const { ipcMain } = require('electron');
const actionModule = require('../src/core/action-engine.cjs');
const overlayModule = require('../src/core/overlay-server.cjs');
const { AlertQueue } = require('../src/core/alerts/alert-queue.cjs');

const OriginalActionEngine = actionModule.ActionEngine;
class TrackedActionEngine extends OriginalActionEngine {
  constructor(options) {
    super(options);
    globalThis.__battoActionEngine = this;
  }
}
actionModule.ActionEngine = TrackedActionEngine;

const OriginalOverlayServer = overlayModule.OverlayServer;
class QueuedOverlayServer extends OriginalOverlayServer {
  constructor(options) {
    super(options);
    const cfg = options?.configStore?.get?.()?.alerts || {};
    this.alertQueue = new AlertQueue({
      maxQueue: cfg.maxQueue || 100,
      defaultDurationMs: cfg.defaultDurationMs || 5000,
      mode: cfg.queueMode || 'priority',
      onDrop: (item, reason) => options?.chatCore?.log?.('WARN', 'Alerts', `Alert verworfen: ${reason}`, { eventId: item?.id })
    });
    this.alertQueue.on('show', (payload) => OriginalOverlayServer.prototype.emitEvent.call(this, payload));
  }

  emitEvent(payload = {}) {
    const type = String(payload.type || payload.event || payload.data?.event || 'custom').toLowerCase();
    if (['gift', 'follow', 'sub', 'subscribe', 'custom', 'media', 'alert'].includes(type)) {
      const normalized = type === 'subscribe' ? { ...payload, type: 'sub', event: 'sub' } : payload;
      return this.alertQueue.enqueue(normalized);
    }
    return OriginalOverlayServer.prototype.emitEvent.call(this, payload);
  }

  getStatus() {
    return { ...super.getStatus(), alertQueue: this.alertQueue?.stats?.() || null };
  }

  async stop() {
    this.alertQueue?.clear?.();
    return super.stop();
  }
}
overlayModule.OverlayServer = QueuedOverlayServer;

require('./main21.cjs');

ipcMain.handle('automation:cancel', (_event, ruleId) => globalThis.__battoActionEngine?.cancel?.(ruleId) || { ok: false, error: 'Action Engine ist noch nicht bereit.' });
ipcMain.handle('automation:cancelAll', () => globalThis.__battoActionEngine?.cancelAll?.() || { ok: false, error: 'Action Engine ist noch nicht bereit.' });
ipcMain.handle('automation:active', () => ({ ok: true, runs: globalThis.__battoActionEngine?.active?.() || [] }));
