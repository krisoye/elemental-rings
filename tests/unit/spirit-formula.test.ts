import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum, DIFFICULTY_MULTIPLIERS, type DifficultyTier } from '../../shared/types';
import { forceFromTier1 } from '../../shared/tiers';

// ---------------------------------------------------------------------------
// #520 (EPIC #511 Contract F) — spirit_max = SUM(max_uses × force) over the
// player's Reliquary rings (in_carry = 0, heart_slot = 0), × difficulty
// multiplier. Two independent formula encodings must agree, forever:
//   - PlayerRepo.getSpiritStats() — the TS path, imports forceFromTier1
//     directly from shared/tiers.ts (no re-derivation).
//   - db.ts recomputeSpiritMax() — the raw-SQL boot-time recompute, which
//     restates the same formula as `r.max_uses * ((r.tier + 3) / 2)` because
//     a raw db.exec() UPDATE cannot call into TypeScript.
// This file is the drift guard the issue mandates: it seeds a scratch DB, runs
// BOTH paths, and asserts they land on the exact same number for every
// DifficultyTier and for the issue's acceptance-criteria worked examples.
//
// Each test gets an isolated player in a shared throwaway DB (one beforeAll).
// DB_PATH must be set before the first import of db.ts (process-level
// singleton) — same pattern as RechargeAllReliquary.test.ts / Tiers.test.ts.
// ---------------------------------------------------------------------------

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbMod: typeof import('../../server/src/persistence/db');
let dbInstance: import('better-sqlite3').Database;

/** Create a bare player row + empty loadout at the given difficulty. */
function makePlayer(difficulty: DifficultyTier = 'seeker'): string {
  const id = `p_${Math.random().toString(36).slice(2)}`;
  dbInstance
    .prepare(
      `INSERT INTO players (id, username, password_hash, difficulty) VALUES (?, ?, ?, ?)`,
    )
    .run(id, `u_${id}`, 'x', difficulty);
  dbInstance
    .prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(id);
  return id;
}

interface RingSpec {
  /** The stored (0-indexed, tierForXp-derived) tier column value. */
  tier: number;
  maxUses: number;
  inCarry?: number;
  heartSlot?: number;
}

/** Insert a ring owned by playerId. tier/maxUses are the literal stored columns. */
function makeRing(playerId: string, spec: RingSpec): void {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  const { tier, maxUses, inCarry = 0, heartSlot = 0 } = spec;
  dbInstance
    .prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    )
    .run(id, playerId, ElementEnum.FIRE, tier, maxUses, maxUses, inCarry, heartSlot);
}

/** Read a player's persisted spirit_max column directly (post db.ts recompute). */
function getPersistedSpiritMax(playerId: string): number {
  const row = dbInstance.prepare(`SELECT spirit_max FROM players WHERE id = ?`).get(playerId) as
    | { spirit_max: number }
    | undefined;
  return row?.spirit_max ?? 0;
}

/**
 * Expected force-weighted spirit_max, computed independently of both
 * production paths (imports forceFromTier1 directly from shared/tiers, not
 * through PlayerRepo or db.ts) — a real cross-check, not a tautology against
 * the code under test.
 */
function expectedSpiritMax(rings: RingSpec[], difficulty: DifficultyTier): number {
  const usesSum = rings.reduce((sum, r) => sum + r.maxUses * forceFromTier1(r.tier + 1), 0);
  return usesSum * DIFFICULTY_MULTIPLIERS[difficulty];
}

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-spirit-formula-test-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  repo = await import('../../server/src/persistence/PlayerRepo');
  dbMod = await import('../../server/src/persistence/db');
  dbInstance = dbMod.db;
});

// Representative ring compositions, reused across the drift-guard sweep. Tier
// values are the stored (0-indexed) column; human "Tier N" = stored tier N-1.
const COMPOSITIONS: Record<string, RingSpec[]> = {
  empty: [],
  // GDD starter Reliquary: 5× Tier-1 (stored tier=0, max_uses=3 each).
  tier1Only: [
    { tier: 0, maxUses: 3 },
    { tier: 0, maxUses: 3 },
    { tier: 0, maxUses: 3 },
    { tier: 0, maxUses: 3 },
    { tier: 0, maxUses: 3 },
  ],
  // Acceptance table row 2: 3× Tier-4 + 2× Tier-5.
  midTier: [
    { tier: 3, maxUses: 6 }, // Tier-4
    { tier: 3, maxUses: 6 },
    { tier: 3, maxUses: 6 },
    { tier: 4, maxUses: 7 }, // Tier-5
    { tier: 4, maxUses: 7 },
  ],
  // Acceptance table row 3: 3× Tier-10 + 2× Tier-9.
  highTier: [
    { tier: 9, maxUses: 12 }, // Tier-10
    { tier: 9, maxUses: 12 },
    { tier: 9, maxUses: 12 },
    { tier: 8, maxUses: 11 }, // Tier-9
    { tier: 8, maxUses: 11 },
  ],
};

const ALL_DIFFICULTIES: DifficultyTier[] = ['wanderer', 'seeker', 'ascendant', 'ascetic', 'void'];

// ===========================================================================
// getSpiritStats — force-weighted formula correctness
// ===========================================================================

