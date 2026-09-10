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
  settingsDraft: (patch) => ipcRenderer.invoke('settings:draft', patch),
  settingsApply: () => ipcRenderer.invoke('settings:apply'),
  settingsDiscard: () => ipcRenderer.invoke('settings:discard'),
  settingsReset: (section) => ipcRenderer.invoke('settings:reset', section),
  settingsTest: (section) => ipcRenderer.invoke('settings:test', section),

  connectAdapter: (name) => ipcRenderer.invoke('adapter:connect', name),
  disconnectAdapter: (name) => ipcRenderer.invoke('adapter:disconnect', name),
  adapterHealth: (name) => ipcRenderer.invoke('adapter:health', name),

  testMessage: (payload) => ipcRenderer.invoke('chat:test', payload),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  moderate: (payload) => ipcRenderer.invoke('moderation:act', payload),
  addFilter: (payload) => ipcRenderer.invoke('filter:add', payload),
  removeFilter: (id) => ipcRenderer.invoke('filter:remove', id),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),

  obsConnect: (payload) => ipcRenderer.invoke('obs:connect', payload),
  obsDisconnect: () => ipcRenderer.invoke('obs:disconnect'),
  obsTest: () => ipcRenderer.invoke('obs:test'),
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
  testAutomationSequence: payload=>ipcRenderer.invoke('automation:testSequence',payload),
  testAutomationAction: (action) => ipcRenderer.invoke('automation:testAction', action),
  cancelAutomation: (ruleId) => ipcRenderer.invoke('automation:cancel', ruleId),
  cancelAllAutomations: () => ipcRenderer.invoke('automation:cancelAll'),
  activeAutomations: () => ipcRenderer.invoke('automation:active'),
  testBroadcast: () => ipcRenderer.invoke('broadcast:test'),
  broadcastUpsert: x=>ipcRenderer.invoke('broadcast:upsert',x),
  broadcastDelete: x=>ipcRenderer.invoke('broadcast:delete',x),
  broadcastDuplicate: x=>ipcRenderer.invoke('broadcast:duplicate',x),
  broadcastMaster: x=>ipcRenderer.invoke('broadcast:master',x),
  broadcastTest: x=>ipcRenderer.invoke('broadcast:testItem',x),
  broadcastStatus: ()=>ipcRenderer.invoke('broadcast:status'),
  onBroadcastStatus: cb=>on('broadcast:status',cb),

  openOverlay: (route) => ipcRenderer.invoke('overlay:open', route),
  testEvent: (event) => ipcRenderer.invoke('overlay:testEvent', event),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  ffmpegDetect: () => ipcRenderer.invoke('ffmpeg:detect'),
  ffmpegTestEncoder: (encoder) => ipcRenderer.invoke('ffmpeg:testEncoder', encoder),
  ffmpegStart: (args, options) => ipcRenderer.invoke('ffmpeg:start', args, options),
  ffmpegStop: () => ipcRenderer.invoke('ffmpeg:stop'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  healthGet: () => ipcRenderer.invoke('health:get'),
  diagnosticsGet: () => ipcRenderer.invoke('diagnostics:get'),
  diagnosticsExport: () => ipcRenderer.invoke('diagnostics:export'),

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
  onConfigChanged: (cb) => on('config:changed', cb),
  onHealthStatus: (cb) => on('health:status', cb),
  onFfmpegStatus: (cb) => on('ffmpeg:status', cb),
  onDatabaseStatus: (cb) => on('database:status', cb)
});
