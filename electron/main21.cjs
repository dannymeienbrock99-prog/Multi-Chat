// RELEASE_213_COMPLETE
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeImage } = require('electron');
const { BroadcastService } = require('../src/core/broadcast/service.cjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const { ChatCore } = require('../src/core/chat-core.cjs');
const { ConfigStore } = require('../src/core/config-store.cjs');
const { SettingsService } = require('../src/core/settings/settings-service.cjs');
const { SecretsService } = require('../src/core/settings/secrets-service.cjs');
const { validateConfig } = require('../src/core/settings/schema.cjs');
const { EventCore } = require('../src/core/events/event-core.cjs');
const { ConnectorManager } = require('../src/core/connectors/connector-manager.cjs');
const { OverlayServer } = require('../src/core/overlay-server.cjs');
const { OBSController } = require('../src/core/obs-controller.cjs');
const { StatusMonitor } = require('../src/core/status-monitor.cjs');
const { ActionEngine } = require('../src/core/action-engine.cjs');
const { Logger, redact } = require('../src/core/logging/logger.cjs');
const { HealthService } = require('../src/core/health/health-service.cjs');
const { AuditStore } = require('../src/core/storage/audit-store.cjs');
const { FFmpegService } = require('../src/core/media/ffmpeg-service.cjs');
const { validateChatBackgroundFile, isPathInside } = require('../src/core/media/chat-background.cjs');
const { LOCAL_CHAT_ICON_SIZE, validateLocalChatIconSource } = require('../src/core/media/local-chat-icon.cjs');
const { AxelChatAdapter } = require('../src/adapters/axelchat.cjs');
const { TikFinityAdapter } = require('../src/adapters/tikfinity.cjs');
const { TwitchAdapter } = require('../src/adapters/twitch.cjs');
const { YouTubeAdapter } = require('../src/adapters/youtube.cjs');
const { MockAdapter } = require('../src/adapters/mock.cjs');

let mainWindow;
let detachedWindow;
let configStore;
let settingsService;
let secretsService;
let chatCore;
let eventCore;
let connectorManager;
let overlayServer;
let obs;
let statusMonitor;
let actionEngine;
let logger;
let healthService;
let auditStore;
let ffmpeg;
let adapters = {};
let broadcastService = null;
let autoBroadcastTimer = null;
let autoBroadcastDelayTimer = null;
let autoBroadcastIndex = 0;
let quitting = false;
let obsWasLive = false;

const SECRET_REFS = {
  obs: 'obs-password',
  youtube: 'youtube-api-key',
  discord: 'discord-webhook',
  cng: 'cng-obs-chat-url'
};
const CHAT_BACKGROUND_PRESET_URL = '../assets/source/crazy-batto-chat-default.jpg';

function send(channel, payload) {
  for (const win of [mainWindow, detachedWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function bridgeLog(level, module, code, context = {}) {
  const normalized = String(level || 'info').toLowerCase();
  const message = context?.message ? `${code}: ${context.message}` : String(code || '');
  if (chatCore) chatCore.log(normalized.toUpperCase(), module, message, { code, ...redact(context) });
  else logger?.write(normalized, module, code, message, context);
}

function migrateLegacySecrets(userDataPath) {
  try {
    const oldFile = path.join(userDataPath, 'BattoMultiChat', 'secrets.json');
    if (!fs.existsSync(oldFile) || !safeStorage.isEncryptionAvailable()) return;
    const old = JSON.parse(fs.readFileSync(oldFile, 'utf8')) || {};
    const mapping = {
      'obs.password': SECRET_REFS.obs,
      'youtube.apiKey': SECRET_REFS.youtube,
      'discord.webhook': SECRET_REFS.discord,
      'cng.obsChatUrl': SECRET_REFS.cng
    };
    for (const [legacyKey, ref] of Object.entries(mapping)) {
      if (secretsService.has(ref) || !old[legacyKey]) continue;
      try {
        const value = safeStorage.decryptString(Buffer.from(String(old[legacyKey]), 'base64'));
        if (value) secretsService.set(ref, value);
      } catch {}
    }
  } catch {}
}

function createWindow(detached = false) {
  const saved = configStore?.get()?.windows?.[detached ? 'detachedBounds' : 'mainBounds'];
  const win = new BrowserWindow({
    width: saved?.width || (detached ? 720 : 1600),
    height: saved?.height || 980,
    x: Number.isFinite(saved?.x) ? saved.x : undefined,
    y: Number.isFinite(saved?.y) ? saved.y : undefined,
    minWidth: detached ? 520 : 1180,
    autoHideMenuBar: true,
    minHeight: 700,
    show: false,
    title: detached ? 'Batto OBS Tool 2.1 – Multi-Chat' : 'Batto OBS Tool 2.1',
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, '..', 'src', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
    query: { detached: detached ? '1' : '0' }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url).catch(()=>{});return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(pathToFileURL(path.join(__dirname,'..','src','renderer','index.html')).href))event.preventDefault();});
  let timer;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed()) configStore.merge({ windows: { [detached ? 'detachedBounds' : 'mainBounds']: win.getBounds() } });
    }, 300);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  return win;
}

function normalizedToChat(event) {
  return {
    id: event.eventId,
    platform: event.platform,
    userId: event.user?.id,
    username: event.user?.username,
    displayName: event.user?.displayName,
    message: event.message?.text || '',
    timestamp: event.timestamp,
    badges: event.user?.badges || [],
    moderator: Boolean(event.user?.isModerator),
    raw: event
  };
}

function normalizedToUiEvent(event) {
  const data = {
    user: event.user,
    message: event.message,
    gift: event.gift,
    moderation: event.moderation,
    username: event.user?.username,
    nickname: event.user?.displayName,
    uniqueId: event.user?.username,
    text: event.message?.text,
    giftName: event.gift?.name,
    count: event.gift?.count,
    value: event.gift?.value
  };
  return {
    source: event.meta?.sourceConnector,
    platform: event.platform,
    type: event.type,
    event: event.type,
    data,
    timestamp: event.timestamp,
    eventId: event.eventId
  };
}

