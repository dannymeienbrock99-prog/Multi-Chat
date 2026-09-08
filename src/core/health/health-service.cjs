class HealthService {
  constructor({ getObs, getOverlay, getConnectors, getEventCore, getFfmpeg, getSettings, onUpdate, intervalMs = 2000 } = {}) {
    this.getObs = getObs;
    this.getOverlay = getOverlay;
    this.getConnectors = getConnectors;
    this.getEventCore = getEventCore;
    this.getFfmpeg = getFfmpeg;
    this.getSettings = getSettings;
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
    const snapshot = {
      ts: new Date().toISOString(),
      obs,
      overlay,
      connectors,
      eventCore,
      ffmpeg,
      settings,
      overall: this.overall({ obs, overlay, connectors, eventCore, ffmpeg, settings })
    };
    this.last = snapshot;
    return snapshot;
  }

  overall(parts) {
    if (parts.settings?.ok === false) return 'ERROR';
    if (parts.overlay?.error) return 'DEGRADED';
    if (parts.ffmpeg?.state === 'ERROR') return 'DEGRADED';
    return 'HEALTHY';
  }

  start() {
    if (this.timer) return;
    const tick = () => this.onUpdate?.(this.snapshot());
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  getStatus() { return this.last || this.snapshot(); }
}

module.exports = { HealthService };