describe('getSpiritStats — force-weighted formula (#520, EPIC #511 Contract F)', () => {
  test('Tier-1-only Reliquary is unchanged: per-ring contribution stays max_uses × 1 (seeker ×4 → 60)', () => {
    const p = makePlayer('seeker');
    for (const r of COMPOSITIONS.tier1Only) makeRing(p, r);
    expect(repo.getSpiritStats(p).spiritMax).toBe(60);
  });

  test('a lone Tier-10 ring (max_uses=12) contributes 72 (was 12) — 6x, isolated via the void ×1 multiplier', () => {
    const p = makePlayer('void'); // ×1 multiplier isolates the per-ring contribution
    makeRing(p, { tier: 9, maxUses: 12 });
    expect(repo.getSpiritStats(p).spiritMax).toBe(72);
  });

  test('3× Tier-4 + 2× Tier-5 at seeker (×4): 128 (old formula) becomes 384 (new formula)', () => {
    const p = makePlayer('seeker');
    for (const r of COMPOSITIONS.midTier) makeRing(p, r);
    expect(repo.getSpiritStats(p).spiritMax).toBe(384);
    // Old-formula sanity check (not the code under test): SUM(max_uses) × 4.
    const oldSum = COMPOSITIONS.midTier.reduce((s, r) => s + r.maxUses, 0);
    expect(oldSum * DIFFICULTY_MULTIPLIERS.seeker).toBe(128);
  });

  test('3× Tier-10 + 2× Tier-9 at seeker (×4): 232 (old formula) becomes 1304 (new formula)', () => {
    const p = makePlayer('seeker');
    for (const r of COMPOSITIONS.highTier) makeRing(p, r);
    expect(repo.getSpiritStats(p).spiritMax).toBe(1304);
    const oldSum = COMPOSITIONS.highTier.reduce((s, r) => s + r.maxUses, 0);
    expect(oldSum * DIFFICULTY_MULTIPLIERS.seeker).toBe(232);
  });

  test('an empty Reliquary yields spirit_max = 0 — no floor, no starting grant', () => {
    const p = makePlayer('seeker');
    expect(repo.getSpiritStats(p).spiritMax).toBe(0);
  });

  test('carried and heart-slot rings are excluded from the sum', () => {
    const p = makePlayer('void');
    makeRing(p, { tier: 9, maxUses: 12, inCarry: 1 }); // carried — excluded
    makeRing(p, { tier: 9, maxUses: 12, heartSlot: 1 }); // heart slot — excluded
    makeRing(p, { tier: 0, maxUses: 3 }); // Reliquary — counted
    expect(repo.getSpiritStats(p).spiritMax).toBe(3);
  });

  test('no clamp/cap — a large high-tier Reliquary scales linearly, unbounded (no HEART_LOSS_CAP-style ceiling)', () => {
    const p = makePlayer('void'); // ×1 multiplier isolates the raw sum
    const many: RingSpec[] = Array.from({ length: 20 }, () => ({ tier: 9, maxUses: 12 }));
    for (const r of many) makeRing(p, r);
    // 20 × 72 = 1440, far above any old-formula ceiling (20 × 12 = 240) —
    // asserts the inflation is intentional and nothing silently clamps it.
    expect(repo.getSpiritStats(p).spiritMax).toBe(1440);
  });
});

// ===========================================================================
// db.ts recomputeSpiritMax() vs PlayerRepo.getSpiritStats() — drift guard
// ===========================================================================

describe('db.ts recomputeSpiritMax() vs PlayerRepo.getSpiritStats() — drift guard (#520)', () => {
  test.each(ALL_DIFFICULTIES)(
    'the SQL boot-recompute and the TS path agree exactly for every representative composition at difficulty=%s',
    (difficulty) => {
      for (const [name, rings] of Object.entries(COMPOSITIONS)) {
        const p = makePlayer(difficulty);
        for (const r of rings) makeRing(p, r);

        const tsValue = repo.getSpiritStats(p).spiritMax;
        expect(tsValue, `TS path (${name}, ${difficulty})`).toBe(expectedSpiritMax(rings, difficulty));

        dbMod.recomputeSpiritMax();
        const sqlValue = getPersistedSpiritMax(p);
        expect(sqlValue, `SQL boot-recompute path (${name}, ${difficulty})`).toBe(tsValue);
      }
    },
  );

  test('the three acceptance-criteria worked examples agree between both encodings at seeker (×4)', () => {
    const p1 = makePlayer('seeker');
    for (const r of COMPOSITIONS.tier1Only) makeRing(p1, r);
    const p2 = makePlayer('seeker');
    for (const r of COMPOSITIONS.midTier) makeRing(p2, r);
    const p3 = makePlayer('seeker');
    for (const r of COMPOSITIONS.highTier) makeRing(p3, r);

    dbMod.recomputeSpiritMax();

    expect(getPersistedSpiritMax(p1)).toBe(repo.getSpiritStats(p1).spiritMax);
    expect(getPersistedSpiritMax(p1)).toBe(60);

    expect(getPersistedSpiritMax(p2)).toBe(repo.getSpiritStats(p2).spiritMax);
    expect(getPersistedSpiritMax(p2)).toBe(384);

    expect(getPersistedSpiritMax(p3)).toBe(repo.getSpiritStats(p3).spiritMax);
    expect(getPersistedSpiritMax(p3)).toBe(1304);
  });
});
