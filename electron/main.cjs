const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { ChatCore } = require("../src/core/chat-core.cjs");
const { ConfigStore } = require("../src/core/config-store.cjs");
const { OverlayServer } = require("../src/core/overlay-server.cjs");
const { AxelChatAdapter } = require("../src/adapters/axelchat.cjs");
const { TwitchAdapter, normalizeChannel } = require("../src/adapters/twitch.cjs");
const { MockAdapter } = require("../src/adapters/mock.cjs");

let mainWindow;
let detachedWindow;
let configStore;
let secretStore;
let chatCore;
let overlayServer;
let adapters;

class SecretStore {
  constructor(userDataPath) {
    this.dir = path.join(userDataPath, "BattoMultiChat");
    this.file = path.join(this.dir, "secrets.json");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  readAll() {
    try {
      if (!fs.existsSync(this.file)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  writeAll(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  get(key) {
    const value = this.readAll()[key];
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(String(value), "base64"));
    } catch {
      return "";
    }
  }

  set(key, value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows Secure Storage ist momentan nicht verfügbar.");
    }
    const all = this.readAll();
    const clean = String(value || "");
    if (!clean) delete all[key];
    else all[key] = safeStorage.encryptString(clean).toString("base64");
    this.writeAll(all);
  }

  delete(key) {
    const all = this.readAll();
    delete all[key];
    this.writeAll(all);
  }
}

function createWindow({ detached = false } = {}) {
  const saved = configStore?.get()?.windows?.[detached ? "detachedBounds" : "mainBounds"];
  const win = new BrowserWindow({
    width: saved?.width || (detached ? 620 : 1280),
    height: saved?.height || 820,
    x: Number.isFinite(saved?.x) ? saved.x : undefined,
    y: Number.isFinite(saved?.y) ? saved.y : undefined,
    minWidth: detached ? 420 : 980,
    minHeight: 620,
    show: false,
    backgroundColor: "#07111f",
    title: detached ? "Batto Multi-Chat – Entkoppelt" : "Batto Multi-Chat",
    icon: path.join(__dirname, "..", "src", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"), {
    query: { detached: detached ? "1" : "0" }
  });
  win.once("ready-to-show", () => win.show());

  const persistBounds = () => {
    if (!configStore || win.isDestroyed()) return;
    const bounds = win.getBounds();
    configStore.merge({ windows: { [detached ? "detachedBounds" : "mainBounds"]: bounds } });
  };
  let boundsTimer;
  const scheduleBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(persistBounds, 250);
  };
  win.on("move", scheduleBounds);
  win.on("resize", scheduleBounds);
  return win;
}

function sendToRenderers(channel, payload) {
  for (const win of [mainWindow, detachedWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function startServices() {
  configStore = new ConfigStore(app.getPath("userData"));
  secretStore = new SecretStore(app.getPath("userData"));
  const config = configStore.get();

  chatCore = new ChatCore(config);
  overlayServer = new OverlayServer({
    host: config.http.host,
    port: config.http.port,
    chatCore,
    configStore
  });

  adapters = {
    axelchat: new AxelChatAdapter({
      url: config.platforms.axelchat.url,
      reconnectSeconds: config.platforms.axelchat.reconnectSeconds,
      onMessage: (message) => chatCore.ingest(message),
      onStatus: (status) => sendToRenderers("adapter:status", status)
    }),
    twitch: new TwitchAdapter({
      account: config.platforms.twitch?.account,
      channel: config.platforms.twitch?.channel,
      getToken: () => secretStore.get("twitch.oauth"),
      onMessage: (message) => chatCore.ingest(message),
      onStatus: (status) => sendToRenderers("adapter:status", status)
    }),
    mock: new MockAdapter({
      onMessage: (message) => chatCore.ingest(message),
      onStatus: (status) => sendToRenderers("adapter:status", status)
    })
  };

  chatCore.on("message", (message) => sendToRenderers("chat:message", message));
  chatCore.on("moderation", (entry) => sendToRenderers("moderation:event", entry));
  chatCore.on("filter-hit", (entry) => sendToRenderers("filter:hit", entry));
  chatCore.on("log", (entry) => sendToRenderers("log:event", entry));

  if (config.http.enabled && config.http.autoStart !== false) {
    await overlayServer.start().catch((error) => {
      chatCore.log("ERROR", "OBS", `Overlay-Server: ${error.message}`);
    });
  }

  if (config.platforms.axelchat.autoConnect) adapters.axelchat.connect();
  if (config.platforms.twitch?.autoConnect && secretStore.get("twitch.oauth")) {
    adapters.twitch.connect().catch((error) => chatCore.log("ERROR", "Twitch", error.message));
  }
}

function registerIpc() {
  ipcMain.handle("state:get", () => {
    const config = configStore.get();
    return {
      config,
      messages: chatCore.getMessages(),
      moderation: chatCore.getModerationState(),
      logs: chatCore.getLogs(),
      overlay: overlayServer.getStatus(),
      twitchAuth: { hasToken: Boolean(secretStore.get("twitch.oauth")) },
      adapters: Object.fromEntries(Object.entries(adapters).map(([key, adapter]) => [key, adapter.getStatus()]))
    };
  });

  ipcMain.handle("config:save", async (_event, patch) => {
    const next = configStore.merge(patch);
    chatCore.setConfig(next);

    if (patch?.http) {
      if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
      else await overlayServer.stop();
    }
    if (patch?.platforms?.axelchat) adapters.axelchat.updateConfig(next.platforms.axelchat);
    if (patch?.platforms?.twitch) adapters.twitch.updateConfig(next.platforms.twitch);
    return next;
  });

  ipcMain.handle("adapter:connect", async (_event, name) => {
    if (!adapters[name]) return { ok: false, error: "Unbekannter Adapter" };
    try {
      await adapters[name].connect();
      return { ok: true, status: adapters[name].getStatus() };
    } catch (error) {
      return { ok: false, error: error.message, status: adapters[name].getStatus() };
    }
  });

  ipcMain.handle("adapter:disconnect", (_event, name) => {
    if (!adapters[name]) return { ok: false, error: "Unbekannter Adapter" };
    adapters[name].disconnect();
    return { ok: true, status: adapters[name].getStatus() };
  });

  ipcMain.handle("twitch:saveConnect", async (_event, payload = {}) => {
    try {
      const current = configStore.get().platforms.twitch || {};
      const incomingToken = String(payload.token || "").trim();
      const token = incomingToken || secretStore.get("twitch.oauth");
      const validation = await adapters.twitch.validateToken(token);
      const channel = normalizeChannel(payload.channel || current.channel || validation.login);
      if (!channel) return { ok: false, error: "Kein Twitch-Kanal angegeben." };

      if (incomingToken) secretStore.set("twitch.oauth", validation.token);
      const next = configStore.merge({
        platforms: {
          twitch: {
            ...current,
            enabled: true,
            account: validation.login,
            channel,
            autoConnect: Boolean(payload.autoConnect),
            status: "configured"
          }
        }
      });
      chatCore.setConfig(next);
      adapters.twitch.updateConfig(next.platforms.twitch);
      await adapters.twitch.connect();
      return { ok: true, login: validation.login, channel, scopes: validation.scopes, status: adapters.twitch.getStatus() };
    } catch (error) {
      return { ok: false, error: error.message, status: adapters.twitch.getStatus() };
    }
  });

  ipcMain.handle("twitch:check", async (_event, payload = {}) => {
    try {
      const token = String(payload.token || "").trim() || secretStore.get("twitch.oauth");
      const validation = await adapters.twitch.validateToken(token);
      return { ok: true, login: validation.login, scopes: validation.scopes, expiresIn: validation.expiresIn };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("twitch:disconnect", () => {
    adapters.twitch.disconnect();
    return { ok: true, status: adapters.twitch.getStatus() };
  });

  ipcMain.handle("twitch:clear", () => {
    adapters.twitch.disconnect();
    secretStore.delete("twitch.oauth");
    const current = configStore.get().platforms.twitch || {};
    const next = configStore.merge({
      platforms: { twitch: { ...current, account: "", autoConnect: false, status: "not-configured" } }
    });
    chatCore.setConfig(next);
    adapters.twitch.updateConfig(next.platforms.twitch);
    return { ok: true, config: next };
  });

  ipcMain.handle("twitch:openDashboard", async (_event, channelValue) => {
    const channel = normalizeChannel(channelValue || configStore.get().platforms.twitch?.channel);
    if (!channel) return { ok: false, error: "Kein Twitch-Kanal angegeben." };
    const url = `https://dashboard.twitch.tv/popout/u/${encodeURIComponent(channel)}/stream-manager/chat`;
    await shell.openExternal(url);
    return { ok: true, url };
  });

  ipcMain.handle("chat:test", (_event, payload) => {
    adapters.mock.emitOne(payload || {});
    return { ok: true };
  });

  ipcMain.handle("chat:send", async (_event, payload) => {
    const platform = String(payload?.platform || "").toLowerCase();
    const text = String(payload?.text || "").trim();
    if (!text) return { ok: false, error: "Nachricht ist leer." };

    if (platform === "local" || platform === "mock") {
      adapters.mock.emitOne({ platform: "local", username: configStore.get().general.displayName || "Crazy_Batto", text });
      return { ok: true, mode: "local" };
    }

    if (platform === "twitch") {
      try {
        await adapters.twitch.sendChat(text);
        return { ok: true, mode: "twitch" };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    return { ok: false, error: `Senden an ${platform || "diese Plattform"} ist noch nicht durch einen autorisierten Plattform-Adapter freigeschaltet.` };
  });

  ipcMain.handle("moderation:act", (_event, payload) => {
    const result = chatCore.moderate(payload);
    if (result.ok) configStore.merge({ moderation: { state: chatCore.getModerationState() } });
    return result;
  });

  ipcMain.handle("filter:add", (_event, payload) => {
    const result = chatCore.addFilter(payload);
    if (result.ok) configStore.merge({ filters: { rules: chatCore.config.filters.rules } });
    return result;
  });

  ipcMain.handle("filter:remove", (_event, id) => {
    const result = chatCore.removeFilter(id);
    if (result.ok) configStore.merge({ filters: { rules: chatCore.config.filters.rules } });
    return result;
  });

  ipcMain.handle("chat:clear", () => {
    chatCore.clearMessages();
    return { ok: true };
  });

  ipcMain.handle("logs:clear", () => {
    chatCore.clearLogs();
    return { ok: true };
  });

  ipcMain.handle("window:detach", () => {
    if (!detachedWindow || detachedWindow.isDestroyed()) {
      detachedWindow = createWindow({ detached: true });
      detachedWindow.on("closed", () => {
        detachedWindow = null;
        configStore.merge({ windows: { detachedOpen: false } });
      });
      configStore.merge({ windows: { detachedOpen: true } });
    } else {
      detachedWindow.focus();
    }
    return { ok: true };
  });

  ipcMain.handle("window:closeDetached", () => {
    if (detachedWindow && !detachedWindow.isDestroyed()) detachedWindow.close();
    return { ok: true };
  });

  ipcMain.handle("overlay:open", async (_event, route = "/overlay/chat") => {
    const status = overlayServer.getStatus();
    if (!status.running) return { ok: false, error: "Overlay-Server läuft nicht." };
    const url = `http://${status.host}:${status.port}${route}`;
    await shell.openExternal(url);
    return { ok: true, url };
  });

  ipcMain.handle("backup:now", () => {
    const filePath = configStore.backupNow();
    return { ok: true, filePath, backups: configStore.listBackups() };
  });

  ipcMain.handle("backup:list", () => ({ ok: true, backups: configStore.listBackups() }));

  ipcMain.handle("backup:restore", async (_event, filePath) => {
    const next = configStore.restoreBackup(filePath);
    chatCore.setConfig(next);
    if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
    else await overlayServer.stop();
    adapters.axelchat.updateConfig(next.platforms.axelchat);
    adapters.twitch.updateConfig(next.platforms.twitch || {});
    return { ok: true, config: next };
  });

  ipcMain.handle("dialog:exportConfig", async () => {
    const result = await dialog.showSaveDialog({
      title: "Batto Multi-Chat Config exportieren",
      defaultPath: "batto-multichat-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    configStore.exportTo(result.filePath);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("dialog:importConfig", async () => {
    const result = await dialog.showOpenDialog({
      title: "Batto Multi-Chat Config importieren",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const next = configStore.importFrom(result.filePaths[0]);
    chatCore.setConfig(next);
    if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
    else await overlayServer.stop();
    adapters.axelchat.updateConfig(next.platforms.axelchat);
    adapters.twitch.updateConfig(next.platforms.twitch || {});
    return { ok: true, config: next };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await startServices();
    registerIpc();

    mainWindow = createWindow();
    mainWindow.on("closed", () => { mainWindow = null; });

    const config = configStore.get();
    if (config.windows.detachedOpen) {
      detachedWindow = createWindow({ detached: true });
      detachedWindow.on("closed", () => {
        detachedWindow = null;
        configStore.merge({ windows: { detachedOpen: false } });
      });
    }

    app.on("activate", () => {
      if (!mainWindow) mainWindow = createWindow();
    });
  });
}

app.on("before-quit", async () => {
  try {
    for (const adapter of Object.values(adapters || {})) adapter.disconnect();
    if (overlayServer) await overlayServer.stop();
  } catch {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
