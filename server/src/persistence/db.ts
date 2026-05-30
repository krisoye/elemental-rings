import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SPIRIT_BASE, XP_SCALER } from '../game/constants';
import { tierForXp, naturalMaxUses } from '../game/Tiers';

// DB path is env-driven so production can point at a persistent volume
// (DB_PATH=/var/lib/elemental-rings/elemental.db via the systemd unit) while
// local dev and E2E use a throwaway file. Default resolves to server/data/.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/elemental.db');

// Auto-create the parent directory so opening never fails on a missing folder.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/** Process-wide singleton connection. better-sqlite3 is synchronous. */
export const db: Database.Database = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// synchronous=NORMAL is the recommended companion to WAL: it relaxes the fsync
// discipline (no fsync per transaction, only at checkpoint) for a large write
// throughput gain while remaining crash-safe under WAL. The E2E suite registers
// many players concurrently (parallel Playwright workers), so this materially
// reduces write contention. Safe for prod too — WAL + NORMAL cannot corrupt the
// DB, only risks losing the very last transactions on an OS-level crash.
db.pragma('synchronous = NORMAL');
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
  db.exec(`ALTER TABLE players ADD COLUMN spirit_max INTEGER NOT NULL DEFAULT ${SPIRIT_BASE}`);
}
if (!hasPlayerCol('spirit_current')) {
  db.exec(`ALTER TABLE players ADD COLUMN spirit_current INTEGER NOT NULL DEFAULT ${SPIRIT_BASE}`);
}
if (!hasPlayerCol('food_units')) {
  db.exec('ALTER TABLE players ADD COLUMN food_units INTEGER NOT NULL DEFAULT 100');
}

// #63 — Phase 8B.3 teleportation: the waystone the player's Sanctum is currently
// anchored at. Drives overworld spawn placement. Defaults to the Forest entry
// waystone so existing players (and fresh ones) start anchored there.
if (!hasPlayerCol('anchored_waystone')) {
  db.exec("ALTER TABLE players ADD COLUMN anchored_waystone TEXT NOT NULL DEFAULT 'forest_entry'");
}

// Recompute spirit_max on every boot using the same formula as computeSpiritMax()
// in PlayerRepo: SPIRIT_BASE + floor(aggregate_xp / XP_SCALER). Only Reliquary
// rings (in_carry = 0) count toward aggregate_xp — must match the filter in
// selectAggregateRingXp (PlayerRepo.ts). Template literals embed the constants
// so the formula stays in sync when either value changes.
// Then cap spirit_current to the new max (fixes overflow when XP was lost/zeroed),
// and raise any player below SPIRIT_BASE up to the base floor.
db.exec(
  `UPDATE players
     SET spirit_max = ${SPIRIT_BASE} + CAST(
       COALESCE((SELECT SUM(xp) FROM rings WHERE owner_id = players.id AND in_carry = 0), 0) / ${XP_SCALER}
     AS INTEGER)`,
);
db.exec('UPDATE players SET spirit_current = MIN(spirit_current, spirit_max)');
db.exec(`UPDATE players SET spirit_current = spirit_max WHERE spirit_current < ${SPIRIT_BASE}`);

// EPIC #173 C8 — recompute every existing ring's tier and max_uses from XP, so a
// DB created under the old hard-cap model (tier stored independently, starter
// tier 1, fixed per-tier max_uses) lines up with the XP-derived model in
// Tiers.ts. Runs on every boot and is fully idempotent: tier and max_uses are
// pure functions of the (unchanged) xp column, so re-running recomputes the same
// values. Unlike the guarded one-time backfills below, there is no flag to gate —
// the computation is its own fixed point.
//
// CAVEAT (fusion history): a fused ring's natural max_uses is min(parents)−1, not
// 3+tier, and that history is not reconstructable from the persisted row. This
// migration therefore recomputes EVERY ring as if natural (max_uses = 3+tier),
// which can over-grant uses to a pre-existing fused ring. Accepted as pre-release
// behaviour per the EPIC; A4 (#178) owns the fusion crafting path going forward.
recomputeRingTiers();

