const { EventEmitter } = require('events');

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

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
      connectedAt: null
    });
    return adapter;
  }

  get(name) { return this.entries.get(name)?.adapter; }

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
      ...adapterStatus
    };
  }

  statuses() {
    return Object.fromEntries([...this.entries.keys()].map((name) => [name, this.status(name)]));
  }

  setState(entry, state, error = null) {
    entry.state = state;
    entry.lastError = error ? String(error.message || error) : null;
    this.emit('state', this.status(entry.name));
  }

  async connect(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unbekannter Connector: ${name}`);
    if (!entry.enabled) {
      this.setState(entry, 'DISABLED');
      return { ok: false, disabled: true };
    }
    clearTimeout(entry.timer);
    entry.timer = null;
    this.setState(entry, entry.attempt ? 'RETRYING' : 'CONNECTING');

    try {
      await Promise.race([
        Promise.resolve(typeof entry.adapter.connect === 'function' ? entry.adapter.connect() : entry.adapter.start?.()),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Connector ${name}: Verbindungs-Timeout nach ${this.connectTimeoutMs} ms`)), this.connectTimeoutMs))
      ]);
      entry.attempt = 0;
      entry.connectedAt = new Date().toISOString();
      this.setState(entry, 'CONNECTED');
      return { ok: true, status: this.status(name) };
    } catch (error) {
      entry.lastError = String(error.message || error);
      this.setState(entry, 'ERROR', error);
      this.onLog?.('WARN', `connector:${name}`, 'CONNECT_FAILED', { message: entry.lastError, attempt: entry.attempt + 1 });
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
      this.onLog?.('WARN', `connector:${name}`, 'STOP_FAILED', { message: error.message });
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
