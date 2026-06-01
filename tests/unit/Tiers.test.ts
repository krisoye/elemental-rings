import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { tierStartXp, tierForXp, naturalMaxUses } from '../../server/src/game/Tiers';

// ---------------------------------------------------------------------------
// Pure tier math (no DB). EPIC #173 C1.
// Thresholds: T0=0, T1=500, T2=1500, T3=3000, T4=5000, T5=7500.
// ---------------------------------------------------------------------------

describe('tierStartXp — triangular × 500', () => {
  test('matches the §4.2 threshold table', () => {
    expect(tierStartXp(0)).toBe(0);
    expect(tierStartXp(1)).toBe(500);
    expect(tierStartXp(2)).toBe(1500);
    expect(tierStartXp(3)).toBe(3000);
    expect(tierStartXp(4)).toBe(5000);
    expect(tierStartXp(5)).toBe(7500);
  });
});

describe('tierForXp — XP → tier', () => {
  const boundaries: Array<[number, number]> = [
    [0, 0],
    [500, 1],
    [1500, 2],
    [3000, 3],
    [5000, 4],
    [7500, 5],
  ];

  test('exactly on each boundary returns that tier', () => {
    for (const [xp, tier] of boundaries) {
      expect(tierForXp(xp)).toBe(tier);
    }
  });

  test('one XP below each boundary returns the lower tier (float-safe)', () => {
    expect(tierForXp(499)).toBe(0);
    expect(tierForXp(1499)).toBe(1);
    expect(tierForXp(2999)).toBe(2);
    expect(tierForXp(4999)).toBe(3);
    expect(tierForXp(7499)).toBe(4);
  });

  test('mid-range values land in the correct tier', () => {
    expect(tierForXp(1)).toBe(0);
    expect(tierForXp(750)).toBe(1);
    expect(tierForXp(2000)).toBe(2);
    expect(tierForXp(6000)).toBe(4);
    expect(tierForXp(10000)).toBe(5);
  });

  test('every tier start and one-below is consistent for n=0..20 (float robustness)', () => {
    for (let n = 0; n <= 20; n++) {
      const start = tierStartXp(n);
      expect(tierForXp(start)).toBe(n);
      if (start > 0) expect(tierForXp(start - 1)).toBe(n - 1);
    }
  });

  test('negative XP returns 0 (guard against NaN propagation)', () => {
    expect(tierForXp(-1)).toBe(0);
    expect(tierForXp(-100)).toBe(0);
    expect(tierForXp(-Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  test('multi-tier XP jump: exact thresholds and just-past are classified correctly', () => {
    // Jump that crosses T1 (500), T2 (1500), T3 (3000) simultaneously from 0.
    expect(tierForXp(3000)).toBe(3); // exactly at T3
    expect(tierForXp(3001)).toBe(3); // just past T3, still tier 3
    expect(tierForXp(5000)).toBe(4); // exactly at T4
  });
});

describe('naturalMaxUses — 3 + tier', () => {
  test('matches the §4.2 natural max-uses table', () => {
    expect(naturalMaxUses(0)).toBe(3);
    expect(naturalMaxUses(1)).toBe(4);
    expect(naturalMaxUses(2)).toBe(5);
    expect(naturalMaxUses(3)).toBe(6);
    expect(naturalMaxUses(4)).toBe(7);
    expect(naturalMaxUses(5)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// awardXP natural-crossing + boot migration. EPIC #173 C2/C8.
//
// db.ts is a process-wide singleton keyed off DB_PATH, so we set DB_PATH BEFORE
// the first import of any module that transitively imports db.ts, then
// dynamically import the repo (mirrors FusionCrafting.test.ts).
// ---------------------------------------------------------------------------

describe('awardXP — natural tier crossings (#173 C2)', () => {
  let repo: typeof import('../../server/src/persistence/PlayerRepo');
  let dbMod: typeof import('../../server/src/persistence/db');
  let db: import('better-sqlite3').Database;

  /** Insert a ring owned by playerId with the given tier/max_uses/xp. */
  function makeRing(
    playerId: string,
    element: number,
    tier: number,
    maxUses: number,
    xp: number,
  ): string {
    const id = `ring_${element}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, playerId, element, tier, maxUses, maxUses, xp);
    return id;
  }

  function makePlayer(): string {
    const id = `p_${Math.random().toString(36).slice(2)}`;
    db.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      id,
      `u_${id}`,
      'x',
    );
    return id;
  }

  function getRing(playerId: string, ringId: string) {
    return repo.getRingsByOwner(playerId).find((r) => r.id === ringId)!;
  }

  beforeAll(async () => {
    const dbFile = path.join(os.tmpdir(), `er-tiers-test-${process.pid}-${Date.now()}.db`);
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
    }
    process.env.DB_PATH = dbFile;
    repo = await import('../../server/src/persistence/PlayerRepo');
    dbMod = await import('../../server/src/persistence/db');
    db = dbMod.db;
  });

  test('sub-threshold award updates xp + tier but not max_uses', () => {
    const p = makePlayer();
    // Tier 0 ring at 400 XP; award 50 → 450, still tier 0.
    const r = makeRing(p, ElementEnum.FIRE, 0, 3, 400);
    repo.awardXP(r, 50);
    const ring = getRing(p, r);
    expect(ring.xp).toBe(450);
    expect(ring.tier).toBe(0);
    expect(ring.max_uses).toBe(3);
    expect(ring.current_uses).toBe(3); // grant never touches current_uses
  });

  test('crossing one threshold grants +1 max use and updates tier', () => {
    const p = makePlayer();
    // Tier 1 ring at 1499 XP; award 1 → 1500, crosses T1→T2.
    const r = makeRing(p, ElementEnum.WATER, 1, 4, 1499);
    repo.awardXP(r, 1);
    const ring = getRing(p, r);
    expect(ring.xp).toBe(1500);
    expect(ring.tier).toBe(2);
    expect(ring.max_uses).toBe(5); // 4 + 1 crossing
    expect(ring.current_uses).toBe(4); // unchanged by the crossing
  });

  test('crossing multiple thresholds grants +1 per tier crossed', () => {
    const p = makePlayer();
    // Tier 0 ring at 0 XP; award 3000 → tier 3, crosses T1, T2, T3 (+3).
    const r = makeRing(p, ElementEnum.WOOD, 0, 3, 0);
    repo.awardXP(r, 3000);
    const ring = getRing(p, r);
    expect(ring.xp).toBe(3000);
    expect(ring.tier).toBe(3);
    expect(ring.max_uses).toBe(6); // 3 + 3 crossings
  });

  test('non-positive award is a no-op', () => {
    const p = makePlayer();
    const r = makeRing(p, ElementEnum.FIRE, 1, 4, 600);
    repo.awardXP(r, 0);
    repo.awardXP(r, -100);
    const ring = getRing(p, r);
    expect(ring.xp).toBe(600);
    expect(ring.tier).toBe(1);
    expect(ring.max_uses).toBe(4);
  });

  test('a fused ring earning past its landing tier still collects the crossing bonus only for the new tier', () => {
    const p = makePlayer();
    // Fused ring: landed at Tier 2 (1500 XP) with explicit max_uses 4 (not natural 5).
    const r = makeRing(p, ElementEnum.STEAM, 2, 4, 1500);
    // Award 1500 → 3000, crosses T2→T3 once (+1). max_uses 4 → 5 (NOT reset to natural).
    repo.awardXP(r, 1500);
    const ring = getRing(p, r);
    expect(ring.tier).toBe(3);
    expect(ring.max_uses).toBe(5); // 4 + 1, preserves the lower fusion base
  });

  // -------------------------------------------------------------------------
  // #171 — XP-driven spare carry capacity (GDD §4.1). spare_slots = ceil(
  // log_2(aggregate_xp)) counting ONLY Reliquary (in_carry=0) rings.
  // These tests live inside this describe so they share the same DB singleton.
  // -------------------------------------------------------------------------

  test('fresh player with no Reliquary rings has spare capacity 0 and carry cap 5', () => {
    const p = makePlayer();
    expect(repo.getSpareCapacity(p)).toBe(0);
    expect(repo.getCarryCap(p)).toBe(5);
  });

  test('aggregate XP = 1 → spare capacity 0 (ceil(log2(1)) = 0, first sub-threshold value)', () => {
    // ceil(log_2(1)) = ceil(0) = 0. No spare slot until aggregate_xp = 2.
    const p = makePlayer();
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry)
       VALUES (?, ?, 0, 0, 3, 3, 1, 0)`,
    ).run(`ring_sp1_${Math.random().toString(36).slice(2)}`, p);
    expect(repo.getSpareCapacity(p)).toBe(0);
    expect(repo.getCarryCap(p)).toBe(5);
  });

  test('aggregate XP = 2 → spare capacity 1, carry cap 6 (ceil(log2(2)) = 1, first slot)', () => {
    // ceil(log_2(2)) = ceil(1) = 1 spare slot → cap = 5+1 = 6.
    const p = makePlayer();
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry)
       VALUES (?, ?, 0, 0, 3, 3, 2, 0)`,
    ).run(`ring_sp2_${Math.random().toString(36).slice(2)}`, p);
    expect(repo.getSpareCapacity(p)).toBe(1);
    expect(repo.getCarryCap(p)).toBe(6);
  });

  test('aggregate XP = 100 → spare capacity 7, carry cap 12 (log scaling)', () => {
    // ceil(log_2(100)) = ceil(6.644) = 7 spare slots → cap = 5+7 = 12.
    const p = makePlayer();
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry)
       VALUES (?, ?, 0, 0, 3, 3, 100, 0)`,
    ).run(`ring_sp100_${Math.random().toString(36).slice(2)}`, p);
    expect(repo.getSpareCapacity(p)).toBe(7);
    expect(repo.getCarryCap(p)).toBe(12);
  });

  test('carried rings (in_carry=1) do NOT count toward aggregate XP for spare capacity', () => {
    // Spec #171: aggregate_xp = SUM(xp) WHERE in_carry = 0 (Reliquary only).
    // A carried ring with 1000 XP must contribute nothing.
    const p = makePlayer();
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry)
       VALUES (?, ?, 0, 0, 3, 3, 1000, 1)`,
    ).run(`ring_spcarry_${Math.random().toString(36).slice(2)}`, p);
    expect(repo.getSpareCapacity(p)).toBe(0); // carried XP excluded
    expect(repo.getCarryCap(p)).toBe(5);
  });

  test('aggregate XP = 625 → spare capacity 10, carry cap 15 (high-XP flattening)', () => {
    // ceil(log_2(625)) = ceil(9.287) = 10. The log curve flattens vs the old linear
    // formula (which gave 6 slots at 625 XP).
    const p = makePlayer();
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry)
         VALUES (?, ?, 0, 0, 3, 3, 125, 0)`,
      ).run(`ring_sp625_${i}_${Math.random().toString(36).slice(2)}`, p);
    }
    expect(repo.getSpareCapacity(p)).toBe(10);
    expect(repo.getCarryCap(p)).toBe(15);
  });

  test('awardXP with amount=0 at the exact threshold boundary is a strict no-op', () => {
    // Adversarial: a ring at exactly 1499 XP (one below T2). Awarding 0 must leave
    // every column untouched — no tier upgrade, no max_uses change.
    const p = makePlayer();
    const r = makeRing(p, ElementEnum.WATER, 1, 4, 1499);
    repo.awardXP(r, 0);
    const ring = getRing(p, r);
    expect(ring.xp).toBe(1499); // XP unchanged
    expect(ring.tier).toBe(1);  // still Tier 1 — threshold NOT crossed
    expect(ring.max_uses).toBe(4);
  });

  test('awardXP crossing T0→T3 in one jump grants exactly +3 max uses', () => {
    // Spec C2: one +1 grant per natural tier crossed. A 0→3000 XP jump crosses
    // T1 (500), T2 (1500), T3 (3000) — exactly 3 crossings.
    const p = makePlayer();
    const r = makeRing(p, ElementEnum.FIRE, 0, 3, 0); // Tier 0, natural max_uses 3
    repo.awardXP(r, 3000);
    const ring = getRing(p, r);
    expect(ring.tier).toBe(3);
    expect(ring.max_uses).toBe(6); // 3 + 3 crossings = 6, matching naturalMaxUses(3)
    expect(ring.current_uses).toBe(3); // current_uses is never touched by awardXP
  });

  test('recomputeRingTiers recomputes tier/max_uses and is idempotent (#173 C8)', () => {
    const p = makePlayer();
    // Stale rows from the old model: wrong tier, fixed-5 max_uses.
    const lowXp = makeRing(p, ElementEnum.FIRE, 1, 5, 400); // → T0, max 3
    const midXp = makeRing(p, ElementEnum.WATER, 1, 5, 1500); // → T2, max 5
    const highXp = makeRing(p, ElementEnum.WOOD, 2, 5, 3000); // → T3, max 6

    dbMod.recomputeRingTiers();
    const after1 = repo.getRingsByOwner(p);
    const byId1 = new Map(after1.map((r) => [r.id, r]));
    expect(byId1.get(lowXp)!.tier).toBe(0);
    expect(byId1.get(lowXp)!.max_uses).toBe(3);
    expect(byId1.get(lowXp)!.current_uses).toBe(3); // clamped down from 5
    expect(byId1.get(midXp)!.tier).toBe(2);
    expect(byId1.get(midXp)!.max_uses).toBe(5);
    expect(byId1.get(highXp)!.tier).toBe(3);
    expect(byId1.get(highXp)!.max_uses).toBe(6);

    // Idempotent: a second run produces identical rows.
    dbMod.recomputeRingTiers();
    const after2 = repo.getRingsByOwner(p);
    expect(after2).toEqual(after1);
  });
});

