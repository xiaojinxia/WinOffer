import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, BACKUP_VERSION, createApplication, applyChange, validateApplication, validateBackup, advanceResumeScreening, AUTO_SCREENING_NOTE } from '../shared/model.js';

const safetyBackupPattern = /^before-(?:restore|screening|hr-stage)-[\w.-]+\.json$/;
function normalizeScreening(record) {
  const next = advanceResumeScreening(record);
  if (next === record) return record;
  // Keep the original update time so upgrading existing records preserves their list order.
  return validateApplication({ ...next, history: [...record.history, { time: new Date().toISOString(), type: 'auto-screening', text: AUTO_SCREENING_NOTE }] });
}

export class Store {
  constructor(filename) {
    mkdirSync(dirname(filename), { recursive: true });
    this.backupDirectory = join(dirname(filename), 'backups');
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('数据库版本高于当前程序，请使用新版 WinOffer 打开。'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
      PRAGMA user_version=1;
    `);
    this.db.prepare('INSERT OR IGNORE INTO metadata(key, value) VALUES (?, ?)').run('revision', randomUUID());
    try { this.migrateHrStage(); this.migrateResumeScreening(); }
    catch (error) { this.db.close(); throw error; }
  }
  revision() { return this.db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value; }
  records() { return this.db.prepare('SELECT document FROM applications').all().map(r => JSON.parse(r.document)).sort((a,b) => b.updated.localeCompare(a.updated)); }
  snapshot() {
    this.db.exec('BEGIN');
    try { const result = { revision: this.revision(), records: this.records() }; this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  transaction(expected, action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (expected !== this.revision()) throw new AppError('数据已在其他页面更新。请重新加载最新记录后再编辑；本次修改尚未保存。', 409);
      const result = action();
      const revision = randomUUID();
      this.db.prepare("UPDATE metadata SET value=? WHERE key='revision'").run(revision);
      this.db.exec('COMMIT');
      return { ...result, revision };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveSafetyBackup(records, reason = 'restore') {
    const backup = { format: 'winoffer-backup', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records };
    mkdirSync(this.backupDirectory, { recursive: true });
    const filename = `before-${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    writeFileSync(join(this.backupDirectory, filename), JSON.stringify(backup, null, 2), { encoding: 'utf8', flag: 'wx', flush: true });
    return filename;
  }
  migrateResumeScreening() {
    const before = this.snapshot();
    const changes = before.records.map(record => ({ original: record, next: normalizeScreening(record) })).filter(({ original, next }) => original !== next);
    if (!changes.length) return;
    return this.transaction(before.revision, () => {
      const safetyBackup = this.saveSafetyBackup(before.records, 'screening');
      const update = this.db.prepare('UPDATE applications SET document=? WHERE id=?');
      for (const { next } of changes) update.run(JSON.stringify(next), next.id);
      return { count: changes.length, safetyBackup };
    });
  }
  migrateHrStage() {
    const before = this.snapshot();
    const changes = before.records.filter(record => record.workflowVersion !== 2).map(validateApplication);
    if (!changes.length) return;
    return this.transaction(before.revision, () => {
      const safetyBackup = this.saveSafetyBackup(before.records, 'hr-stage');
      const update = this.db.prepare('UPDATE applications SET document=? WHERE id=?');
      for (const record of changes) update.run(JSON.stringify(record), record.id);
      return { count: changes.length, safetyBackup };
    });
  }
  create(input, revision) {
    const record = createApplication(input, randomUUID());
    record.history.push({ time: record.created, type: 'create', text: '创建了投递记录' });
    return this.transaction(revision, () => {
      if (this.db.prepare('SELECT count(*) AS count FROM applications').get().count >= 10000) throw new AppError('最多支持 10000 条投递记录');
      this.db.prepare('INSERT INTO applications VALUES (?, ?)').run(record.id, JSON.stringify(record));
      return { record };
    });
  }
  change(id, change, revision) {
    return this.transaction(revision, () => {
      const row = this.db.prepare('SELECT document FROM applications WHERE id=?').get(id);
      if (!row) throw new AppError('投递记录已不存在，请重新加载列表', 404);
      const record = applyChange(JSON.parse(row.document), change);
      this.db.prepare('UPDATE applications SET document=? WHERE id=?').run(JSON.stringify(record), id);
      return { record };
    });
  }
  remove(id, revision) {
    return this.transaction(revision, () => {
      const result = this.db.prepare('DELETE FROM applications WHERE id=?').run(id);
      if (result.changes === 0) throw new AppError('投递记录已不存在，请重新加载列表', 404);
      return { id };
    });
  }
  export() { const { records } = this.snapshot(); return { format: 'winoffer-backup', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records }; }
  restore(input, revision) {
    // Fully validate every record before any filesystem/database mutation.
    const backup = validateBackup(input);
    backup.records = backup.records.map(normalizeScreening);
    return this.transaction(revision, () => {
      // Refuse to replace data if the safety copy cannot be written and flushed.
      const safetyBackup = this.saveSafetyBackup(this.records());
      this.db.exec('DELETE FROM applications');
      const insert = this.db.prepare('INSERT INTO applications VALUES (?, ?)');
      for (const record of backup.records) insert.run(record.id, JSON.stringify(record));
      return { records: backup.records, safetyBackup };
    });
  }
  backups() {
    try { return readdirSync(this.backupDirectory).filter(n => safetyBackupPattern.test(n)).sort((a,b) => b.replace(/^before-(?:restore|screening|hr-stage)-/, '').localeCompare(a.replace(/^before-(?:restore|screening|hr-stage)-/, ''))); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  readBackup(name) {
    if (!safetyBackupPattern.test(name) || !this.backups().includes(name)) throw new AppError('找不到该自动备份', 404);
    return validateBackup(JSON.parse(readFileSync(join(this.backupDirectory, name), 'utf8')));
  }
  close() { this.db.close(); }
}
