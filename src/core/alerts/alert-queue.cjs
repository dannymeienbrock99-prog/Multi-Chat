const { EventEmitter } = require('events');

class AlertQueue extends EventEmitter {
  constructor({ maxQueue = 100, defaultDurationMs = 5000, mode = 'priority', onDrop } = {}) {
    super();
    this.maxQueue = Math.max(1, Number(maxQueue || 100));
    this.defaultDurationMs = Math.max(250, Number(defaultDurationMs || 5000));
    this.mode = mode || 'priority';
    this.onDrop = onDrop;
    this.queue = [];
    this.active = null;
    this.timer = null;
    this.sequence = 0;
    this.dropped = 0;
    this.processed = 0;
  }

  enqueue(payload = {}) {
    const item = {
      id: payload.eventId || payload.id || `alert-${Date.now()}-${++this.sequence}`,
      payload,
      priority: Number(payload.priority ?? payload.data?.priority ?? 0),
      durationMs: Math.max(250, Number(payload.durationMs ?? payload.data?.durationMs ?? this.defaultDurationMs)),
      queuedAt: Date.now()
    };
    const duplicate = this.queue.some((x) => x.id === item.id) || this.active?.id === item.id;
    if (duplicate) return { ok: false, duplicate: true };

    if (this.queue.length >= this.maxQueue) {
      this.dropped += 1;
      let dropped;
      if (this.mode === 'priority') {
        const lowest = this.queue.reduce((best, x, i, a) => x.priority < a[best].priority ? i : best, 0);
        if (this.queue[lowest]?.priority > item.priority) {
          this.onDrop?.(item, 'lower-priority');
          this.emit('drop', { item, reason: 'lower-priority' });
          return { ok: false, dropped: true };
        }
        dropped = this.queue.splice(lowest, 1)[0];
      } else dropped = this.queue.shift();
      this.onDrop?.(dropped, 'overflow');
      this.emit('drop', { item: dropped, reason: 'overflow' });
    }

    this.queue.push(item);
    if (this.mode === 'priority') this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    this.drain();
    return { ok: true, id: item.id };
  }

  drain() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    this.processed += 1;
    this.emit('show', this.active.payload);
    this.timer = setTimeout(() => {
      const finished = this.active;
      this.active = null;
      this.emit('hide', finished?.payload);
      this.drain();
    }, this.active.durationMs);
    this.timer.unref?.();
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.active = null;
  }

  stats() {
    return { queued: this.queue.length, active: Boolean(this.active), maxQueue: this.maxQueue, dropped: this.dropped, processed: this.processed };
  }
}

module.exports = { AlertQueue };