function assetStatus() {
  const cfg = configStore.get();
  const missing = [];
  for (const media of cfg.media || []) {
    if (media.path && !fs.existsSync(media.path)) missing.push({ type: 'media', id: media.id, name: media.name });
  }
  const font = cfg.chatDesign?.customFontPath;
  if (font && !fs.existsSync(font)) missing.push({ type: 'font', name: path.basename(font) });
  const chatBackground = cfg.appearance?.chatBackground;
  if (chatBackground?.mode === 'custom') {
    const validation = validateChatBackgroundFile(chatBackground.customPath);
    if (!validation.ok) missing.push({ type:'chat-background', name:chatBackground.customName || 'Chatfenster-Bild', error:validation.error });
  }
  const localIcon = cfg.appearance?.chatIcons?.local;
  if (localIcon?.mode === 'custom') {
    const asset = localChatIconAsset(cfg);
    if (asset.missing) missing.push({ type:'local-chat-icon', name:localIcon.customName || 'Lokaler Chat / Overlay', error:asset.error });
  }
  return { missing: missing.length, invalid: 0, items: missing.slice(0, 100) };
}

async function sendDiscord(text) {
  const url = secretsService.get(SECRET_REFS.discord);
  if (!url) throw new Error('Kein Discord Webhook gespeichert.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: String(text || 'CRAZY_BATTO') }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
    return { ok: true };
  } finally { clearTimeout(timer); }
}

async function safeHttpAction(action = {}) {
  const url = new URL(String(action.url || ''));
  const cfg = configStore.get();
  const allowed = new Set(['127.0.0.1', 'localhost', '::1', ...((cfg.rules?.httpAllowlist || []).map(String))]);
  if (!allowed.has(url.hostname)) throw new Error(`HTTP-Ziel ${url.hostname} ist nicht in der Allowlist.`);
  const method = String(action.method || 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('HTTP-Methode ist nicht erlaubt.');
  const controller = new AbortController();
  const timeoutMs = Math.max(500, Math.min(15000, Number(action.timeoutMs || 5000)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: action.body ? { 'content-type': 'application/json' } : undefined,
      body: action.body && method !== 'GET' ? String(action.body) : undefined,
      signal: controller.signal
    });
    return { ok: response.ok, status: response.status };
  } finally { clearTimeout(timer); }
}

async function sendOutbound(platform, text, { source = 'manual' } = {}) {
  const target = String(platform || 'local').toLowerCase();
  const message = String(text || '').trim();
  if (!message) throw new Error('Nachricht ist leer.');

  if (target === 'local') {
    eventCore.ingestChat({ platform: 'internal', username: configStore.get().general.displayName, text: message }, `local-${source}`);
    return { ok: true, mode: 'local' };
  }

  if (target === 'cng') {
    const cfg = configStore.get();
    if (cfg.platforms.cng?.localBroadcastEnabled !== false && cfg.autoBroadcast?.localCngOverlay !== false) {
      eventCore.ingestChat({ platform: 'cng', username: cfg.general.displayName, displayName: cfg.general.displayName, text: message }, `cng-local-${source}`);
      bridgeLog('info', 'CNG', 'LOCAL_OVERLAY_ONLY', { message: 'CNG Nachricht lokal im Multi-Chat/Overlay ausgegeben; kein Plattform-Post simuliert.' });
      return { ok: true, mode: 'cng-local-overlay' };
    }
    throw new Error('CNG Schreiben ist nicht über eine dokumentierte Plattform-Schnittstelle verbunden.');
  }

  const adapter = connectorManager.get(target);
  if (adapter && typeof adapter.sendChat === 'function') {
    await adapter.sendChat(message);
    return { ok: true, mode: target };
  }
  throw new Error(`Senden an ${target} ist ohne autorisierte Schreib-Verbindung deaktiviert.`);
}

function stripTtsText(text, cfg) {
  let value = String(text || '');
  if (cfg?.stripUrls) value = value.replace(/https?:\/\/\S+/gi, ' Link ');
  return value.replace(/\s+/g, ' ').trim();
}

function handleNormalizedEvent(event) {
  auditStore?.writeEvent(event);
  if (event.type === 'chat') {
    const accepted = chatCore.ingest(normalizedToChat(event));
    if (!accepted) return;
    const source=String(event.meta?.sourceConnector || '');
    if (!/automation|broadcast|mock|fake|test|local/i.test(source)) broadcastService?.noteChat(event.platform);
    actionEngine.handleMessage(event).catch((error) => bridgeLog('warn', 'Rules', 'COMMAND_FAILED', { message: error.message }));
    const tts = configStore.get().tts || {};
    if (tts.enabled && tts.readChat && (tts.platforms || []).includes(event.platform)) {
      const text = stripTtsText(`${event.user?.displayName || event.user?.username}: ${event.message?.text || ''}`, tts);
      if (text) send('tts:speak', { text, voice: tts.voice, rate: tts.rate, pitch: tts.pitch, volume: tts.volume, outputDeviceId: tts.outputDeviceId });
    }
    return;
  }

  overlayServer.emitEvent(event);
  send('platform:event', normalizedToUiEvent(event));
  actionEngine.handleEvent(event).catch((error) => bridgeLog('warn', 'Rules', 'EVENT_RULE_FAILED', { message: error.message }));
}

function restartAutoBroadcast() {
  clearTimeout(autoBroadcastDelayTimer);clearInterval(autoBroadcastTimer);
  autoBroadcastDelayTimer=null;autoBroadcastTimer=null;
  broadcastService?.start();
}

