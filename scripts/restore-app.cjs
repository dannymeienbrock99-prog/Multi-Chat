const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = path.join(__dirname, '..', 'src', 'renderer', 'app.parts');
const dest = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const files = fs.readdirSync(dir)
  .filter((name) => /^part\d+\.b64$/i.test(name))
  .sort();

if (!files.length) throw new Error('src/renderer/app.parts enthält keine Quelldaten.');

const base64 = files
  .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim())
  .join('');

const source = zlib.gunzipSync(Buffer.from(base64, 'base64'));
fs.writeFileSync(dest, source);
console.log(`Renderer app restored: ${source.length} bytes aus ${files.length} Teilen`);
