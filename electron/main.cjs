const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { ChatCore } = require('../src/core/chat-core.cjs');
const { ConfigStore } = require('../src/core/config-store.cjs');
const { OverlayServer } = require('../src/core/overlay-server.cjs');
const { OBSController } = require('../src/core/obs-controller.cjs');
const { StatusMonitor } = require('../src/core/status-monitor.cjs');
const { ActionEngine } = require('../src/core/action-engine.cjs');
const { AxelChatAdapter } = require('../src/adapters/axelchat.cjs');
const { TikFinityAdapter } = require('../src/adapters/tikfinity.cjs');
const { TwitchAdapter } = require('../src/adapters/twitch.cjs');
const { YouTubeAdapter } = require('../src/adapters/youtube.cjs');
const { MockAdapter } = require('../src/adapters/mock.cjs');

let mainWindow;
let detachedWindow;
let configStore;
let secretStore;
let chatCore;
let overlayServer;
let obs;
let statusMonitor;
let actionEngine;
let adapters;
let autoBroadcastTimer = null;
let autoBroadcastIndex = 0;
let autoBroadcastStartedAt = 0;

class SecretStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'BattoMultiChat', 'secrets.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  read() {
    try {
      return fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  write(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get(key) {
    const value = this.read()[key];
    if (!value || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }

  set(key, value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows Secure Storage ist nicht verfügbar.');
    }
    const data = this.read();
    const clean = String(value || '');
    if (clean) data[key] = safeStorage.encryptString(clean).toString('base64');
    else delete data[key];
    this.write(data);
  }

  delete(key) {
    const data = this.read();
    delete data[key];
    this.write(data);
  }
}

function send(channel, payload) {
  for (const win of [mainWindow, detachedWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function createWindow(detached = false) {
  const saved = configStore?.get()?.windows?.[detached ? 'detachedBounds' : 'mainBounds'];
  const win = new BrowserWindow({
    width: saved?.width || (detached ? 720 : 1600),
    height: saved?.height || 980,
    x: Number.isFinite(saved?.x) ? saved.x : undefined,
    y: Number.isFinite(saved?.y) ? saved.y : undefined,
    minWidth: detached ? 520 : 1180,
    minHeight: 700,
    show: false,
    title: detached ? 'CRAZY_BATTO Multi-Chat – Chat' : 'CRAZY_BATTO Multi-Chat Platform',
    backgroundColor: '#eef7ff',
    icon: path.join(__dirname, '..', 'src', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
    query: { detached: detached ? '1' : '0' }
  });
  win.once('ready-to-show', () => win.show());

  let timer;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed()) {
        configStore.merge({ windows: { [detached ? 'detachedBounds' : 'mainBounds']: win.getBounds() } });
      }
    }, 250);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  return win;
}

function platformStatus() {
  return Object.fromEntries(Object.entries(adapters || {}).map(([key, adapter]) => [key, adapter.getStatus()]));
}

async function sendDiscord(text) {
  const url = secretStore.get('discord.webhook');
  if (!url) throw new Error('Kein Discord Webhook gespeichert.');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: String(text || 'CRAZY_BATTO') })
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
  return { ok: true };
}

async function sendOutbound(platform, text, { source = 'manual' } = {}) {
  const target = String(platform || 'local').toLowerCase();
  const message = String(text || '').trim();
  if (!message) throw new Error('Nachricht ist leer.');

  if (target === 'local') {
    adapters.mock.emitOne({ platform: 'local', username: configStore.get().general.displayName, text: message });
    return { ok: true, mode: 'local' };
  }

  if (target === 'cng') {
    const cfg = configStore.get();
    if (cfg.platforms.cng?.localBroadcastEnabled !== false && cfg.autoBroadcast?.localCngOverlay !== false) {
      chatCore.ingest({
        platform: 'cng',
        username: cfg.general.displayName,
        displayName: cfg.general.displayName,
        message,
        raw: { source: `cng-local-${source}`, localOverlayOnly: true }
      });
      chatCore.log('INFO', 'CNG', 'CNG Auto-Broadcast wurde im lokalen Multi-Chat/Overlay ausgegeben. Kein Plattform-Post wurde simuliert.');
      return { ok: true, mode: 'cng-local-overlay' };
    }
    throw new Error('CNG Schreiben ist nicht über eine dokumentierte Plattform-Schnittstelle verbunden.');
  }

  if (target === 'twitch' && typeof adapters.twitch?.sendChat === 'function') {
    await adapters.twitch.sendChat(message);
    return { ok: true, mode: 'twitch' };
  }

  if (target === 'youtube' && typeof adapters.youtube?.sendChat === 'function') {
    await adapters.youtube.sendChat(message);
    return { ok: true, mode: 'youtube' };
  }

  throw new Error(`Senden an ${target} ist ohne autorisierte Schreib-Verbindung deaktiviert.`);
}

