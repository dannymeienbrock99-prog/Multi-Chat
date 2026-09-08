const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('batto', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  resetConfig: (section) => ipcRenderer.invoke('config:reset', section),

  connectAdapter: (name) => ipcRenderer.invoke('adapter:connect', name),
  disconnectAdapter: (name) => ipcRenderer.invoke('adapter:disconnect', name),

  testMessage: (payload) => ipcRenderer.invoke('chat:test', payload),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  moderate: (payload) => ipcRenderer.invoke('moderation:act', payload),
  addFilter: (payload) => ipcRenderer.invoke('filter:add', payload),
  removeFilter: (id) => ipcRenderer.invoke('filter:remove', id),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  obsConnect: (payload) => ipcRenderer.invoke('obs:connect', payload),
  obsDisconnect: () => ipcRenderer.invoke('obs:disconnect'),
  youtubeSaveKey: (key) => ipcRenderer.invoke('youtube:saveKey', key),
  discordSaveWebhook: (url) => ipcRenderer.invoke('discord:saveWebhook', url),
  discordTest: (text) => ipcRenderer.invoke('discord:test', text),

  cngSaveChatUrl: (url) => ipcRenderer.invoke('cng:saveChatUrl', url),
  cngClearChatUrl: () => ipcRenderer.invoke('cng:clearChatUrl'),
  cngCopyUrl: (kind) => ipcRenderer.invoke('cng:copyUrl', kind),
  cngOpenUrl: (kind) => ipcRenderer.invoke('cng:openUrl', kind),

  ttsListVoices: () => ipcRenderer.invoke('tts:listVoices'),
  ttsSynthesize: (payload) => ipcRenderer.invoke('tts:synthesize', payload),
  ttsCleanup: (filePath) => ipcRenderer.invoke('tts:cleanup', filePath),

  importFont: () => ipcRenderer.invoke('dialog:font'),
  importMedia: () => ipcRenderer.invoke('dialog:media'),
  removeMedia: (id) => ipcRenderer.invoke('media:remove', id),
  testAutomationAction: (action) => ipcRenderer.invoke('automation:testAction', action),
  testBroadcast: () => ipcRenderer.invoke('broadcast:test'),

  openOverlay: (route) => ipcRenderer.invoke('overlay:open', route),
  testEvent: (event) => ipcRenderer.invoke('overlay:testEvent', event),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  backupNow: () => ipcRenderer.invoke('backup:now'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (path) => ipcRenderer.invoke('backup:restore', path),
  exportConfig: () => ipcRenderer.invoke('dialog:exportConfig'),
  importConfig: () => ipcRenderer.invoke('dialog:importConfig'),
  detachChat: () => ipcRenderer.invoke('window:detach'),
  closeDetached: () => ipcRenderer.invoke('window:closeDetached'),

  onChatMessage: (cb) => on('chat:message', cb),
  onAdapterStatus: (cb) => on('adapter:status', cb),
  onModerationEvent: (cb) => on('moderation:event', cb),
  onFilterHit: (cb) => on('filter:hit', cb),
  onLogEvent: (cb) => on('log:event', cb),
  onPlatformEvent: (cb) => on('platform:event', cb),
  onObsStatus: (cb) => on('obs:status', cb),
  onSystemStatus: (cb) => on('system:status', cb),
  onTtsSpeak: (cb) => on('tts:speak', cb),
  onConfigChanged: (cb) => on('config:changed', cb)
});
