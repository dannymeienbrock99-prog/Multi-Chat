const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("batto", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveConfig: (patch) => ipcRenderer.invoke("config:save", patch),
  connectAdapter: (name) => ipcRenderer.invoke("adapter:connect", name),
  disconnectAdapter: (name) => ipcRenderer.invoke("adapter:disconnect", name),
  twitchDisconnect: () => ipcRenderer.invoke("twitch:disconnect"),
  twitchClear: () => ipcRenderer.invoke("twitch:clear"),
  twitchOpenDashboard: (channel) => ipcRenderer.invoke("twitch:openDashboard", channel),
  testMessage: (payload) => ipcRenderer.invoke("chat:test", payload),
  sendMessage: (payload) => ipcRenderer.invoke("chat:send", payload),
  moderate: (payload) => ipcRenderer.invoke("moderation:act", payload),
  addFilter: (payload) => ipcRenderer.invoke("filter:add", payload),
  removeFilter: (id) => ipcRenderer.invoke("filter:remove", id),
  clearChat: () => ipcRenderer.invoke("chat:clear"),
  clearLogs: () => ipcRenderer.invoke("logs:clear"),
  detachChat: () => ipcRenderer.invoke("window:detach"),
  closeDetached: () => ipcRenderer.invoke("window:closeDetached"),
  openOverlay: (route) => ipcRenderer.invoke("overlay:open", route),
  exportConfig: () => ipcRenderer.invoke("dialog:exportConfig"),
  importConfig: () => ipcRenderer.invoke("dialog:importConfig"),
  backupNow: () => ipcRenderer.invoke("backup:now"),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  restoreBackup: (filePath) => ipcRenderer.invoke("backup:restore", filePath),
  onChatMessage: (cb) => on("chat:message", cb),
  onAdapterStatus: (cb) => on("adapter:status", cb),
  onModerationEvent: (cb) => on("moderation:event", cb),
  onFilterHit: (cb) => on("filter:hit", cb),
  onLogEvent: (cb) => on("log:event", cb)
});