function stripTtsText(text, cfg) {
  let value = String(text || '');
  if (cfg?.stripUrls) value = value.replace(/https?:\/\/\S+/gi, ' Link ');
  return value.replace(/\s+/g, ' ').trim();
}

function broadcastMessageNow() {
  const cfg = configStore.get().autoBroadcast || {};
  const messages = (cfg.messages || []).map(String).map((x) => x.trim()).filter(Boolean);
  if (!cfg.enabled || !messages.length) return;

  let text;
  if ((cfg.mode || 'sequence') === 'random') {
    text = messages[Math.floor(Math.random() * messages.length)];
  } else {
    text = messages[autoBroadcastIndex % messages.length];
    autoBroadcastIndex = (autoBroadcastIndex + 1) % messages.length;
  }

  for (const platform of cfg.targets || []) {
    sendOutbound(platform, text, { source: 'auto-broadcast' })
      .catch((error) => chatCore.log('WARN', 'Auto-Broadcast', `${platform}: ${error.message}`));
  }
}

function restartAutoBroadcast() {
  clearInterval(autoBroadcastTimer);
  autoBroadcastTimer = null;
  autoBroadcastIndex = 0;
  autoBroadcastStartedAt = Date.now();

  const cfg = configStore.get().autoBroadcast || {};
  if (!cfg.enabled) return;
  const intervalMs = Math.max(30, Number(cfg.intervalSeconds || 600)) * 1000;
  const delayMs = Math.max(0, Number(cfg.startDelaySeconds || 0)) * 1000;

  setTimeout(() => {
    if (!configStore.get().autoBroadcast?.enabled) return;
    broadcastMessageNow();
    autoBroadcastTimer = setInterval(broadcastMessageNow, intervalMs);
  }, delayMs);
}

function powershell(script) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Diese TTS-Funktion ist für Windows vorgesehen.'));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell Code ${code}`)));
  });
}

