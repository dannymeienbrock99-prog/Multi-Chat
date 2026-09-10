const assert = require('assert');
const { DEFAULT_CONFIG, migrateConfig } = require('../src/core/config-store.cjs');
const { validateConfig } = require('../src/core/settings/schema.cjs');
const { ChatCore, normalizeMessage } = require('../src/core/chat-core.cjs');
const { EventCore } = require('../src/core/events/event-core.cjs');
const { normalizeChat, normalizeEvent } = require('../src/core/events/normalizer.cjs');
const { expand } = require('../src/core/action-engine.cjs');
const { PRESETS } = require('../src/core/media/presets.cjs');

const cfg = structuredClone(DEFAULT_CONFIG);
assert.equal(cfg.http.port, 17777);
assert.equal(cfg.obs.url, 'ws://127.0.0.1:4455');
assert.equal(cfg.multiChat.maxMessages, 500);
assert.equal(validateConfig(cfg).ok, true);
assert.ok(Array.isArray(cfg.platforms.tikfinity.widgets));
assert.equal(cfg.platforms.tikfinity.widgets[0]?.url, 'https://tikfinity.zerody.one/widget/chat?cid=676051');

const migrated = migrateConfig({ version: 5, http: { port: 8787 }, multiChat: { maxMessages: 5000 }, backup: { keep: 10 } });
assert.equal(migrated.version, 7);
assert.equal(migrated.schemaVersion, 5);
assert.equal(migrated.http.port, 17777);
assert.equal(migrated.multiChat.maxMessages, 500);
assert.equal(migrated.backup.keep, 5);
assert.ok(Array.isArray(migrated.platforms.tikfinity.widgets));

const core = new ChatCore(cfg);
const msg = normalizeMessage({ platform: 'TikTok', username: 'User', text: 'Hallo' });
assert.equal(msg.platform, 'tiktok');
assert.equal(msg.message, 'Hallo');
core.ingest({ platform: 'twitch', username: 'One', text: 'Test' });
assert.equal(core.getMessages().length, 1);
const mod = core.moderate({ platform: 'twitch', username: 'One', action: 'mute', reason: 'Spam' });
assert.equal(mod.ok, true);
assert.equal(core.getModerationHistory().length, 1);
assert.equal(core.getModerationState().twitch.muted[0].reason, 'Spam');

const cfg2 = structuredClone(DEFAULT_CONFIG);
cfg2.filters.rules.push({ id: 'x', term: 'spamwort', platform: 'all', action: 'hide', enabled: true });
const core2 = new ChatCore(cfg2);
core2.ingest({ platform: 'youtube', username: 'Two', text: 'spamwort hier' });
assert.equal(core2.getMessages().length, 0);

const normalizedChat = normalizeChat({ platform: 'Twitch', id: 'm1', username: 'Tester', text: 'Hallo Event Core' }, 'mock');
assert.equal(normalizedChat.schemaVersion, 1);
assert.equal(normalizedChat.type, 'chat');
assert.equal(normalizedChat.eventId, 'twitch:chat:m1');
const normalizedGift = normalizeEvent({ platform: 'tiktok', event: 'gift', id: 'g1', data: { uniqueId: 'u1', giftId: 'rose', giftName: 'Rose', count: 3 } }, 'tikfinity');
assert.equal(normalizedGift.type, 'gift');
assert.equal(normalizedGift.gift.count, 3);

const eventCore = new EventCore({ maxQueue: 100 });
let published = 0;
eventCore.on('event', () => { published += 1; });
eventCore.ingestChat({ platform: 'twitch', id: 'dedupe-1', username: 'A', text: 'eins' }, 'mock');
const duplicate = eventCore.ingestChat({ platform: 'twitch', id: 'dedupe-1', username: 'A', text: 'eins' }, 'mock');
assert.equal(duplicate.duplicate, true);
assert.equal(eventCore.getMetrics().dedupe.dropped, 1);
eventCore.bus.drain();
assert.equal(published, 1);
eventCore.stop();

assert.ok(PRESETS['tiktok-vertical']);
assert.equal(PRESETS['ultrawide-5120x1440-split'].regions.map((r) => r.width).join('/'), '1706/1706/1708');
assert.equal(expand('Danke {user}', { user: 'Batto' }), 'Danke Batto');

console.log('Batto OBS Tool 2.1 core smoke test: OK');
