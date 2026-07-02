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
  // #520 adversarial: every ring is excluded (carried-only, heart-slot-only, AND
  // a ring with BOTH flags set) — the sum must be exactly 0, not just "small".
  // Distinct from `empty` (no rings at all): this proves the WHERE filter, not
  // just an empty table, drives the zero.
  onlyExcluded: [
    { tier: 9, maxUses: 12, inCarry: 1 }, // carried — excluded
    { tier: 9, maxUses: 12, heartSlot: 1 }, // heart slot — excluded
    { tier: 9, maxUses: 12, inCarry: 1, heartSlot: 1 }, // both flags — still excluded
  ],
  // #520 adversarial: far beyond the acceptance table's Tier-10 ceiling — proves
  // the uncapped linear scaling (no HEART_LOSS_CAP-style ceiling) and SQL/TS
  // integer-division parity hold at Tier-50 and Tier-100, not just near tier 0-9.
  veryHighTier: [
    { tier: 49, maxUses: 52 }, // Tier-50
    { tier: 99, maxUses: 102 }, // Tier-100
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

  // #520 adversarial: a Reliquary composed ENTIRELY of carried/heart-slot rings
  // (including one ring with BOTH flags set) must yield 0, not just "excludes
  // some rings" — proves the WHERE filter zeroes the sum, distinct from the
  // `empty` case which has no rings to filter at all.
  test('a Reliquary with only carried/heart-slot rings (including a dual-flagged ring) contributes 0', () => {
    const p = makePlayer('void');
    for (const r of COMPOSITIONS.onlyExcluded) makeRing(p, r);
    expect(repo.getSpiritStats(p).spiritMax).toBe(0);
  });

  // #520 adversarial: acceptance table tops out at Tier-10; nothing in the spec
  // bounds tier, so a stale/buggy cap could silently reappear at higher tiers
  // without any test catching it. Tier-50/Tier-100 exercise floor((tier1+2)/2)
  // and SQLite integer division well past the tested range.
  test('force scaling stays correct and uncapped at very high tiers (Tier-50, Tier-100)', () => {
    const p = makePlayer('void'); // ×1 isolates the raw per-ring math
    for (const r of COMPOSITIONS.veryHighTier) makeRing(p, r);
    // Tier-50: 52 × forceFromTier1(50)=26 = 1352. Tier-100: 102 × forceFromTier1(100)=51 = 5202.
    expect(repo.getSpiritStats(p).spiritMax).toBe(1352 + 5202);
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

// ===========================================================================
// Implementation-aware branches (#520 Phase 2 QA — visible only from the
// finished code, not derivable from the spec alone)
// ===========================================================================

describe('implementation-specific branches (#520 Phase 2)', () => {
  // #520 adversarial: the per-ring query's WHERE clause is `in_carry = 0 AND
  // heart_slot = 0` — an AND, not an OR. A ring with exactly one flag set is
  // excluded (already covered elsewhere), but this test nails down the full
  // 2x2 boundary in one place, including the "both flags set" cell, so a
  // future refactor to `OR` (which would under-exclude) or to checking only
  // one column (which would over-include) fails loudly here.
  test('the Reliquary filter requires BOTH in_carry=0 AND heart_slot=0 — every other flag combination is excluded', () => {
    const p = makePlayer('void'); // ×1 isolates the raw per-ring math
    makeRing(p, { tier: 9, maxUses: 12, inCarry: 1, heartSlot: 0 }); // in_carry alone excludes
    makeRing(p, { tier: 9, maxUses: 12, inCarry: 0, heartSlot: 1 }); // heart_slot alone excludes
    makeRing(p, { tier: 9, maxUses: 12, inCarry: 1, heartSlot: 1 }); // both set — still excluded
    makeRing(p, { tier: 9, maxUses: 12, inCarry: 0, heartSlot: 0 }); // neither set — the only counted ring

    expect(repo.getSpiritStats(p).spiritMax, 'TS path').toBe(72); // 12 × forceFromTier1(10) = 72
    dbMod.recomputeSpiritMax();
    expect(getPersistedSpiritMax(p), 'SQL boot-recompute path').toBe(72);
  });

  // #520 adversarial: DIFFICULTY_MULTIPLIERS is a Record<DifficultyTier, number>,
  // but the `players.difficulty` column is a raw TEXT column with no DB-level
  // CHECK constraint — a legacy/corrupted row could hold a value outside the
  // 5-member union. getSpiritStats() falls back via `?? DIFFICULTY_MULTIPLIERS
  // .seeker`; the SQL CASE falls back via its `ELSE 4`. Neither fallback is
  // exercised by the acceptance table (which only uses valid DifficultyTier
  // values), so this locks in that both encodings degrade the same way instead
  // of one throwing/NaN-ing while the other silently defaults.
  test('an unrecognized difficulty value falls back to the seeker (×4) multiplier in both encodings', () => {
    const p = makePlayer('seeker');
    dbInstance.prepare('UPDATE players SET difficulty = ? WHERE id = ?').run('legacy_unknown', p);
    makeRing(p, { tier: 0, maxUses: 3 }); // pre-multiplier contribution: 3 × forceFromTier1(1) = 3

    expect(repo.getSpiritStats(p).spiritMax, 'TS path falls back to seeker ×4').toBe(12);
    dbMod.recomputeSpiritMax();
    expect(getPersistedSpiritMax(p), 'SQL CASE ELSE falls back to seeker ×4').toBe(12);
  });

  // #520 adversarial: what if the boot-time recompute runs twice with no ring
  // changes in between (e.g. a process restart loop, or a future caller that
  // invokes it defensively)? recomputeSpiritMax() must be a pure function of
  // current DB state, not accumulate/drift on repeated invocation.
  test('calling recomputeSpiritMax() twice in a row with no ring changes is idempotent', () => {
    const p = makePlayer('seeker');
    for (const r of COMPOSITIONS.midTier) makeRing(p, r);

    dbMod.recomputeSpiritMax();
    const first = getPersistedSpiritMax(p);
    dbMod.recomputeSpiritMax();
    const second = getPersistedSpiritMax(p);

    expect(second).toBe(first);
    expect(second).toBe(384);
  });

  // #520 adversarial: recomputeSpiritMax() has a second statement
  // (`UPDATE players SET spirit_current = MIN(spirit_current, spirit_max)`)
  // that isn't in the acceptance criteria at all — it's only visible by reading
  // db.ts. A brand-new player row defaults to spirit_max=50/spirit_current=50
  // (schema.sql); once their real Reliquary composition drives spirit_max well
  // below 50, spirit_current must be clamped down too, or a player could carry
  // a spirit_current reading that exceeds their (now-authoritative) max.
  test('recomputeSpiritMax() clamps spirit_current down when the new spirit_max shrinks below the schema-default 50', () => {
    const p = makePlayer('void'); // fresh row: spirit_max=50, spirit_current=50 (schema.sql defaults)
    makeRing(p, { tier: 0, maxUses: 3 }); // new max = 3 × forceFromTier1(1) × 1 = 3, far below 50

    dbMod.recomputeSpiritMax();

    expect(getPersistedSpiritMax(p)).toBe(3);
    const row = dbInstance
      .prepare('SELECT spirit_current FROM players WHERE id = ?')
      .get(p) as { spirit_current: number };
    expect(row.spirit_current, 'spirit_current must be clamped down, not left at the stale 50').toBe(3);
  });
});

// ===========================================================================
// Boot-recompute ORDERING regression (#520 P2 fix)
// ===========================================================================
//
// db.ts calls recomputeRingTiers() then recomputeSpiritMax(), in that order
// (see the ORDERING comment above recomputeSpiritMax() in db.ts). Getting this
// backwards was exactly the P2 defect fixed in this issue's code review: if
// spirit_max were recomputed BEFORE a stale rings.tier column is corrected from
// xp, spirit_max would silently bake in the wrong tier until the next boot.
//
// IMPORTANT — this describe block MUST stay the LAST thing in this file.
// recomputeRingTiers() is table-wide (no player filter): it recomputes
// tier/max_uses for EVERY ring in the shared scratch DB from `xp`. makeRing()
// always inserts xp=0, so any ring created by an earlier test in this file
// (almost all of them use tier > 0 with xp=0, e.g. the Tier-10 fixtures above)
// would get its tier collapsed to 0 the moment recomputeRingTiers() runs. That
// is harmless for tests that already ran and asserted (their expectations are
// already checked), but would corrupt fixtures for any test placed AFTER this
// one. Vitest's default sequencer runs tests in file declaration order
// (server/vitest.config.ts sets no `sequence.shuffle` and `fileParallelism:
// false`), so "last in the file" is a safe, deterministic guarantee here — do
// not insert new tests below this block.
describe('recomputeSpiritMax() boot-recompute ordering (#520 P2 fix — must stay last in this file)', () => {
  // #520 adversarial (regresses the exact P2 defect): simulate a pre-correction
  // DB row — xp=0 (the true, current tier is 0) but the stored tier/max_uses
  // columns are stuck at stale Tier-10 values, exactly the drift
  // recomputeRingTiers() exists to repair. Calling recomputeSpiritMax() BEFORE
  // the tier correction reproduces the pre-fix bug (wrong, stale spirit_max);
  // calling it AFTER (the production order in db.ts) yields the corrected value.
  test('spirit_max reflects the corrected tier only when recomputeRingTiers() runs first — reversing the order reproduces the P2 bug', () => {
    const p = makePlayer('void'); // ×1 isolates the raw per-ring math
    // Stale fixture: xp=0 (correct tier=0) but tier/max_uses left at Tier-10.
    makeRing(p, { tier: 9, maxUses: 12 });

    // Wrong order (the pre-fix bug): spirit recompute runs against the stale
    // tier=9 column because no tier correction has happened yet.
    dbMod.recomputeSpiritMax();
    expect(getPersistedSpiritMax(p), 'wrong-order recompute reflects the stale Tier-10 data').toBe(
      72, // 12 × forceFromTier1(10) = 12 × 6
    );

    // Correct order (db.ts L208-212): tier correction THEN spirit recompute.
    dbMod.recomputeRingTiers();
    dbMod.recomputeSpiritMax();
    expect(
      getPersistedSpiritMax(p),
      'correct-order recompute reflects the corrected Tier-1 data (xp=0 → tier=0, max_uses=3)',
    ).toBe(
      3, // 3 × forceFromTier1(1) = 3 × 1
    );
  });
});
