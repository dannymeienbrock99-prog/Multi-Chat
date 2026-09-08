const fs = require('fs');
const path = require('path');

class SecretsService {
  constructor({ userDataPath, safeStorage }) {
    if (!userDataPath) throw new Error('userDataPath fehlt.');
    if (!safeStorage) throw new Error('safeStorage fehlt.');
    this.safeStorage = safeStorage;
    this.dir = path.join(userDataPath, 'Batto-OBS-Tool');
    this.file = path.join(this.dir, 'secrets.bin');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  readEnvelope() {
    try {
      if (!fs.existsSync(this.file)) return {};
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch { return {}; }
  }

  writeEnvelope(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
  }

  available() { return Boolean(this.safeStorage.isEncryptionAvailable?.()); }

  get(ref) {
    if (!ref || !this.available()) return '';
    const stored = this.readEnvelope()[ref];
    if (!stored) return '';
    try { return this.safeStorage.decryptString(Buffer.from(stored, 'base64')); }
    catch { return ''; }
  }

  set(ref, value) {
    if (!ref) throw new Error('secretRef fehlt.');
    if (!this.available()) throw new Error('Windows Secure Storage ist nicht verfügbar.');
    const envelope = this.readEnvelope();
    const clean = String(value || '');
    if (!clean) delete envelope[ref];
    else envelope[ref] = this.safeStorage.encryptString(clean).toString('base64');
    this.writeEnvelope(envelope);
    return { ok: true, ref, stored: Boolean(clean) };
  }

  delete(ref) {
    const envelope = this.readEnvelope();
    delete envelope[ref];
    this.writeEnvelope(envelope);
    return { ok: true };
  }

  has(ref) { return Boolean(this.get(ref)); }
  listRefs() { return Object.keys(this.readEnvelope()); }
}

module.exports = { SecretsService };
