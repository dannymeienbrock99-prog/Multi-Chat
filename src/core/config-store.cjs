const fs = require('fs');
const path = require('path');
const { assertValidConfig, validateConfig } = require('./settings/schema.cjs');

const CURRENT_VERSION = 6;
const CURRENT_SCHEMA_VERSION = 3;

const DEFAULT_CONFIG = {
  version: CURRENT_VERSION,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  general: { displayName:'Crazy_Batto', language:'de', autoSave:false, startMinimized:false, startView:'multichat', minimizeToTray:false, updateBehavior:'manual' },
  appearance: { uiScale:1, panelOpacity:.9, brightness:1, compact:false, programBackground:true, backgroundDarkness:.28, theme:'crazy-batto' },
  sync: { enabled:true, debounceMs:250, modules:{ platforms:true, commands:true, autoBroadcast:true, events:true, mediaPools:true, tts:true, cng:true, cohost:true, overlays:true, obs:true, alerts:true } },
  multiChat: { enabled:true, defaultTab:'all', showTimestamp:true, showPlatform:true, showBadges:true, autoScroll:true, maxMessages:500, fontFamily:'Segoe UI', fontSize:14 },
  moderation: {
    enabled:true, askReasonForMute:true, askReasonForBlock:true, defaultMuteMinutes:10, saveLastMessage:true, confirmDangerousActions:true,
    state:{ tiktok:{moderators:[],muted:[],blocked:[]}, twitch:{moderators:[],muted:[],blocked:[]}, cng:{moderators:[],muted:[],blocked:[]}, youtube:{moderators:[],muted:[],blocked:[]}, local:{moderators:[],muted:[],blocked:[]} },
    history:[]
  },
  filters: { enabled:true, rules:[], whitelistUsers:[], whitelistTerms:[] },
  chatDesign: { enabled:true, usernameEnabled:true, messageEnabled:true, fontFamily:'Segoe UI', customFontPath:'', fontSize:20, usernameColor:'#00d4ff', messageColor:'#ffffff', glow:10, opacity:.92, displaySeconds:12 },
  alerts: { enabled:true, maxQueue:100, defaultDurationMs:5000, queueMode:'priority', mergeGiftWindowMs:1500, masterVolume:1, items:[] },
  cohost: { enabled:true, format:'tiktok', places:4, slots:[{label:'Gast 1',source:''},{label:'Gast 2',source:''},{label:'Gast 3',source:''},{label:'Gast 4',source:''}] },
  platforms: {
    axelchat:{ enabled:true, autoConnect:false, url:'ws://127.0.0.1:8356', reconnectSeconds:5 },
    tikfinity:{ enabled:true, autoConnect:false, url:'ws://127.0.0.1:21213/', reconnectSeconds:5 },
    twitch:{ enabled:true, autoConnect:false, channel:'crazy_batto', mode:'readonly' },
    youtube:{ enabled:true, autoConnect:false, liveChatId:'', apiKey:'', pollMs:2500 },
    cng:{ enabled:true, status:'overlay-ready', creatorId:'210048', alertOverlayUrl:'https://cng-plattform.com/alert-overlay?creatorId=210048&alertTts=1&chatTts=0', ghostChatUrl:'https://cng-plattform.com/chat-popout/210048?mode=ghost', autoOpenGhost:false, localBroadcastEnabled:true }
  },
  commands: [], hotkeys: [], events: [],
  rules: { maxConcurrentRuns:25, defaultTimeoutMs:5000, defaultFailurePolicy:'stop-sequence', httpAllowlist:[] },
  autoBroadcast: { enabled:false, intervalSeconds:600, startDelaySeconds:30, mode:'sequence', targets:['cng'], messages:[], localCngOverlay:true },
  media: [], mediaPools: [],
  mediaEngine: { ffmpegPath:'auto', encoder:'auto', fps:60, videoBitrateKbps:12000, audioSampleRate:48000, audioChannels:2, profile:'twitch-1080p', restartPolicy:'manual' },
  tts: { enabled:false, readChat:false, voice:'', language:'de-DE', rate:1, pitch:1, volume:1, outputDeviceId:'default', outputDeviceLabel:'Systemstandard', queueLimit:100, platforms:['twitch','tiktok','cng','youtube'], stripUrls:true },
  discord: { enabled:false, messageTemplate:'CRAZY_BATTO ist live!' },
  obs: { enabled:true, url:'ws://127.0.0.1:4455', autoConnect:true, reconnect:true, requestTimeoutMs:5000 },
  http: { enabled:true, host:'127.0.0.1', port:17777, autoStart:true, heartbeatSeconds:15, allowLan:false, maxWsClients:20 },
  eventCore: { dedupeTtlMs:120000, dedupeMaxEntries:10000, maxQueue:5000, aggregateLikes:true, aggregateGifts:true },
  logging: { level:'info', retentionDays:7, maxFileBytes:5242880 },
  backup: { keep:5 },
  diagnostics: { eventInspector:false, includeRawData:false },
  windows: { detachedOpen:false, mainBounds:null, detachedBounds:null }
};

