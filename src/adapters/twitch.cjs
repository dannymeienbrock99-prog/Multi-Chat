const WebSocket = require("ws");

function normalizeToken(value = "") {
  return String(value).trim().replace(/^oauth:/i, "");
}

function normalizeChannel(value = "") {
  const raw = String(value).trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "dashboard.twitch.tv") {
      const m = url.pathname.match(/\/popout\/u\/([^/]+)/i);
      if (m?.[1]) return decodeURIComponent(m[1]).toLowerCase();
    }
    if (host === "www.twitch.tv" || host === "twitch.tv") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "popout" && parts[1]) return parts[1].toLowerCase();
      if (parts[0]) return parts[0].toLowerCase();
    }
  } catch {}

  return raw.replace(/^#/, "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function parseTags(raw = "") {
  const out = {};
  for (const part of String(raw).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i);
    const value = part.slice(i + 1)
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
    out[key] = value;
  }
  return out;
}

class TwitchAdapter {
  constructor({ account = "", channel = "", onMessage, onStatus, getToken }) {
    this.account = String(account || "").toLowerCase();
    this.channel = normalizeChannel(channel || account);
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.getToken = getToken;
    this.socket = null;
    this.connectPromise = null;
    this.manualStop = false;
    this.scopes = [];
    this.status = {
      name: "twitch",
      connected: false,
      state: "not-configured",
      account: this.account,
      channel: this.channel,
      error: null
    };
  }

  getStatus() { return { ...this.status, scopes: [...this.scopes] }; }

  setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      account: this.account,
      channel: this.channel
    };
    this.onStatus?.(this.getStatus());
  }

  updateConfig(config = {}) {
    if (config.account !== undefined) this.account = String(config.account || "").trim().toLowerCase();
    if (config.channel !== undefined) this.channel = normalizeChannel(config.channel || this.account);
    this.setStatus({});
  }

  async validateToken(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (!token) throw new Error("Kein Twitch OAuth / Access Token gespeichert.");

    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      method: "GET",
      headers: { Authorization: `OAuth ${token}` }
    });

    if (!response.ok) {
      throw new Error("Twitch-Token ist ungültig, abgelaufen oder wurde widerrufen.");
    }

    const data = await response.json();
    const login = String(data.login || "").toLowerCase();
    const scopes = Array.isArray(data.scopes) ? data.scopes.map(String) : [];
    if (!login) throw new Error("Twitch konnte dem Token keinen Benutzer zuordnen.");
    if (!scopes.includes("chat:read")) {
      throw new Error("Dem Twitch-Token fehlt die Berechtigung chat:read.");
    }

    return {
      token,
      login,
      userId: String(data.user_id || ""),
      clientId: String(data.client_id || ""),
      scopes,
      expiresIn: Number(data.expires_in || 0)
    };
  }

  async connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return this.connectPromise || { ok: true, status: this.getStatus() };
    }

    const storedToken = await this.getToken?.();
    const validation = await this.validateToken(storedToken);
    this.account = validation.login;
    this.scopes = validation.scopes;
    if (!this.channel) this.channel = this.account;
    if (!this.channel) throw new Error("Kein Twitch-Kanal eingetragen.");

    this.manualStop = false;
    this.setStatus({ state: "connecting", connected: false, error: null });

    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let authenticated = false;
      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.socket = socket;

      const finishError = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = message instanceof Error ? message : new Error(String(message));
        this.setStatus({ state: "error", connected: false, error: error.message });
        reject(error);
      };

      const finishOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.setStatus({ state: "connected", connected: true, error: null });
        resolve({ ok: true, status: this.getStatus() });
      };

      const timer = setTimeout(() => finishError("Twitch-Verbindung: Zeitüberschreitung."), 12000);

      socket.on("open", () => {
        socket.send("CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands");
        socket.send(`PASS oauth:${validation.token}`);
        socket.send(`NICK ${validation.login}`);
      });

      socket.on("message", (data) => {
        const raw = data.toString("utf8");
        for (const line of raw.split("\r\n")) {
          if (!line) continue;
          if (line.startsWith("PING ")) {
            if (socket.readyState === WebSocket.OPEN) socket.send(line.replace(/^PING/, "PONG"));
            continue;
          }
          if (/NOTICE \* :Login authentication failed/i.test(line)) {
            finishError("Twitch: Login authentication failed – Token wurde abgelehnt.");
            try { socket.close(); } catch {}
            continue;
          }
          if (/NOTICE \* :Improperly formatted auth/i.test(line)) {
            finishError("Twitch: OAuth-Anmeldung ist falsch formatiert.");
            try { socket.close(); } catch {}
            continue;
          }
          if (/^:tmi\.twitch\.tv 001 /i.test(line)) {
            authenticated = true;
            if (socket.readyState === WebSocket.OPEN) socket.send(`JOIN #${this.channel}`);
            finishOk();
            continue;
          }
          this.handleIrcLine(line);
        }
      });

      socket.on("error", (error) => finishError(error));
      socket.on("close", () => {
        this.socket = null;
        this.connectPromise = null;
        if (!authenticated && !settled && !this.manualStop) {
          finishError("Twitch hat die Verbindung vor der Anmeldung geschlossen.");
          return;
        }
        if (!this.manualStop) this.setStatus({ state: "disconnected", connected: false });
        else this.setStatus({ state: "stopped", connected: false });
      });
    });

    return this.connectPromise;
  }

  handleIrcLine(line) {
    let rest = line;
    let tags = {};
    if (rest.startsWith("@")) {
      const space = rest.indexOf(" ");
      if (space > 0) {
        tags = parseTags(rest.slice(1, space));
        rest = rest.slice(space + 1);
      }
    }

    const match = rest.match(/^:([^! ]+)!.* PRIVMSG #([^ ]+) :([\s\S]*)$/);
    if (!match) return;

    const username = match[1];
    const channel = match[2];
    const message = match[3];
    this.onMessage?.({
      platform: "twitch",
      id: tags.id,
      userId: tags["user-id"] || username,
      username,
      displayName: tags["display-name"] || username,
      message,
      timestamp: tags["tmi-sent-ts"] ? new Date(Number(tags["tmi-sent-ts"])).toISOString() : new Date().toISOString(),
      badges: tags.badges ? tags.badges.split(",").filter(Boolean) : [],
      moderator: tags.mod === "1" || String(tags.badges || "").includes("moderator/") || String(tags.badges || "").includes("broadcaster/"),
      raw: { line, tags, channel }
    });
  }

  async sendChat(text) {
    const message = String(text || "").trim();
    if (!message) throw new Error("Nachricht ist leer.");
    if (!this.scopes.includes("chat:edit")) throw new Error("Dem Twitch-Token fehlt chat:edit.");
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.status.connected) {
      throw new Error("Twitch ist nicht verbunden.");
    }
    this.socket.send(`PRIVMSG #${this.channel} :${message.replace(/[\r\n]+/g, " ")}`);
    return { ok: true };
  }

  disconnect() {
    this.manualStop = true;
    if (this.socket) {
      try { this.socket.close(); } catch {}
    }
    this.socket = null;
    this.connectPromise = null;
    this.setStatus({ state: "stopped", connected: false, error: null });
  }
}

module.exports = { TwitchAdapter, normalizeToken, normalizeChannel, parseTags };
