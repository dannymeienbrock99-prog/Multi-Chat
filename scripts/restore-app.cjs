'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
require('./tikfinity-214.cjs').apply(root);
for(const item of require('../src/assets/artwork-manifest.json')){
 const file=path.join(root,'src/assets/source',item.file);
 const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(actual!==item.sha256)throw new Error('Originalbild-Prüfsumme falsch: '+item.file);
}
for(const file of ['src/renderer/app.js','src/renderer/release-ui.js','src/renderer/broadcast-ui.js','src/core/broadcast/service.cjs','src/assets/platforms/tiktok.svg','src/assets/platforms/twitch.svg','src/assets/platforms/youtube.svg','src/assets/platforms/cng.svg'])if(!fs.statSync(path.join(root,file)).size)throw new Error('Quelldatei fehlt: '+file);
console.log('Direkter 2.1.3-Quellstand, TikFinity HTTPS-Widgets, Plattformlogos und vier Originalbilder geprüft.');
