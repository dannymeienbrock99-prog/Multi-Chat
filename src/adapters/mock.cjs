class MockAdapter {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.connected = true;
  }

  getStatus() { return { name: "mock", connected: this.connected, state: "ready" }; }
  connect() { this.connected = true; this.onStatus?.(this.getStatus()); }
  disconnect() { this.connected = false; this.onStatus?.(this.getStatus()); }

  emitOne(payload = {}) {
    const platforms = ["twitch", "tiktok", "cng", "youtube"];
    this.onMessage?.({
      platform: payload.platform || platforms[Math.floor(Math.random() * platforms.length)],
      userId: payload.userId || `test-${Date.now()}`,
      username: payload.username || "Crazy_User",
      displayName: payload.displayName || payload.username || "Crazy_User",
      message: payload.text || payload.message || "Das ist eine Testnachricht im Batto Multi-Chat.",
      timestamp: new Date().toISOString(),
      badges: payload.badges || [],
      moderator: Boolean(payload.moderator),
      raw: { mock: true, ...payload }
    });
  }
}

module.exports = { MockAdapter };
