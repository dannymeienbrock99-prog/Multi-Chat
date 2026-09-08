const fs = require('fs');
const path = require('path');

const SECRET_KEYS = /token|password|secret|authorization|cookie|apikey|api_key/i;

function redact(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(val, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…`;
  return value;
}

class Logger {
  constructor({ dir, level = 'info', retentionDays = 7, maxFileBytes = 5 * 1024 * 1024 } = {}) {
    if (!dir) throw new Error('Logger-Verzeichnis fehlt.');
    this.dir = dir;
    this.level = level;
    this.retentionDays = Math.max(1, Number(retentionDays || 7));
    this.maxFileBytes = Math.max(256 * 1024, Number(maxFileBytes || 5 * 1024 * 1024));
    fs.mkdirSync(dir, { recursive: true });
  }

  enabled(level) {
    const order = { error: 0, warn: 1, info: 2, debug: 3 };
    return (order[level] ?? 2) <= (order[this.level] ?? 2);
  }

  fileForToday() {
    return path.join(this.dir, `batto-${new Date().toISOString().slice(0, 10)}.log`);
  }

  rotateIfNeeded(file) {
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size < this.maxFileBytes) return;
      const suffix = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(file, file.replace(/\.log$/i, `-${suffix}.log`));
    } catch {}
  }

  cleanup() {
    const cutoff = Date.now() - this.retentionDays * 86400000;
    try {
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.endsWith('.log')) continue;
        const file = path.join(this.dir, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      }
    } catch {}
  }

  write(level, module, code, message, context = {}) {
    if (!this.enabled(level)) return null;
    const entry = {
      ts: new Date().toISOString(),
      level,
      module: String(module || 'app'),
      code: String(code || 'INFO'),
      message: String(message || ''),
      context: redact(context)
    };
    const file = this.fileForToday();
    this.rotateIfNeeded(file);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  error(module, code, message, context) { return this.write('error', module, code, message, context); }
  warn(module, code, message, context) { return this.write('warn', module, code, message, context); }
  info(module, code, message, context) { return this.write('info', module, code, message, context); }
  debug(module, code, message, context) { return this.write('debug', module, code, message, context); }
}

module.exports = { Logger, redact, SECRET_KEYS };
