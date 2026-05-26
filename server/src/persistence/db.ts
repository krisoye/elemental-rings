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

// Guard migrations: ALTER TABLE ... ADD COLUMN throws on a second run, so check
// PRAGMA first. Each block is independently idempotent and safe on every boot.
const ringCols = db.pragma('table_info(rings)') as Array<{ name: string }>;
if (!ringCols.some((c) => c.name === 'escrowed')) {
  db.exec('ALTER TABLE rings ADD COLUMN escrowed INTEGER NOT NULL DEFAULT 0');
}

const playerCols = db.pragma('table_info(players)') as Array<{ name: string }>;
const hasPlayerCol = (name: string): boolean => playerCols.some((c) => c.name === name);

// #40 — carry system: per-player carry cap.
if (!hasPlayerCol('carry_cap')) {
  db.exec('ALTER TABLE players ADD COLUMN carry_cap INTEGER NOT NULL DEFAULT 10');
}

// #41 — spirit system: spirit gauge + food economy.
if (!hasPlayerCol('spirit_max')) {
  db.exec('ALTER TABLE players ADD COLUMN spirit_max INTEGER NOT NULL DEFAULT 30');
}
if (!hasPlayerCol('spirit_current')) {
  db.exec('ALTER TABLE players ADD COLUMN spirit_current INTEGER NOT NULL DEFAULT 30');
}
if (!hasPlayerCol('food_units')) {
  db.exec('ALTER TABLE players ADD COLUMN food_units INTEGER NOT NULL DEFAULT 100');
}

// #40 — carry flag on rings. On first introduction of the column, backfill it:
// rings already assigned to a loadout slot become carried, then remaining slots
// up to each player's carry_cap are filled by element ascending. This block is
// guarded so the one-time backfill never re-runs (it would clobber player edits).
if (!ringCols.some((c) => c.name === 'in_carry')) {
  db.exec('ALTER TABLE rings ADD COLUMN in_carry INTEGER NOT NULL DEFAULT 0');
  backfillCarry();
}

/**
 * One-time backfill of the in_carry flag for pre-#40 databases. For each player:
 * mark every ring referenced by their loadout (thumb/a1/a2/d1/d2) as carried,
 * then fill remaining carry slots up to carry_cap with the cheapest-element
 * rings first. Runs inside a single transaction.
 */
function backfillCarry(): void {
  const players = db.prepare('SELECT id, carry_cap FROM players').all() as Array<{
    id: string;
    carry_cap: number;
  }>;
  const loadoutFor = db.prepare(
    'SELECT thumb, a1, a2, d1, d2 FROM loadout WHERE player_id = ?',
  );
  const ringsFor = db.prepare(
    'SELECT id FROM rings WHERE owner_id = ? ORDER BY element ASC, id ASC',
  );
  const setCarry = db.prepare('UPDATE rings SET in_carry = 1 WHERE id = ?');

  const run = db.transaction(() => {
    for (const player of players) {
      const carried = new Set<string>();
      const loadout = loadoutFor.get(player.id) as
        | Record<string, string | null>
        | undefined;
      if (loadout) {
        for (const slot of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
          const id = loadout[slot];
          if (id) carried.add(id);
        }
      }
      const owned = ringsFor.all(player.id) as Array<{ id: string }>;
      for (const ring of owned) {
        if (carried.size >= player.carry_cap) break;
        carried.add(ring.id);
      }
      for (const id of carried) setCarry.run(id);
    }
  });
  run();
}
