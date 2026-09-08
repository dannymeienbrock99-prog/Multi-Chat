const assert = require('assert');
const { EventCore } = require('../src/core/events/event-core.cjs');
const { ConnectorManager } = require('../src/core/connectors/connector-manager.cjs');

const minutes = Math.max(1, Number(process.env.SOAK_MINUTES || 240));
const durationMs = minutes * 60000;
const core = new EventCore({ maxQueue:5000, dedupeMaxEntries:10000 });
const manager = new ConnectorManager({ connectTimeoutMs:1000 });
let events = 0;
core.on('event', () => { events += 1; });
class FixtureConnector { constructor(){this.s={connected:true,state:'connected'}} connect(){this.s={connected:true,state:'connected'}} disconnect(){this.s={connected:false,state:'stopped'}} getStatus(){return {...this.s}} }
manager.register('fixture', new FixtureConnector(), { autoReconnect:false });

const start = Date.now();
const startHeap = process.memoryUsage().heapUsed;
let seq = 0;
const timer = setInterval(() => {
  for (let i=0;i<100;i++) core.ingestChat({platform:'twitch',id:`soak-${seq++}`,username:`u${i%50}`,text:`soak ${seq}`},'soak');
  core.bus.drain();
  const elapsed = Date.now()-start;
  if (elapsed >= durationMs) finish();
}, 200);

async function finish(){
  clearInterval(timer); core.bus.drain();
  const metrics=core.getMetrics(); const heapGrowth=process.memoryUsage().heapUsed-startHeap;
  assert.ok(events>0); assert.ok(metrics.bus.queued<=5000); assert.ok(metrics.dedupe.size<=metrics.dedupe.maxEntries);
  assert.ok(heapGrowth<384*1024*1024,`heap growth too high: ${heapGrowth}`);
  await manager.stopAll(); core.stop();
  console.log(JSON.stringify({ok:true,minutes,events,heapGrowthBytes:heapGrowth,metrics},null,2));
  process.exit(0);
}

process.on('SIGINT',()=>finish().catch(()=>process.exit(1)));