// #180 — retire the Sanctum Stone. Re-anchoring is now a natural ability
// (POST /api/sanctum/summon). Null out any equipped Stone so no player row
// references a talisman id that no longer exists in the catalog. Idempotent:
// WHERE guards ensure a second run touches 0 rows when the Stone is already gone.
db.exec(
  "UPDATE talisman_loadout SET necklace_id = NULL, necklace_charges = 0 WHERE necklace_id = 'sanctum_stone'",
);

// #127 — forage_nodes: per-player node depletion tracking (GDD §10.10). The
// table is created here with IF NOT EXISTS so it is idempotent on every boot.
// An explicit anchored_waystone migration guard above already ran, so forage
// nodes can safely reference players(id) via their foreign key.
db.exec(`
  CREATE TABLE IF NOT EXISTS forage_nodes (
    node_id     TEXT    NOT NULL,
    player_id   TEXT    NOT NULL REFERENCES players(id),
    depleted_day INTEGER NOT NULL,
    PRIMARY KEY (node_id, player_id)
  )
`);

// #40 — carry flag on rings. On first introduction of the column, backfill it:
// rings already assigned to a loadout slot become carried, then remaining slots
// up to each player's carry_cap are filled by element ascending. This block is
// guarded so the one-time backfill never re-runs (it would clobber player edits).
if (!ringCols.some((c) => c.name === 'in_carry')) {
  db.exec('ALTER TABLE rings ADD COLUMN in_carry INTEGER NOT NULL DEFAULT 0');
  backfillCarry();
}

// #61 — Phase 8B waystone attunement. The table is created by the idempotent
// schema.sql apply above. Backfill the `forest_entry` attunement for every
// existing player so everyone starts attuned to the biome's entry waystone
// (GDD §10.7). Guarded so the one-time backfill never re-runs: it only fires
// when the table holds no rows yet (first boot after the migration). The
// INSERT OR IGNORE is itself idempotent, so a re-run could never clobber player
// attunements — the guard simply avoids a redundant scan on every boot.
const attunementCount = (
  db.prepare('SELECT COUNT(*) AS n FROM waystone_attunements').get() as { n: number }
).n;
if (attunementCount === 0) {
  backfillEntryAttunement();
}

/**
 * One-time backfill: grant every existing player the `forest_entry` waystone
 * attunement (attuned_at = now). INSERT OR IGNORE keeps it safe against the
 * (player_id, waystone_id) primary key. Runs inside a single transaction.
 */
function backfillEntryAttunement(): void {
  const players = db.prepare('SELECT id FROM players').all() as Array<{ id: string }>;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO waystone_attunements (player_id, waystone_id, attuned_at) VALUES (?, ?, ?)',
  );
  const now = Date.now();
  const run = db.transaction(() => {
    for (const player of players) insert.run(player.id, 'forest_entry', now);
  });
  run();
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

/**
 * EPIC #173 C8 — recompute `tier = tierForXp(xp)` and `max_uses = naturalMaxUses
 * (tier)` for every ring, aligning a legacy DB with the XP-derived tier model.
 * Idempotent: both targets are pure functions of the unchanged `xp` column, so a
 * second run produces identical values. Runs in a single transaction.
 *
 * Fusion caveat: every ring is recomputed as if natural (max_uses = 3+tier).
 * A pre-existing fused ring's true natural max (min(parents)−1) cannot be
 * reconstructed from its row, so it may be over-granted uses here — accepted as
 * pre-release behaviour (see the call site comment).
 */
export function recomputeRingTiers(): void {
  const rings = db.prepare('SELECT id, xp FROM rings').all() as Array<{
    id: string;
    xp: number;
  }>;
  // Recompute tier/max_uses, then clamp current_uses to the (possibly lowered)
  // new max in the same statement so the migration never leaves current_uses
  // above max_uses (e.g. an old fixed-5-use Tier-2 ring recomputed to 3).
  const update = db.prepare(
    'UPDATE rings SET tier = ?, max_uses = ?, current_uses = MIN(current_uses, ?) WHERE id = ?',
  );
  const run = db.transaction(() => {
    for (const ring of rings) {
      const tier = tierForXp(ring.xp);
      const max = naturalMaxUses(tier);
      update.run(tier, max, max, ring.id);
    }
  });
  run();
}
