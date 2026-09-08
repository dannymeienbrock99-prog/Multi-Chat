const { EventEmitter } = require('events');
const { normalizeChat, normalizeEvent } = require('./normalizer.cjs');
const { DedupeCache } = require('./dedupe.cjs');
const { EventAggregator } = require('./aggregation.cjs');
const { EventBus } = require('./event-bus.cjs');

class EventCore extends EventEmitter {
  constructor({ dedupeTtlMs = 120000, dedupeMaxEntries = 10000, maxQueue = 5000, onLog } = {}) {
    super();
    this.onLog = onLog;
    this.dedupe = new DedupeCache({ ttlMs: dedupeTtlMs, maxEntries: dedupeMaxEntries });
    this.aggregator = new EventAggregator();
    this.bus = new EventBus({ maxQueue });
    this.received = 0;
    this.invalid = 0;
    this.startedAt = Date.now();
    this.flushTimer = setInterval(() => this.flushAggregates(), 250);
    this.flushTimer.unref?.();

    this.bus.on('event', (event) => this.emit('event', event));
    this.bus.on('overflow', (info) => {
      this.onLog?.('WARN', 'EventCore', 'Event-Bus Queue-Limit erreicht; ältestes Event verworfen.', info);
      this.emit('overflow', info);
    });
  }

  ingestChat(input, sourceConnector = 'unknown') {
    return this.ingestNormalized(() => normalizeChat(input, sourceConnector));
  }

  ingestEvent(input, sourceConnector = 'unknown') {
    return this.ingestNormalized(() => normalizeEvent(input, sourceConnector));
  }

  ingestNormalized(factory) {
    this.received += 1;
    let event;
    try {
      event = factory();
    } catch (error) {
      this.invalid += 1;
      this.onLog?.('WARN', 'EventCore', error.message, {});
      this.emit('invalid', { error: error.message });
      return { ok: false, error: error.message };
    }

    if (this.dedupe.seen(event.eventId)) return { ok: false, duplicate: true, event };

    const aggregate = this.aggregator.add(event);
    if (aggregate.emitNow) this.bus.publish(aggregate.event);
    return { ok: true, event: aggregate.event, aggregated: !aggregate.emitNow };
  }

  flushAggregates() {
    for (const event of this.aggregator.flushDue()) {
      this.bus.publish(event);
    }
  }

  getMetrics() {
    return {
      received: this.received,
      invalid: this.invalid,
      uptimeMs: Date.now() - this.startedAt,
      dedupe: this.dedupe.stats(),
      aggregation: this.aggregator.stats(),
      bus: this.bus.stats()
    };
  }

  stop() {
    clearInterval(this.flushTimer);
    this.flushAggregates();
    this.bus.clear();
  }
}

module.exports = { EventCore };