function clone(value) { return structuredClone(value); }

function deepMerge(base, patch) {
  if (patch === undefined) return clone(base);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
  const result = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}

function stripUnknown(template, value) {
  if (Array.isArray(template)) return Array.isArray(value) ? clone(value) : clone(template);
  if (!template || typeof template !== 'object') return value === undefined ? clone(template) : clone(value);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const key of Object.keys(template)) out[key] = stripUnknown(template[key], source[key] === undefined ? template[key] : source[key]);
  return out;
}

function migrateSchema1To2(input) {
  const cfg = clone(input || {});
  cfg.schemaVersion = 2;
  cfg.http = { ...(cfg.http || {}) };
  if (cfg.http.port === undefined || Number(cfg.http.port) === 8787) cfg.http.port = 17777;
  cfg.multiChat = { ...(cfg.multiChat || {}) };
  if (cfg.multiChat.maxMessages === undefined || Number(cfg.multiChat.maxMessages) === 5000) cfg.multiChat.maxMessages = 500;
  cfg.backup = { ...(cfg.backup || {}) };
  if (cfg.backup.keep === undefined || Number(cfg.backup.keep) === 10) cfg.backup.keep = 5;
  return cfg;
}

function migrateSchema2To3(input) {
  const cfg = clone(input || {});
  cfg.schemaVersion = 3;
  cfg.http = { allowLan:false, maxWsClients:20, ...(cfg.http || {}) };
  cfg.obs = { reconnect:true, requestTimeoutMs:5000, ...(cfg.obs || {}) };
  cfg.rules = { maxConcurrentRuns:25, defaultTimeoutMs:5000, defaultFailurePolicy:'stop-sequence', httpAllowlist:[], ...(cfg.rules || {}) };
  cfg.eventCore = { dedupeTtlMs:120000, dedupeMaxEntries:10000, maxQueue:5000, aggregateLikes:true, aggregateGifts:true, ...(cfg.eventCore || {}) };
  cfg.alerts = { enabled:true, maxQueue:100, defaultDurationMs:5000, queueMode:'priority', mergeGiftWindowMs:1500, masterVolume:1, items:[], ...(cfg.alerts || {}) };
  return cfg;
}

function migrateConfig(input) {
  let source = input && typeof input === 'object' ? clone(input) : {};
  let schema = Number(source.schemaVersion || 1);
  if (!Number.isInteger(schema) || schema < 1) schema = 1;
  while (schema < CURRENT_SCHEMA_VERSION) {
    if (schema === 1) source = migrateSchema1To2(source);
    else if (schema === 2) source = migrateSchema2To3(source);
    else throw new Error(`Keine Settings-Migration von Schema ${schema} verfügbar.`);
    schema = Number(source.schemaVersion);
  }
  if (schema > CURRENT_SCHEMA_VERSION) throw new Error(`Settings-Schema ${schema} ist neuer als unterstützt (${CURRENT_SCHEMA_VERSION}).`);
  const merged = deepMerge(DEFAULT_CONFIG, source);
  merged.version = CURRENT_VERSION;
  merged.schemaVersion = CURRENT_SCHEMA_VERSION;
  return stripUnknown(DEFAULT_CONFIG, merged);
}

class ConfigStore {
  constructor(userDataPath) {
    this.legacyDir = path.join(userDataPath, 'BattoMultiChat');
    this.dir = path.join(userDataPath, 'Batto-OBS-Tool');
    this.file = path.join(this.dir, 'settings.json');
    this.backupFile = path.join(this.dir, 'settings.backup.json');
    this.profilesDir = path.join(this.dir, 'profiles');
    this.dataDir = path.join(this.dir, 'data');
    this.assetsDir = path.join(this.dir, 'assets');
    this.mediaDir = path.join(this.assetsDir, 'media');
    this.soundDir = path.join(this.assetsDir, 'sounds');
    this.imageDir = path.join(this.assetsDir, 'images');
    this.videoDir = path.join(this.assetsDir, 'videos');
    this.lottieDir = path.join(this.assetsDir, 'lottie');
    this.fontDir = path.join(this.assetsDir, 'fonts');
    this.logDir = path.join(this.dir, 'logs');
    this.backupDir = path.join(this.dir, 'backups');
    this.cacheDir = path.join(this.dir, 'cache');
    this.ttsDir = path.join(this.cacheDir, 'tts');
    this.prepareDirectories();
    this.migrateLegacyUserData();
    this.config = this.load();
  }

  prepareDirectories() {
    for (const dir of [this.dir,this.profilesDir,this.dataDir,this.assetsDir,this.mediaDir,this.soundDir,this.imageDir,this.videoDir,this.lottieDir,this.fontDir,this.logDir,this.backupDir,this.cacheDir,this.ttsDir]) fs.mkdirSync(dir,{recursive:true});
  }

