import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// DB path is env-driven so production can point at a persistent volume
// (DB_PATH=/var/lib/elemental-rings/elemental.db via the systemd unit) while
// local dev and E2E use a throwaway file. Default resolves to server/data/.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/elemental.db');

// Auto-create the parent directory so opening never fails on a missing folder.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** Process-wide singleton connection. better-sqlite3 is synchronous. */
export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply the schema on startup. The file lives next to this module (under
// ts-node-dev __dirname is the src dir, so schema.sql sits beside db.ts). The
// DDL is idempotent (IF NOT EXISTS), so re-running on every boot is safe.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Guard migration: add escrowed column to existing DBs that predate the column.
// ALTER TABLE ... ADD COLUMN throws on a second run, so check PRAGMA first.
const ringCols = db.pragma('table_info(rings)') as Array<{ name: string }>;
if (!ringCols.some((c) => c.name === 'escrowed')) {
  db.exec('ALTER TABLE rings ADD COLUMN escrowed INTEGER NOT NULL DEFAULT 0');
}
