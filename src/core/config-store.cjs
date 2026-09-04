const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
  version: 1,
  general: {
    displayName: "Crazy_Batto",
    language: "de",
    autoSave: true
  },
  multiChat: {
    enabled: true,
    defaultTab: "all",
    showTimestamp: true,
    showPlatform: true,
    showBadges: true,
    autoScroll: true,
    maxMessages: 5000
  },
  moderation: {
    enabled: true,
    askReasonForMute: true,
    askReasonForBlock: true,
    defaultMuteMinutes: 10,
    saveLastMessage: true,
    state: {
      tiktok: { moderators: [], muted: [], blocked: [] },
      twitch: { moderators: [], muted: [], blocked: [] },
      cng: { moderators: [], muted: [], blocked: [] },
      youtube: { moderators: [], muted: [], blocked: [] },
      local: { moderators: [], muted: [], blocked: [] }
    }
  },
  filters: {
    enabled: true,
    rules: [],
    whitelistUsers: [],
    whitelistTerms: []
  },
  chatDesign: {
    enabled: true,
    fontFamily: "Segoe UI",
    fontSize: 20,
    usernameColor: "#7dd3fc",
    messageColor: "#ffffff",
    glow: 10,
    displaySeconds: 12
  },
  platforms: {
    axelchat: {
      enabled: true,
      autoConnect: false,
      url: "ws://127.0.0.1:8356",
      reconnectSeconds: 5
    },
    twitch: { enabled: true, status: "not-configured" },
    youtube: { enabled: true, status: "not-configured" },
    tiktok: { enabled: true, status: "bridge-required" },
    cng: { enabled: true, status: "local-only" }
  },
  http: {
    enabled: true,
    host: "127.0.0.1",
    port: 8787,
    autoStart: true
  },
  windows: {
    detachedOpen: false,
    mainBounds: null,
    detachedBounds: null
  },
  backup: {
    keep: 10
  }
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base?.[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

class ConfigStore {
  constructor(userDataPath) {
    this.dir = path.join(userDataPath, "BattoMultiChat");
    this.file = path.join(this.dir, "config.json");
    fs.mkdirSync(this.dir, { recursive: true });
    this.config = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
        return structuredClone(DEFAULT_CONFIG);
      }
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return deepMerge(DEFAULT_CONFIG, parsed);
    } catch {
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  get() { return structuredClone(this.config); }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  backupNow() {
    const backupDir = path.join(this.dir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `config-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(this.config, null, 2), "utf8");
    const keep = Math.max(1, Number(this.config.backup?.keep || 10));
    const files = fs.readdirSync(backupDir)
      .filter((name) => /^config-.*\.json$/i.test(name))
      .map((name) => ({ name, full: path.join(backupDir, name), mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(keep)) {
      try { fs.unlinkSync(old.full); } catch {}
    }
    return file;
  }

  listBackups() {
    const backupDir = path.join(this.dir, "backups");
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter((name) => /^config-.*\.json$/i.test(name))
      .map((name) => ({ name, path: path.join(backupDir, name), mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, Math.max(1, Number(this.config.backup?.keep || 10)));
  }

  restoreBackup(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    this.config = deepMerge(DEFAULT_CONFIG, parsed);
    this.save();
    return this.get();
  }

  merge(patch) {
    this.config = deepMerge(this.config, patch || {});
    this.save();
    return this.get();
  }

  exportTo(filePath) { fs.writeFileSync(filePath, JSON.stringify(this.config, null, 2), "utf8"); }

  importFrom(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    this.config = deepMerge(DEFAULT_CONFIG, parsed);
    this.save();
    return this.get();
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, deepMerge };
