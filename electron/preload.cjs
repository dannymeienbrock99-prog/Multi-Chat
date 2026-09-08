const {contextBridge,ipcRenderer}=require('electron');
const on=(channel,cb)=>{const listener=(_e,p)=>cb(p);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener)};
contextBridge.exposeInMainWorld('batto',{
  getState:()=>ipcRenderer.invoke('state:get'),saveConfig:p=>ipcRenderer.invoke('config:save',p),resetConfig:s=>ipcRenderer.invoke('config:reset',s),
  connectAdapter:n=>ipcRenderer.invoke('adapter:connect',n),disconnectAdapter:n=>ipcRenderer.invoke('adapter:disconnect',n),
  testMessage:p=>ipcRenderer.invoke('chat:test',p),sendMessage:p=>ipcRenderer.invoke('chat:send',p),moderate:p=>ipcRenderer.invoke('moderation:act',p),addFilter:p=>ipcRenderer.invoke('filter:add',p),removeFilter:id=>ipcRenderer.invoke('filter:remove',id),clearChat:()=>ipcRenderer.invoke('chat:clear'),clearLogs:()=>ipcRenderer.invoke('logs:clear'),
  obsConnect:p=>ipcRenderer.invoke('obs:connect',p),obsDisconnect:()=>ipcRenderer.invoke('obs:disconnect'),youtubeSaveKey:k=>ipcRenderer.invoke('youtube:saveKey',k),discordSaveWebhook:u=>ipcRenderer.invoke('discord:saveWebhook',u),discordTest:t=>ipcRenderer.invoke('discord:test',t),
  importFont:()=>ipcRenderer.invoke('dialog:font'),importMedia:()=>ipcRenderer.invoke('dialog:media'),openOverlay:r=>ipcRenderer.invoke('overlay:open',r),testEvent:e=>ipcRenderer.invoke('overlay:testEvent',e),copyText:t=>ipcRenderer.invoke('clipboard:write',t),
  backupNow:()=>ipcRenderer.invoke('backup:now'),listBackups:()=>ipcRenderer.invoke('backup:list'),restoreBackup:p=>ipcRenderer.invoke('backup:restore',p),exportConfig:()=>ipcRenderer.invoke('dialog:exportConfig'),importConfig:()=>ipcRenderer.invoke('dialog:importConfig'),detachChat:()=>ipcRenderer.invoke('window:detach'),closeDetached:()=>ipcRenderer.invoke('window:closeDetached'),
  onChatMessage:cb=>on('chat:message',cb),onAdapterStatus:cb=>on('adapter:status',cb),onModerationEvent:cb=>on('moderation:event',cb),onFilterHit:cb=>on('filter:hit',cb),onLogEvent:cb=>on('log:event',cb),onPlatformEvent:cb=>on('platform:event',cb),onObsStatus:cb=>on('obs:status',cb),onSystemStatus:cb=>on('system:status',cb),onTtsSpeak:cb=>on('tts:speak',cb)
});
