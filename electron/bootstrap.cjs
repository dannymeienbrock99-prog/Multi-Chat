const { ipcMain } = require('electron');
const actionModule = require('../src/core/action-engine.cjs');
const eventModule = require('../src/core/events/event-core.cjs');
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

const OriginalEventCore = eventModule.EventCore;
class TrackedEventCore extends OriginalEventCore {
  constructor(options) {
    super(options);
    globalThis.__battoEventCore = this;
  }
  stop() {
    if (globalThis.__battoEventCore === this) globalThis.__battoEventCore = null;
    return super.stop();
  }
}
eventModule.EventCore = TrackedEventCore;

const OriginalOverlayServer = overlayModule.OverlayServer;
class QueuedOverlayServer extends OriginalOverlayServer {
  constructor(options) {
    const realChatCore = options?.chatCore;
    const ingestProxy = {
      getMessages: (...args) => realChatCore.getMessages(...args),
      on: (...args) => realChatCore.on(...args),
      off: (...args) => realChatCore.off(...args),
      log: (...args) => realChatCore.log(...args),
      ingest: (payload = {}) => {
        const core = globalThis.__battoEventCore;
        if (!core) return null;
        const result = core.ingestChat(payload, 'http-ingest');
        return result?.ok ? result.event : null;
      }
    };
    super({ ...options, chatCore: ingestProxy });
    this.realChatCore = realChatCore;
    const cfg = options?.configStore?.get?.()?.alerts || {};
    this.alertQueue = new AlertQueue({
      maxQueue: cfg.maxQueue || 100,
      defaultDurationMs: cfg.defaultDurationMs || 5000,
      mode: cfg.queueMode || 'priority',
      onDrop: (item, reason) => realChatCore?.log?.('WARN', 'Alerts', `Alert verworfen: ${reason}`, { eventId: item?.id })
    });
    this.alertQueue.on('show', (payload) => OriginalOverlayServer.prototype.emitEvent.call(this, payload));
  }

  emitEvent(payload = {}) {
    const core = globalThis.__battoEventCore;
    if (!payload.schemaVersion && core && !payload.__normalizedByCore) {
      const source = String(payload.source || '').toLowerCase();
      if (source !== 'automation' && source !== 'rule-engine') {
        const result = core.ingestEvent(payload, source || 'http-ingest');
        return result;
      }
    }

    const type = String(payload.type || payload.event || payload.data?.event || 'custom').toLowerCase();
    if (['gift', 'follow', 'sub', 'subscribe', 'custom', 'media', 'alert'].includes(type)) {
      let normalized = payload;
      if (type === 'subscribe') normalized = { ...payload, type: 'sub', event: 'sub' };
      else if (type === 'media') normalized = { ...payload, type: 'media', event: 'media' };
      else if (!payload.event) normalized = { ...payload, event: type };
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
