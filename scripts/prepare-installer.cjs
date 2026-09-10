'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const projectRoot=path.resolve(__dirname,'..');
const verifierPath=path.join(projectRoot,'build','installer-key-verifier.json');
const defaultOutputPath=path.join(projectRoot,'build','generated-installer-key.nsh');

function normalizeInstallKey(value){
  return String(value || '').replace(/[\s\-\u2010-\u2015]/gu,'');
}

function validateVerifier(verifier){
  if(!verifier || verifier.algorithm!=='SHA2-512')throw new Error('Installer-Key: nicht unterstützter Prüfalgorithmus.');
  if(!/^[a-f0-9]{48}$/i.test(verifier.salt || ''))throw new Error('Installer-Key: Salt ist ungültig.');
  if(!Number.isInteger(verifier.iterations) || verifier.iterations<1024 || verifier.iterations>100000)throw new Error('Installer-Key: Iterationszahl ist ungültig.');
  if(!Number.isInteger(verifier.normalizedLength) || verifier.normalizedLength<8 || verifier.normalizedLength>128)throw new Error('Installer-Key: erwartete Länge ist ungültig.');
  if(!/^[A-F0-9]{128}$/.test(verifier.digest || ''))throw new Error('Installer-Key: Prüfwert ist ungültig.');
  return verifier;
}

function deriveInstallKeyDigest(key,verifier){
  const normalized=normalizeInstallKey(key);
  if(!/^\d+$/.test(normalized) || normalized.length!==verifier.normalizedLength)throw new Error('Temporärer QA-Installationskey hat ein ungültiges Format.');
  let value=`${verifier.salt}:${normalized}`;
  for(let index=0;index<verifier.iterations;index+=1)value=crypto.createHash('sha512').update(value,'utf8').digest('hex').toUpperCase();
  return value;
}

function prepareInstaller({outputPath=defaultOutputPath,keyOverride=process.env.BATTO_INSTALL_KEY_OVERRIDE}={}){
  const verifier=validateVerifier(JSON.parse(fs.readFileSync(verifierPath,'utf8')));
  const digest=keyOverride ? deriveInstallKeyDigest(keyOverride,verifier) : verifier.digest;
  const generated=[
    '; Automatisch erzeugt. Enthält keinen Klartext-Installationskey.',
    `!define BATTO_INSTALL_KEY_ALGORITHM "${verifier.algorithm}"`,
    `!define BATTO_INSTALL_KEY_SALT "${verifier.salt}"`,
    `!define BATTO_INSTALL_KEY_ITERATIONS ${verifier.iterations}`,
    `!define BATTO_INSTALL_KEY_LENGTH ${verifier.normalizedLength}`,
    `!define BATTO_INSTALL_KEY_DIGEST "${digest}"`,
    ''
  ].join('\n');
  fs.writeFileSync(outputPath,generated,{encoding:'utf8',mode:0o600});
  console.log(`Installer-Key-Prüfung vorbereitet (${keyOverride ? 'isolierter QA-Prüfwert' : 'Produktions-Prüfwert'}; kein Klartext-Key).`);
  return {outputPath,verifier:{...verifier,digest}};
}

if(require.main===module)prepareInstaller();

module.exports={deriveInstallKeyDigest,normalizeInstallKey,prepareInstaller,validateVerifier};
