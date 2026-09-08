const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigStore, migrateConfig, DEFAULT_CONFIG } = require('../src/core/config-store.cjs');
const { SettingsService } = require('../src/core/settings/settings-service.cjs');
const { EventCore } = require('../src/core/events/event-core.cjs');
const { ConnectorManager } = require('../src/core/connectors/connector-manager.cjs');
const { Logger, redact } = require('../src/core/logging/logger.cjs');
const { ActionEngine } = require('../src/core/action-engine.cjs');
const { AlertQueue } = require('../src/core/alerts/alert-queue.cjs');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batto21-'));
  try {
    const fixtureV1 = { version: 1, http: { port: 8787 }, multiChat: { maxMessages: 5000 }, backup: { keep: 10 } };
    const fixtureV5 = { version: 5, http: { host: '127.0.0.1', port: 8787 }, obs: { url: 'ws://127.0.0.1:4455' } };
    for (const fixture of [fixtureV1, fixtureV5]) {
      const migrated = migrateConfig(fixture);
      assert.equal(migrated.version, DEFAULT_CONFIG.version);
      assert.equal(migrated.schemaVersion, 3);
      assert.equal(migrated.http.port, 17777);
    }

    const store = new ConfigStore(tmp);
    const settings = new SettingsService({ configStore: store });
    const drafted = settings.patch({ general: { displayName: 'DraftName' } });
    assert.equal(drafted.dirty, true);
    assert.equal(store.get().general.displayName, 'Crazy_Batto');
    assert.equal(settings.apply().ok, true);
    assert.equal(store.get().general.displayName, 'DraftName');
    settings.patch({ general: { displayName: 'DiscardMe' } });
    settings.discard();
    assert.equal(settings.getDraft().general.displayName, 'DraftName');
    settings.resetSection('general');
    assert.equal(settings.apply().ok, true);
    assert.equal(store.get().general.displayName, DEFAULT_CONFIG.general.displayName);

    const core = new EventCore({ maxQueue: 64, dedupeMaxEntries: 256 });
    let count = 0;
    core.on('event', () => { count += 1; });
    core.ingestChat({ platform: 'twitch', id: 'a', username: 'one', text: 'Hallo' }, 'fixture');
    const duplicate = core.ingestChat({ platform: 'twitch', id: 'a', username: 'one', text: 'Hallo' }, 'fixture');
    assert.equal(duplicate.duplicate, true);
    for (let i = 0; i < 200; i++) core.ingestChat({ platform: 'youtube', id: `m-${i}`, username: 'stress', text: `m${i}` }, 'fixture');
    core.bus.drain();
    assert.ok(count >= 1);
    assert.ok(core.getMetrics().bus.queued <= 64);
    core.stop();

    class Good {
      constructor(){ this.status={connected:false,state:'idle'}; }
      connect(){ setTimeout(()=>{this.status={connected:true,state:'connected'};},20); }
      disconnect(){ this.status={connected:false,state:'stopped'}; }
      getStatus(){ return {...this.status}; }
    }
    class Bad {
      connect(){ throw new Error('synthetic connector failure'); }
      disconnect(){}
      getStatus(){ return {connected:false,state:'error',error:'synthetic connector failure'}; }
    }
    const manager = new ConnectorManager({ connectTimeoutMs: 1000 });
    manager.register('good', new Good(), { autoReconnect:false });
    manager.register('bad', new Bad(), { autoReconnect:false });
    const bad = await manager.connect('bad');
    assert.equal(bad.ok, false);
    const good = await manager.connect('good');
    assert.equal(good.ok, true);
    assert.equal(manager.status('good').connected, true);
    await manager.stopAll();

    // Cancellable Multi-Action.
    const engine = new ActionEngine({
      getConfig: () => ({ commands:[], events:[], media:[], mediaPools:[], rules:{ maxConcurrentRuns:5, defaultTimeoutMs:5000, defaultFailurePolicy:'stop-sequence' } }),
      sendChat: async () => ({ok:true})
    });
    const rule = { id:'cancel-test', cooldownSeconds:0, actions:[{type:'delay',ms:3000},{type:'chat',platform:'local',text:'should-not-run'}] };
    const running = engine.executeRule(rule, { platform:'local', user:'Tester' }, 'command');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(engine.active().length, 1);
    assert.equal(engine.cancel('cancel-test').ok, true);
    const cancelled = await running;
    assert.equal(cancelled.cancelled, true);
    assert.equal(engine.active().length, 0);

    // Alert queue is bounded and serializes display.
    const queue = new AlertQueue({ maxQueue:2, defaultDurationMs:50, mode:'priority' });
    let shown = 0;
    queue.on('show', () => { shown += 1; });
    queue.enqueue({ eventId:'q1', type:'gift', priority:1, durationMs:50 });
    queue.enqueue({ eventId:'q2', type:'follow', priority:1, durationMs:50 });
    queue.enqueue({ eventId:'q3', type:'sub', priority:5, durationMs:50 });
    queue.enqueue({ eventId:'q4', type:'gift', priority:2, durationMs:50 });
    assert.ok(queue.stats().queued <= 2);
    await new Promise((r) => setTimeout(r, 180));
    assert.ok(shown >= 2);
    queue.clear();

    const redacted = redact({ token:'abc', password:'xyz', nested:{ apiKey:'123', safe:'ok' } });
    assert.equal(redacted.token, '[REDACTED]');
    assert.equal(redacted.password, '[REDACTED]');
    assert.equal(redacted.nested.apiKey, '[REDACTED]');
    assert.equal(redacted.nested.safe, 'ok');
    const logger = new Logger({ dir:path.join(tmp,'logs') });
    logger.info('test','CORE21_OK','Core acceptance',{ authorization:'secret', safe:true });
    const log = fs.readFileSync(logger.fileForToday(),'utf8');
    assert.ok(!log.includes('secret'));

    console.log('Batto OBS Tool 2.1 core acceptance: OK');
  } finally {
    fs.rmSync(tmp, { recursive:true, force:true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