function psString(value) {
  return String(value || '').replace(/'/g, "''");
}

async function listTtsVoices() {
  if (process.platform !== 'win32') return [];
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v=$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Select-Object Name,@{n='Culture';e={$_.Culture.Name}},Gender,Age; $s.Dispose(); $v | ConvertTo-Json -Compress`;
  const raw = await powershell(script);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((voice) => ({
    name: voice.Name,
    culture: voice.Culture,
    gender: String(voice.Gender || ''),
    age: String(voice.Age || '')
  }));
}

async function synthesizeTts(payload = {}) {
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('TTS-Text ist leer.');
  const cfg = configStore.get().tts || {};
  const voice = String(payload.voice || cfg.voice || '');
  const rate = Number(payload.rate ?? cfg.rate ?? 1);
  const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 5)));
  const file = path.join(configStore.ttsDir, `tts-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.wav`);
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `try{$s.SelectVoice('${psString(voice)}')}catch{}` : ''} $s.Rate=${sapiRate}; $s.Volume=100; $s.SetOutputToWaveFile('${psString(file)}'); $s.Speak('${psString(text)}'); $s.Dispose();`;
  await powershell(script);
  return { ok: true, path: file, url: pathToFileURL(file).href };
}

async function startServices() {
  configStore = new ConfigStore(app.getPath('userData'));
  secretStore = new SecretStore(app.getPath('userData'));
  let cfg = configStore.get();

  chatCore = new ChatCore(cfg);
  overlayServer = new OverlayServer({ host: cfg.http.host, port: cfg.http.port, chatCore, configStore });
  obs = new OBSController({ url: cfg.obs.url, password: secretStore.get('obs.password'), onStatus: (status) => send('obs:status', status) });

  const onMessage = (message) => chatCore.ingest(message);
  const onStatus = (status) => send('adapter:status', status);
  const onEvent = (event) => {
    overlayServer.emitEvent(event);
    send('platform:event', event);
    actionEngine?.handleEvent(event);
  };

  adapters = {
    axelchat: new AxelChatAdapter({ ...cfg.platforms.axelchat, onMessage, onEvent, onStatus }),
    tikfinity: new TikFinityAdapter({ ...cfg.platforms.tikfinity, onMessage, onEvent, onStatus }),
    twitch: new TwitchAdapter({ channel: cfg.platforms.twitch.channel, onMessage, onStatus }),
    youtube: new YouTubeAdapter({
      liveChatId: cfg.platforms.youtube.liveChatId,
      apiKey: secretStore.get('youtube.apiKey'),
      pollMs: cfg.platforms.youtube.pollMs,
      onMessage,
      onStatus
    }),
    mock: new MockAdapter({ onMessage, onStatus })
  };

  actionEngine = new ActionEngine({
    getConfig: () => configStore.get(),
    sendChat: (platform, text) => sendOutbound(platform, text, { source: 'automation' }),
    onTts: (payload) => send('tts:speak', payload),
    onOverlay: (event) => overlayServer.emitEvent({ source: 'automation', event: event.type || 'custom', data: event.data || {} }),
    onDiscord: sendDiscord,
    onLog: (level, category, message, meta) => chatCore.log(level, category, message, meta)
  });

  chatCore.on('message', (message) => {
    send('chat:message', message);
    actionEngine.handleMessage(message);
    const tts = configStore.get().tts || {};
    if (tts.enabled && tts.readChat && (tts.platforms || []).includes(message.platform)) {
      const text = stripTtsText(`${message.displayName || message.username}: ${message.message}`, tts);
      if (text) send('tts:speak', { text, voice: tts.voice, rate: tts.rate, pitch: tts.pitch, volume: tts.volume });
    }
  });
  chatCore.on('moderation', (event) => send('moderation:event', event));
  chatCore.on('filter-hit', (event) => send('filter:hit', event));
  chatCore.on('log', (event) => send('log:event', event));
  chatCore.on('config-dirty', (config) => configStore.merge({ moderation: config.moderation, filters: config.filters }));

  if (cfg.http.enabled && cfg.http.autoStart !== false) {
    await overlayServer.start().catch((error) => chatCore.log('ERROR', 'Overlay', error.message));
  }

  for (const name of ['axelchat', 'tikfinity', 'twitch', 'youtube']) {
    const platformConfig = cfg.platforms[name];
    if (platformConfig?.autoConnect) {
      try { await adapters[name].connect(); } catch (error) { chatCore.log('WARN', name, error.message); }
    }
  }

  if (cfg.obs.autoConnect) {
    try { await obs.connect(); } catch (error) { chatCore.log('WARN', 'OBS', error.message); }
  }

  statusMonitor = new StatusMonitor({ obs, onStatus: (status) => send('system:status', status) });
  statusMonitor.start();
  restartAutoBroadcast();
}

function applyConfig(next, patch = {}) {
  chatCore.setConfig(next);
  if (patch.platforms?.axelchat) adapters.axelchat.updateConfig(next.platforms.axelchat);
  if (patch.platforms?.tikfinity) adapters.tikfinity.updateConfig(next.platforms.tikfinity);
  if (patch.platforms?.twitch) adapters.twitch.updateConfig(next.platforms.twitch);
  if (patch.platforms?.youtube) adapters.youtube.updateConfig({ ...next.platforms.youtube, apiKey: secretStore.get('youtube.apiKey') });
  if (patch.obs) obs.updateConfig({ ...next.obs, password: secretStore.get('obs.password') });
  if (patch.autoBroadcast) restartAutoBroadcast();
  send('config:changed', next);
}

function registerIpc() {
  ipcMain.handle('state:get', () => {
    const cfg = configStore.get();
    return {
      config: cfg,
      messages: chatCore.getMessages(),
      logs: chatCore.getLogs(),
      moderation: chatCore.getModerationState(),
      moderationHistory: chatCore.getModerationHistory(),
      overlay: overlayServer.getStatus(),
      adapters: platformStatus(),
      obs: obs.getStatus(),
      secrets: {
        obsPassword: Boolean(secretStore.get('obs.password')),
        youtubeApiKey: Boolean(secretStore.get('youtube.apiKey')),
        discordWebhook: Boolean(secretStore.get('discord.webhook')),
        cngObsChatUrl: Boolean(secretStore.get('cng.obsChatUrl'))
      }
    };
  });

  ipcMain.handle('config:save', async (_event, patch) => {
    const next = configStore.merge(patch || {});
    applyConfig(next, patch || {});
    if (patch?.http) {
      if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
      else await overlayServer.stop();
    }
    return next;
  });

  ipcMain.handle('config:reset', (_event, section) => {
    const next = configStore.resetSection(section);
    applyConfig(next, { [section]: next[section] });
    return next;
  });

  ipcMain.handle('adapter:connect', async (_event, name) => {
    const adapter = adapters[name];
    if (!adapter) return { ok: false, error: 'Unbekannter Adapter' };
    try { return await adapter.connect(); }
    catch (error) { return { ok: false, error: error.message, status: adapter.getStatus() }; }
  });

  ipcMain.handle('adapter:disconnect', (_event, name) => {
    const adapter = adapters[name];
    if (!adapter) return { ok: false, error: 'Unbekannter Adapter' };
    adapter.disconnect();
    return { ok: true, status: adapter.getStatus() };
  });

  ipcMain.handle('chat:test', (_event, payload) => {
    adapters.mock.emitOne(payload || {});
    return { ok: true };
  });

  ipcMain.handle('chat:send', async (_event, payload = {}) => {
    try { return await sendOutbound(payload.platform, payload.text, { source: 'manual' }); }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('moderation:act', (_event, payload) => {
    const result = chatCore.moderate(payload);
    if (result.ok) configStore.merge({ moderation: { state: chatCore.getModerationState(), history: chatCore.getModerationHistory() } });
    return result;
  });

  ipcMain.handle('filter:add', (_event, payload) => {
    const result = chatCore.addFilter(payload);
    if (result.ok) configStore.merge({ filters: chatCore.config.filters });
    return result;
  });
  ipcMain.handle('filter:remove', (_event, id) => {
    const result = chatCore.removeFilter(id);
    if (result.ok) configStore.merge({ filters: chatCore.config.filters });
    return result;
  });

  ipcMain.handle('chat:clear', () => { chatCore.clearMessages(); return { ok: true }; });
  ipcMain.handle('logs:clear', () => { chatCore.clearLogs(); return { ok: true }; });

  ipcMain.handle('obs:connect', async (_event, payload = {}) => {
    try {
      if (payload.password) secretStore.set('obs.password', payload.password);
      const cfg = configStore.get();
      const url = payload.url || cfg.obs.url || 'ws://127.0.0.1:4455';
      const next = configStore.merge({ obs: { ...cfg.obs, url, autoConnect: Boolean(payload.autoConnect) } });
      obs.updateConfig({ url, password: secretStore.get('obs.password') });
      send('config:changed', next);
      return await obs.connect();
    } catch (error) {
      return { ok: false, error: error.message, status: obs.getStatus() };
    }
  });
  ipcMain.handle('obs:disconnect', async () => { await obs.disconnect(); return { ok: true, status: obs.getStatus() }; });

  ipcMain.handle('youtube:saveKey', (_event, key) => {
    secretStore.set('youtube.apiKey', key);
    adapters.youtube.updateConfig({ ...configStore.get().platforms.youtube, apiKey: secretStore.get('youtube.apiKey') });
    return { ok: true, hasKey: Boolean(key) };
  });

  ipcMain.handle('discord:saveWebhook', (_event, url) => {
    secretStore.set('discord.webhook', url);
    return { ok: true, hasWebhook: Boolean(url) };
  });
  ipcMain.handle('discord:test', async (_event, text) => {
    try { return await sendDiscord(text || 'CRAZY_BATTO Test'); }
    catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('cng:saveChatUrl', (_event, url) => {
    const value = String(url || '').trim();
    if (value && !/^https:\/\/cng-plattform\.com\//i.test(value)) {
      return { ok: false, error: 'Die CNG Chat-URL muss von cng-plattform.com stammen.' };
    }
    secretStore.set('cng.obsChatUrl', value);
    return { ok: true, hasUrl: Boolean(value) };
  });
  ipcMain.handle('cng:clearChatUrl', () => {
    secretStore.delete('cng.obsChatUrl');
    return { ok: true };
  });
  ipcMain.handle('cng:copyUrl', (_event, kind) => {
    const cfg = configStore.get().platforms.cng || {};
    const value = kind === 'alert'
      ? cfg.alertOverlayUrl
      : kind === 'ghost'
        ? cfg.ghostChatUrl
        : secretStore.get('cng.obsChatUrl');
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    clipboard.writeText(value);
    return { ok: true };
  });
  ipcMain.handle('cng:openUrl', async (_event, kind) => {
    const cfg = configStore.get().platforms.cng || {};
    const value = kind === 'alert'
      ? cfg.alertOverlayUrl
      : kind === 'ghost'
        ? cfg.ghostChatUrl
        : secretStore.get('cng.obsChatUrl');
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    await shell.openExternal(value);
    return { ok: true };
  });

  ipcMain.handle('tts:listVoices', async () => {
    try { return { ok: true, voices: await listTtsVoices() }; }
    catch (error) { return { ok: false, error: error.message, voices: [] }; }
  });
  ipcMain.handle('tts:synthesize', async (_event, payload) => {
    try { return await synthesizeTts(payload); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('tts:cleanup', (_event, filePath) => {
    try {
      const resolved = path.resolve(String(filePath || ''));
      if (resolved.startsWith(path.resolve(configStore.ttsDir)) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('dialog:font', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Eigene Schrift auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const src = result.filePaths[0];
    const ext = path.extname(src).toLowerCase();
    const dest = path.join(configStore.fontDir, `custom${ext}`);
    fs.copyFileSync(src, dest);
    const cfg = configStore.merge({ chatDesign: { customFontPath: dest, fontFamily: 'BattoCustom' } });
    send('config:changed', cfg);
    return { ok: true, path: dest, config: cfg };
  });

  ipcMain.handle('dialog:media', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Medien hinzufügen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Medien', extensions: ['mp3', 'wav', 'ogg', 'mp4', 'webm', 'gif', 'png', 'jpg', 'jpeg'] }]
    });
    if (result.canceled) return { ok: false, canceled: true };
    const cfg = configStore.get();
    const items = [...(cfg.media || [])];
    const added = [];
    for (const src of result.filePaths) {
      const ext = path.extname(src);
      const name = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      const dest = path.join(configStore.mediaDir, name);
      fs.copyFileSync(src, dest);
      const item = { id: crypto.randomUUID(), name: path.basename(src), path: dest, type: ext.replace('.', '').toLowerCase() };
      items.push(item);
      added.push(item);
    }
    const next = configStore.merge({ media: items });
    send('config:changed', next);
    return { ok: true, config: next, items: added };
  });

  ipcMain.handle('media:remove', (_event, id) => {
    const cfg = configStore.get();
    const item = (cfg.media || []).find((x) => x.id === id);
    if (!item) return { ok: false, error: 'Medium nicht gefunden.' };
    try { if (item.path && fs.existsSync(item.path)) fs.unlinkSync(item.path); } catch {}
    const media = (cfg.media || []).filter((x) => x.id !== id);
    const mediaPools = (cfg.mediaPools || []).map((pool) => ({ ...pool, mediaIds: (pool.mediaIds || []).filter((mediaId) => mediaId !== id) }));
    const next = configStore.merge({ media, mediaPools });
    send('config:changed', next);
    return { ok: true, config: next };
  });

  ipcMain.handle('automation:testAction', async (_event, action) => {
    try {
      await actionEngine.execute([action], { user: 'Crazy_User', username: 'Crazy_User', platform: 'local', message: 'Test' });
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('broadcast:test', async () => {
    const cfg = configStore.get().autoBroadcast || {};
    const messages = (cfg.messages || []).filter(Boolean);
    if (!messages.length) return { ok: false, error: 'Keine Broadcast-Nachricht eingetragen.' };
    const text = messages[0];
    const results = [];
    for (const platform of cfg.targets || []) {
      try { results.push({ platform, ...(await sendOutbound(platform, text, { source: 'broadcast-test' })) }); }
      catch (error) { results.push({ platform, ok: false, error: error.message }); }
    }
    return { ok: results.some((x) => x.ok), results };
  });

  ipcMain.handle('overlay:open', async (_event, route = '/overlay/chat') => {
    const status = overlayServer.getStatus();
    if (!status.running) return { ok: false, error: 'Overlay-Server läuft nicht.' };
    const url = `http://${status.host}:${status.port}${route}`;
    await shell.openExternal(url);
    return { ok: true, url };
  });
  ipcMain.handle('overlay:testEvent', (_event, event = 'gift') => {
    const evt = { source: 'test', platform: 'tiktok', event, data: { nickname: 'Crazy_User', text: 'Test Event', value: 100 }, timestamp: new Date().toISOString() };
    overlayServer.emitEvent(evt);
    send('platform:event', evt);
    actionEngine.handleEvent(evt);
    return { ok: true };
  });

  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
  ipcMain.handle('backup:now', () => ({ ok: true, filePath: configStore.backupNow(), backups: configStore.listBackups() }));
  ipcMain.handle('backup:list', () => ({ ok: true, backups: configStore.listBackups() }));
  ipcMain.handle('backup:restore', async (_event, file) => {
    const next = configStore.restoreBackup(file);
    applyConfig(next, next);
    return { ok: true, config: next };
  });

  ipcMain.handle('dialog:exportConfig', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Config exportieren',
      defaultPath: 'crazy-batto-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    configStore.exportTo(result.filePath);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('dialog:importConfig', async () => {
    const result = await dialog.showOpenDialog({ title: 'Config importieren', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const next = configStore.importFrom(result.filePaths[0]);
    applyConfig(next, next);
    return { ok: true, config: next };
  });

  ipcMain.handle('window:detach', () => {
    if (!detachedWindow || detachedWindow.isDestroyed()) {
      detachedWindow = createWindow(true);
      detachedWindow.on('closed', () => {
        detachedWindow = null;
        configStore.merge({ windows: { detachedOpen: false } });
      });
      configStore.merge({ windows: { detachedOpen: true } });
    } else detachedWindow.focus();
    return { ok: true };
  });
  ipcMain.handle('window:closeDetached', () => { detachedWindow?.close(); return { ok: true }; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await startServices();
    registerIpc();
    mainWindow = createWindow(false);
    mainWindow.on('closed', () => { mainWindow = null; });
    if (configStore.get().windows.detachedOpen) {
      detachedWindow = createWindow(true);
      detachedWindow.on('closed', () => { detachedWindow = null; });
    }
    app.on('activate', () => { if (!mainWindow) mainWindow = createWindow(false); });
  });
}

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      clearInterval(autoBroadcastTimer);
      statusMonitor?.stop();
      for (const adapter of Object.values(adapters || {})) adapter.disconnect?.();
      await obs?.disconnect?.();
      await overlayServer?.stop?.();
    } catch {}
    app.quit();
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
