const { ipcMain } = require('electron');
const fs = require('fs');
const actionModule = require('../src/core/action-engine.cjs');
const eventModule = require('../src/core/events/event-core.cjs');
const configModule = require('../src/core/config-store.cjs');
const overlayModule = require('../src/core/overlay-server.cjs');
const { AlertQueue } = require('../src/core/alerts/alert-queue.cjs');
const { validateMediaItems, validateMediaFile } = require('../src/core/alerts/media-validator.cjs');

const OriginalConfigStore = configModule.ConfigStore;
class TrackedConfigStore extends OriginalConfigStore {
  constructor(...args) { super(...args); globalThis.__battoConfigStore = this; }
}
configModule.ConfigStore = TrackedConfigStore;

const OriginalActionEngine = actionModule.ActionEngine;
class TrackedActionEngine extends OriginalActionEngine {
  constructor(options) { super(options); globalThis.__battoActionEngine = this; }
}
actionModule.ActionEngine = TrackedActionEngine;

const OriginalEventCore = eventModule.EventCore;
class TrackedEventCore extends OriginalEventCore {
  constructor(options) { super(options); globalThis.__battoEventCore = this; }
  stop() { if (globalThis.__battoEventCore === this) globalThis.__battoEventCore = null; return super.stop(); }
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
      if (source !== 'automation' && source !== 'rule-engine') return core.ingestEvent(payload, source || 'http-ingest');
    }
    const type = String(payload.type || payload.event || payload.data?.event || 'custom').toLowerCase();
    if (['gift','follow','sub','subscribe','custom','media','alert'].includes(type)) {
      let normalized = payload;
      if (type === 'subscribe') normalized = { ...payload, type:'sub', event:'sub' };
      else if (type === 'media') normalized = { ...payload, type:'media', event:'media' };
      else if (!payload.event) normalized = { ...payload, event:type };
      return this.alertQueue.enqueue(normalized);
    }
    return OriginalOverlayServer.prototype.emitEvent.call(this, payload);
  }

  getStatus() { return { ...super.getStatus(), alertQueue: this.alertQueue?.stats?.() || null }; }
  async stop() { this.alertQueue?.clear?.(); return super.stop(); }
}
overlayModule.OverlayServer = QueuedOverlayServer;

const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  if (channel !== 'dialog:media') return nativeHandle(channel, listener);
  return nativeHandle(channel, async (...args) => {
    const result = await listener(...args);
    if (!result?.ok || !Array.isArray(result.items)) return result;
    const checked = validateMediaItems(result.items);
    if (checked.ok) return { ...result, validation: checked };
    const invalidIds = new Set(checked.invalid.map((x) => x.item?.id).filter(Boolean));
    for (const invalid of checked.invalid) {
      try { if (invalid.item?.path && fs.existsSync(invalid.item.path)) fs.unlinkSync(invalid.item.path); } catch {}
    }
    const store = globalThis.__battoConfigStore;
    if (store) {
      const cfg = store.get();
      const media = (cfg.media || []).filter((item) => !invalidIds.has(item.id));
      const mediaPools = (cfg.mediaPools || []).map((pool) => ({ ...pool, mediaIds:(pool.mediaIds || []).filter((id) => !invalidIds.has(id)) }));
      const next = store.merge({ media, mediaPools });
      const validItems = result.items.filter((item) => !invalidIds.has(item.id));
      return {
        ...result,
        ok: validItems.length > 0,
        error: validItems.length ? undefined : checked.invalid.map((x) => `${x.item?.name || 'Datei'}: ${x.validation.error}`).join(' | '),
        config: next,
        items: validItems,
        validation: checked,
        rejected: checked.invalid.map((x) => ({ name:x.item?.name, error:x.validation.error }))
      };
    }
    return { ok:false, error:checked.invalid.map((x) => x.validation.error).join(' | '), validation:checked };
  });
};

if (process.argv.includes('--batto-qa')) require('./qa-self-test.cjs');
require('./main21.cjs');

nativeHandle('automation:cancel', (_event, ruleId) => globalThis.__battoActionEngine?.cancel?.(ruleId) || { ok:false, error:'Action Engine ist noch nicht bereit.' });
nativeHandle('automation:cancelAll', () => globalThis.__battoActionEngine?.cancelAll?.() || { ok:false, error:'Action Engine ist noch nicht bereit.' });
nativeHandle('automation:active', () => ({ ok:true, runs:globalThis.__battoActionEngine?.active?.() || [] }));
nativeHandle('media:validate', (_event, filePath) => validateMediaFile(filePath));
