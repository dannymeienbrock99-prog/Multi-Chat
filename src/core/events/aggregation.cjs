class EventAggregator {
  constructor({ likeWindowMs = 1000, giftWindowMs = 1500, maxBuckets = 500 } = {}) {
    this.likeWindowMs = Math.max(100, Number(likeWindowMs || 1000));
    this.giftWindowMs = Math.max(250, Number(giftWindowMs || 1500));
    this.maxBuckets = Math.max(50, Number(maxBuckets || 500));
    this.buckets = new Map();
    this.aggregated = 0;
  }

  keyFor(event) {
    if (event.type === 'like') return `like:${event.platform}:${event.user?.id || 'unknown'}`;
    if (event.type === 'gift') return `gift:${event.platform}:${event.user?.id || 'unknown'}:${event.gift?.id || event.gift?.name || 'gift'}`;
    return '';
  }

  windowFor(event) {
    return event.type === 'like' ? this.likeWindowMs : event.type === 'gift' ? this.giftWindowMs : 0;
  }

  add(event) {
    const key = this.keyFor(event);
    const windowMs = this.windowFor(event);
    if (!key || !windowMs) return { emitNow: true, event };

    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.buckets.set(key, { event, count: event.type === 'gift' ? Number(event.gift?.count || 1) : 1, expiresAt: now + windowMs });
      this.trim();
      return { emitNow: true, event };
    }

    existing.count += event.type === 'gift' ? Number(event.gift?.count || 1) : 1;
    existing.expiresAt = now + windowMs;
    existing.event = {
      ...event,
      eventId: `${event.eventId}:agg:${existing.count}`,
      gift: event.gift ? { ...event.gift, count: existing.count } : event.gift,
      meta: { ...event.meta, aggregatedCount: existing.count, aggregated: true }
    };
    this.buckets.set(key, existing);
    this.aggregated += 1;
    return { emitNow: false, event: existing.event, key, expiresAt: existing.expiresAt };
  }

  flushDue(now = Date.now()) {
    const out = [];
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt > now) continue;
      if (bucket.count > 1) out.push(bucket.event);
      this.buckets.delete(key);
    }
    return out;
  }

  trim() {
    while (this.buckets.size > this.maxBuckets) {
      const first = this.buckets.keys().next();
      if (first.done) break;
      this.buckets.delete(first.value);
    }
  }

  stats() {
    return { buckets: this.buckets.size, aggregated: this.aggregated, maxBuckets: this.maxBuckets };
  }
}

module.exports = { EventAggregator };
