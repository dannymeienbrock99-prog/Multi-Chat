'use strict';
// Explicit opt-in CI self-test. Never reads or changes the user's normal profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = process.env.BATTO_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'batto-qa-'));
fs.mkdirSync(dir, { recursive: true });
const profile = path.join(dir, 'isolated-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const checks = [];
let finished = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error(`QA timeout: ${label}`);
}
function finish(ok, error) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok, checks, error: error?.message, versions: process.versions }, null, 2));
  if (!ok) { console.error(error); app.exit(1); }
  else { console.log('Installed Electron UI/IPC self-test passed.'); app.quit(); }
}
const timer = setTimeout(() => finish(false, new Error('Installed app QA exceeded 60 seconds')), 60000);
timer.unref();
app.whenReady().then(async () => {
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 'main window');
  const run = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  await waitFor(() => run("return typeof S !== 'undefined' && !!S.config && !!document.querySelector('#composer');"), 'rendered app and IPC');
  checks.push('Fresh profile: main window and renderer ready');
  await waitFor(async () => (await run('return await window.batto.getState();')).overlay?.running, 'overlay HTTP server');
  const state = await run('return await window.batto.getState();');
  assert.equal(state.config.http.port, 17777);
  assert.equal(state.config.obs.url, 'ws://127.0.0.1:4455');
  checks.push('Separate OBS 4455 / Overlay 17777');
  assert.equal(await run("return Array.from(document.images).every(img => img.complete && img.naturalWidth > 0);"), true);
  checks.push('All visible branding images decoded');
  await run("document.querySelector('#sendPlatform').value='local'; document.querySelector('#messageInput').value='QA CHAT 2101'; document.querySelector('#composer').requestSubmit();");
  await waitFor(() => run("return document.querySelector('#chatList').textContent.includes('QA CHAT 2101');"), 'local chat render');
  checks.push('Composer -> IPC -> normalizer -> chat renderer');

  await run("document.querySelector('[data-view=commands]').click(); document.querySelector('#cmdTrigger').value='!qa'; document.querySelector('#cmdPlatform').value='cng'; document.querySelector('#cmdCd').value='17'; document.querySelector('#cmdType').value='overlay'; document.querySelector('#cmdText').value='QA command'; document.querySelector('#cmdAddAction').click();");
  assert.equal(await run("return document.querySelector('#cmdTrigger').value + ':' + document.querySelector('#cmdPlatform').value + ':' + document.querySelector('#cmdCd').value;"), '!qa:cng:17');
  await run("await document.querySelector('#cmdSave').onclick();");
  assert.equal((await run('return await window.batto.getState();')).config.commands[0].trigger, '!qa');
  checks.push('Command builder retains trigger/platform/cooldown when adding actions');
  await run("document.querySelector('[data-view=events]').click(); document.querySelector('#evPlatform').value='cng'; document.querySelector('#evEventType').value='follow'; document.querySelector('#evMatch').value='tester'; document.querySelector('#evMin').value='3'; document.querySelector('#evEventType').value='follow'; document.querySelector('#evType').value='overlay'; document.querySelector('#evText').value='QA event'; document.querySelector('#evAddAction').click();");
  assert.equal(await run("return document.querySelector('#evPlatform').value + ':' + document.querySelector('#evMatch').value + ':' + document.querySelector('#evMin').value;"), 'cng:tester:3');
  await run("await document.querySelector('#evSave').onclick();");
  const eventRule = (await run('return await window.batto.getState();')).config.events[0];
  assert.equal(eventRule.event, 'follow'); assert.equal(eventRule.actions[0].type, 'overlay');
  checks.push('Event builder retains platform/filter/minimum and separates event/action type');

  await run("document.querySelector('[data-view=platforms]').click(); document.querySelector('#cngChatSecret').value='https://cng-plattform.com/chat-popout/210048?mode=obs&obsChatToken=qa-fixture-only'; await document.querySelector('#cngSave').onclick();");
  const afterSecret = await run('return await window.batto.getState();');
  assert.equal(afterSecret.secrets.cngObsChatUrl, true);
  assert.equal(JSON.stringify(afterSecret.config).includes('qa-fixture-only'), false);
  checks.push('CNG field -> safeStorage persists; no secret in settings');
  await run("document.querySelector('[data-view=settings]').click();");
  await waitFor(() => run("return !!document.querySelector('#stApply21');"), 'settings controls');
  assert.equal(await run("return document.querySelector('#settingsModule').textContent.includes('Sarah Luna');"), true);
  await run("document.querySelector('#stBgDark21').value='0.4'; await document.querySelector('#stApply21').onclick();");
  assert.equal((await run('return await window.batto.getState();')).config.appearance.backgroundDarkness, 0.4);
  checks.push('Settings Apply persists background control and retains dedication');
  await run("document.querySelector('[data-view=dashboard]').click();");
  await delay(300);
  fs.writeFileSync(path.join(dir, 'dashboard.png'), (await win.webContents.capturePage()).toPNG());
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'Batto-OBS-Tool', 'settings.json'), 'utf8'));
  assert.equal(persisted.appearance.backgroundDarkness, 0.4);
  checks.push('Settings written to disk; desktop screenshot captured');
  finish(true);
}).catch(error => finish(false, error));
