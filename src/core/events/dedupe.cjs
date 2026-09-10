class DedupeCache {
  constructor({ ttlMs = 120000, maxEntries = 10000 } = {}) {
    this.ttlMs = Math.max(1000, Number(ttlMs || 120000));
    this.maxEntries = Math.max(100, Number(maxEntries || 10000));
    this.map = new Map();
    this.dropped = 0;
  }

  prune(now = Date.now()) {
    for (const [id, expiresAt] of this.map) {
      if (expiresAt > now) break;
      this.map.delete(id);
    }
    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next();
      if (first.done) break;
      this.map.delete(first.value);
    }
  }

  seen(id) {
    const key = String(id || '');
    if (!key) return false;
    const now = Date.now();
    const expires = this.map.get(key);
    if (expires && expires > now) {
      this.dropped += 1;
      return true;
    }
    if (expires) this.map.delete(key);
    this.map.set(key, now + this.ttlMs);
    this.prune(now);
    return false;
  }

  stats() {
    return { size: this.map.size, dropped: this.dropped, ttlMs: this.ttlMs, maxEntries: this.maxEntries };
  }

  clear() {
    this.map.clear();
    this.dropped = 0;
  }
}

module.exports = { DedupeCache };
