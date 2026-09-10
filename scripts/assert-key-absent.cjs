'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {normalizeInstallKey}=require('./prepare-installer.cjs');

const secret=process.env.BATTO_KEY_LEAK_SCAN;
const files=process.argv.slice(2);
if(!secret)throw new Error('Temporärer Leak-Scan-Key fehlt.');
if(files.length===0)throw new Error('Keine Datei für den Leak-Scan angegeben.');

const normalized=normalizeInstallKey(secret);
const needles=[
  Buffer.from(secret,'utf8'),
  Buffer.from(normalized,'utf8'),
  Buffer.from(secret,'utf16le'),
  Buffer.from(normalized,'utf16le')
].filter((needle,index,all)=>needle.length>0 && all.findIndex(other=>other.equals(needle))===index);

for(const file of files){
  const bytes=fs.readFileSync(file);
  if(needles.some(needle=>bytes.indexOf(needle)!==-1))throw new Error(`Klartext-Key in ${path.basename(file)} gefunden.`);
}

console.log(`${files.length} Datei(en) enthalten den temporären QA-Key nicht im Klartext.`);
