'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CHAT_BACKGROUND_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_CHAT_BACKGROUND_BYTES = 20 * 1024 * 1024;

function contentMatchesExtension(ext, head) {
  if (ext === '.png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (ext === '.webp') return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function validateChatBackgroundFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  try {
    if (!filePath || !fs.existsSync(resolved)) return { ok:false, error:'Die Bilddatei wurde nicht gefunden.', path:resolved };
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok:false, error:'Der ausgewählte Pfad ist keine Datei.', path:resolved };
    if (stat.size <= 0) return { ok:false, error:'Die Bilddatei ist leer.', path:resolved };
    if (stat.size > MAX_CHAT_BACKGROUND_BYTES) return { ok:false, error:'Das Chatbild darf höchstens 20 MB groß sein.', path:resolved, size:stat.size };
    const ext = path.extname(resolved).toLowerCase();
    if (!CHAT_BACKGROUND_EXTENSIONS.has(ext)) return { ok:false, error:'Erlaubt sind PNG, JPG/JPEG und WebP.', path:resolved, ext, size:stat.size };
    const fd = fs.openSync(resolved, 'r');
    const head = Buffer.alloc(Math.min(16, stat.size));
    try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    if (!contentMatchesExtension(ext, head)) return { ok:false, error:`Der Dateiinhalt passt nicht zum Bildformat ${ext}.`, path:resolved, ext, size:stat.size };
    return { ok:true, path:resolved, ext, size:stat.size };
  } catch (error) {
    return { ok:false, error:'Die Bilddatei konnte nicht gelesen werden.', path:resolved, code:error.code };
  }
}

function isPathInside(filePath, directory) {
  if (!filePath || !directory) return false;
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

module.exports = { CHAT_BACKGROUND_EXTENSIONS, MAX_CHAT_BACKGROUND_BYTES, validateChatBackgroundFile, isPathInside };
