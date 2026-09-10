const { normalizeItem, LIMIT } = require('../broadcast/scheduler.cjs');
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const TIKFINITY_WIDGET_TYPES = new Set(['chat','follow','gift','like','share','subscribe','goal','ranking','custom']);

function issue(path, message) { return { path, message }; }
function integerIn(value, min, max) { const n=Number(value); return Number.isInteger(n) && n>=min && n<=max; }
function numberIn(value, min, max) { const n=Number(value); return Number.isFinite(n) && n>=min && n<=max; }

function validateUrl(value, { ws = false, http = false, allowEmpty = true } = {}) {
  if (!value && allowEmpty) return true;
  try {
    const url = new URL(String(value));
    if (ws && !['ws:', 'wss:'].includes(url.protocol)) return false;
    if (http && !['http:', 'https:'].includes(url.protocol)) return false;
    return true;
  } catch { return false; }
}

function isTikFinityWidgetUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (hostname === 'tikfinity.zerody.one' || hostname.endsWith('.tikfinity.zerody.one'))
      && /^\/widget(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

function validateConfig(config) {
  const errors = [];
  const c = config || {};

  const port = Number(c.http?.port);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) errors.push(issue('http.port', `Port muss zwischen ${PORT_MIN} und ${PORT_MAX} liegen.`));
  if (c.http?.host && typeof c.http.host !== 'string') errors.push(issue('http.host', 'Host muss Text sein.'));
  if (c.http?.allowLan !== true && c.http?.host && !['127.0.0.1','localhost','::1'].includes(c.http.host)) errors.push(issue('http.host', 'Ohne LAN-Freigabe muss der Overlay-Server auf Loopback gebunden sein.'));
  if (!integerIn(c.http?.maxWsClients ?? 20, 1, 100)) errors.push(issue('http.maxWsClients', 'WebSocket-Client-Limit muss zwischen 1 und 100 liegen.'));
  if (!integerIn(c.http?.heartbeatSeconds ?? 15, 1, 300)) errors.push(issue('http.heartbeatSeconds', 'Heartbeat muss zwischen 1 und 300 Sekunden liegen.'));

  if (!validateUrl(c.obs?.url || 'ws://127.0.0.1:4455', { ws:true, allowEmpty:false })) errors.push(issue('obs.url', 'OBS-Adresse muss ws:// oder wss:// verwenden.'));
  if (!integerIn(c.obs?.requestTimeoutMs ?? 5000, 500, 60000)) errors.push(issue('obs.requestTimeoutMs', 'OBS Request-Timeout muss zwischen 500 und 60000 ms liegen.'));

  if (c.platforms?.tikfinity?.url && !validateUrl(c.platforms.tikfinity.url, { ws:true })) errors.push(issue('platforms.tikfinity.url', 'TikFinity-Adresse muss ws:// oder wss:// verwenden.'));
  const tikfinityWidgets=c.platforms?.tikfinity?.webWidgets;
  if (!Array.isArray(tikfinityWidgets) || tikfinityWidgets.length>24) errors.push(issue('platforms.tikfinity.webWidgets', 'TikFinity erlaubt maximal 24 HTTPS-Widgets.'));
  else {
    const ids=new Set();
    tikfinityWidgets.forEach((widget,index)=>{
      const base=`platforms.tikfinity.webWidgets.${index}`;
      const id=String(widget?.id || '');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) errors.push(issue(`${base}.id`, 'Widget-ID ist ungültig.'));
      else if (ids.has(id)) errors.push(issue(`${base}.id`, 'Widget-ID ist doppelt.'));
      else ids.add(id);
      if (!String(widget?.name || '').trim() || String(widget.name).length>80) errors.push(issue(`${base}.name`, 'Widget-Name muss 1 bis 80 Zeichen haben.'));
      if (!TIKFINITY_WIDGET_TYPES.has(String(widget?.eventType || ''))) errors.push(issue(`${base}.eventType`, 'Unbekannter TikFinity-Widget-Typ.'));
      if (!isTikFinityWidgetUrl(widget?.url)) errors.push(issue(`${base}.url`, 'Widget-URL muss eine HTTPS-Adresse unter tikfinity.zerody.one/widget/ sein.'));
      if (typeof widget?.enabled !== 'boolean') errors.push(issue(`${base}.enabled`, 'Widget-Status muss aktiviert oder deaktiviert sein.'));
    });
  }
  if (c.platforms?.axelchat?.url && !validateUrl(c.platforms.axelchat.url, { ws:true })) errors.push(issue('platforms.axelchat.url', 'AxelChat-Adresse muss ws:// oder wss:// verwenden.'));
  if (!integerIn(c.platforms?.youtube?.pollMs ?? 2500, 1000, 60000)) errors.push(issue('platforms.youtube.pollMs', 'YouTube-Polling muss zwischen 1000 und 60000 ms liegen.'));
  for (const key of ['alertOverlayUrl','ghostChatUrl']) {
    const value=c.platforms?.cng?.[key];
    if (value && !validateUrl(value,{http:true})) errors.push(issue(`platforms.cng.${key}`, 'CNG-URL muss http:// oder https:// verwenden.'));
  }

  if (c.multiChat?.maxMessages !== undefined && !integerIn(c.multiChat.maxMessages, 50, 5000)) errors.push(issue('multiChat.maxMessages', 'Maximale sichtbare Nachrichten müssen zwischen 50 und 5000 liegen.'));
  if (!integerIn(c.multiChat?.fontSize ?? 14, 8, 72)) errors.push(issue('multiChat.fontSize', 'Multi-Chat Schriftgröße muss zwischen 8 und 72 liegen.'));

  if (!integerIn(c.cohost?.places ?? 4, 1, 9) || ![1,2,3,4,6,9].includes(Number(c.cohost?.places ?? 4))) errors.push(issue('cohost.places', 'Co-Host Plätze müssen 1, 2, 3, 4, 6 oder 9 sein.'));
  if (!['tiktok','twitch'].includes(String(c.cohost?.format || 'tiktok'))) errors.push(issue('cohost.format', 'Co-Host Format muss tiktok oder twitch sein.'));

  if (!integerIn(c.alerts?.maxQueue ?? 100, 1, 1000)) errors.push(issue('alerts.maxQueue', 'Alert-Queue muss zwischen 1 und 1000 liegen.'));
  if (!integerIn(c.alerts?.defaultDurationMs ?? 5000, 250, 120000)) errors.push(issue('alerts.defaultDurationMs', 'Alert-Dauer muss zwischen 250 und 120000 ms liegen.'));
  if (!numberIn(c.alerts?.masterVolume ?? 1, 0, 1)) errors.push(issue('alerts.masterVolume', 'Alert-Lautstärke muss zwischen 0 und 1 liegen.'));

  if (c.mediaEngine?.fps !== undefined && ![30,60].includes(Number(c.mediaEngine.fps))) errors.push(issue('mediaEngine.fps', 'FPS muss 30 oder 60 sein.'));
  if (!numberIn(c.mediaEngine?.videoBitrateKbps ?? 12000, 500, 100000)) errors.push(issue('mediaEngine.videoBitrateKbps', 'Video-Bitrate muss zwischen 500 und 100000 kbps liegen.'));
  if (!integerIn(c.mediaEngine?.audioSampleRate ?? 48000, 8000, 192000)) errors.push(issue('mediaEngine.audioSampleRate', 'Audio-Samplerate muss zwischen 8000 und 192000 Hz liegen.'));
  if (!['auto','nvenc','amf','qsv','cpu','h264_nvenc','h264_amf','h264_qsv','libx264'].includes(String(c.mediaEngine?.encoder || 'auto').toLowerCase())) errors.push(issue('mediaEngine.encoder', 'Unbekannter FFmpeg-Encoder-Modus.'));

  if (!numberIn(c.tts?.volume ?? 1, 0, 1)) errors.push(issue('tts.volume', 'TTS-Lautstärke muss zwischen 0 und 1 liegen.'));
  if (!numberIn(c.tts?.rate ?? 1, .25, 4)) errors.push(issue('tts.rate', 'TTS-Geschwindigkeit muss zwischen 0.25 und 4 liegen.'));
  if (!integerIn(c.tts?.queueLimit ?? 100, 1, 1000)) errors.push(issue('tts.queueLimit', 'TTS-Queue-Limit muss zwischen 1 und 1000 liegen.'));

  if (!integerIn(c.rules?.maxConcurrentRuns ?? 25, 1, 100)) errors.push(issue('rules.maxConcurrentRuns', 'Maximale parallele Regeln müssen zwischen 1 und 100 liegen.'));
  if (!integerIn(c.rules?.defaultTimeoutMs ?? 5000, 250, 60000)) errors.push(issue('rules.defaultTimeoutMs', 'Regel-Timeout muss zwischen 250 und 60000 ms liegen.'));
  if (!['continue','stop-sequence','retry-once'].includes(String(c.rules?.defaultFailurePolicy || 'stop-sequence'))) errors.push(issue('rules.defaultFailurePolicy', 'Ungültige Failure Policy.'));
  if (c.rules?.httpAllowlist !== undefined && !Array.isArray(c.rules.httpAllowlist)) errors.push(issue('rules.httpAllowlist', 'HTTP-Allowlist muss eine Liste sein.'));

  if (!integerIn(c.eventCore?.maxQueue ?? 5000, 100, 50000)) errors.push(issue('eventCore.maxQueue', 'Event-Queue muss zwischen 100 und 50000 liegen.'));
  if (!integerIn(c.eventCore?.dedupeMaxEntries ?? 10000, 100, 100000)) errors.push(issue('eventCore.dedupeMaxEntries', 'Dedup-Cache muss zwischen 100 und 100000 Einträgen liegen.'));
  if (!integerIn(c.eventCore?.dedupeTtlMs ?? 120000, 1000, 3600000)) errors.push(issue('eventCore.dedupeTtlMs', 'Dedup-TTL muss zwischen 1000 und 3600000 ms liegen.'));

  if (!integerIn(c.autoBroadcast?.intervalSeconds ?? 600, 30, 86400)) errors.push(issue('autoBroadcast.intervalSeconds', 'Auto-Broadcast Intervall muss zwischen 30 und 86400 Sekunden liegen.'));
  if (!integerIn(c.autoBroadcast?.startDelaySeconds ?? 30, 0, 86400)) errors.push(issue('autoBroadcast.startDelaySeconds', 'Auto-Broadcast Startverzögerung ist ungültig.'));
  if (!['sequence','random'].includes(String(c.autoBroadcast?.mode || 'sequence'))) errors.push(issue('autoBroadcast.mode', 'Auto-Broadcast Modus muss sequence oder random sein.'));

  if (!integerIn(c.logging?.retentionDays ?? 7, 1, 365)) errors.push(issue('logging.retentionDays', 'Log-Retention muss zwischen 1 und 365 Tagen liegen.'));
  if (!integerIn(c.backup?.keep ?? 5, 1, 100)) errors.push(issue('backup.keep', 'Backup-Anzahl muss zwischen 1 und 100 liegen.'));
  if (!numberIn(c.appearance?.uiScale ?? 1, .5, 2)) errors.push(issue('appearance.uiScale', 'UI-Skalierung muss zwischen 0.5 und 2 liegen.'));
  if (!numberIn(c.appearance?.backgroundDarkness ?? .28, 0, .9)) errors.push(issue('appearance.backgroundDarkness', 'Hintergrund-Abdunklung muss zwischen 0 und 0.9 liegen.'));
  const chatBackground=c.appearance?.chatBackground;
  if (!chatBackground || typeof chatBackground !== 'object' || Array.isArray(chatBackground)) errors.push(issue('appearance.chatBackground', 'Chatfenster-Bild-Einstellungen fehlen.'));
  else {
    if (typeof chatBackground.enabled !== 'boolean') errors.push(issue('appearance.chatBackground.enabled', 'Chatfenster-Bild muss aktiviert oder deaktiviert sein.'));
    if (!['preset','custom'].includes(String(chatBackground.mode || ''))) errors.push(issue('appearance.chatBackground.mode', 'Chatfenster-Bildquelle muss preset oder custom sein.'));
    if (chatBackground.mode === 'custom' && (!String(chatBackground.customPath || '').trim() || String(chatBackground.customPath).length > 4096)) errors.push(issue('appearance.chatBackground.customPath', 'Für ein eigenes Chatbild wird ein gültiger Dateipfad benötigt.'));
    if (typeof chatBackground.customName !== 'string' || chatBackground.customName.length > 260) errors.push(issue('appearance.chatBackground.customName', 'Der Chatbild-Dateiname ist ungültig.'));
    if (!['contain','cover'].includes(String(chatBackground.fit || ''))) errors.push(issue('appearance.chatBackground.fit', 'Bildanpassung muss contain oder cover sein.'));
    if (!['center','left center','right center'].includes(String(chatBackground.position || ''))) errors.push(issue('appearance.chatBackground.position', 'Die Chatbild-Position ist ungültig.'));
    if (!numberIn(chatBackground.darkness, 0, .95)) errors.push(issue('appearance.chatBackground.darkness', 'Chatbild-Abdunklung muss zwischen 0 und 0.95 liegen.'));
    if (typeof chatBackground.showInMain !== 'boolean') errors.push(issue('appearance.chatBackground.showInMain', 'Die Hauptfenster-Auswahl muss wahr oder falsch sein.'));
  }
  const localChatIcon=c.appearance?.chatIcons?.local;
  if (!localChatIcon || typeof localChatIcon !== 'object' || Array.isArray(localChatIcon)) errors.push(issue('appearance.chatIcons.local', 'Die Einstellung für das lokale Chat-Icon fehlt.'));
  else {
    if (!['default','custom'].includes(String(localChatIcon.mode || ''))) errors.push(issue('appearance.chatIcons.local.mode', 'Die Quelle des lokalen Chat-Icons muss default oder custom sein.'));
    if (localChatIcon.mode === 'custom' && (!String(localChatIcon.customPath || '').trim() || String(localChatIcon.customPath).length > 4096)) errors.push(issue('appearance.chatIcons.local.customPath', 'Für ein eigenes lokales Chat-Icon wird ein gültiger Dateipfad benötigt.'));
    if (typeof localChatIcon.customName !== 'string' || localChatIcon.customName.length > 260) errors.push(issue('appearance.chatIcons.local.customName', 'Der Dateiname des lokalen Chat-Icons ist ungültig.'));
  }

  const bc=c.autoBroadcast || {};
  if (bc.items !== undefined) {
    if (!Array.isArray(bc.items) || bc.items.length>LIMIT) errors.push(issue('autoBroadcast.items','Maximal 100 Broadcasts erlaubt.'));
    else {
      const ids=new Set();
      bc.items.forEach((item,index)=>{try{const normalized=normalizeItem(item);if(ids.has(normalized.id))throw new Error('Doppelte Broadcast-ID.');ids.add(normalized.id);}catch(e){errors.push(issue('autoBroadcast.items.'+index,e.message));}});
    }
  }
  for(const key of ['globalMinGapSeconds','platformMinGapSeconds']) if(!numberIn(bc[key]??3,0,3600))errors.push(issue('autoBroadcast.'+key,'Mindestabstand muss zwischen 0 und 3600 Sekunden liegen.'));
  for(const section of ['commands','events'])for(const [index,rule] of (c[section] || []).entries()){
    if(!rule || !Array.isArray(rule.actions) || !rule.actions.length || rule.actions.length>50)errors.push(issue(section+'.'+index,'1 bis 50 Aktionen erforderlich.'));
    if(!numberIn(rule.cooldownSeconds??0,0,86400))errors.push(issue(section+'.'+index+'.cooldownSeconds','Ungültiger Cooldown.'));
    if(!numberIn(rule.timeoutMs??5000,250,60000))errors.push(issue(section+'.'+index+'.timeoutMs','Timeout: 250 bis 60000 ms.'));
    if(rule.failurePolicy && !['continue','stop-sequence','retry-once'].includes(rule.failurePolicy))errors.push(issue(section+'.'+index+'.failurePolicy','Ungültiges Fehlerverhalten.'));
  }
  return { ok: errors.length === 0, errors };
}

function assertValidConfig(config) {
  const result = validateConfig(config);
  if (!result.ok) {
    const err = new Error(result.errors.map((x) => `${x.path}: ${x.message}`).join(' | '));
    err.code = 'INVALID_SETTINGS';
    err.details = result.errors;
    throw err;
  }
  return config;
}

module.exports = { PORT_MIN, PORT_MAX, TIKFINITY_WIDGET_TYPES, validateConfig, assertValidConfig, validateUrl, isTikFinityWidgetUrl };
