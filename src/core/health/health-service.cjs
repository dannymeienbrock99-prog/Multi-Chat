class HealthService {
  constructor({ getObs, getOverlay, getConnectors, getEventCore, getFfmpeg, getSettings, getDatabase, getAssets, onUpdate, intervalMs = 2000 } = {}) {
    this.getObs = getObs;
    this.getOverlay = getOverlay;
    this.getConnectors = getConnectors;
    this.getEventCore = getEventCore;
    this.getFfmpeg = getFfmpeg;
    this.getSettings = getSettings;
    this.getDatabase = getDatabase;
    this.getAssets = getAssets;
    this.onUpdate = onUpdate;
    this.intervalMs = Math.max(500, Number(intervalMs || 2000));
    this.timer = null;
    this.last = null;
  }

  snapshot() {
    const obs = this.getObs?.() || { state: 'offline' };
    const overlay = this.getOverlay?.() || { running: false };
    const connectors = this.getConnectors?.() || {};
    const eventCore = this.getEventCore?.() || {};
    const ffmpeg = this.getFfmpeg?.() || { state: 'DEGRADED' };
    const settings = this.getSettings?.() || { ok: true, errors: [] };
    const database = this.getDatabase?.() || { state: 'CLOSED' };
    const assets = this.getAssets?.() || { missing: 0, invalid: 0 };
    const snapshot = {
      ts: new Date().toISOString(), obs, overlay, connectors, eventCore, ffmpeg,
      settings, database, assets,
      overall: this.overall({ obs, overlay, connectors, eventCore, ffmpeg, settings, database, assets })
    };
    this.last = snapshot;
    return snapshot;
  }

  overall(parts) {
    if (parts.settings?.ok === false) return 'ERROR';
    if (parts.overlay?.error || parts.overlay?.running === false) return 'DEGRADED';
    if (parts.ffmpeg?.state === 'ERROR') return 'DEGRADED';
    if (parts.database?.state === 'ERROR') return 'DEGRADED';
    if (Number(parts.assets?.missing || 0) > 0 || Number(parts.assets?.invalid || 0) > 0) return 'DEGRADED';
    const connectorStates = Object.values(parts.connectors || {}).map((x) => String(x?.state || '').toUpperCase());
    if (connectorStates.includes('ERROR')) return 'DEGRADED';
    return 'HEALTHY';
  }

  start() {
    if (this.timer) return;
    const tick = () => this.onUpdate?.(this.snapshot());
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); this.timer = null; }
  getStatus() { return this.last || this.snapshot(); }
}

module.exports = { HealthService };
