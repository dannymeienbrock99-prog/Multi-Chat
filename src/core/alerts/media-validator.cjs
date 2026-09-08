const fs = require('fs');
const path = require('path');

const SUPPORTED = new Set(['.lottie','.json','.webm','.mp4','.gif','.png','.jpg','.jpeg','.mp3','.wav','.ogg']);
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

function magicMatches(ext, head) {
  if (ext === '.png') return head.slice(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (ext === '.gif') return ['GIF87a','GIF89a'].includes(head.slice(0,6).toString('ascii'));
  if (ext === '.wav') return head.slice(0,4).toString('ascii') === 'RIFF' && head.slice(8,12).toString('ascii') === 'WAVE';
  if (ext === '.ogg') return head.slice(0,4).toString('ascii') === 'OggS';
  if (ext === '.mp4') return head.slice(4,8).toString('ascii') === 'ftyp';
  if (ext === '.webm') return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (ext === '.mp3') return head.slice(0,3).toString('ascii') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  return true;
}

function validateLottie(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ok = data && typeof data === 'object' && (Array.isArray(data.layers) || data.v || data.animation || data.nm);
    return ok ? { ok:true } : { ok:false, error:'Lottie/JSON enthält keine erkennbare Animation.' };
  } catch (error) { return { ok:false, error:`JSON ungültig: ${error.message}` }; }
}

function validateMediaFile(filePath) {
  const file = path.resolve(String(filePath || ''));
  if (!filePath || !fs.existsSync(file)) return { ok:false, error:'Datei fehlt.', path:file };
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { ok:false, error:'Pfad ist keine Datei.', path:file };
  if (stat.size <= 0) return { ok:false, error:'Datei ist leer.', path:file };
  if (stat.size > MAX_FILE_BYTES) return { ok:false, error:'Datei ist größer als 1 GB.', path:file, size:stat.size };
  const ext = path.extname(file).toLowerCase();
  if (!SUPPORTED.has(ext)) return { ok:false, error:`Nicht unterstütztes Medienformat: ${ext || 'ohne Endung'}`, path:file };
  if (ext === '.json' || ext === '.lottie') return { ...validateLottie(file), path:file, ext, size:stat.size };
  const fd = fs.openSync(file,'r');
  const head = Buffer.alloc(Math.min(64, stat.size));
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  if (!magicMatches(ext, head)) return { ok:false, error:`Dateiinhalt passt nicht zum Format ${ext}.`, path:file, ext, size:stat.size };
  return { ok:true, path:file, ext, size:stat.size };
}

function validateMediaItems(items = []) {
  const results = items.map((item) => ({ item, validation: validateMediaFile(item?.path) }));
  return { ok: results.every((x) => x.validation.ok), results, invalid: results.filter((x) => !x.validation.ok) };
}

module.exports = { SUPPORTED, MAX_FILE_BYTES, validateMediaFile, validateMediaItems };
