import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { RELIQUARY_BASE_CAP } from '../game/constants';
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
const hasRingCol = (name: string): boolean => ringCols.some((c) => c.name === name);
if (!hasRingCol('escrowed')) {
  db.exec('ALTER TABLE rings ADD COLUMN escrowed INTEGER NOT NULL DEFAULT 0');
}

// #263 — two-tone fused cards: persist the dominant (higher-XP) parent element at
// fusion time so the card renders the leading parent's color first. -1 = base
// ring or a pre-migration fusion (renders in static FUSION_PARENTS order). The
// DEFAULT -1 backfills every existing row, so pre-migration fusions never break.
if (!hasRingCol('parent_dominant')) {
  db.exec('ALTER TABLE rings ADD COLUMN parent_dominant INTEGER NOT NULL DEFAULT -1');
}

// EPIC #302 — heart slot. A ring equipped in the dedicated Heart slot is NOT a
// Reliquary ring: it does not contribute to spirit_max and does not consume a
// carry or Reliquary slot. heart_slot = 1 marks the equipped heart ring (at most
// one per player, tracked authoritatively by players.heart_ring_id). DEFAULT 0
// backfills every existing row, so legacy rings migrate as non-heart.
if (!hasRingCol('heart_slot')) {
  db.exec('ALTER TABLE rings ADD COLUMN heart_slot INTEGER NOT NULL DEFAULT 0');
}

const playerCols = db.pragma('table_info(players)') as Array<{ name: string }>;
const hasPlayerCol = (name: string): boolean => playerCols.some((c) => c.name === name);

// #40 — carry system: per-player carry cap.
if (!hasPlayerCol('carry_cap')) {
  db.exec('ALTER TABLE players ADD COLUMN carry_cap INTEGER NOT NULL DEFAULT 10');
}

// EPIC #279 — difficulty tier. Scales the spirit_max multiplier (the boot
// recompute below reads this column in its CASE). Defaults to 'seeker' so every
// existing player migrates to the meaningful-choices baseline. Guarded like every
// other column so the ALTER never re-runs.
if (!hasPlayerCol('difficulty')) {
  db.exec("ALTER TABLE players ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'seeker'");
}

// #41 — spirit system: spirit gauge + food economy. The column DEFAULT is a
// placeholder only — the boot recompute below overwrites spirit_max from the
// EPIC #279 formula (SUM(Reliquary max_uses) × difficulty multiplier) on every
// boot, and 0 is a valid value (empty Reliquary → 0, by design).
if (!hasPlayerCol('spirit_max')) {
  db.exec('ALTER TABLE players ADD COLUMN spirit_max INTEGER NOT NULL DEFAULT 0');
}
if (!hasPlayerCol('spirit_current')) {
  db.exec('ALTER TABLE players ADD COLUMN spirit_current INTEGER NOT NULL DEFAULT 0');
}
if (!hasPlayerCol('food_units')) {
  db.exec('ALTER TABLE players ADD COLUMN food_units INTEGER NOT NULL DEFAULT 100');
}

// EPIC #302 — the ring currently equipped in the player's Heart slot, or NULL
// when the slot is empty. Nullable with NO DEFAULT so legacy players migrate to
// an empty heart slot (NULL). The matching rings.heart_slot flag is set on the
// referenced ring; this column is the authoritative single-ring pointer.
if (!hasPlayerCol('heart_ring_id')) {
  db.exec('ALTER TABLE players ADD COLUMN heart_ring_id TEXT');
}

// #63 — Phase 8B.3 teleportation: the waystone the player's Sanctum is currently
// anchored at. Drives overworld spawn placement. Defaults to the Forest entry
// waystone so existing players (and fresh ones) start anchored there.
if (!hasPlayerCol('anchored_waystone')) {
  db.exec("ALTER TABLE players ADD COLUMN anchored_waystone TEXT NOT NULL DEFAULT 'forest_entry'");
}

// #182 — Reliquary cap + Shard expansion.
// reliquary_cap: how many resting (in_carry=0, escrowed=0) rings the player can
// hold. Defaults to RELIQUARY_BASE_CAP. Expansions via Shards raise this.
// Legacy over-cap players are grandfathered — we only block ADDING more rings.
if (!hasPlayerCol('reliquary_cap')) {
  db.exec(`ALTER TABLE players ADD COLUMN reliquary_cap INTEGER NOT NULL DEFAULT ${RELIQUARY_BASE_CAP}`);
}
// reliquary_shards: unspent Shards held by the player. Grants from NPCs/loot call
// grantShard(); spending them calls addReliquaryShardToReliquary().
if (!hasPlayerCol('reliquary_shards')) {
  db.exec('ALTER TABLE players ADD COLUMN reliquary_shards INTEGER NOT NULL DEFAULT 0');
}

// EPIC #378 — spare_ring_max: per-player cap on rings in the spare grid
// (in_carry=1 AND not in any loadout slot). Defaults to SPARE_SLOTS (9).
// Unlike the old carry_cap model, clearing a battle slot does NOT free spare
// capacity — battle-hand and spare-grid are independently bounded.
if (!hasPlayerCol('spare_ring_max')) {
  db.exec('ALTER TABLE players ADD COLUMN spare_ring_max INTEGER NOT NULL DEFAULT 9');
}

