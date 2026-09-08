const { EventEmitter } = require('events');

const CONNECTOR_STATES = new Set(['DISABLED', 'CONNECTING', 'AUTH_REQUIRED', 'CONNECTED', 'DEGRADED', 'RETRYING', 'ERROR']);

class BaseConnector extends EventEmitter {
  constructor({ name, enabled = true } = {}) {
    super();
    if (!name) throw new Error('Connector-Name fehlt.');
    this.name = name;
    this.enabled = enabled !== false;
    this.state = this.enabled ? 'ERROR' : 'DISABLED';
    this.lastError = null;
    this.lastEventAt = null;
    this.startedAt = null;
  }

  setState(state, details = {}) {
    if (!CONNECTOR_STATES.has(state)) throw new Error(`Unbekannter Connector-State: ${state}`);
    this.state = state;
    if (details.error !== undefined) this.lastError = details.error || null;
    this.emit('state', this.getStatus());
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      connected: this.state === 'CONNECTED',
      enabled: this.enabled,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0
    };
  }

  async start() { throw new Error('start() muss vom Connector implementiert werden.'); }
  async stop() { throw new Error('stop() muss vom Connector implementiert werden.'); }
  async healthCheck() { return { ok: this.state === 'CONNECTED', status: this.getStatus() }; }
}

module.exports = { BaseConnector, CONNECTOR_STATES };
