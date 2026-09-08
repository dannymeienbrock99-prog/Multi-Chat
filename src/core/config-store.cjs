const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  version: 4,
  general: { displayName: 'Crazy_Batto', language: 'de', autoSave: true, startMinimized: false },
  appearance: { uiScale: 1, panelOpacity: 0.9, brightness: 1, compact: false },
  multiChat: { enabled: true, defaultTab: 'all', showTimestamp: true, showPlatform: true, showBadges: true, autoScroll: true, maxMessages: 5000 },
  moderation: {
    enabled: true, askReasonForMute: true, askReasonForBlock: true, defaultMuteMinutes: 10, saveLastMessage: true,
    state: {
      tiktok: { moderators: [], muted: [], blocked: [] }, twitch: { moderators: [], muted: [], blocked: [] },
      cng: { moderators: [], muted: [], blocked: [] }, youtube: { moderators: [], muted: [], blocked: [] }, local: { moderators: [], muted: [], blocked: [] }
    },
    history: []
  },
  filters: { enabled: true, rules: [], whitelistUsers: [], whitelistTerms: [] },
  chatDesign: {
    enabled: true, usernameEnabled: true, messageEnabled: true, fontFamily: 'Segoe UI', customFontPath: '',
    fontSize: 20, usernameColor: '#00d4ff', messageColor: '#ffffff', glow: 10, opacity: 0.92, displaySeconds: 12
  },
  cohost: {
    enabled: true, format: 'tiktok', places: 4,
    slots: [
      { label: 'Gast 1', source: '' }, { label: 'Gast 2', source: '' }, { label: 'Gast 3', source: '' }, { label: 'Gast 4', source: '' }
    ]
  },
  platforms: {
    axelchat: { enabled: true, autoConnect: false, url: 'ws://127.0.0.1:8356', reconnectSeconds: 5 },
    tikfinity: { enabled: true, autoConnect: false, url: 'ws://127.0.0.1:21213/', reconnectSeconds: 5 },
    twitch: { enabled: true, autoConnect: false, channel: 'crazy_batto', mode: 'readonly' },
    youtube: { enabled: true, autoConnect: false, liveChatId: '', apiKey: '', pollMs: 2500 },
    cng: { enabled: true, status: 'local-only' }
  },
  commands: [],
  hotkeys: [],
  events: [],
  media: [],
  mediaPools: [],
  tts: { enabled: false, voice: '', rate: 1, pitch: 1, volume: 1, platforms: ['twitch','tiktok','cng','youtube'] },
  discord: { enabled: false, messageTemplate: 'CRAZY_BATTO ist live!' },
  obs: { enabled: true, url: 'ws://127.0.0.1:4455', autoConnect: false },
  http: { enabled: true, host: '127.0.0.1', port: 8787, autoStart: true, heartbeatSeconds: 15 },
  backup: { keep: 10 },
  windows: { detachedOpen: false, mainBounds: null, detachedBounds: null }
};

function clone(v){ return structuredClone(v); }
function deepMerge(base, patch) {
  if (patch === undefined) return clone(base);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else result[key] = clone(value);
  }
  return result;
}

class ConfigStore {
  constructor(userDataPath) {
    this.dir = path.join(userDataPath, 'BattoMultiChat');
    this.file = path.join(this.dir, 'config.json');
    this.mediaDir = path.join(this.dir, 'media');
    this.fontDir = path.join(this.dir, 'fonts');
    this.backupDir = path.join(this.dir, 'backups');
    for (const d of [this.dir,this.mediaDir,this.fontDir,this.backupDir]) fs.mkdirSync(d,{recursive:true});
    this.config = this.load();
  }
  load() {
    try {
      if (!fs.existsSync(this.file)) { fs.writeFileSync(this.file, JSON.stringify(DEFAULT_CONFIG,null,2),'utf8'); return clone(DEFAULT_CONFIG); }
      return deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(this.file,'utf8')));
    } catch { return clone(DEFAULT_CONFIG); }
  }
  get(){ return clone(this.config); }
  save(){ const tmp=`${this.file}.tmp`; fs.writeFileSync(tmp,JSON.stringify(this.config,null,2),'utf8'); fs.renameSync(tmp,this.file); }
  merge(patch){ this.config=deepMerge(this.config,patch||{}); this.save(); return this.get(); }
  resetSection(section){ if (!(section in DEFAULT_CONFIG)) throw new Error('Unbekannter Bereich'); this.config[section]=clone(DEFAULT_CONFIG[section]); this.save(); return this.get(); }
  backupNow(){
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const file=path.join(this.backupDir,`config-${stamp}.json`);
    fs.writeFileSync(file,JSON.stringify(this.config,null,2),'utf8');
    const files=this.listBackupsRaw();
    const keep=Math.max(1,Number(this.config.backup?.keep||10));
    for (const old of files.slice(keep)) try{fs.unlinkSync(old.path)}catch{}
    return file;
  }
  listBackupsRaw(){
    if(!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir).filter(n=>/^config-.*\.json$/i.test(n)).map(name=>{const p=path.join(this.backupDir,name);return{name,path:p,mtime:fs.statSync(p).mtimeMs}}).sort((a,b)=>b.mtime-a.mtime);
  }
  listBackups(){ return this.listBackupsRaw().slice(0,Math.max(1,Number(this.config.backup?.keep||10))); }
  restoreBackup(filePath){ this.config=deepMerge(DEFAULT_CONFIG,JSON.parse(fs.readFileSync(filePath,'utf8'))); this.save(); return this.get(); }
  exportTo(filePath){ fs.writeFileSync(filePath,JSON.stringify(this.config,null,2),'utf8'); }
  importFrom(filePath){ this.config=deepMerge(DEFAULT_CONFIG,JSON.parse(fs.readFileSync(filePath,'utf8'))); this.save(); return this.get(); }
}

module.exports={ConfigStore,DEFAULT_CONFIG,deepMerge};