function registerBroadcastIpc() {
  const wrap=fn=>async(_event,payload)=>{try{return await fn(payload);}catch(e){return{ok:false,error:e.message};}};
  ipcMain.handle('broadcast:status',()=>broadcastService.status());
  ipcMain.handle('broadcast:upsert',wrap(x=>broadcastService.upsert(x)));
  ipcMain.handle('broadcast:delete',wrap(x=>broadcastService.remove(x)));
  ipcMain.handle('broadcast:duplicate',wrap(x=>broadcastService.duplicate(x)));
  ipcMain.handle('broadcast:master',wrap(x=>broadcastService.master(x)));
  ipcMain.handle('broadcast:testItem',wrap(x=>broadcastService.test(x)));
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

function psString(value) { return String(value || '').replace(/'/g, "''"); }

async function listTtsVoices() {
  if (process.platform !== 'win32') return [];
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v=$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Select-Object Name,@{n='Culture';e={$_.Culture.Name}},Gender,Age; $s.Dispose(); $v | ConvertTo-Json -Compress`;
  const raw = await powershell(script);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((voice) => ({ name: voice.Name, culture: voice.Culture, gender: String(voice.Gender || ''), age: String(voice.Age || '') }));
}

async function synthesizeTts(payload = {}) {
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('TTS-Text ist leer.');
  const cfg = configStore.get().tts || {};
  const voice = String(payload.voice || cfg.voice || '');
  const rate = Number(payload.rate ?? cfg.rate ?? 1);
  const volume = Math.max(0, Math.min(1, Number(payload.volume ?? cfg.volume ?? 1)));
  const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 5)));
  const file = path.join(configStore.ttsDir, `tts-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.wav`);
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `try{$s.SelectVoice('${psString(voice)}')}catch{}` : ''} $s.Rate=${sapiRate}; $s.Volume=100; $s.SetOutputToWaveFile('${psString(file)}'); $s.Speak('${psString(text)}'); $s.Dispose();`;
  await powershell(script);
  return { ok: true, path: file, url: pathToFileURL(file).href, outputDeviceId: payload.outputDeviceId || cfg.outputDeviceId || 'default' };
}

function currentConfig() { return configStore.get(); }

function chatBackgroundAsset(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatBackground || {};
  if (selected.mode === 'custom') {
    const validation = validateChatBackgroundFile(selected.customPath);
    if (validation.ok) return { mode:'custom', url:pathToFileURL(validation.path).href, name:selected.customName || path.basename(validation.path), missing:false };
    return { mode:'preset', url:CHAT_BACKGROUND_PRESET_URL, name:'Crazy_Batto Social-Media-Motiv', missing:true, error:validation.error };
  }
  return { mode:'preset', url:CHAT_BACKGROUND_PRESET_URL, name:'Crazy_Batto Social-Media-Motiv', missing:false };
}

function configuredLocalChatIcon(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatIcons?.local || {};
  if (selected.mode !== 'custom') return { ok:false, default:true };
  if (!isPathInside(selected.customPath, configStore.imageDir)) return { ok:false, error:'Das lokale Chat-Icon liegt nicht im geschützten App-Bildordner.' };
  const validation = validateLocalChatIconSource(selected.customPath);
  if (!validation.ok) return validation;
  if (validation.ext !== '.png') return { ok:false, error:'Das gespeicherte lokale Chat-Icon ist kein PNG.' };
  const decoded = nativeImage.createFromPath(validation.path);
  const size = decoded.getSize();
  if (decoded.isEmpty() || size.width !== LOCAL_CHAT_ICON_SIZE || size.height !== LOCAL_CHAT_ICON_SIZE) return { ok:false, error:`Das lokale Chat-Icon muss ${LOCAL_CHAT_ICON_SIZE} × ${LOCAL_CHAT_ICON_SIZE} Pixel groß sein.` };
  return { ...validation, width:size.width, height:size.height };
}

function localChatIconAsset(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatIcons?.local || {};
  if (selected.mode === 'custom') {
    const validation = configuredLocalChatIcon(cfg);
    if (validation.ok) return { mode:'custom', url:pathToFileURL(validation.path).href, overlayUrl:'/assets/custom/local-chat-icon.png', name:selected.customName || path.basename(validation.path), width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:false };
    return { mode:'default', url:'', overlayUrl:'', name:'Standardpunkt', width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:true, error:validation.error };
  }
  return { mode:'default', url:'', overlayUrl:'', name:'Standardpunkt', width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:false };
}

function normalizeLocalChatIcon(sourcePath) {
  const decoded = nativeImage.createFromPath(sourcePath);
  const sourceSize = decoded.getSize();
  if (decoded.isEmpty() || sourceSize.width < 1 || sourceSize.height < 1) throw new Error('Das ausgewählte Icon konnte nicht gelesen werden.');
  if (sourceSize.width > 12000 || sourceSize.height > 12000) throw new Error('Das Ausgangsbild darf höchstens 12000 × 12000 Pixel groß sein.');
  const side = Math.min(sourceSize.width, sourceSize.height);
  const square = decoded.crop({ x:Math.floor((sourceSize.width-side)/2), y:Math.floor((sourceSize.height-side)/2), width:side, height:side });
  const normalized = square.resize({ width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, quality:'best' });
  const outputSize = normalized.getSize();
  const bytes = normalized.toPNG();
  if (normalized.isEmpty() || outputSize.width !== LOCAL_CHAT_ICON_SIZE || outputSize.height !== LOCAL_CHAT_ICON_SIZE || !bytes.length) throw new Error('Das Icon konnte nicht auf 128 × 128 Pixel aufbereitet werden.');
  return { bytes, sourceWidth:sourceSize.width, sourceHeight:sourceSize.height };
}

function removeManagedImage(filePath) {
  try {
    if (isPathInside(filePath, configStore.imageDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function applyConfig(next, patch = {}) {
  chatCore.setConfig(next);
  for (const name of ['axelchat', 'tikfinity', 'twitch', 'youtube']) {
    const pcfg = next.platforms?.[name];
    if (!pcfg) continue;
    connectorManager.configure(name, { enabled: pcfg.enabled !== false });
    const adapter = connectorManager.get(name);
    if (patch.platforms?.[name] && typeof adapter?.updateConfig === 'function') {
      adapter.updateConfig(name === 'youtube' ? { ...pcfg, apiKey: secretsService.get(SECRET_REFS.youtube) } : pcfg);
    }
  }
  if (patch.obs) obs.updateConfig({ ...next.obs, password: secretsService.get(SECRET_REFS.obs) });
  if (patch.mediaEngine) ffmpeg.updateConfig({ ffmpegPath: next.mediaEngine.ffmpegPath });
  if (patch.autoBroadcast) restartAutoBroadcast();
  send('config:changed', next);
  overlayServer.broadcast({type:'config',sections:Object.keys(patch)});
}

function diagnosticsSnapshot() {
  const cfg = currentConfig();
  return redact({
    generatedAt: new Date().toISOString(),
    app: { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, arch: process.arch },
    paths: { userData: configStore.dir, logs: configStore.logDir, data: configStore.dataDir, assets: configStore.assetsDir },
    settings: { validation: validateConfig(cfg), dirty: settingsService.isDirty(), schemaVersion: cfg.schemaVersion, version: cfg.version },
    obs: obs.getStatus(), overlay: overlayServer.getStatus(), connectors: connectorManager.statuses(), eventCore: eventCore.getMetrics(),
    ffmpeg: ffmpeg.getStatus(), database: auditStore.getStatus(), assets: assetStatus(), health: healthService?.getStatus(),
    logs: chatCore.getLogs().slice(-100)
  });
}

function initCore() {
  const userDataPath = app.getPath('userData');
  configStore = new ConfigStore(userDataPath);
  settingsService = new SettingsService({ configStore });
  secretsService = new SecretsService({ userDataPath, safeStorage });
  migrateLegacySecrets(userDataPath);
  const cfg = currentConfig();
  logger = new Logger({ dir: configStore.logDir, level: cfg.logging.level, retentionDays: cfg.logging.retentionDays, maxFileBytes: cfg.logging.maxFileBytes });
  logger.cleanup();
  chatCore = new ChatCore(cfg);
  eventCore = new EventCore({ ...cfg.eventCore, onLog: bridgeLog });
  overlayServer = new OverlayServer({ host: cfg.http.host, port: cfg.http.port, chatCore, configStore });
  obs = new OBSController({ ...cfg.obs, password: secretsService.get(SECRET_REFS.obs), onStatus: status => {
    send('obs:status',status);
    if(status.connected && typeof status.outputActive==='boolean' && status.outputActive!==obsWasLive){obsWasLive=status.outputActive;eventCore.ingestEvent({platform:'internal',type:obsWasLive?'stream_start':'stream_end',id:'obs-stream-'+Date.now(),data:{username:currentConfig().general.displayName}},'obs');}
  } });
  auditStore = new AuditStore({ dataDir: configStore.dataDir, onStatus: (status) => send('database:status', status), onLog: bridgeLog });
  ffmpeg = new FFmpegService({ ffmpegPath: cfg.mediaEngine.ffmpegPath, onStatus: (status) => send('ffmpeg:status', status), onLog: bridgeLog });
  connectorManager = new ConnectorManager({ connectTimeoutMs: 12000, onLog: bridgeLog });

  const callbacks = (name) => ({
    onMessage: (message) => { connectorManager.markEvent(name); eventCore.ingestChat(message, name); },
    onEvent: (event) => { connectorManager.markEvent(name); eventCore.ingestEvent(event, name); },
    onStatus: (status) => connectorManager.observeAdapterStatus(name, status)
  });

  adapters = {
    axelchat: new AxelChatAdapter({ ...cfg.platforms.axelchat, ...callbacks('axelchat') }),
    tikfinity: new TikFinityAdapter({ ...cfg.platforms.tikfinity, ...callbacks('tikfinity') }),
    twitch: new TwitchAdapter({ channel: cfg.platforms.twitch.channel, ...callbacks('twitch') }),
    youtube: new YouTubeAdapter({ liveChatId: cfg.platforms.youtube.liveChatId, apiKey: secretsService.get(SECRET_REFS.youtube), pollMs: cfg.platforms.youtube.pollMs, ...callbacks('youtube') }),
    mock: new MockAdapter({ onMessage: (message) => eventCore.ingestChat(message, 'mock'), onStatus: (status) => send('adapter:status', status) })
  };

  for (const name of ['axelchat','tikfinity','twitch','youtube']) {
    connectorManager.register(name, adapters[name], { enabled: cfg.platforms[name]?.enabled !== false, autoReconnect: false });
  }
  connectorManager.on('state', (status) => { auditStore?.writeConnectorState(status); send('adapter:status', status); });

  actionEngine = new ActionEngine({
    getConfig: currentConfig,
    isLive:()=>Boolean(obs.getStatus().connected && obs.getStatus().outputActive),
    sendChat: (platform, text) => sendOutbound(platform, text, { source: 'automation' }),
    onTts: (payload) => send('tts:speak', payload),
    onOverlay: (event) => overlayServer.emitEvent({ schemaVersion: 1, eventId: `internal:${Date.now()}:${crypto.randomUUID()}`, platform: 'internal', type: event.type || 'custom', timestamp: new Date().toISOString(), user: { id: 'system', username: 'system', displayName: 'System', avatar: '', badges: [], isModerator: false }, message: event.data?.text ? { text: event.data.text, emotes: [], reply: null } : null, gift: null, moderation: null, data: event.data || {}, meta: { sourceConnector: 'rule-engine', receivedAt: new Date().toISOString() } }),
    onDiscord: sendDiscord,
    onHttp: safeHttpAction,
    onAudit: (entry) => auditStore?.writeRuleRun(entry),
    onLog: bridgeLog
  });

  broadcastService = new BroadcastService({store:configStore,send:sendOutbound,
    isLive:()=>Boolean(obs.getStatus().connected && obs.getStatus().outputActive),
    onStatus:status=>send('broadcast:status',status),
    onConfig:next=>{settingsService.syncIfClean();applyConfig(next,{autoBroadcast:next.autoBroadcast});}
  });
  chatCore.on('message', (message) => send('chat:message', message));
  chatCore.on('moderation', (entry) => { auditStore?.writeModeration(entry); send('moderation:event', entry); });
  chatCore.on('filter-hit', (entry) => send('filter:hit', entry));
  chatCore.on('log', (entry) => {
    logger.write(String(entry.level || 'info').toLowerCase(), entry.category || 'app', entry.meta?.code || 'APP_LOG', entry.message, entry.meta || {});
    send('log:event', entry);
  });
  chatCore.on('config-dirty', (config) => {
    try { configStore.merge({ moderation: config.moderation, filters: config.filters }); } catch {}
  });
  eventCore.on('event', handleNormalizedEvent);

  statusMonitor = new StatusMonitor({ obs, onStatus: (status) => send('system:status', status) });
  healthService = new HealthService({
    getObs: () => obs.getStatus(), getOverlay: () => overlayServer.getStatus(), getConnectors: () => connectorManager.statuses(),
    getEventCore: () => eventCore.getMetrics(), getFfmpeg: () => ffmpeg.getStatus(), getSettings: () => validateConfig(currentConfig()),
    getDatabase: () => auditStore.getStatus(), getAssets: assetStatus, onUpdate: (status) => send('health:status', status)
  });
}

async function startExternalServices() {
  const cfg = currentConfig();
  auditStore.open();
  if (cfg.http.enabled && cfg.http.autoStart !== false) overlayServer.start().catch((error) => bridgeLog('error', 'Overlay', error.code || 'START_FAILED', { message: error.message }));
  statusMonitor.start();
  healthService.start();
  restartAutoBroadcast();

  ffmpeg.detect().then(async (result) => {
    if (!result.ok) return;
    try { await ffmpeg.chooseEncoder(cfg.mediaEngine.encoder || 'auto'); }
    catch (error) { bridgeLog('warn', 'FFmpeg', 'ENCODER_SELECTION_FAILED', { message: error.message }); }
  }).catch((error) => bridgeLog('warn', 'FFmpeg', 'DETECT_FAILED', { message: error.message }));

  for (const name of ['axelchat','tikfinity','twitch','youtube']) {
    if (cfg.platforms[name]?.autoConnect) connectorManager.connect(name).catch(() => {});
  }
  if (cfg.obs.autoConnect) obs.connect().catch(() => {});
}

function registerIpc() {
  registerBroadcastIpc();
  ipcMain.handle('state:get', () => ({
    appVersion:app.getVersion(),
    config: currentConfig(), messages: chatCore.getMessages(), logs: chatCore.getLogs(), moderation: chatCore.getModerationState(),
    moderationHistory: chatCore.getModerationHistory(), overlay: overlayServer.getStatus(), adapters: connectorManager.statuses(), obs: obs.getStatus(),
    eventCore: eventCore.getMetrics(), ffmpeg: ffmpeg.getStatus(), database: auditStore.getStatus(), health: healthService.getStatus(),
    settings: { dirty: settingsService.isDirty(), validation: validateConfig(settingsService.getDraft()) },
    assets: { chatBackground:chatBackgroundAsset(), localChatIcon:localChatIconAsset() },
    secrets: { obsPassword: secretsService.has(SECRET_REFS.obs), youtubeApiKey: secretsService.has(SECRET_REFS.youtube), discordWebhook: secretsService.has(SECRET_REFS.discord), cngObsChatUrl: secretsService.has(SECRET_REFS.cng) }
  }));

  ipcMain.handle('config:save', async (_event, patch = {}) => {
    const draft = settingsService.patch(patch);
    if (!draft.validation.ok) throw new Error(draft.validation.errors.map((x) => `${x.path}: ${x.message}`).join(' | '));
    const applied = settingsService.apply();
    const next = applied.config;
    applyConfig(next, patch);
    if (patch.http) {
      if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
      else await overlayServer.stop();
    }
    return next;
  });
  ipcMain.handle('config:reset', async (_event, section) => {
    const reset = settingsService.resetSection(section);
    if (!reset.ok) throw new Error(reset.error || 'Reset fehlgeschlagen.');
    const applied = settingsService.apply();
    applyConfig(applied.config, { [section]: applied.config[section] });
    if(section==='http'){const h=applied.config.http;if(h.enabled)await overlayServer.restart(h.host,h.port);else await overlayServer.stop();}
    return applied.config;
  });
  ipcMain.handle('settings:draft', (_event, patch) => settingsService.patch(patch || {}));
  ipcMain.handle('settings:apply', async () => {
    const result = settingsService.apply();
    if (result.ok) {
      applyConfig(result.config,result.config);
      const h=result.config.http,status=overlayServer.getStatus();
      if(!h.enabled)await overlayServer.stop();
      else if(!status.running||status.host!==h.host||status.port!==h.port)await overlayServer.restart(h.host,h.port);
    }
    return result;
  });
  ipcMain.handle('settings:discard', () => settingsService.discard());
  ipcMain.handle('settings:reset', (_event, section) => settingsService.resetSection(section));
  ipcMain.handle('settings:test', (_event, section) => settingsService.test(section));

  ipcMain.handle('adapter:connect', (_event, name) => connectorManager.connect(name));
  ipcMain.handle('adapter:disconnect', (_event, name) => connectorManager.disconnect(name));
  ipcMain.handle('adapter:health', (_event, name) => connectorManager.healthCheck(name));

  ipcMain.handle('chat:test', (_event, payload = {}) => { eventCore.ingestChat({ platform: payload.platform || 'internal', username: payload.username || 'Crazy_User', text: payload.text || 'Testnachricht' }, 'fake-connector'); return { ok: true }; });
  ipcMain.handle('chat:send', async (_event, payload = {}) => { try { return await sendOutbound(payload.platform, payload.text, { source: 'manual' }); } catch (error) { return { ok: false, error: error.message }; } });
  ipcMain.handle('moderation:act', (_event, payload) => {
    const result = chatCore.moderate(payload);
    if (result.ok) configStore.merge({ moderation: { state: chatCore.getModerationState(), history: chatCore.getModerationHistory() } });
    return result;
  });
  ipcMain.handle('filter:add', (_event, payload) => { const result = chatCore.addFilter(payload); if (result.ok) configStore.merge({ filters: chatCore.config.filters }); return result; });
  ipcMain.handle('filter:remove', (_event, id) => { const result = chatCore.removeFilter(id); if (result.ok) configStore.merge({ filters: chatCore.config.filters }); return result; });
  ipcMain.handle('chat:clear', () => { chatCore.clearMessages(); return { ok: true }; });
  ipcMain.handle('logs:clear', () => { chatCore.clearLogs(); return { ok: true }; });

  ipcMain.handle('obs:connect', async (_event, payload = {}) => {
    try {
      if (payload.password) secretsService.set(SECRET_REFS.obs, payload.password);
      const cfg = currentConfig();
      const url = payload.url || cfg.obs.url || 'ws://127.0.0.1:4455';
      const next = configStore.merge({ obs: { ...cfg.obs, url, autoConnect: Boolean(payload.autoConnect) } });
      settingsService.syncIfClean();
      obs.updateConfig({ ...next.obs, password: secretsService.get(SECRET_REFS.obs) });
      send('config:changed', next);
      return await obs.connect();
    } catch (error) { return { ok: false, error: error.message, status: obs.getStatus() }; }
  });
  ipcMain.handle('obs:disconnect', async () => { await obs.disconnect(); return { ok: true, status: obs.getStatus() }; });
  ipcMain.handle('obs:test', async () => { try { return await obs.testConnection(); } catch (error) { return { ok: false, error: error.message, status: obs.getStatus() }; } });

  ipcMain.handle('youtube:saveKey', (_event, key) => { secretsService.set(SECRET_REFS.youtube, key); adapters.youtube.updateConfig({ ...currentConfig().platforms.youtube, apiKey: secretsService.get(SECRET_REFS.youtube) }); return { ok: true, hasKey: Boolean(key) }; });
  ipcMain.handle('discord:saveWebhook', (_event, url) => { secretsService.set(SECRET_REFS.discord, url); return { ok: true, hasWebhook: Boolean(url) }; });
  ipcMain.handle('discord:test', async (_event, text) => { try { return await sendDiscord(text || 'CRAZY_BATTO Test'); } catch (error) { return { ok: false, error: error.message }; } });

  ipcMain.handle('cng:saveChatUrl', (_event, url) => {
    const value = String(url || '').trim();
    if (value && !/^https:\/\/cng-plattform\.com\//i.test(value)) return { ok: false, error: 'Die CNG Chat-URL muss von cng-plattform.com stammen.' };
    secretsService.set(SECRET_REFS.cng, value);
    return { ok: true, hasUrl: Boolean(value) };
  });
  ipcMain.handle('cng:clearChatUrl', () => { secretsService.delete(SECRET_REFS.cng); return { ok: true }; });
  ipcMain.handle('cng:copyUrl', (_event, kind) => {
    const cfg = currentConfig().platforms.cng || {};
    const value = kind === 'alert' ? cfg.alertOverlayUrl : kind === 'ghost' ? cfg.ghostChatUrl : secretsService.get(SECRET_REFS.cng);
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    clipboard.writeText(value); return { ok: true };
  });
  ipcMain.handle('cng:openUrl', async (_event, kind) => {
    const cfg = currentConfig().platforms.cng || {};
    const value = kind === 'alert' ? cfg.alertOverlayUrl : kind === 'ghost' ? cfg.ghostChatUrl : secretsService.get(SECRET_REFS.cng);
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    await shell.openExternal(value); return { ok: true };
  });

  ipcMain.handle('tts:listVoices', async () => { try { return { ok: true, voices: await listTtsVoices() }; } catch (error) { return { ok: false, error: error.message, voices: [] }; } });
  ipcMain.handle('tts:synthesize', async (_event, payload) => { try { return await synthesizeTts(payload); } catch (error) { return { ok: false, error: error.message }; } });
  ipcMain.handle('tts:cleanup', (_event, filePath) => { try { const resolved = path.resolve(String(filePath || '')); if (resolved.startsWith(path.resolve(configStore.ttsDir)+path.sep) && fs.existsSync(resolved)) fs.unlinkSync(resolved); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });

  ipcMain.handle('dialog:chatBackground', async () => {
    const result = await dialog.showOpenDialog({ title:'Eigenes Chatfenster-Bild auswählen', properties:['openFile'], filters:[{ name:'Bilder', extensions:['png','jpg','jpeg','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true };
    const validation = validateChatBackgroundFile(result.filePaths[0]);
    if (!validation.ok) return validation;
    const decoded = nativeImage.createFromPath(validation.path);
    const size = decoded.getSize();
    if (decoded.isEmpty() || size.width < 1 || size.height < 1) return { ok:false, error:'Das ausgewählte Bild konnte nicht gelesen werden.' };
    if (size.width > 12000 || size.height > 12000) return { ok:false, error:'Das Chatbild darf höchstens 12000 × 12000 Pixel groß sein.' };
    const destination = path.join(configStore.imageDir, `chat-background-${Date.now()}-${crypto.randomUUID().slice(0,8)}${validation.ext}`);
    try {
      fs.copyFileSync(validation.path, destination);
      const copied = validateChatBackgroundFile(destination);
      if (!copied.ok) throw new Error(copied.error);
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatBackground?.customPath;
      const next = configStore.merge({ appearance:{ chatBackground:{ ...(cfg.appearance?.chatBackground || {}), enabled:true, mode:'custom', customPath:destination, customName:path.basename(validation.path).slice(0,260) } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = chatBackgroundAsset(next);
      send('chat-background:changed', { config:next, asset });
      if (previousPath && previousPath !== destination) removeManagedImage(previousPath);
      return { ok:true, config:next, asset, width:size.width, height:size.height };
    } catch (error) {
      removeManagedImage(destination);
      return { ok:false, error:error.message };
    }
  });

  ipcMain.handle('chat-background:reset', () => {
    try {
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatBackground?.customPath;
      const next = configStore.merge({ appearance:{ chatBackground:{ ...(cfg.appearance?.chatBackground || {}), enabled:true, mode:'preset', customPath:'', customName:'' } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = chatBackgroundAsset(next);
      send('chat-background:changed', { config:next, asset });
      removeManagedImage(previousPath);
      return { ok:true, config:next, asset };
    } catch (error) { return { ok:false, error:error.message }; }
  });

  ipcMain.handle('dialog:localChatIcon', async () => {
    const result = await dialog.showOpenDialog({ title:'Icon für Lokaler Chat / Overlay auswählen', properties:['openFile'], filters:[{ name:'Bilder', extensions:['png','jpg','jpeg','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true };
    const validation = validateLocalChatIconSource(result.filePaths[0]);
    if (!validation.ok) return validation;
    const destination = path.join(configStore.imageDir, `local-chat-icon-${Date.now()}-${crypto.randomUUID().slice(0,8)}.png`);
    try {
      const normalized = normalizeLocalChatIcon(validation.path);
      fs.writeFileSync(destination, normalized.bytes, { flag:'wx' });
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatIcons?.local?.customPath;
      const next = configStore.merge({ appearance:{ chatIcons:{ local:{ mode:'custom', customPath:destination, customName:path.basename(validation.path).slice(0,260) } } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = localChatIconAsset(next);
      if (asset.missing) throw new Error(asset.error || 'Das lokale Chat-Icon konnte nicht gespeichert werden.');
      send('local-chat-icon:changed', { config:next, asset });
      if (previousPath && previousPath !== destination) removeManagedImage(previousPath);
      return { ok:true, config:next, asset, sourceWidth:normalized.sourceWidth, sourceHeight:normalized.sourceHeight, width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE };
    } catch (error) {
      removeManagedImage(destination);
      return { ok:false, error:error.message };
    }
  });

  ipcMain.handle('local-chat-icon:reset', () => {
    try {
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatIcons?.local?.customPath;
      const next = configStore.merge({ appearance:{ chatIcons:{ local:{ mode:'default', customPath:'', customName:'' } } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = localChatIconAsset(next);
      send('local-chat-icon:changed', { config:next, asset });
      removeManagedImage(previousPath);
      return { ok:true, config:next, asset };
    } catch (error) { return { ok:false, error:error.message }; }
  });

  ipcMain.handle('dialog:font', async () => {
    const result = await dialog.showOpenDialog({ title: 'Eigene Schrift auswählen', properties: ['openFile'], filters: [{ name: 'Fonts', extensions: ['ttf','otf','woff','woff2'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const src = result.filePaths[0]; const ext = path.extname(src).toLowerCase(); const dest = path.join(configStore.fontDir, `custom${ext}`);
    fs.copyFileSync(src, dest); const next = configStore.merge({ chatDesign: { customFontPath: dest, fontFamily: 'BattoCustom' } }); settingsService.discard(); send('config:changed', next); return { ok: true, path: dest, config: next };
  });
  ipcMain.handle('dialog:media', async () => {
    const result = await dialog.showOpenDialog({ title: 'Medien hinzufügen', properties: ['openFile','multiSelections'], filters: [{ name: 'Medien', extensions: ['mp3','wav','ogg','mp4','webm','gif','png','jpg','jpeg','webp','json'] }] });
    if (result.canceled) return { ok: false, canceled: true };
    const cfg = currentConfig(); const items = [...(cfg.media || [])]; const added = [];
    for (const src of result.filePaths) { const ext = path.extname(src); const name = `${Date.now()}-${crypto.randomUUID().slice(0,8)}${ext}`; const dest = path.join(configStore.mediaDir, name); fs.copyFileSync(src, dest); const item = { id: crypto.randomUUID(), name: path.basename(src), path: dest, type: ext.replace('.','').toLowerCase() }; items.push(item); added.push(item); }
    const next = configStore.merge({ media: items }); settingsService.discard(); send('config:changed', next); return { ok: true, config: next, items: added };
  });
  ipcMain.handle('media:remove', (_event, id) => {
    const cfg = currentConfig(); const item = (cfg.media || []).find((x) => x.id === id); if (!item) return { ok: false, error: 'Medium nicht gefunden.' };
    try { if (item.path && fs.existsSync(item.path)) fs.unlinkSync(item.path); } catch {}
    const media = (cfg.media || []).filter((x) => x.id !== id); const mediaPools = (cfg.mediaPools || []).map((pool) => ({ ...pool, mediaIds: (pool.mediaIds || []).filter((mediaId) => mediaId !== id) }));
    const next = configStore.merge({ media, mediaPools }); settingsService.discard(); send('config:changed', next); return { ok: true, config: next };
  });

  ipcMain.handle('automation:testSequence',async(_event,payload={})=>{
    try{
      if(!Array.isArray(payload.actions)||!payload.actions.length||payload.actions.length>50)throw new Error('1 bis 50 Aktionen erforderlich.');
      return await actionEngine.execute(payload.actions,payload.context || {platform:'internal',user:'Crazy_User',username:'Crazy_User',message:'Test'},{failurePolicy:payload.failurePolicy || 'stop-sequence',timeoutMs:Math.min(60000,Math.max(250,Number(payload.timeoutMs)||5000))});
    }catch(e){return{ok:false,error:e.message};}
  });
  ipcMain.handle('automation:testAction', async (_event, action) => { try { return await actionEngine.execute([action], { user:'Crazy_User', username:'Crazy_User', platform:'internal', message:'Test' }); } catch (error) { return { ok:false, error:error.message }; } });
  ipcMain.handle('broadcast:test',async()=>{try{return await broadcastService.test();}catch(e){return{ok:false,error:e.message};}});

  ipcMain.handle('overlay:open', async (_event, route = '/overlay/chat') => { const status = overlayServer.getStatus(); if (!status.running) return { ok:false, error:'Overlay-Server läuft nicht.' }; const url = `http://${status.host}:${status.port}${route}`; await shell.openExternal(url); return { ok:true, url }; });
  ipcMain.handle('overlay:testEvent', (_event, type = 'gift') => { eventCore.ingestEvent({ platform:'tiktok', type, id:`test-${Date.now()}`, data:{ uniqueId:'Crazy_User', nickname:'Crazy_User', giftName:'Rose', count:1, value:100, text:'Test Event' } }, 'fake-connector'); return { ok:true }; });
  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text || '')); return { ok:true }; });

  ipcMain.handle('ffmpeg:detect', () => ffmpeg.detect());
  ipcMain.handle('ffmpeg:testEncoder', async (_event, encoder) => { try { return await ffmpeg.testEncoder(encoder); } catch (error) { return { ok:false, error:error.message, status:ffmpeg.getStatus() }; } });
  ipcMain.handle('ffmpeg:start', (_event, args, options) => { try { return ffmpeg.start(args, options); } catch (error) { return { ok:false, error:error.message }; } });
  ipcMain.handle('ffmpeg:stop', () => ffmpeg.stop());
  ipcMain.handle('ffmpeg:status', () => ffmpeg.getStatus());

  ipcMain.handle('health:get', () => healthService.getStatus());
  ipcMain.handle('diagnostics:get', () => diagnosticsSnapshot());
  ipcMain.handle('diagnostics:export', async () => {
    const result = await dialog.showSaveDialog({ title:'Diagnose exportieren', defaultPath:`batto-obs-tool-2.1-diagnose-${Date.now()}.json`, filters:[{ name:'JSON', extensions:['json'] }] });
    if (result.canceled || !result.filePath) return { ok:false, canceled:true };
    fs.writeFileSync(result.filePath, JSON.stringify(diagnosticsSnapshot(), null, 2), 'utf8'); return { ok:true, filePath:result.filePath };
  });

  ipcMain.handle('backup:now', () => ({ ok:true, filePath:configStore.backupNow(), backups:configStore.listBackups() }));
  ipcMain.handle('backup:list', () => ({ ok:true, backups:configStore.listBackups() }));
  ipcMain.handle('backup:restore', async (_event, file) => { const next = configStore.restoreBackup(file); settingsService.discard(); applyConfig(next, next); return { ok:true, config:next }; });
  ipcMain.handle('dialog:exportConfig', async () => { const result = await dialog.showSaveDialog({ title:'Settings exportieren', defaultPath:'batto-obs-tool-2.1-settings.json', filters:[{ name:'JSON', extensions:['json'] }] }); if (result.canceled || !result.filePath) return { ok:false, canceled:true }; configStore.exportTo(result.filePath); return { ok:true, filePath:result.filePath }; });
  ipcMain.handle('dialog:importConfig', async () => { const result = await dialog.showOpenDialog({ title:'Settings importieren', properties:['openFile'], filters:[{ name:'JSON', extensions:['json'] }] }); if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true }; const next = configStore.importFrom(result.filePaths[0]); settingsService.discard(); applyConfig(next, next); return { ok:true, config:next }; });

  ipcMain.handle('window:detach', () => { if (!detachedWindow || detachedWindow.isDestroyed()) { detachedWindow=createWindow(true); detachedWindow.on('closed',()=>{ detachedWindow=null; configStore.merge({ windows:{ detachedOpen:false } }); }); configStore.merge({ windows:{ detachedOpen:true } }); } else detachedWindow.focus(); return { ok:true }; });
  ipcMain.handle('window:closeDetached', () => { detachedWindow?.close(); return { ok:true }; });
}

async function shutdown() {
  broadcastService?.stop();
  actionEngine?.cancelAll();
  clearTimeout(autoBroadcastDelayTimer);
  clearInterval(autoBroadcastTimer);
  healthService?.stop();
  statusMonitor?.stop();
  await connectorManager?.stopAll?.();
  await ffmpeg?.stop?.().catch?.(() => {});
  await obs?.disconnect?.().catch?.(() => {});
  await overlayServer?.stop?.().catch?.(() => {});
  eventCore?.stop?.();
  auditStore?.close?.();
  logger?.cleanup?.();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    initCore();
    registerIpc();
    mainWindow = createWindow(false);
    mainWindow.on('closed', () => { mainWindow = null; });
    if (currentConfig().windows.detachedOpen) { detachedWindow = createWindow(true); detachedWindow.on('closed', () => { detachedWindow = null; }); }
    app.on('activate', () => { if (!mainWindow) mainWindow = createWindow(false); });
    startExternalServices().catch((error) => bridgeLog('error', 'Runtime', 'START_EXTERNAL_FAILED', { message:error.message }));
  });
}

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  shutdown().finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
