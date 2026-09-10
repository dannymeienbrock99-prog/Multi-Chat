'use strict';
const fs=require('node:fs');
const path=require('node:path');
function apply(root=path.resolve(__dirname,'..')){
  for(const name of [
    'src/core/config-store.cjs',
    'src/core/settings/schema.cjs',
    'src/renderer/release-ui.js',
    'src/renderer/marble-gold.css',
    'scripts/storage-regression.cjs',
    'scripts/ui-contract.cjs',
    'electron/qa-release.cjs'
  ]){
    const file=path.join(root,name);
    const raw=fs.readFileSync(file,'utf8');
    if(raw.includes('\r\n'))fs.writeFileSync(file,raw.replace(/\r\n/g,'\n'),'utf8');
  }
  require('./tikfinity-214.cjs').apply(root);
  const qaFile=path.join(root,'electron','qa-release.cjs');
  let qa=fs.readFileSync(qaFile,'utf8');
  qa=qa.replace("assert.equal(saved.schemaVersion,4);","assert.equal(saved.schemaVersion,6);")
       .replace("assert.equal(saved.schemaVersion,5);","assert.equal(saved.schemaVersion,6);")
       .replace("schemaVersion:4,broadcasts:1","schemaVersion:6,broadcasts:1")
       .replace("schemaVersion:5,broadcasts:1","schemaVersion:6,broadcasts:1")
       .replace("persisted schema-4 settings ready","persisted schema-6 settings ready")
       .replace("persisted schema-5 settings ready","persisted schema-6 settings ready");
  if(!qa.includes("assert.equal(saved.schemaVersion,6);"))throw new Error('QA schema-6 migration check was not applied.');
  fs.writeFileSync(qaFile,qa,'utf8');
}
module.exports={apply};
if(require.main===module)apply();