  migrateLegacyUserData() {
    try {
      if (!fs.existsSync(this.file)) {
        const legacyConfig = path.join(this.legacyDir, 'config.json');
        if (fs.existsSync(legacyConfig)) fs.copyFileSync(legacyConfig, this.file);
      }
      for (const [legacyName,target] of [['media',this.mediaDir],['fonts',this.fontDir],['backups',this.backupDir]]) {
        const src=path.join(this.legacyDir,legacyName);
        if (fs.existsSync(src) && fs.readdirSync(target).length===0) fs.cpSync(src,target,{recursive:true,force:false});
      }
    } catch {}
  }

  readJson(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }

  load() {
    let primaryError = null;
    if (fs.existsSync(this.file)) {
      try {
        const raw=this.readJson(this.file); const migrated=migrateConfig(raw); assertValidConfig(migrated);
        this.config=migrated;
        if (JSON.stringify(raw)!==JSON.stringify(migrated)) this.atomicWrite(this.file,JSON.stringify(migrated,null,2));
        return migrated;
      } catch (error) { primaryError=error; }
    }
    if (fs.existsSync(this.backupFile)) {
      try {
        const migrated=migrateConfig(this.readJson(this.backupFile)); assertValidConfig(migrated); this.config=migrated;
        this.atomicWrite(this.file,JSON.stringify(migrated,null,2));
        return migrated;
      } catch {}
    }
    const defaults=clone(DEFAULT_CONFIG); this.config=defaults; this.atomicWrite(this.file,JSON.stringify(defaults,null,2));
    if (primaryError) this.lastRecoveryError=primaryError.message;
    return defaults;
  }

  get() { return clone(this.config); }
  validate(candidate) { return validateConfig(candidate); }

  atomicWrite(file,data) {
    const tmp=`${file}.tmp`;
    fs.writeFileSync(tmp,data,'utf8');
    let fd=null;
    try {
      // Windows benötigt für FlushFileBuffers ein beschreibbares Handle; ein reines 'r'-Handle kann EPERM liefern.
      fd=fs.openSync(tmp,process.platform==='win32'?'r+':'r');
      try { fs.fsyncSync(fd); }
      catch (error) {
        // Auf Dateisystemen ohne fsync-Unterstützung bleibt die atomare tmp->rename-Garantie erhalten.
        if (!['EPERM','EINVAL','ENOSYS','ENOTSUP'].includes(error?.code)) throw error;
      }
    } finally {
      if (fd!==null) { try{fs.closeSync(fd);}catch{} }
    }
    fs.renameSync(tmp,file);
  }

  save() {
    assertValidConfig(this.config);
    if (fs.existsSync(this.file)) { try{fs.copyFileSync(this.file,this.backupFile);}catch{} }
    this.atomicWrite(this.file,JSON.stringify(this.config,null,2));
  }

  merge(patch) { const candidate=migrateConfig(deepMerge(this.config,patch||{})); assertValidConfig(candidate); this.config=candidate; this.save(); return this.get(); }
  resetSection(section) { if(!(section in DEFAULT_CONFIG))throw new Error('Unbekannter Bereich'); const candidate=clone(this.config); candidate[section]=clone(DEFAULT_CONFIG[section]); assertValidConfig(candidate); this.config=candidate; this.save(); return this.get(); }

  backupNow() {
    const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const file=path.join(this.backupDir,`settings-${stamp}.json`); this.atomicWrite(file,JSON.stringify(this.config,null,2));
    const files=this.listBackupsRaw(),keep=Math.max(1,Number(this.config.backup?.keep||5)); for(const old of files.slice(keep)){try{fs.unlinkSync(old.path)}catch{}} return file;
  }
  listBackupsRaw() { if(!fs.existsSync(this.backupDir))return[]; return fs.readdirSync(this.backupDir).filter(name=>/^(settings|config)-.*\.json$/i.test(name)).map(name=>{const p=path.join(this.backupDir,name);return{name,path:p,mtime:fs.statSync(p).mtimeMs}}).sort((a,b)=>b.mtime-a.mtime); }
  listBackups() { return this.listBackupsRaw().slice(0,Math.max(1,Number(this.config.backup?.keep||5))); }
  restoreBackup(filePath) { const candidate=migrateConfig(this.readJson(filePath)); assertValidConfig(candidate); this.config=candidate; this.save(); return this.get(); }
  exportTo(filePath) { this.atomicWrite(filePath,JSON.stringify(this.config,null,2)); }
  importFrom(filePath) { const candidate=migrateConfig(this.readJson(filePath)); assertValidConfig(candidate); this.config=candidate; this.save(); return this.get(); }
}

module.exports={ConfigStore,DEFAULT_CONFIG,CURRENT_VERSION,CURRENT_SCHEMA_VERSION,deepMerge,migrateConfig,migrateSchema1To2,migrateSchema2To3,stripUnknown};
