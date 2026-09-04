const assert = require("assert");
const { ChatCore, normalizeMessage } = require("../src/core/chat-core.cjs");
const { DEFAULT_CONFIG } = require("../src/core/config-store.cjs");

const config = structuredClone(DEFAULT_CONFIG);
const core = new ChatCore(config);

const normalized = normalizeMessage({
  platform: "Twitch",
  user: "Tester",
  text: "Hallo"
});
assert.equal(normalized.platform, "twitch");
assert.equal(normalized.username, "Tester");
assert.equal(normalized.message, "Hallo");

core.ingest({ platform: "twitch", username: "One", text: "erste Nachricht" });
assert.equal(core.getMessages().length, 1);

config.filters.rules.push({
  id: "x",
  term: "spamwort",
  platform: "all",
  action: "hide",
  wholeWord: false,
  enabled: true
});
core.setConfig(config);
core.ingest({ platform: "youtube", username: "Two", text: "hier steht spamwort" });
assert.equal(core.getMessages().length, 1);

const mod = core.moderate({
  platform: "tiktok",
  username: "BadUser",
  action: "block",
  reason: "Test",
  resultMode: "local"
});
assert.equal(mod.ok, true);
assert.equal(core.getModerationState().tiktok.blocked.length, 1);
assert.equal(core.config.moderation.state.tiktok.blocked.length, 1);

console.log("Batto Multi-Chat smoke test: OK");
