const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } = require('electron');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {ChatCore}=require('../src/core/chat-core.cjs');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {OverlayServer}=require('../src/core/overlay-server.cjs');
const {OBSController}=require('../src/core/obs-controller.cjs');
const {StatusMonitor}=require('../src/core/status-monitor.cjs');
const {ActionEngine}=require('../src/core/action-engine.cjs');
const {AxelChatAdapter}=require('../src/adapters/axelchat.cjs');
const {TikFinityAdapter}=require('../src/adapters/tikfinity.cjs');
const {TwitchAdapter}=require('../src/adapters/twitch.cjs');
const {YouTubeAdapter}=require('../src/adapters/youtube.cjs');
const {MockAdapter}=require('../src/adapters/mock.cjs');

let mainWindow,detachedWindow,configStore,secretStore,chatCore,overlayServer,obs,statusMonitor,actionEngine,adapters;
class SecretStore{
  constructor(userDataPath){this.file=path.join(userDataPath,'BattoMultiChat','secrets.json');fs.mkdirSync(path.dirname(this.file),{recursive:true})}
  read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{}}catch{return{}}}
  write(data){const t=`${this.file}.tmp`;fs.writeFileSync(t,JSON.stringify(data,null,2),'utf8');fs.renameSync(t,this.file)}
  get(k){const v=this.read()[k];if(!v||!safeStorage.isEncryptionAvailable())return'';try{return safeStorage.decryptString(Buffer.from(v,'base64'))}catch{return''}}
  set(k,v){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows Secure Storage ist nicht verfügbar.');const d=this.read();const s=String(v||'');if(s)d[k]=safeStorage.encryptString(s).toString('base64');else delete d[k];this.write(d)}
  delete(k){const d=this.read();delete d[k];this.write(d)}
}
function send(channel,payload){for(const w of [mainWindow,detachedWindow])if(w&&!w.isDestroyed())w.webContents.send(channel,payload)}
function createWindow(detached=false){const saved=configStore?.get()?.windows?.[detached?'detachedBounds':'mainBounds'];const w=new BrowserWindow({width:saved?.width||(detached?720:1600),height:saved?.height||980,x:Number.isFinite(saved?.x)?saved.x:undefined,y:Number.isFinite(saved?.y)?saved.y:undefined,minWidth:detached?520:1180,minHeight:700,show:false,title:detached?'CRAZY_BATTO Multi-Chat – Chat':'CRAZY_BATTO Multi-Chat Platform',backgroundColor:'#020b18',icon:path.join(__dirname,'..','src','assets','icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});w.loadFile(path.join(__dirname,'..','src','renderer','index.html'),{query:{detached:detached?'1':'0'}});w.once('ready-to-show',()=>w.show());let timer;const saveBounds=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!w.isDestroyed())configStore.merge({windows:{[detached?'detachedBounds':'mainBounds']:w.getBounds()}})},250)};w.on('move',saveBounds);w.on('resize',saveBounds);return w}

function platformStatus(){return Object.fromEntries(Object.entries(adapters||{}).map(([k,a])=>[k,a.getStatus()]));}
async function startServices(){
  configStore=new ConfigStore(app.getPath('userData'));secretStore=new SecretStore(app.getPath('userData'));let cfg=configStore.get();
  chatCore=new ChatCore(cfg);overlayServer=new OverlayServer({host:cfg.http.host,port:cfg.http.port,chatCore,configStore});
  obs=new OBSController({url:cfg.obs.url,password:secretStore.get('obs.password'),onStatus:s=>send('obs:status',s)});
  const onMessage=m=>chatCore.ingest(m);const onStatus=s=>send('adapter:status',s);const onEvent=e=>{overlayServer.emitEvent(e);send('platform:event',e);actionEngine?.handleEvent(e)};
  adapters={
    axelchat:new AxelChatAdapter({...cfg.platforms.axelchat,onMessage,onEvent,onStatus}),
    tikfinity:new TikFinityAdapter({...cfg.platforms.tikfinity,onMessage,onEvent,onStatus}),
    twitch:new TwitchAdapter({channel:cfg.platforms.twitch.channel,onMessage,onStatus}),
    youtube:new YouTubeAdapter({liveChatId:cfg.platforms.youtube.liveChatId,apiKey:secretStore.get('youtube.apiKey'),pollMs:cfg.platforms.youtube.pollMs,onMessage,onStatus}),
    mock:new MockAdapter({onMessage,onStatus})
  };
  actionEngine=new ActionEngine({getConfig:()=>configStore.get(),sendChat:async(platform,text)=>{if(platform==='local'||platform==='mock'){adapters.mock.emitOne({platform:'local',username:cfg.general.displayName,text});return}throw new Error(`Senden an ${platform} ist ohne autorisierte Plattform-Anmeldung deaktiviert.`)},onTts:p=>send('tts:speak',p),onOverlay:e=>overlayServer.emitEvent({source:'automation',event:e.type||'custom',data:e.data||{}}),onLog:(l,c,m,meta)=>chatCore.log(l,c,m,meta)});
  chatCore.on('message',m=>{send('chat:message',m);actionEngine.handleMessage(m)});chatCore.on('moderation',e=>send('moderation:event',e));chatCore.on('filter-hit',e=>send('filter:hit',e));chatCore.on('log',e=>send('log:event',e));chatCore.on('config-dirty',c=>configStore.merge({moderation:c.moderation,filters:c.filters}));
  if(cfg.http.enabled&&cfg.http.autoStart!==false)await overlayServer.start().catch(e=>chatCore.log('ERROR','Overlay',e.message));
  for(const name of ['axelchat','tikfinity','twitch','youtube']){const pcfg=cfg.platforms[name];if(pcfg?.autoConnect){try{await adapters[name].connect()}catch(e){chatCore.log('WARN',name,e.message)}}}
  if(cfg.obs.autoConnect){try{await obs.connect()}catch(e){chatCore.log('WARN','OBS',e.message)}}
  statusMonitor=new StatusMonitor({obs,onStatus:s=>send('system:status',s)});statusMonitor.start();
}

function applyConfig(next,patch={}){chatCore.setConfig(next);if(patch.platforms?.axelchat)adapters.axelchat.updateConfig(next.platforms.axelchat);if(patch.platforms?.tikfinity)adapters.tikfinity.updateConfig(next.platforms.tikfinity);if(patch.platforms?.twitch)adapters.twitch.updateConfig(next.platforms.twitch);if(patch.platforms?.youtube)adapters.youtube.updateConfig({...next.platforms.youtube,apiKey:secretStore.get('youtube.apiKey')});if(patch.obs)obs.updateConfig({...next.obs,password:secretStore.get('obs.password')});}
function registerIpc(){
  ipcMain.handle('state:get',()=>{const cfg=configStore.get();return{config:cfg,messages:chatCore.getMessages(),logs:chatCore.getLogs(),moderation:chatCore.getModerationState(),moderationHistory:chatCore.getModerationHistory(),overlay:overlayServer.getStatus(),adapters:platformStatus(),obs:obs.getStatus(),secrets:{obsPassword:Boolean(secretStore.get('obs.password')),youtubeApiKey:Boolean(secretStore.get('youtube.apiKey')),discordWebhook:Boolean(secretStore.get('discord.webhook'))}}});
  ipcMain.handle('config:save',async(_e,patch)=>{const next=configStore.merge(patch||{});applyConfig(next,patch||{});if(patch?.http){if(next.http.enabled)await overlayServer.restart(next.http.host,next.http.port);else await overlayServer.stop()}return next});
  ipcMain.handle('config:reset',(_e,section)=>{const next=configStore.resetSection(section);applyConfig(next,{[section]:next[section]});return next});
  ipcMain.handle('adapter:connect',async(_e,name)=>{const a=adapters[name];if(!a)return{ok:false,error:'Unbekannter Adapter'};try{return await a.connect()}catch(e){return{ok:false,error:e.message,status:a.getStatus()}}});
  ipcMain.handle('adapter:disconnect',(_e,name)=>{const a=adapters[name];if(!a)return{ok:false,error:'Unbekannter Adapter'};a.disconnect();return{ok:true,status:a.getStatus()}});
  ipcMain.handle('chat:test',(_e,p)=>{adapters.mock.emitOne(p||{});return{ok:true}});
  ipcMain.handle('chat:send',async(_e,p={})=>{const platform=String(p.platform||'local').toLowerCase(),text=String(p.text||'').trim();if(!text)return{ok:false,error:'Nachricht ist leer.'};if(platform==='local'){adapters.mock.emitOne({platform:'local',username:configStore.get().general.displayName,text});return{ok:true}}return{ok:false,error:`Senden an ${platform} ist ohne autorisierte Plattform-Anmeldung deaktiviert.`}});
  ipcMain.handle('moderation:act',(_e,p)=>{const r=chatCore.moderate(p);if(r.ok)configStore.merge({moderation:{state:chatCore.getModerationState(),history:chatCore.getModerationHistory()}});return r});
  ipcMain.handle('filter:add',(_e,p)=>{const r=chatCore.addFilter(p);if(r.ok)configStore.merge({filters:chatCore.config.filters});return r});ipcMain.handle('filter:remove',(_e,id)=>{const r=chatCore.removeFilter(id);if(r.ok)configStore.merge({filters:chatCore.config.filters});return r});
  ipcMain.handle('chat:clear',()=>{chatCore.clearMessages();return{ok:true}});ipcMain.handle('logs:clear',()=>{chatCore.clearLogs();return{ok:true}});
  ipcMain.handle('obs:connect',async(_e,p={})=>{try{if(p.password)secretStore.set('obs.password',p.password);const cfg=configStore.get();const url=p.url||cfg.obs.url||'ws://127.0.0.1:4455';configStore.merge({obs:{...cfg.obs,url,autoConnect:Boolean(p.autoConnect)}});obs.updateConfig({url,password:secretStore.get('obs.password')});return await obs.connect()}catch(e){return{ok:false,error:e.message,status:obs.getStatus()}}});
  ipcMain.handle('obs:disconnect',async()=>{await obs.disconnect();return{ok:true,status:obs.getStatus()}});
  ipcMain.handle('youtube:saveKey',(_e,key)=>{secretStore.set('youtube.apiKey',key);adapters.youtube.updateConfig({...configStore.get().platforms.youtube,apiKey:secretStore.get('youtube.apiKey')});return{ok:true,hasKey:Boolean(key)}});
  ipcMain.handle('discord:saveWebhook',(_e,url)=>{secretStore.set('discord.webhook',url);return{ok:true,hasWebhook:Boolean(url)}});
  ipcMain.handle('discord:test',async(_e,text)=>{const url=secretStore.get('discord.webhook');if(!url)return{ok:false,error:'Kein Discord Webhook gespeichert.'};try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:String(text||'CRAZY_BATTO Test')})});if(!r.ok)throw new Error(`Discord HTTP ${r.status}`);return{ok:true}}catch(e){return{ok:false,error:e.message}}});
  ipcMain.handle('dialog:font',async()=>{const r=await dialog.showOpenDialog({title:'Eigene Schrift auswählen',properties:['openFile'],filters:[{name:'Fonts',extensions:['ttf','otf','woff','woff2']}]});if(r.canceled||!r.filePaths[0])return{ok:false,canceled:true};const src=r.filePaths[0],ext=path.extname(src).toLowerCase(),dest=path.join(configStore.fontDir,`custom${ext}`);fs.copyFileSync(src,dest);const cfg=configStore.merge({chatDesign:{customFontPath:dest,fontFamily:'BattoCustom'}});return{ok:true,path:dest,config:cfg}});
  ipcMain.handle('dialog:media',async()=>{const r=await dialog.showOpenDialog({title:'Medien hinzufügen',properties:['openFile','multiSelections'],filters:[{name:'Medien',extensions:['mp3','wav','ogg','mp4','webm','gif','png','jpg','jpeg']}]});if(r.canceled)return{ok:false,canceled:true};const cfg=configStore.get(),items=[...(cfg.media||[])];for(const src of r.filePaths){const ext=path.extname(src),name=`${Date.now()}-${crypto.randomUUID().slice(0,8)}${ext}`,dest=path.join(configStore.mediaDir,name);fs.copyFileSync(src,dest);items.push({id:crypto.randomUUID(),name:path.basename(src),path:dest,type:ext.replace('.','').toLowerCase()})}const next=configStore.merge({media:items});return{ok:true,config:next,items}});
  ipcMain.handle('overlay:open',async(_e,route='/overlay/chat')=>{const s=overlayServer.getStatus();if(!s.running)return{ok:false,error:'Overlay-Server läuft nicht.'};const url=`http://${s.host}:${s.port}${route}`;await shell.openExternal(url);return{ok:true,url}});
  ipcMain.handle('overlay:testEvent',(_e,event='gift')=>{const evt={source:'test',platform:'tiktok',event,data:{nickname:'Crazy_User',text:'Test Event'},timestamp:new Date().toISOString()};overlayServer.emitEvent(evt);send('platform:event',evt);return{ok:true}});
  ipcMain.handle('clipboard:write',(_e,text)=>{clipboard.writeText(String(text||''));return{ok:true}});
  ipcMain.handle('backup:now',()=>({ok:true,filePath:configStore.backupNow(),backups:configStore.listBackups()}));ipcMain.handle('backup:list',()=>({ok:true,backups:configStore.listBackups()}));ipcMain.handle('backup:restore',async(_e,file)=>{const next=configStore.restoreBackup(file);applyConfig(next,next);return{ok:true,config:next}});
  ipcMain.handle('dialog:exportConfig',async()=>{const r=await dialog.showSaveDialog({title:'Config exportieren',defaultPath:'crazy-batto-config.json',filters:[{name:'JSON',extensions:['json']}]});if(r.canceled||!r.filePath)return{ok:false,canceled:true};configStore.exportTo(r.filePath);return{ok:true,filePath:r.filePath}});
  ipcMain.handle('dialog:importConfig',async()=>{const r=await dialog.showOpenDialog({title:'Config importieren',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(r.canceled||!r.filePaths[0])return{ok:false,canceled:true};const next=configStore.importFrom(r.filePaths[0]);applyConfig(next,next);return{ok:true,config:next}});
  ipcMain.handle('window:detach',()=>{if(!detachedWindow||detachedWindow.isDestroyed()){detachedWindow=createWindow(true);detachedWindow.on('closed',()=>{detachedWindow=null;configStore.merge({windows:{detachedOpen:false}})});configStore.merge({windows:{detachedOpen:true}})}else detachedWindow.focus();return{ok:true}});ipcMain.handle('window:closeDetached',()=>{detachedWindow?.close();return{ok:true}});
}

const gotLock=app.requestSingleInstanceLock();if(!gotLock)app.quit();else{app.on('second-instance',()=>{if(mainWindow&&!mainWindow.isDestroyed()){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}});app.whenReady().then(async()=>{await startServices();registerIpc();mainWindow=createWindow(false);mainWindow.on('closed',()=>mainWindow=null);if(configStore.get().windows.detachedOpen){detachedWindow=createWindow(true);detachedWindow.on('closed',()=>detachedWindow=null)}app.on('activate',()=>{if(!mainWindow)mainWindow=createWindow(false)})})}
let quitting=false;app.on('before-quit',e=>{if(quitting)return;e.preventDefault();quitting=true;(async()=>{try{statusMonitor?.stop();for(const a of Object.values(adapters||{}))a.disconnect?.();await obs?.disconnect?.();await overlayServer?.stop?.()}catch{}app.quit()})()});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
