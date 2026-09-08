'use strict';
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'src', 'assets');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(path.join(root, 'brand-logo.jpg'));
  const background = nativeImage.createFromPath(path.join(root, 'program-background.jpg'));
  if (logo.isEmpty() || background.isEmpty()) throw new Error('Logo oder Hintergrund ist nicht decodierbar.');
  fs.writeFileSync(path.join(root, 'icon.png'), logo.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(root, 'HIntergund.png'), background.toPNG());
  for (const name of ['icon.png', 'HIntergund.png', 'brand-logo.jpg', 'program-background.jpg']) {
    const image = nativeImage.createFromPath(path.join(root, name));
    if (image.isEmpty()) throw new Error(`Ungültige Bilddatei: ${name}`);
    const size = image.getSize();
    console.log(`Bild geprüft: ${name} ${size.width}x${size.height}`);
  }
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
