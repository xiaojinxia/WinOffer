import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateAgent(db, directory, oldVersion) {
  if (oldVersion === 2) return;
  if (oldVersion === 1) {
    mkdirSync(directory, { recursive: true });
    const filename = join(directory, `before-agent-${randomUUID()}.sqlite`);
    // VACUUM INTO creates a consistent standalone snapshot, including WAL data.
    db.prepare('VACUUM INTO ?').run(filename);
    const check = new DatabaseSync(filename, { readOnly: true });
    try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('迁移备份校验失败'); }
    finally { check.close(); }
  }
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, created TEXT NOT NULL,
      document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE REFERENCES agent_messages(id),
      state TEXT NOT NULL CHECK(state IN ('needs_input','pending','applied','ignored','stale')),
      created TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE INDEX IF NOT EXISTS agent_proposals_state ON agent_proposals(state,created);
    CREATE TABLE IF NOT EXISTS agent_audit (
      proposal_id TEXT PRIMARY KEY REFERENCES agent_proposals(id), preview_id TEXT NOT NULL UNIQUE,
      document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
      created TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE TABLE IF NOT EXISTS agent_state (key TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    CREATE TABLE IF NOT EXISTS agent_drafts (id TEXT PRIMARY KEY, created TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
    PRAGMA user_version=2;
    COMMIT;`);
}
