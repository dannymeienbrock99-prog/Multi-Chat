const fs = require('fs');
const path = require('path');

class AuditStore {
  constructor({ dataDir, onStatus, onLog } = {}) {
    if (!dataDir) throw new Error('AuditStore dataDir fehlt.');
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'batto.db');
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.db = null;
    this.state = 'CLOSED';
    this.error = null;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  getStatus() {
    let size = 0;
    try { if (fs.existsSync(this.file)) size = fs.statSync(this.file).size; } catch {}
    return { state: this.state, open: this.state === 'OPEN', wal: this.state === 'OPEN', file: this.file, sizeBytes: size, error: this.error };
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error ? String(error.message || error) : null;
    this.onStatus?.(this.getStatus());
  }

  open() {
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.file);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          event_id TEXT PRIMARY KEY, ts TEXT NOT NULL, platform TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS moderation_audit (
          action_id TEXT PRIMARY KEY, ts TEXT NOT NULL, platform TEXT NOT NULL, action TEXT NOT NULL,
          target_user TEXT NOT NULL, actor TEXT, reason TEXT, last_message TEXT, result TEXT NOT NULL, error TEXT
        );
        CREATE TABLE IF NOT EXISTS rule_runs (
          run_id TEXT PRIMARY KEY, rule_id TEXT, started_at TEXT NOT NULL, duration_ms INTEGER, result TEXT NOT NULL, error TEXT
        );
        CREATE TABLE IF NOT EXISTS connector_state_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, connector TEXT NOT NULL, state TEXT NOT NULL, error TEXT
        );
      `);
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
      this.setState('OPEN');
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      this.db = null;
      this.setState('DEGRADED', error);
      this.onLog?.('WARN', 'AuditStore', 'SQLITE_DEGRADED', { message: error.message });
      return { ok: false, degraded: true, error: error.message, status: this.getStatus() };
    }
  }

  writeEvent(event) {
    if (!this.db) return false;
    try {
      this.db.prepare('INSERT OR IGNORE INTO events(event_id,ts,platform,type,payload_json) VALUES(?,?,?,?,?)')
        .run(event.eventId, event.timestamp, event.platform, event.type, JSON.stringify(event));
      return true;
    } catch (error) { this.onLog?.('WARN', 'AuditStore', 'WRITE_EVENT_FAILED', { message: error.message }); return false; }
  }

  writeModeration(entry) {
    if (!this.db) return false;
    try {
      this.db.prepare('INSERT OR REPLACE INTO moderation_audit(action_id,ts,platform,action,target_user,actor,reason,last_message,result,error) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(entry.id || entry.actionId, entry.timestamp, entry.platform, entry.action, entry.username || entry.targetUser || '', entry.executor || entry.actor || '', entry.reason || '', entry.lastMessage || '', entry.result || 'unsupported', entry.error || null);
      return true;
    } catch (error) { this.onLog?.('WARN', 'AuditStore', 'WRITE_MODERATION_FAILED', { message: error.message }); return false; }
  }

  writeRuleRun(entry) {
    if (!this.db) return false;
    try {
      this.db.prepare('INSERT OR REPLACE INTO rule_runs(run_id,rule_id,started_at,duration_ms,result,error) VALUES(?,?,?,?,?,?)')
        .run(entry.runId || `${Date.now()}-${Math.random()}`, entry.ruleId || null, entry.startedAt || new Date().toISOString(), Number(entry.durationMs || 0), entry.result || entry.phase || 'unknown', entry.error || null);
      return true;
    } catch (error) { this.onLog?.('WARN', 'AuditStore', 'WRITE_RULE_FAILED', { message: error.message }); return false; }
  }

  writeConnectorState(entry) {
    if (!this.db) return false;
    try {
      this.db.prepare('INSERT INTO connector_state_history(ts,connector,state,error) VALUES(?,?,?,?)')
        .run(entry.ts || new Date().toISOString(), entry.name || entry.connector || 'unknown', entry.state || 'ERROR', entry.lastError || entry.error || null);
      return true;
    } catch (error) { this.onLog?.('WARN', 'AuditStore', 'WRITE_CONNECTOR_FAILED', { message: error.message }); return false; }
  }

  retention(days = 7) {
    if (!this.db) return false;
    const cutoff = new Date(Date.now() - Math.max(1, Number(days || 7)) * 86400000).toISOString();
    try {
      this.db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
      this.db.prepare('DELETE FROM connector_state_history WHERE ts < ?').run(cutoff);
      return true;
    } catch { return false; }
  }

  close() {
    try { this.db?.close(); } catch {}
    this.db = null;
    this.setState('CLOSED');
  }
}

module.exports = { AuditStore };
