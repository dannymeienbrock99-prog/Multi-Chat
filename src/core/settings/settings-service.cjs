const { EventEmitter } = require('events');
const { deepMerge, DEFAULT_CONFIG } = require('../config-store.cjs');
const { validateConfig } = require('./schema.cjs');

class SettingsService extends EventEmitter {
  constructor({ configStore } = {}) {
    super();
    if (!configStore) throw new Error('SettingsService benötigt ConfigStore.');
    this.configStore = configStore;
    this.draft = configStore.get();
    this.dirty = false;
  }

  getPersisted() { return this.configStore.get(); }
  getDraft() { return structuredClone(this.draft); }
  isDirty() { return this.dirty; }

  patch(patch) {
    const candidate = deepMerge(this.draft, patch || {});
    const validation = validateConfig(candidate);
    this.draft = candidate;
    this.dirty = JSON.stringify(this.draft) !== JSON.stringify(this.configStore.get());
    this.emit('draft', { config: this.getDraft(), dirty: this.dirty, validation });
    return { config: this.getDraft(), dirty: this.dirty, validation };
  }

  apply() {
    const validation = validateConfig(this.draft);
    if (!validation.ok) return { ok: false, validation };
    const persisted = this.configStore.merge(this.draft);
    this.draft = persisted;
    this.dirty = false;
    this.emit('applied', persisted);
    return { ok: true, config: structuredClone(persisted) };
  }

  discard() {
    this.draft = this.configStore.get();
    this.dirty = false;
    this.emit('discarded', this.getDraft());
    return { ok: true, config: this.getDraft() };
  }

  resetSection(section) {
    if (!(section in DEFAULT_CONFIG)) return { ok: false, error: 'Unbekannter Bereich.' };
    const candidate = structuredClone(this.draft);
    candidate[section] = structuredClone(DEFAULT_CONFIG[section]);
    const validation = validateConfig(candidate);
    this.draft = candidate;
    this.dirty = true;
    this.emit('draft', { config: this.getDraft(), dirty: true, validation });
    return { ok: validation.ok, config: this.getDraft(), validation };
  }

  test(section) {
    const validation = validateConfig(this.draft);
    const related = validation.errors.filter((x) => x.path === section || x.path.startsWith(`${section}.`));
    return { ok: related.length === 0, errors: related };
  }
}

module.exports = { SettingsService };
