const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');

function sortedParts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^part\d+\.b64$/i.test(name)).sort();
}

function restoreRenderer() {
  const dir = path.join(root, 'src', 'renderer', 'app.parts');
  const dest = path.join(root, 'src', 'renderer', 'app.js');
  const files = sortedParts(dir);
  if (!files.length) {
    if (!fs.existsSync(dest)) throw new Error('Renderer-Quelle fehlt: weder app.js noch app.parts vorhanden.');
    return;
  }
  const base64 = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
  const source = zlib.gunzipSync(Buffer.from(base64, 'base64'));
  fs.writeFileSync(dest, source);
  console.log(`Renderer app restored: ${source.length} bytes aus ${files.length} Teilen`);
}

function restoreBackground() {
  const dir = path.join(root, 'src', 'assets', 'program-background.parts');
  const dest = path.join(root, 'src', 'assets', 'program-background.jpg');
  const files = sortedParts(dir);
  if (!files.length) return;
  const base64 = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
  const image = Buffer.from(base64, 'base64');
  if (image.length < 1000 || image[0] !== 0xff || image[1] !== 0xd8) throw new Error('Programmhintergrund konnte nicht als JPEG rekonstruiert werden.');
  fs.writeFileSync(dest, image);
  console.log(`Program background restored: ${image.length} bytes aus ${files.length} Teilen`);
}

restoreRenderer();
restoreBackground();
