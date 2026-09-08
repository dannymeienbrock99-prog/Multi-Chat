const assert = require('assert');
const { EventCore } = require('../src/core/events/event-core.cjs');

const seconds = Math.max(1, Number(process.env.STRESS_SECONDS || 60));
const rate = Math.max(1, Number(process.env.STRESS_RATE || 500));
const core = new EventCore({ maxQueue: 5000, dedupeMaxEntries: Math.max(10000, seconds * rate + 1000) });
let published = 0;
core.on('event', () => { published += 1; });

const startHeap = process.memoryUsage().heapUsed;
const started = Date.now();
let second = 0;

function burst() {
  const base = second * rate;
  for (let i = 0; i < rate; i++) {
    core.ingestChat({ platform:'twitch', id:`stress-${base+i}`, username:`u${i%200}`, text:`Event ${base+i}` }, 'stress-fixture');
  }
  core.bus.drain();
  second += 1;
  if (second >= seconds) finish();
  else setTimeout(burst, 1000);
}

function finish() {
  core.bus.drain();
  const elapsedMs = Date.now() - started;
  const metrics = core.getMetrics();
  const heapGrowth = process.memoryUsage().heapUsed - startHeap;
  const expected = seconds * rate;
  assert.ok(metrics.received >= expected, `received ${metrics.received} < ${expected}`);
  assert.ok(published >= expected * .98, `published ${published} unexpectedly low`);
  assert.ok(metrics.bus.queued <= 5000, 'event queue exceeded configured bound');
  assert.ok(metrics.dedupe.size <= metrics.dedupe.maxEntries, 'dedupe cache exceeded configured bound');
  assert.ok(heapGrowth < 256 * 1024 * 1024, `heap growth too high: ${heapGrowth}`);
  core.stop();
  console.log(JSON.stringify({ ok:true, seconds, rate, expected, published, elapsedMs, heapGrowthBytes:heapGrowth, metrics }, null, 2));
}

burst();
