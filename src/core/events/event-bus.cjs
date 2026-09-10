const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  constructor({ maxQueue = 5000 } = {}) {
    super();
    this.maxQueue = Math.max(100, Number(maxQueue || 5000));
    this.queue = [];
    this.processing = false;
    this.dropped = 0;
    this.emitted = 0;
  }

  publish(event) {
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
      this.dropped += 1;
      this.emit('overflow', { dropped: this.dropped, maxQueue: this.maxQueue });
    }
    this.queue.push(event);
    this.schedule();
  }

  schedule() {
    if (this.processing) return;
    this.processing = true;
    setImmediate(() => this.drain());
  }

  drain() {
    try {
      let processed = 0;
      while (this.queue.length && processed < 500) {
        const event = this.queue.shift();
        this.emitted += 1;
        this.emit('event', event);
        this.emit(event.type, event);
        processed += 1;
      }
    } finally {
      this.processing = false;
      if (this.queue.length) this.schedule();
    }
  }

  stats() {
    return { queued: this.queue.length, emitted: this.emitted, dropped: this.dropped, maxQueue: this.maxQueue };
  }

  clear() {
    this.queue.length = 0;
  }
}

module.exports = { EventBus };
