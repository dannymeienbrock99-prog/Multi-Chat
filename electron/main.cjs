const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { ChatCore } = require("../src/core/chat-core.cjs");
const { ConfigStore } = require("../src/core/config-store.cjs");
const { OverlayServer } = require("../src/core/overlay-server.cjs");
const { AxelChatAdapter } = require("../src/adapters/axelchat.cjs");
const { MockAdapter } = require("../src/adapters/mock.cjs");

let mainWindow;
let detachedWindow;
let configStore;
let chatCore;
let overlayServer;
let adapters;

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
    configStore.merge({
      windows: {
        [detached ? "detachedBounds" : "mainBounds"]: bounds
      }
    });
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
      adapters: Object.fromEntries(
        Object.entries(adapters).map(([key, adapter]) => [key, adapter.getStatus()])
      )
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
    return next;
  });

  ipcMain.handle("adapter:connect", (_event, name) => {
    if (!adapters[name]) return { ok: false, error: "Unbekannter Adapter" };
    adapters[name].connect();
    return { ok: true };
  });

  ipcMain.handle("adapter:disconnect", (_event, name) => {
    if (!adapters[name]) return { ok: false, error: "Unbekannter Adapter" };
    adapters[name].disconnect();
    return { ok: true };
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
      adapters.mock.emitOne({
        platform: "local",
        username: configStore.get().general.displayName || "Crazy_Batto",
        text
      });
      return { ok: true, mode: "local" };
    }

    return {
      ok: false,
      error: `Senden an ${platform || "diese Plattform"} ist noch nicht durch einen autorisierten Plattform-Adapter freigeschaltet.`
    };
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
    return { ok: true, config: next };
  });
}

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

app.on("before-quit", async () => {
  try {
    for (const adapter of Object.values(adapters || {})) adapter.disconnect();
    if (overlayServer) await overlayServer.stop();
  } catch {}
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
