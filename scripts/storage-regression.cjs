'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWrite } = require('../src/core/storage/atomic-file.cjs');
const { ConfigStore } = require('../src/core/config-store.cjs');
const { SecretsService } = require('../src/core/settings/secrets-service.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-storage-'));
try {
  const store = new ConfigStore(dir);
  store.merge({ general: { displayName: 'Storage test' } });
  assert.equal(new ConfigStore(dir).get().general.displayName, 'Storage test');
  const widgets=[{id:'follow-alert',name:'Neue Follower',eventType:'follow',url:'https://tikfinity.zerody.one/widget/follow?cid=storage-test',enabled:true}];
  store.merge({platforms:{tikfinity:{webWidgets:widgets}}});
  assert.deepEqual(new ConfigStore(dir).get().platforms.tikfinity.webWidgets,widgets);
  const file = path.join(dir, 'atomic.json');
  atomicWrite(file, 'original');
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = () => { const err = new Error('synthetic write failure'); err.code='EIO'; throw err; };
  try {
    assert.throws(() => atomicWrite(file, 'must not replace'), /synthetic write failure/);
    assert.throws(() => store.merge({general:{displayName:'must not persist'}}), /synthetic write failure/);
    assert.equal(store.get().general.displayName, 'Storage test');
  }
  finally { fs.fsyncSync = originalFsync; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
  // Mock only the OS encryption boundary; installed-app QA checks real safeStorage.
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: bytes => bytes.toString().split('').reverse().join('') };
  const secrets = new SecretsService({ userDataPath: dir, safeStorage });
  secrets.set('qa', 'private-fixture');
  assert.equal(secrets.get('qa'), 'private-fixture');
  secrets.delete('qa');
  assert.equal(secrets.has('qa'), false);
  console.log('Writable-handle settings/secrets and failed-flush regression: OK');
} finally { fs.rmSync(dir, { recursive:true, force:true }); }
