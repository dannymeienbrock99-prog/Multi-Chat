const { EventEmitter } = require("events");
const crypto = require("crypto");

const PLATFORMS = new Set(["tiktok", "twitch", "cng", "youtube", "local"]);

function normalizeMessage(input = {}) {
  const platform = String(input.platform || "local").toLowerCase();
  return {
    id: input.id || crypto.randomUUID(),
    platform: PLATFORMS.has(platform) ? platform : "local",
    userId: String(input.userId || input.userid || input.user_id || input.username || "unknown"),
    username: String(input.username || input.user || input.name || "Unknown"),
    displayName: String(input.displayName || input.display_name || input.username || input.user || input.name || "Unknown"),
    message: String(input.message || input.text || input.comment || ""),
    timestamp: input.timestamp || new Date().toISOString(),
    badges: Array.isArray(input.badges) ? input.badges : [],
    moderator: Boolean(input.moderator || input.isModerator || input.mod),
    raw: input.raw || input
  };
}

class ChatCore extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.messages = [];
    this.logs = [];
    this.moderation = structuredClone(config.moderation?.state || {
      tiktok: { moderators: [], muted: [], blocked: [] },
      twitch: { moderators: [], muted: [], blocked: [] },
      cng: { moderators: [], muted: [], blocked: [] },
      youtube: { moderators: [], muted: [], blocked: [] },
      local: { moderators: [], muted: [], blocked: [] }
    });
  }

  setConfig(config) { this.config = config; }

  log(level, category, message, meta = {}) {
    const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, category, message, meta };
    this.logs.push(entry);
    if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
    this.emit("log", entry);
    return entry;
  }

  getLogs() { return this.logs.slice(); }
  clearLogs() { this.logs = []; }
  getMessages() { return this.messages.slice(); }
  clearMessages() { this.messages = []; }
  getModerationState() { return structuredClone(this.moderation); }

  findLastMessage(platform, username) {
    return [...this.messages].reverse().find((m) => m.platform === platform && m.username === username)?.message || "";
  }

  evaluateFilters(message) {
    if (!this.config.filters?.enabled) return null;
    const user = message.username.toLowerCase();
    if ((this.config.filters.whitelistUsers || []).map(String).map((x) => x.toLowerCase()).includes(user)) return null;

    const text = message.message;
    const whitelist = (this.config.filters.whitelistTerms || []).map(String).map((x) => x.toLowerCase());
    for (const rule of this.config.filters.rules || []) {
      if (rule.enabled === false) continue;
      if (rule.platform && rule.platform !== "all" && rule.platform !== message.platform) continue;
      const needle = String(rule.term || "").trim();
      if (!needle || whitelist.includes(needle.toLowerCase())) continue;

      const caseSensitive = Boolean(rule.caseSensitive);
      const haystack = caseSensitive ? text : text.toLowerCase();
      const term = caseSensitive ? needle : needle.toLowerCase();
      let hit = false;
      if (rule.wholeWord) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        hit = new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, caseSensitive ? "" : "i").test(text);
      } else {
        hit = haystack.includes(term);
      }
      if (hit) return rule;
    }
    return null;
  }

  ingest(input) {
    const message = normalizeMessage(input);
    if (!message.message.trim()) return null;

    const state = this.moderation[message.platform] || this.moderation.local;
    if (state.blocked.some((x) => x.username === message.username)) {
      this.log("INFO", "Moderation", `Lokale Blockierung: Nachricht von ${message.username} verworfen.`, { platform: message.platform });
      return null;
    }
    if (state.muted.some((x) => x.username === message.username)) {
      this.log("INFO", "Moderation", `Lokale Stummschaltung: Nachricht von ${message.username} ausgeblendet.`, { platform: message.platform });
      return null;
    }

    const filter = this.evaluateFilters(message);
    if (filter) {
      const hit = {
        id: crypto.randomUUID(), timestamp: new Date().toISOString(), platform: message.platform,
        username: message.username, message: message.message, term: filter.term, action: filter.action || "hide"
      };
      this.emit("filter-hit", hit);
      this.log("INFO", "Chat-Filter", `${message.username}: "${filter.term}" erkannt`, hit);

      if (filter.action === "mute") {
        this.moderate({ platform: message.platform, username: message.username, action: "mute", reason: `Chat-Filter: ${filter.term}`, resultMode: "local" });
      } else if (filter.action === "block") {
        this.moderate({ platform: message.platform, username: message.username, action: "block", reason: `Chat-Filter: ${filter.term}`, resultMode: "local" });
      }
      if ((filter.action || "hide") === "hide") return null;
      message.filterHit = hit;
    }

    this.messages.push(message);
    const max = Math.max(100, Number(this.config.multiChat?.maxMessages || 5000));
    if (this.messages.length > max) this.messages.splice(0, this.messages.length - max);
    this.emit("message", message);
    return message;
  }

  moderate(payload = {}) {
    const platform = PLATFORMS.has(String(payload.platform).toLowerCase()) ? String(payload.platform).toLowerCase() : "local";
    const username = String(payload.username || "").trim();
    const action = String(payload.action || "");
    const reason = String(payload.reason || "").trim();
    if (!username) return { ok: false, error: "Benutzername fehlt." };

    const state = this.moderation[platform];
    const remove = (list) => { const index = list.findIndex((x) => x.username === username); if (index >= 0) list.splice(index, 1); };
    const add = (list) => { remove(list); list.push({ username, reason, at: new Date().toISOString() }); };

    if (action === "addModerator") add(state.moderators);
    else if (action === "removeModerator") remove(state.moderators);
    else if (action === "mute") add(state.muted);
    else if (action === "unmute") remove(state.muted);
    else if (action === "block") add(state.blocked);
    else if (action === "unblock") remove(state.blocked);
    else return { ok: false, error: "Unbekannte Moderationsaktion." };

    this.config.moderation.state = structuredClone(this.moderation);

    const entry = {
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), platform, username, action, reason,
      lastMessage: this.findLastMessage(platform, username),
      executor: this.config.general?.displayName || "Crazy_Batto",
      result: payload.resultMode || "local"
    };
    this.emit("moderation", entry);
    this.log("INFO", "Moderation", `${username}: ${action}`, entry);
    return { ok: true, entry, state: structuredClone(state) };
  }

  addFilter(payload = {}) {
    const term = String(payload.term || "").trim();
    if (!term) return { ok: false, error: "Begriff fehlt." };
    const rule = {
      id: crypto.randomUUID(), term, platform: payload.platform || "all", action: payload.action || "hide",
      wholeWord: Boolean(payload.wholeWord), caseSensitive: Boolean(payload.caseSensitive), enabled: payload.enabled !== false
    };
    this.config.filters.rules = [...(this.config.filters.rules || []), rule];
    this.emit("config-dirty", this.config);
    return { ok: true, rule };
  }

  removeFilter(id) {
    const before = this.config.filters.rules.length;
    this.config.filters.rules = this.config.filters.rules.filter((rule) => rule.id !== id);
    return { ok: this.config.filters.rules.length !== before };
  }
}

module.exports = { ChatCore, normalizeMessage };
