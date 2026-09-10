'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {deriveInstallKeyDigest,normalizeInstallKey,prepareInstaller,validateVerifier}=require('./prepare-installer.cjs');

const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const verifier=validateVerifier(require('../build/installer-key-verifier.json'));
const installerScript=fs.readFileSync(path.join(root,'build','installer.nsh'),'utf8');
const licenseBytes=fs.readFileSync(path.join(root,'build','license_de.txt'));
const license=licenseBytes.toString('utf8');

assert.equal(pkg.version,'2.1.5');
assert.equal(pkg.license,'SEE LICENSE IN build/license_de.txt');
assert.equal(pkg.build.nsis.oneClick,false);
assert.equal(pkg.build.nsis.include,'build/installer.nsh');
assert.equal(pkg.build.nsis.license,'build/license_de.txt');
assert.deepEqual(pkg.build.nsis.installerLanguages,['de_DE']);
assert.equal(pkg.build.nsis.language,'1031');
assert.equal(pkg.build.nsis.installerHeader,'src/assets/installer-header.bmp');
assert.equal(pkg.build.nsis.installerSidebar,'src/assets/installer-sidebar.bmp');

for(const required of ['customWelcomePage','customPageAfterChangeDir','customInit','${Silent}','BATTO_ACCEPT_LICENSE','BATTO_INSTALL_KEY','${StdUtils.HashText}','NSD_CreatePassword'])assert(installerScript.includes(required),`Installer-Hook fehlt: ${required}`);
assert(!installerScript.includes('StdUtils.GetParameter'),'Installationskey darf nicht als sichtbarer Kommandozeilenparameter gelesen werden.');
assert.deepEqual([...licenseBytes.subarray(0,3)],[0xEF,0xBB,0xBF],'Der deutsche Lizenztext benötigt für NSIS einen UTF-8-BOM.');
assert(license.length>9000,'Lizenztext ist unerwartet kurz.');
for(const section of ['1. GELTUNGSBEREICH','4. VERBOT DES KOPIERENS, NACHBAUENS UND NACHAHMENS','15. SCHLUSSBESTIMMUNGEN','Copyright © 2026 Crazy_Batto / Team Alpha'])assert(license.includes(section),`Lizenzabschnitt fehlt: ${section}`);

const qaKey='1234-5678-9012-34';
assert.equal(normalizeInstallKey(qaKey),'12345678901234');
assert.equal(normalizeInstallKey('1234 – 5678 – 9012 – 34'),'12345678901234');
const qaDigest=deriveInstallKeyDigest(qaKey,verifier);
assert.match(qaDigest,/^[A-F0-9]{128}$/);
assert.notEqual(qaDigest,deriveInstallKeyDigest('1234-5678-9012-35',verifier));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'batto-installer-test-'));
try{
  const qaOutput=path.join(tmp,'qa.nsh');
  prepareInstaller({outputPath:qaOutput,keyOverride:qaKey});
  const qaInclude=fs.readFileSync(qaOutput,'utf8');
  assert(qaInclude.includes(qaDigest));
  assert(!qaInclude.includes(qaKey));
  assert(!qaInclude.includes(normalizeInstallKey(qaKey)));

  const productionOutput=path.join(tmp,'production.nsh');
  prepareInstaller({outputPath:productionOutput,keyOverride:''});
  const productionInclude=fs.readFileSync(productionOutput,'utf8');
  assert(productionInclude.includes(verifier.digest));
}finally{
  fs.rmSync(tmp,{recursive:true,force:true});
}

const sourceImage=fs.readFileSync(path.join(root,'src','assets','source','michelle-sarah-installer.jpg'));
assert.equal(crypto.createHash('sha256').update(sourceImage).digest('hex'),'5e401a0b01a72e1d1aaf0020f174583e5eb42a50991ffd8bfc157ef8a8684dec');

function contains(buffer,needle){return needle.length>0 && buffer.indexOf(needle)!==-1;}
function assertSecretAbsent(secret,files){
  const normalized=normalizeInstallKey(secret);
  const needles=[
    Buffer.from(String(secret),'utf8'),
    Buffer.from(normalized,'utf8'),
    Buffer.from(String(secret),'utf16le'),
    Buffer.from(normalized,'utf16le')
  ];
  for(const file of files){
    const bytes=fs.readFileSync(file);
    if(needles.some(needle=>contains(bytes,needle)))throw new Error(`Klartext-Installationskey in Datei gefunden: ${path.relative(root,file)}`);
  }
}

if(process.env.BATTO_PRODUCTION_KEY_CHECK){
  assert.equal(deriveInstallKeyDigest(process.env.BATTO_PRODUCTION_KEY_CHECK,verifier),verifier.digest,'Der private Produktionskey passt nicht zum hinterlegten Prüfwert.');
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean).map(file=>path.join(root,file));
  const generatedInclude=path.join(root,'build','generated-installer-key.nsh');
  if(fs.existsSync(generatedInclude))tracked.push(generatedInclude);
  assertSecretAbsent(process.env.BATTO_PRODUCTION_KEY_CHECK,tracked);
}

console.log('Installer 2.1.5: deutsche Lizenz, Key-Gate, gehashter Prüfwert und Michelle/Sarah-Artwork geprüft.');
