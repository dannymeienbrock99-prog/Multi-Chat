const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { ConfigStore } = require('../src/core/config-store.cjs');
const { ChatCore } = require('../src/core/chat-core.cjs');
const { OverlayServer } = require('../src/core/overlay-server.cjs');
const { FFmpegService } = require('../src/core/media/ffmpeg-service.cjs');
const { validateMediaFile } = require('../src/core/alerts/media-validator.cjs');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-runtime21-'));
  let blocker;
  try {
    const configStore = new ConfigStore(tmp);
    const chatCore = new ChatCore(configStore.get());

    // Port conflict must be visible and must never silently switch ports.
    blocker = net.createServer();
    await new Promise((resolve, reject) => { blocker.once('error',reject); blocker.listen(17777,'127.0.0.1',resolve); });
    const overlay = new OverlayServer({ host:'127.0.0.1', port:17777, chatCore, configStore });
    let portError = null;
    try { await overlay.start(); } catch (error) { portError = error; }
    assert.ok(portError, 'Portkonflikt wurde nicht gemeldet.');
    assert.equal(portError.code, 'EADDRINUSE');
    assert.equal(overlay.port, 17777);
    assert.equal(configStore.get().http.port, 17777);
    await overlay.stop().catch(() => {});
    await new Promise((resolve) => blocker.close(resolve)); blocker = null;

    // Free port starts and health endpoint remains local-first.
    const freeOverlay = new OverlayServer({ host:'127.0.0.1', port:17777, chatCore, configStore });
    const started = await freeOverlay.start();
    assert.equal(started.running, true);
    assert.equal(started.port, 17777);
    const health = await fetch('http://127.0.0.1:17777/health').then((r) => r.json());
    assert.equal(health.ok, true);
    await freeOverlay.stop();

    // FFmpeg missing is DEGRADED, not a crash; detected FFmpeg is CONNECTED.
    const ffMissing = new FFmpegService({ ffmpegPath:path.join(tmp,'does-not-exist','ffmpeg.exe') });
    const missing = await ffMissing.detect();
    assert.equal(missing.ok, false);
    assert.equal(ffMissing.getStatus().state, 'DEGRADED');

    // Invalid media is rejected before activation.
    const fakePng = path.join(tmp,'fake.png');
    fs.writeFileSync(fakePng,'not a png');
    const validation = validateMediaFile(fakePng);
    assert.equal(validation.ok, false);

    console.log('Batto OBS Tool 2.1 runtime integration: OK');
  } finally {
    try { if (blocker) await new Promise((resolve) => blocker.close(resolve)); } catch {}
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch((error) => { console.error(error); process.exit(1); });
