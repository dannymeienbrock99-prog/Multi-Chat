'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Backport the bounded KnownFolder copy from the upstream NSIS template.
// The old *$2(&w8192 .s) dereferences beyond the allocated UTF-16 string and
// can crash the installer before the UI or /S installation even starts.
// https://github.com/electron-userland/electron-builder/issues/8536
// https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/multiUser.nsh
const root = path.join(__dirname, '..', 'node_modules', 'app-builder-lib');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (version !== '26.0.12') throw new Error(`Re-evaluate NSIS backport for app-builder-lib ${version}`);
const file = path.join(root, 'templates', 'nsis', 'multiUser.nsh');
let source = fs.readFileSync(file, 'utf8');
const marker = '# BATTO bounded KnownFolder copy (upstream backport)';
if (source.includes(marker)) {
  console.log('NSIS bounded string-copy fix already applied.');
  process.exit(0);
}
const pattern = /      System::Store S\r?\n[\s\S]*?      System::Store L/;
const found = source.match(pattern);
if (!found || !found[0].includes("System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'")) {
  throw new Error('NSIS template differs from pinned 26.0.12; refusing a partial patch.');
}
const replacement = [
  '      ' + marker,
  '      Push $1',
  '      Push $2',
  '      StrCpy $2 0',
  `      System::Call 'SHELL32::SHGetKnownFolderPath(g "\${FOLDERID_UserProgramFiles}", i \${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'`,
  '      ${If} $1 == 0',
  `        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i \${NSIS_MAX_STRLEN})p'`,
  '      ${endif}',
  '      ${If} $2 != 0',
  `        System::Call 'OLE32::CoTaskMemFree(p r2)'`,
  '      ${endif}',
  '      Pop $2',
  '      Pop $1'
].join('\n');
source = source.replace(pattern, () => replacement);
if (source.includes("System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'")) throw new Error('Unsafe NSIS copy still present');
fs.writeFileSync(file, source, 'utf8');
console.log('NSIS 26.0.12 KnownFolder bounded-copy backport applied.');
