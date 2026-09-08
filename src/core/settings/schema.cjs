const PORT_MIN = 1024;
const PORT_MAX = 65535;

function issue(path, message) { return { path, message }; }

function validateUrl(value, { ws = false, http = false, allowEmpty = true } = {}) {
  if (!value && allowEmpty) return true;
  try {
    const url = new URL(String(value));
    if (ws && !['ws:', 'wss:'].includes(url.protocol)) return false;
    if (http && !['http:', 'https:'].includes(url.protocol)) return false;
    return true;
  } catch { return false; }
}

function validateConfig(config) {
  const errors = [];
  const c = config || {};
  const port = Number(c.http?.port);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) errors.push(issue('http.port', `Port muss zwischen ${PORT_MIN} und ${PORT_MAX} liegen.`));
  if (c.http?.host && typeof c.http.host !== 'string') errors.push(issue('http.host', 'Host muss Text sein.'));
  if (c.http?.allowLan !== true && c.http?.host && !['127.0.0.1', 'localhost', '::1'].includes(c.http.host)) errors.push(issue('http.host', 'Ohne LAN-Freigabe muss der Overlay-Server auf Loopback gebunden sein.'));
  if (!validateUrl(c.obs?.url || 'ws://127.0.0.1:4455', { ws: true, allowEmpty: false })) errors.push(issue('obs.url', 'OBS-Adresse muss ws:// oder wss:// verwenden.'));
  if (c.platforms?.tikfinity?.url && !validateUrl(c.platforms.tikfinity.url, { ws: true })) errors.push(issue('platforms.tikfinity.url', 'TikFinity-Adresse muss ws:// oder wss:// verwenden.'));
  if (c.platforms?.axelchat?.url && !validateUrl(c.platforms.axelchat.url, { ws: true })) errors.push(issue('platforms.axelchat.url', 'AxelChat-Adresse muss ws:// oder wss:// verwenden.'));
  if (c.multiChat?.maxMessages !== undefined) {
    const max = Number(c.multiChat.maxMessages);
    if (!Number.isInteger(max) || max < 50 || max > 5000) errors.push(issue('multiChat.maxMessages', 'Maximale sichtbare Nachrichten müssen zwischen 50 und 5000 liegen.'));
  }
  if (c.mediaEngine?.fps !== undefined && ![30, 60].includes(Number(c.mediaEngine.fps))) errors.push(issue('mediaEngine.fps', 'FPS muss 30 oder 60 sein.'));
  if (c.mediaEngine?.videoBitrateKbps !== undefined) {
    const bitrate = Number(c.mediaEngine.videoBitrateKbps);
    if (!Number.isFinite(bitrate) || bitrate < 500 || bitrate > 100000) errors.push(issue('mediaEngine.videoBitrateKbps', 'Video-Bitrate muss zwischen 500 und 100000 kbps liegen.'));
  }
  if (c.tts?.volume !== undefined) {
    const volume = Number(c.tts.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) errors.push(issue('tts.volume', 'TTS-Lautstärke muss zwischen 0 und 1 liegen.'));
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

module.exports = { PORT_MIN, PORT_MAX, validateConfig, assertValidConfig, validateUrl };
