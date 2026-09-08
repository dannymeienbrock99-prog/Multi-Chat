const WebSocket = require("ws");

function first(obj, keys) {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  return undefined;
}

class AxelChatAdapter {
  constructor({ url, reconnectSeconds = 5, onMessage, onStatus }) {
    this.url = url;
    this.reconnectSeconds = reconnectSeconds;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.socket = null;
    this.manualStop = false;
    this.reconnectTimer = null;
    this.status = { name: "axelchat", connected: false, state: "idle", url };
  }

  getStatus() { return { ...this.status }; }

  updateConfig(config) {
    this.url = config.url || this.url;
    this.reconnectSeconds = Number(config.reconnectSeconds || 5);
    this.status.url = this.url;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, url: this.url };
    this.onStatus?.(this.getStatus());
  }

  connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) return;
    this.manualStop = false;
    clearTimeout(this.reconnectTimer);
    this.setStatus({ state: "connecting", connected: false, error: null });

    try { this.socket = new WebSocket(this.url); }
    catch (error) {
      this.setStatus({ state: "error", error: error.message });
      return this.scheduleReconnect();
    }

    this.socket.on("open", () => this.setStatus({ state: "connected", connected: true, error: null }));
    this.socket.on("message", (data) => this.handleRaw(data));
    this.socket.on("error", (error) => this.setStatus({ state: "error", connected: false, error: error.message }));
    this.socket.on("close", () => {
      this.socket = null;
      this.setStatus({ state: this.manualStop ? "stopped" : "disconnected", connected: false });
      if (!this.manualStop) this.scheduleReconnect();
    });
  }

  disconnect() {
    this.manualStop = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) this.socket.close();
    this.socket = null;
    this.setStatus({ state: "stopped", connected: false });
  }

  scheduleReconnect() {
    if (this.manualStop) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), Math.max(1, this.reconnectSeconds) * 1000);
  }

  handleRaw(data) {
    let payload;
    try { payload = JSON.parse(data.toString("utf8")); } catch { return; }
    const candidates = Array.isArray(payload) ? payload : [payload];
    for (const item of candidates) {
      const text = first(item, ["message", "text", "comment", "msg"]);
      if (!text) continue;
      const rawPlatform = String(first(item, ["platform", "source", "service", "streamingService"]) || "local").toLowerCase();
      const platform = rawPlatform.includes("twitch") ? "twitch" : rawPlatform.includes("youtube") ? "youtube" : rawPlatform.includes("tiktok") ? "tiktok" : rawPlatform.includes("cng") ? "cng" : "local";
      this.onMessage?.({
        platform,
        userId: first(item, ["userId", "userid", "id", "authorId"]),
        username: first(item, ["username", "user", "author", "name", "login"]) || "AxelChatUser",
        displayName: first(item, ["displayName", "nickname", "authorName", "name"]),
        message: String(text),
        timestamp: first(item, ["timestamp", "time", "date"]) || new Date().toISOString(),
        badges: first(item, ["badges", "roles"]) || [],
        moderator: Boolean(first(item, ["moderator", "isModerator", "mod"])),
        raw: item
      });
    }
  }
}

module.exports = { AxelChatAdapter };
