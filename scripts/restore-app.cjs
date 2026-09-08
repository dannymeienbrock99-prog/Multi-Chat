"use strict";
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { patchRenderer } = require('./renderer-fixes.cjs');
const root = path.join(__dirname, '..');
function readParts(relative) {
  const dir = path.join(root, relative);
  const names = fs.readdirSync(dir).filter(name => /^part\d+\.b64$/.test(name)).sort();
  if (!names.length) throw new Error(`Source parts missing: ${relative}`);
  return names.map(name => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
}
function verifiedWrite(relative, bytes, expectedHash) {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== expectedHash) throw new Error(`Asset checksum mismatch: ${relative}`);
  fs.writeFileSync(path.join(root, relative), bytes);
  console.log(`Verified asset: ${relative} (${bytes.length} bytes)`);
}
const renderer = zlib.gunzipSync(Buffer.from(readParts('src/renderer/app.parts'), 'base64')).toString('utf8');
fs.writeFileSync(path.join(root, 'src/renderer/app.js'), patchRenderer(renderer));
// Repair the four damaged spans against the retained original uploaded asset.
let background = Buffer.from(readParts('src/assets/program-background.parts'), 'base64').toString('base64');
const repairs = require('./background-repair.json');
for (const repair of [...repairs].sort((a, b) => b.offset - a.offset)) {
  background = background.slice(0, repair.offset) + repair.insert + background.slice(repair.offset + repair.remove);
}
verifiedWrite('src/assets/program-background.jpg', Buffer.from(background, 'base64'), '16dfe7829c4e4f0c0c46be5396d49b02b5b8d4aff7f84bf0f655ad4b4f27dd92');
verifiedWrite('src/assets/brand-logo.jpg', Buffer.from(readParts('src/assets/brand-source.parts'), 'base64'), 'b5beeba02726648e83552649f2abe91f2c54d79e77228a4485d7b63bacb338fb');
console.log('Renderer restored with form-state and secret-save fixes.');
