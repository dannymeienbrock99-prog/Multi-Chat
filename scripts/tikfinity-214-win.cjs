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
    'scripts/ui-contract.cjs'
  ]){
    const file=path.join(root,name);
    const raw=fs.readFileSync(file,'utf8');
    if(raw.includes('\r\n'))fs.writeFileSync(file,raw.replace(/\r\n/g,'\n'),'utf8');
  }
  return require('./tikfinity-214.cjs').apply(root);
}
module.exports={apply};
if(require.main===module)apply();
