const { OBSWebSocket } = require('obs-websocket-js');

const RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];

function withTimeout(promise, timeoutMs, label) {
  const ms = Math.max(500, Number(timeoutMs || 5000));
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label || 'OBS-Anfrage'}: Timeout nach ${ms} ms`);
        error.code = 'OBS_REQUEST_TIMEOUT';
        reject(error);
      }, ms);
    })
  ]).finally(() => clearTimeout(timer));
}

class OBSController {
  constructor({ url = 'ws://127.0.0.1:4455', password = '', autoReconnect = true, requestTimeoutMs = 5000, onStatus } = {}) {
    this.url = url;
    this.password = password;
    this.autoReconnect = autoReconnect !== false;
    this.requestTimeoutMs = Math.max(500, Number(requestTimeoutMs || 5000));
    this.onStatus = onStatus;
    this.obs = new OBSWebSocket();
    this.connected = false;
    this.manualStop = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.connectPromise = null;
    this.status = {
      connected: false,
      state: 'idle',
      url: this.url,
      error: null,
      obsVersion: null,
      websocketVersion: null,
      currentScene: null,
      latencyMs: null,
      lastSuccessAt: null,
      reconnectAttempt: 0
    };

    this.obs.on('StreamStateChanged', event=>this.setStatus({outputActive:Boolean(event.outputActive)}));
    this.obs.on('ConnectionClosed', () => {
      this.connected = false;
      this.connectPromise = null;
      if (this.manualStop) {
        this.setStatus({ connected: false, state: 'stopped', error: null });
        return;
      }
      this.setStatus({ connected: false, state: 'disconnected' });
      if (this.autoReconnect) this.scheduleReconnect();
    });
  }

  setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      url: this.url,
      reconnectAttempt: this.reconnectAttempt
    };
    if(!this.connected)this.status.outputActive=false;
    this.onStatus?.({ ...this.status });
  }

  getStatus() { return { ...this.status, url: this.url, reconnectAttempt: this.reconnectAttempt }; }

  updateConfig(config = {}) {
    if (config.url) this.url = config.url;
    if (config.password !== undefined) this.password = config.password;
    if (config.reconnect !== undefined) this.autoReconnect = config.reconnect !== false;
    if (config.requestTimeoutMs !== undefined) this.requestTimeoutMs = Math.max(500, Number(config.requestTimeoutMs || 5000));
    this.setStatus({});
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = RECONNECT_MS[Math.min(this.reconnectAttempt, RECONNECT_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.setStatus({ state: 'retrying', connected: false });
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async testConnection() {
    if (!this.connected) throw new Error('OBS ist nicht verbunden.');
    const start = Date.now();
    const [version, scene] = await Promise.all([
      this.call('GetVersion'),
      this.call('GetCurrentProgramScene')
    ]);
    const latencyMs = Date.now() - start;
    const detail = {
      obsVersion: version?.obsVersion || null,
      websocketVersion: version?.obsWebSocketVersion || version?.obsWebSocketVersionString || null,
      currentScene: scene?.currentProgramSceneName || null,
      latencyMs,
      lastSuccessAt: new Date().toISOString()
    };
    this.setStatus(detail);
    return { ok: true, ...detail };
  }

  async connect() {
    if (this.connected) return { ok: true, status: this.getStatus(), test: await this.testConnection() };
    if (this.connectPromise) return this.connectPromise;

    this.manualStop = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setStatus({ state: 'connecting', connected: false, error: null });

    this.connectPromise = (async () => {
      try {
        await withTimeout(this.obs.connect(this.url, this.password || undefined, { rpcVersion: 1 }), this.requestTimeoutMs + 3000, 'OBS-Verbindung');
        this.connected = true;
        const test = await this.testConnection();
        this.reconnectAttempt = 0;
        this.setStatus({ connected: true, state: 'connected', error: null });
        return { ok: true, status: this.getStatus(), test };
      } catch (error) {
        this.connected = false;
        const raw = String(error?.message || error || 'Unbekannter OBS-Fehler');
        const message = /auth|password|authentication|identified/i.test(raw)
          ? 'OBS WebSocket: Passwort/Authentifizierung fehlgeschlagen.'
          : `OBS-Verbindung fehlgeschlagen: ${this.url} – ${raw}`;
        this.setStatus({ connected: false, state: 'error', error: message });
        try { await this.obs.disconnect(); } catch {}
        if (this.autoReconnect && !this.manualStop) this.scheduleReconnect();
        throw new Error(message);
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  async disconnect() {
    this.manualStop = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    try { await this.obs.disconnect(); } catch {}
    this.connected = false;
    this.setStatus({ connected: false, state: 'stopped', error: null });
  }

  async call(request, data) {
    if (!this.connected) throw new Error('OBS ist nicht verbunden.');
    return withTimeout(this.obs.call(request, data), this.requestTimeoutMs, `OBS ${request}`);
  }

  async healthCheck() {
    try { return await this.testConnection(); }
    catch (error) { return { ok: false, error: error.message, status: this.getStatus() }; }
  }

  async stats() {
    if (!this.connected) return null;
    try {
      const [stats, stream] = await Promise.all([
        this.call('GetStats'),
        this.call('GetStreamStatus').catch(() => null)
      ]);
      this.status.outputActive=Boolean(stream?.outputActive);
      return {
        fps: stats.activeFps ?? null,
        cpu: stats.cpuUsage ?? null,
        memory: stats.memoryUsage ?? null,
        renderMissed: stats.renderMissedFrames ?? null,
        outputSkipped: stats.outputSkippedFrames ?? null,
        outputBytes: stream?.outputBytes ?? null,
        outputActive: stream?.outputActive ?? false
      };
    } catch { return null; }
  }
}

module.exports = { OBSController, RECONNECT_MS, withTimeout };