// EPIC #378 — rings.pending: 1 when a ring was received as a WON ring but has
// not yet been assigned to a slot or discarded (overflow carry state). A ring
// with pending=1 is the authoritative WON-ring identifier exposed via /api/me
// as pending_ring_id, replacing the fragile er_pending_ring localStorage key.
// DEFAULT 0 backfills every existing row so no legacy ring starts pending.
if (!hasRingCol('pending')) {
  db.exec('ALTER TABLE rings ADD COLUMN pending INTEGER NOT NULL DEFAULT 0');
}

// #240 — Reliquary held at a FIXED RELIQUARY_BASE_CAP (9). Shard expansion is
// paused. An ALTER ... DEFAULT only affects NEWLY-inserted column values, never
// existing rows — so players created under the old cap (20), or who expanded via
// Shards, still carry a higher reliquary_cap. Clamp any such row down to the
// fixed cap on every boot. Idempotent: the WHERE guard touches 0 rows once every
// player is already at or below the cap. Over-cap RESTING rings are NOT evicted
// (graceful grandfathering — packLoadout only blocks NEW over-cap moves).
db.exec(
  `UPDATE players SET reliquary_cap = ${RELIQUARY_BASE_CAP} WHERE reliquary_cap > ${RELIQUARY_BASE_CAP}`,
);

// EPIC #279 / #511 Contract F (#520) — recompute spirit_max on every boot from
// the FORCE-WEIGHTED formula: SUM(max_uses × force) across the player's
// Reliquary rings (in_carry = 0, heart_slot = 0) × their difficulty multiplier
// (wanderer ×5, ascendant ×3, ascetic ×2, void ×1, else seeker ×4). This must
// match getSpiritStats() in PlayerRepo.ts. The difficulty column migration
// above has already run, so the CASE is safe. An empty Reliquary yields 0 —
// intended; there is no floor. Then cap spirit_current to the (possibly lower)
// new max.
//
// force is `r.max_uses * ((r.tier + 3) / 2)` — a raw-SQL restatement of
// shared/tiers.ts:forceFromTier1(r.tier + 1), which is
// `Math.floor((tier1 + 2) / 2)` with tier1 = r.tier + 1, i.e.
// `Math.floor((r.tier + 3) / 2)`. This UPDATE runs as a raw db.exec() SQL
// statement across every player and cannot call into TypeScript, so the
// formula is duplicated here — the SAME allowance already taken for the
// difficulty-multiplier CASE above. SQLite integer-column (`/`) division
// truncates toward zero for non-negative operands, so `(r.tier + 3) / 2` is
// exactly `floor((r.tier + 3) / 2)`; `r.tier` and `r.max_uses` are both
// INTEGER columns (schema.sql), so the division is integer, not float. This
// duplication is guarded by the drift-guard test in
// tests/unit/spirit-formula.test.ts, which asserts this SQL and
// getSpiritStats() agree across every DifficultyTier and the acceptance-table
// ring compositions — keep both in sync on any change to the force formula.
//
// Exported (mirroring recomputeRingTiers below) so the drift-guard test can
// invoke the EXACT production SQL directly against a seeded scratch DB,
// instead of pasting a second copy of this UPDATE into the test file.
export function recomputeSpiritMax(): void {
  db.exec(
    `UPDATE players
       SET spirit_max = (
         SELECT COALESCE(SUM(r.max_uses * ((r.tier + 3) / 2)), 0)
         FROM rings r
         WHERE r.owner_id = players.id AND r.in_carry = 0 AND r.heart_slot = 0
       ) * CASE players.difficulty
           WHEN 'wanderer'  THEN 5
           WHEN 'ascendant' THEN 3
           WHEN 'ascetic'   THEN 2
           WHEN 'void'      THEN 1
           ELSE 4
         END`,
  );
  db.exec('UPDATE players SET spirit_current = MIN(spirit_current, spirit_max)');
}
recomputeSpiritMax();

// EPIC #173 C8 — recompute every existing ring's tier and max_uses from XP, so a
// DB created under the old hard-cap model (tier stored independently, starter
// tier 1, fixed per-tier max_uses) lines up with the XP-derived model in
// Tiers.ts. Runs on every boot and is fully idempotent: tier and max_uses are
// pure functions of the (unchanged) xp column, so re-running recomputes the same
// values. Unlike the guarded one-time backfills below, there is no flag to gate —
// the computation is its own fixed point.
//
// max_uses is now a pure function of XP for ALL rings — natural and fused alike
// (fusion sets max_uses = 3 + tier(combined XP), see fuseRings) — so this recompute
// is exact for every ring, not a compromise: an old-rule fused ring self-corrects
// to 3 + tierForXp(xp) on boot with no special handling.
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

// #231 — Fusion Shrine seal state: per-player record of which shrines a player
// has permanently unsealed (by consuming a matching fusion ring-key). Created
// here with IF NOT EXISTS so it is idempotent on every boot. References
// players(id); the migration above has already ensured the players table exists.
db.exec(`
  CREATE TABLE IF NOT EXISTS shrines (
    player_id   TEXT    NOT NULL REFERENCES players(id),
    shrine_id   TEXT    NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, shrine_id)
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
 * max_uses is a pure function of XP for every ring — natural and fused alike
 * (fusion sets max_uses = 3 + tier(combined XP)) — so this recompute is exact for
 * all rings, including any old-rule fused ring, with no special handling.
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
