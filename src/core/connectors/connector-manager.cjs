const { EventEmitter } = require('events');

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const TERMINAL_ERROR_STATES = new Set(['error', 'auth_required', 'disabled']);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class ConnectorManager extends EventEmitter {
  constructor({ connectTimeoutMs = 12000, onLog } = {}) {
    super();
    this.connectTimeoutMs = Math.max(1000, Number(connectTimeoutMs || 12000));
    this.onLog = onLog;
    this.entries = new Map();
  }

  register(name, adapter, { enabled = true, autoReconnect = true } = {}) {
    if (!name || !adapter) throw new Error('ConnectorManager.register benötigt name und adapter.');
    this.entries.set(name, {
      name,
      adapter,
      enabled: enabled !== false,
      autoReconnect: autoReconnect !== false,
      attempt: 0,
      timer: null,
      lastError: null,
      state: enabled === false ? 'DISABLED' : 'ERROR',
      connectedAt: null,
      lastEventAt: null
    });
    return adapter;
  }

  get(name) { return this.entries.get(name)?.adapter; }

  configure(name, patch = {}) {
    const entry = this.entries.get(name);
    if (!entry) return false;
    if (patch.enabled !== undefined) entry.enabled = patch.enabled !== false;
    if (patch.autoReconnect !== undefined) entry.autoReconnect = patch.autoReconnect !== false;
    if (!entry.enabled) {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.state = 'DISABLED';
    }
    return true;
  }

  status(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const adapterStatus = typeof entry.adapter.getStatus === 'function' ? entry.adapter.getStatus() : {};
    return {
      name,
      state: entry.state,
      connected: entry.state === 'CONNECTED' || Boolean(adapterStatus.connected),
      attempt: entry.attempt,
      lastError: entry.lastError,
      connectedAt: entry.connectedAt,
      lastEventAt: entry.lastEventAt,
      ...adapterStatus
    };
  }

  statuses() {
    return Object.fromEntries([...this.entries.keys()].map((name) => [name, this.status(name)]));
  }

  setState(entry, state, error = null) {
    if (!entry) return;
    entry.state = state;
    entry.lastError = error ? String(error.message || error) : null;
    if (state === 'CONNECTED' && !entry.connectedAt) entry.connectedAt = new Date().toISOString();
    if (state !== 'CONNECTED') entry.connectedAt = null;
    const status = this.status(entry.name);
    this.emit('state', status);
  }

  markEvent(name) {
    const entry = this.entries.get(name);
    if (!entry) return;
    entry.lastEventAt = new Date().toISOString();
  }

  observeAdapterStatus(name, status = {}) {
    const entry = this.entries.get(name);
    if (!entry) return;
    const rawState = String(status.state || '').toLowerCase();
    if (!entry.enabled) return this.setState(entry, 'DISABLED');
    if (status.connected || rawState === 'connected') {
      entry.attempt = 0;
      return this.setState(entry, 'CONNECTED');
    }
    if (rawState === 'connecting') return this.setState(entry, 'CONNECTING');
    if (rawState === 'retrying' || rawState === 'disconnected') return this.setState(entry, 'RETRYING', status.error || status.lastError || null);
    if (rawState === 'auth_required') return this.setState(entry, 'AUTH_REQUIRED', status.error || status.lastError || null);
    if (rawState === 'degraded') return this.setState(entry, 'DEGRADED', status.error || status.lastError || null);
    if (rawState === 'stopped' || rawState === 'disabled') return this.setState(entry, 'DISABLED');
    if (status.error || rawState === 'error') return this.setState(entry, 'ERROR', status.error || status.lastError || 'Connector-Fehler');
    this.emit('state', this.status(name));
  }

  async waitUntilReady(entry, deadline) {
    while (Date.now() < deadline) {
      const s = typeof entry.adapter.getStatus === 'function' ? entry.adapter.getStatus() : {};
      const state = String(s.state || '').toLowerCase();
      if (s.connected || state === 'connected') return true;
      if (TERMINAL_ERROR_STATES.has(state) || s.error) throw new Error(s.error || `Connector ${entry.name}: ${state}`);
      await sleep(100);
    }
    throw new Error(`Connector ${entry.name}: Verbindungs-Timeout nach ${this.connectTimeoutMs} ms`);
  }

  async connect(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unbekannter Connector: ${name}`);
    if (!entry.enabled) {
      this.setState(entry, 'DISABLED');
      return { ok: false, disabled: true, status: this.status(name) };
    }
    clearTimeout(entry.timer);
    entry.timer = null;
    this.setState(entry, entry.attempt ? 'RETRYING' : 'CONNECTING');

    try {
      const deadline = Date.now() + this.connectTimeoutMs;
      const call = typeof entry.adapter.connect === 'function'
        ? entry.adapter.connect()
        : entry.adapter.start?.();
      await Promise.race([
        Promise.resolve(call),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Connector ${name}: Start-Timeout nach ${this.connectTimeoutMs} ms`)), this.connectTimeoutMs))
      ]);
      const immediate = typeof entry.adapter.getStatus === 'function' ? entry.adapter.getStatus() : {};
      if (!immediate.connected && String(immediate.state || '').toLowerCase() !== 'connected') await this.waitUntilReady(entry, deadline);
      entry.attempt = 0;
      entry.connectedAt = new Date().toISOString();
      this.setState(entry, 'CONNECTED');
      return { ok: true, status: this.status(name) };
    } catch (error) {
      entry.lastError = String(error.message || error);
      this.setState(entry, 'ERROR', error);
      this.onLog?.('warn', `connector:${name}`, 'CONNECT_FAILED', { message: entry.lastError, attempt: entry.attempt + 1 });
      if (entry.autoReconnect) this.scheduleRetry(entry);
      return { ok: false, error: entry.lastError, status: this.status(name) };
    }
  }

  scheduleRetry(entry) {
    clearTimeout(entry.timer);
    const delay = BACKOFF_MS[Math.min(entry.attempt, BACKOFF_MS.length - 1)];
    entry.attempt += 1;
    this.setState(entry, 'RETRYING', entry.lastError);
    entry.timer = setTimeout(() => this.connect(entry.name), delay);
    entry.timer.unref?.();
    this.emit('retry', { name: entry.name, delayMs: delay, attempt: entry.attempt });
  }

  async disconnect(name) {
    const entry = this.entries.get(name);
    if (!entry) return { ok: false, error: `Unbekannter Connector: ${name}` };
    clearTimeout(entry.timer);
    entry.timer = null;
    try {
      if (typeof entry.adapter.disconnect === 'function') await entry.adapter.disconnect();
      else if (typeof entry.adapter.stop === 'function') await entry.adapter.stop();
    } catch (error) {
      this.onLog?.('warn', `connector:${name}`, 'STOP_FAILED', { message: error.message });
    }
    entry.attempt = 0;
    entry.connectedAt = null;
    this.setState(entry, entry.enabled ? 'ERROR' : 'DISABLED');
    return { ok: true, status: this.status(name) };
  }

  async healthCheck(name) {
    const entry = this.entries.get(name);
    if (!entry) return { ok: false, error: `Unbekannter Connector: ${name}` };
    if (typeof entry.adapter.healthCheck === 'function') {
      try { return await entry.adapter.healthCheck(); }
      catch (error) { return { ok: false, error: error.message, status: this.status(name) }; }
    }
    const status = this.status(name);
    return { ok: Boolean(status?.connected), status };
  }

  async stopAll() {
    await Promise.allSettled([...this.entries.keys()].map((name) => this.disconnect(name)));
  }
}

module.exports = { ConnectorManager, BACKOFF_MS };
