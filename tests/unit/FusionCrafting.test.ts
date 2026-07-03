import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { fusionOf, isFusion } from '../../server/src/game/Fusions';
import { isFusionEligibleParent, MIN_FUSION_PARENT_XP } from '../../shared/fusions';
import { tierForXp, tierStartXp, naturalMaxUses } from '../../server/src/game/Tiers';

const { FIRE, WATER, EARTH, WIND, WOOD, STEAM, DUST, MAGMA } = ElementEnum;

// ---------------------------------------------------------------------------
// fusionOf — pure recipe lookup (no DB)
// ---------------------------------------------------------------------------

describe('fusionOf — element pair → fusion element', () => {
  test('FIRE + WATER → STEAM', () => {
    expect(fusionOf(FIRE, WATER)).toBe(STEAM);
  });

  test('WATER + FIRE → STEAM (order-independent)', () => {
    expect(fusionOf(WATER, FIRE)).toBe(STEAM);
  });

  test('FIRE + FIRE → null (same element)', () => {
    expect(fusionOf(FIRE, FIRE)).toBeNull();
  });

  test('WIND + EARTH → DUST', () => {
    expect(fusionOf(WIND, EARTH)).toBe(DUST);
  });

  test('FIRE + EARTH → MAGMA', () => {
    expect(fusionOf(FIRE, EARTH)).toBe(MAGMA);
  });

  test('all 10 distinct base pairs return a non-null fusion', () => {
    const bases = [FIRE, WATER, EARTH, WIND, WOOD];
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        pairs.push([bases[i], bases[j]]);
      }
    }
    expect(pairs).toHaveLength(10);
    for (const [a, b] of pairs) {
      const result = fusionOf(a, b);
      expect(result).not.toBeNull();
      // Result must be one of the 10 fusion indices (5-14).
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThanOrEqual(14);
      // And order-independent.
      expect(fusionOf(b, a)).toBe(result);
    }
  });
});

// ---------------------------------------------------------------------------
// fuseRings — DB transaction. Each test gets a throwaway SQLite file. db.ts is a
// process-wide singleton keyed off DB_PATH, so we set the env BEFORE the first
// import of any module that transitively imports db.ts, then dynamically import
// the repo. better-sqlite3 is synchronous; the schema is applied on import.
//
// Fusion rules (GDD §4.6, #390): each parent must independently reach Tier 1
// (≥ 500 XP) — the parents need NOT share a tier — and neither parent may itself
// be a fusion. XP is additive, fused tier = tierForXp(sum), and fused max_uses =
// naturalMaxUses(fusedTier) = 3 + fusedTier — the same pure-XP rule every natural
// ring obeys (no min(parents)−1 penalty). Tier is derived from XP, so tests seed
// XP at/above the relevant tierStartXp threshold rather than the old hard caps.
// ---------------------------------------------------------------------------

// XP that lands a ring squarely in a given tier (start XP of that tier; §4.2).
const T2_XP = tierStartXp(2); // 1500 — Tier 2 start
const T1_XP = tierStartXp(1); // 500  — Tier 1 start
const T3_XP = tierStartXp(3); // 3000 — Tier 3 start

describe('fuseRings — DB transaction (§4.6)', () => {
  // Loaded after DB_PATH is set, in beforeAll.
  let repo: typeof import('../../server/src/persistence/PlayerRepo');

  /** Insert a ring owned by playerId with the given element/xp/max_uses. */
  function makeRing(
    db: import('better-sqlite3').Database,
    playerId: string,
    element: number,
    xp: number,
    maxUses = 5,
  ): string {
    const id = `ring_${element}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, playerId, element, tierForXp(xp), maxUses, maxUses, xp);
    return id;
  }

  /** Create a bare player row (no starter rings) and return its id. */
  function makePlayer(db: import('better-sqlite3').Database): string {
    const id = `p_${Math.random().toString(36).slice(2)}`;
    db.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      id,
      `u_${id}`,
      'x',
    );
    db.prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    ).run(id);
    return id;
  }

  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `er-fusion-test-${process.pid}-${Date.now()}.db`,
    );
    // Clean any stale file so the schema (IF NOT EXISTS) starts fresh.
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
    }
    process.env.DB_PATH = dbFile;
    repo = await import('../../server/src/persistence/PlayerRepo');
    db = (await import('../../server/src/persistence/db')).db;
  });

  test('same-tier (Tier 2) parents → fused xp=sum, tier=tierForXp(sum), max_uses=3+tier', () => {
    const p = makePlayer(db);
    // Both Tier 2 (1500 XP each). Combined 3000 → Tier 3 → 3 + 3 = 6 uses.
    // Parent max_uses (5, 4) are irrelevant now: max_uses is a pure function of XP.
    const fire = makeRing(db, p, FIRE, T2_XP, 5);
    const water = makeRing(db, p, WATER, T2_XP, 4);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(T2_XP * 2); // 3000
    expect(result!.tier).toBe(tierForXp(T2_XP * 2)); // 3000 → Tier 3
    expect(result!.max_uses).toBe(naturalMaxUses(tierForXp(T2_XP * 2))); // 3 + 3 = 6
    expect(result!.max_uses).toBe(6);
    expect(result!.current_uses).toBe(result!.max_uses);
    // Universal invariant: max_uses == 3 + tierForXp(xp) for the fused result.
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('equal-XP min-tier case: 500 (T1) + 500 (T1) → T1 → 4 uses', () => {
    const p = makePlayer(db);
    // 500 + 500 = 1000, still within Tier 1 → 3 + 1 = 4 uses (old min−1 gave 3).
    const fire = makeRing(db, p, FIRE, T1_XP, 4);
    const water = makeRing(db, p, WATER, T1_XP, 4);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.xp).toBe(1000);
    expect(result!.tier).toBe(1);
    expect(result!.max_uses).toBe(4); // 3 + 1
    expect(result!.current_uses).toBe(4);
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('tier-bump case: 1400 (T1) + 1400 (T1) → T2 → 5 uses', () => {
    const p = makePlayer(db);
    // Both Tier 1 (1400 < 1500). Combined 2800 crosses into Tier 2 → 3 + 2 = 5 uses.
    // Result (5) exceeds either parent's 4 uses — intended: combined XP banked.
    expect(tierForXp(1400)).toBe(1);
    expect(tierForXp(2800)).toBe(2);
    const fire = makeRing(db, p, FIRE, 1400, 4);
    const water = makeRing(db, p, WATER, 1400, 4);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.xp).toBe(2800);
    expect(result!.tier).toBe(2);
    expect(result!.max_uses).toBe(5); // 3 + 2
    expect(result!.current_uses).toBe(5);
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('different-tier pair (Tier 2 + Tier 3) fuses (same-tier requirement dropped, #390)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP); // Tier 2 (1500 XP)
    const water = makeRing(db, p, WATER, T3_XP); // Tier 3 (3000 XP)

    // #390 — both parents clear the Tier-1 floor, so the differing tiers no longer
    // block fusion. Combined 4500 → Tier 3 → 3 + 3 = 6 uses.
    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(T2_XP + T3_XP); // 4500
    expect(result!.tier).toBe(tierForXp(T2_XP + T3_XP)); // 4500 → Tier 3
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
    // Only the fusion ring remains; both parents consumed.
    expect(repo.getRingsByOwner(p)).toHaveLength(1);
  });

  test('same-tier Tier 1 pair → fusion succeeds (Tier 1 is the new minimum)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T1_XP); // Tier 1 (500 XP)
    const water = makeRing(db, p, WATER, T1_XP); // Tier 1 (500 XP)

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(T1_XP * 2); // 1000
    expect(result!.tier).toBe(tierForXp(T1_XP * 2)); // 1000 → Tier 1
  });

  test('same-tier Tier 0 pair throws (below the 500 XP minimum)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 100); // Tier 0
    const water = makeRing(db, p, WATER, 100); // Tier 0

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/Tier 1/);
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r.tier === 0)).toBe(true);
  });

  test('asymmetric sub-500: one Tier 0 + one Tier 1 parent throws (#390 per-parent gate)', () => {
    const p = makePlayer(db);
    // Only ONE parent is below the 500-XP floor. The per-parent `||` gate must
    // still reject — a regression to `&&` (both must be sub-500) would let this
    // through, so this asymmetric case is the one that pins the `||`.
    const fire = makeRing(db, p, FIRE, 200); // Tier 0 — below the floor
    const water = makeRing(db, p, WATER, 600); // Tier 1 — clears the floor

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/Tier 1/);
    // Both parents intact; no fusion created.
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(2);
  });

  test('same-tier Tier 3 parents → fusion succeeds', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T3_XP, 6); // Tier 3
    const water = makeRing(db, p, WATER, T3_XP, 6); // Tier 3

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(T3_XP * 2); // 6000
    expect(result!.tier).toBe(tierForXp(T3_XP * 2)); // 6000 → Tier 4
    expect(result!.max_uses).toBe(7); // 3 + 4
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('parent max_uses is irrelevant: a 1-use parent does not lower the fused uses', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP, 1); // weak parent: 1 use — no longer matters
    const water = makeRing(db, p, WATER, T2_XP, 5);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    // max_uses is a pure function of XP: 3000 → Tier 3 → 3 + 3 = 6 (parent uses ignored).
    expect(result!.max_uses).toBe(6);
    expect(result!.current_uses).toBe(6);
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('ring not owned by the player throws', () => {
    const p1 = makePlayer(db);
    const p2 = makePlayer(db);
    const fire = makeRing(db, p1, FIRE, T2_XP);
    const water = makeRing(db, p2, WATER, T2_XP); // owned by p2

    expect(() => repo.fuseRings(p1, fire, water)).toThrow(/not found or not owned/);
  });

  test('fusing a ring with itself throws', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP);

    expect(() => repo.fuseRings(p, fire, fire)).toThrow(/with itself/);
  });

  test('same element parents (same tier) throw (no valid fusion)', () => {
    const p = makePlayer(db);
    const fire1 = makeRing(db, p, FIRE, T2_XP);
    const fire2 = makeRing(db, p, FIRE, T2_XP);

    expect(() => repo.fuseRings(p, fire1, fire2)).toThrow(/do not form a valid fusion/);
  });

  test('a parent that is itself a fusion throws a distinct "already a fusion" message (#390)', () => {
    const p = makePlayer(db);
    // STEAM is a fusion element (Fire+Water). Even though STEAM + WOOD is not a
    // valid base pair, the isFusion gate fires FIRST — so the rejection is the
    // distinct "already a fusion" message, not the generic invalid-pair one.
    const steam = makeRing(db, p, STEAM, T2_XP);
    const wood = makeRing(db, p, WOOD, T2_XP);

    expect(() => repo.fuseRings(p, steam, wood)).toThrow(/already a fusion/);
    // No fusion created; both parents intact.
    expect(repo.getRingsByOwner(p)).toHaveLength(2);
  });

  test('parents are consumed (deleted) from the DB after fusion', () => {
    const p = makePlayer(db);
    const wind = makeRing(db, p, WIND, T2_XP);
    const earth = makeRing(db, p, EARTH, T2_XP);

    const newId = repo.fuseRings(p, wind, earth);
    const rings = repo.getRingsByOwner(p);

    expect(rings).toHaveLength(1); // only the fusion ring remains
    expect(rings[0].id).toBe(newId);
    expect(rings[0].element).toBe(DUST);
    expect(rings.find((r) => r.id === wind)).toBeUndefined();
    expect(rings.find((r) => r.id === earth)).toBeUndefined();
  });

  test('max_uses = 3 + tier(combined XP) regardless of parent max_uses (4 and 6)', () => {
    // #339: max_uses is a pure function of XP, not min(parents)−1. The parent
    // max_uses values (4, 6) must not affect the result. 3000 → Tier 3 → 6 uses.
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP, 4);
    const water = makeRing(db, p, WATER, T2_XP, 6);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.max_uses).toBe(naturalMaxUses(tierForXp(T2_XP * 2))); // 3 + 3 = 6
    expect(result!.max_uses).toBe(6);
    expect(result!.current_uses).toBe(6);
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('parent assigned to a loadout slot → slot nulled, fusion proceeds', () => {
    const p = makePlayer(db);
    const wood = makeRing(db, p, WOOD, T2_XP);
    const earth = makeRing(db, p, EARTH, T2_XP);

    // Put one parent into the A1 slot.
    repo.saveLoadout(p, { a1: wood });
    expect(repo.getLoadout(p)!.a1).toBe(wood);

    const newId = repo.fuseRings(p, wood, earth);

    // Slot nulled, parents deleted, fusion ring present (Wood+Earth → BLOOM).
    expect(repo.getLoadout(p)!.a1).toBeNull();
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(1);
    expect(rings[0].id).toBe(newId);
    expect(rings[0].element).toBe(ElementEnum.BLOOM);
  });

  // ── in_carry inheritance (bug fix: child mirrors parent1, not DEFAULT 0) ─────
  // Regression guard for the pre-existing insertFusionRing bug: the shared INSERT
  // never set in_carry, so every fused ring silently took the schema DEFAULT (0)
  // and landed resting in the Reliquary regardless of where its parents were. The
  // fix mirrors parent1's in_carry. These cases pin all four (r1, r2) combinations
  // so a regression to the DEFAULT (or to mirroring parent2) is caught.

  /** Fuse FIRE+WATER with the parents' in_carry set to the given flags. */
  function fuseWithCarry(carry1: number, carry2: number): number {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP);
    const water = makeRing(db, p, WATER, T2_XP);
    db.prepare('UPDATE rings SET in_carry = ? WHERE id = ?').run(carry1, fire);
    db.prepare('UPDATE rings SET in_carry = ? WHERE id = ?').run(carry2, water);
    const newId = repo.fuseRings(p, fire, water);
    return repo.getRingsByOwner(p).find((r) => r.id === newId)!.in_carry;
  }

  test('both parents carried (1,1) → fused ring carried (in_carry=1)', () => {
    expect(fuseWithCarry(1, 1)).toBe(1);
  });

  test('both parents resting (0,0) → fused ring rests (in_carry=0)', () => {
    expect(fuseWithCarry(0, 0)).toBe(0);
  });

  test('mixed (parent1 carried, parent2 resting) → mirrors parent1 (in_carry=1)', () => {
    // The load-bearing case: proves the child mirrors parent1, not parent2.
    expect(fuseWithCarry(1, 0)).toBe(1);
  });

  test('mixed the other way (parent1 resting, parent2 carried) → mirrors parent1 (in_carry=0)', () => {
    // Complement: a bug mirroring parent2 (or ORing the two flags) would yield 1 here.
    expect(fuseWithCarry(0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — Spec-driven adversarial tests (#390)
// ---------------------------------------------------------------------------

describe('MIN_FUSION_PARENT_XP constant — spec conformance (#390)', () => {
  // #390 adversarial: constant drift is silent — a refactor moving the value to 499
  // or 501 would change game balance without any type error; pin it explicitly.
  test('MIN_FUSION_PARENT_XP equals 500 (locks the per-parent XP floor)', () => {
    expect(MIN_FUSION_PARENT_XP).toBe(500);
  });

  // #390 adversarial: the constant must match the Tier-1 threshold so the "≥ Tier 1"
  // prose and the numeric constant never diverge silently.
  test('MIN_FUSION_PARENT_XP equals tierStartXp(1) — floor is exactly Tier-1 start', () => {
    expect(MIN_FUSION_PARENT_XP).toBe(tierStartXp(1));
  });
});

describe('isFusionEligibleParent — unit (shared/fusions.ts, #390)', () => {
  // #390 adversarial: 499 XP is one below the floor; previously the tier check ran
  // across both parents together so a near-miss on one could slip through.
  test('returns false at exactly 499 XP for a base element (one below the floor)', () => {
    expect(isFusionEligibleParent(FIRE, 499)).toBe(false);
  });

  // #390 adversarial: exactly-on-boundary must accept — an off-by-one (> vs >=)
  // would silently lock out freshly-minted Tier-1 rings.
  test('returns true at exactly 500 XP for a base element (exactly the floor)', () => {
    expect(isFusionEligibleParent(FIRE, 500)).toBe(true);
  });

  // #390 Phase 2 adversarial: a fusion element (STEAM) at very high XP must always
  // be ineligible — isFusionEligibleParent must gate on !isFusion regardless of XP.
  test('returns false for a fusion element even at XP=10000 (re-fusing is always blocked)', () => {
    expect(isFusionEligibleParent(STEAM, 10000)).toBe(false);
  });

  // #390 adversarial: all 10 fusion elements must be ineligible at any XP to ensure
  // the isFusion branch covers every compound element, not just STEAM.
  test('returns false for every fusion element at XP=5000 (exhaustive fusion-element check)', () => {
    const fusionElements = [
      ElementEnum.STEAM, ElementEnum.WILDFIRE, ElementEnum.INFERNO, ElementEnum.MAGMA,
      ElementEnum.TIDAL, ElementEnum.STORM, ElementEnum.MUD, ElementEnum.THORNADO,
      ElementEnum.BLOOM, ElementEnum.DUST,
    ];
    for (const el of fusionElements) {
      expect(isFusionEligibleParent(el, 5000)).toBe(false);
    }
  });

  // #390 adversarial: all 5 base elements must be eligible at exactly the floor so
  // the predicate doesn't accidentally hard-code only FIRE or WATER.
  test('returns true for every base element at exactly 500 XP', () => {
    for (const el of [FIRE, WATER, EARTH, WIND, WOOD]) {
      expect(isFusionEligibleParent(el, 500)).toBe(true);
    }
  });
});

describe('fuseRings — adversarial boundary and guard-order tests (#390)', () => {
  let repo: typeof import('../../server/src/persistence/PlayerRepo');

  function makeRing(
    db: import('better-sqlite3').Database,
    playerId: string,
    element: number,
    xp: number,
    maxUses = 5,
  ): string {
    const id = `ring_${element}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, playerId, element, tierForXp(xp), maxUses, maxUses, xp);
    return id;
  }

  function makePlayer(db: import('better-sqlite3').Database): string {
    const id = `p_${Math.random().toString(36).slice(2)}`;
    db.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      id, `u_${id}`, 'x',
    );
    db.prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    ).run(id);
    return id;
  }

  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    // Use a separate DB file so these adversarial tests are isolated from the
    // main fuseRings suite above (which already owns its singleton DB_PATH).
    // We share the same process so DB_PATH is already set; fetch the singleton.
    repo = await import('../../server/src/persistence/PlayerRepo');
    db = (await import('../../server/src/persistence/db')).db;
  });

  // --- XP boundary tests ---

  // #390 adversarial: exactly 499 XP is one below the Tier-1 floor; the per-parent
  // gate must reject even when the partner clears the floor (asymmetric case).
  test('parent at exactly 499 XP is rejected — one below the floor', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 499);  // 499 — one below T1
    const water = makeRing(db, p, WATER, 600); // 600 — clears T1

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/Tier 1/);
    expect(repo.getRingsByOwner(p)).toHaveLength(2); // both parents intact
  });

  // #390 adversarial: exactly 500 XP must be accepted — an off-by-one (> instead of
  // >=) would silently lock out the minimum-viable ring; regression would be invisible
  // until a player complains.
  test('parent at exactly 500 XP is accepted — exactly the floor', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 500);  // exactly T1
    const water = makeRing(db, p, WATER, 500); // exactly T1

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(1000); // 500 + 500 — no rounding, no cap
  });

  // #390 adversarial: child XP must be the exact arithmetic sum of both parent XP
  // values — no rounding, no clamping, no floating-point drift. A subtle bug that
  // truncates or rounds the sum would quietly destroy XP for players.
  test('child xp === r1.xp + r2.xp exactly — no rounding, no cap', () => {
    const p = makePlayer(db);
    // Use deliberately asymmetric, non-round XP values to catch rounding bugs.
    const r1Xp = 613;
    const r2Xp = 2887;
    const fire = makeRing(db, p, FIRE, r1Xp);
    const water = makeRing(db, p, WATER, r2Xp);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.xp).toBe(r1Xp + r2Xp); // 3500 — must be exact
  });

  // --- Guard-order tests ---

  // #390 Phase 2 adversarial: guard order is (1) ownership, (2) isFusion, (3) xp≥500,
  // (4) fusionOf. A sub-500-XP fusion-element ring is BOTH a fusion AND below the
  // floor — but the isFusion guard must fire first, yielding "already a fusion", NOT
  // the Tier-1 message. Swapping guards 2 and 3 would flip the message.
  test('sub-500 fusion-element ring throws "already a fusion", not the Tier-1 message (guard order #390)', () => {
    const p = makePlayer(db);
    // STEAM at 200 XP — fails BOTH the isFusion gate AND the xp≥500 gate.
    // The isFusion gate is listed first in fuseRings, so it must fire first.
    const steam = makeRing(db, p, STEAM, 200); // fusion element + below floor
    const fire = makeRing(db, p, FIRE, 600);   // clean base element above floor

    // Must throw the "already a fusion" message, not /Tier 1/.
    expect(() => repo.fuseRings(p, steam, fire)).toThrow(/already a fusion/);
    expect(() => repo.fuseRings(p, steam, fire)).not.toThrow(/Tier 1/);
  });

  // #390 adversarial: the isFusion check must also fire when it is the SECOND ring
  // that is a fusion (isFusion covers r2 too — the `||` operator must not be `&&`).
  test('second ring being a fusion also triggers the "already a fusion" guard', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 600);   // clean
    const magma = makeRing(db, p, MAGMA, 600); // fusion element as r2

    expect(() => repo.fuseRings(p, fire, magma)).toThrow(/already a fusion/);
  });

  // --- Commutativity test ---

  // #390 adversarial: argument order must not gate-crash on the valid asymmetric
  // case. fuseRings(r1, r2) and fuseRings(r2, r1) must both succeed — a guard that
  // only inspects r1 for the XP floor would silently reject the reversed order.
  test('combine(r1, r2) and combine(r2, r1) both succeed for an asymmetric valid pair', () => {
    const p1 = makePlayer(db);
    const fire1 = makeRing(db, p1, FIRE, 600);   // T1 (low)
    const water1 = makeRing(db, p1, WATER, 3200); // T3 (high)
    const newId1 = repo.fuseRings(p1, fire1, water1); // low, high
    const result1 = repo.getRingsByOwner(p1).find((r) => r.id === newId1);
    expect(result1).toBeDefined();
    expect(result1!.element).toBe(STEAM);

    const p2 = makePlayer(db);
    const water2 = makeRing(db, p2, WATER, 3200); // high first
    const fire2 = makeRing(db, p2, FIRE, 600);    // low second
    const newId2 = repo.fuseRings(p2, water2, fire2); // high, low (reversed)
    const result2 = repo.getRingsByOwner(p2).find((r) => r.id === newId2);
    expect(result2).toBeDefined();
    expect(result2!.element).toBe(STEAM);

    // Both fusions must produce the same child XP regardless of argument order.
    expect(result1!.xp).toBe(result2!.xp);
  });
});

// ---------------------------------------------------------------------------
// mergeRings — DB transaction (#431, GDD §4.7)
//
// Each test shares the singleton DB set up by the fuseRings adversarial suite
// above. mergeRings is the sibling transaction to fuseRings but allows same-
// element parents (including fusion elements) and enforces a shrine-based
// caller-side gate (not DB-side); the transaction itself only validates the
// ring state.
// ---------------------------------------------------------------------------

describe('mergeRings — DB transaction (§4.7, #431)', () => {
  let repo: typeof import('../../server/src/persistence/PlayerRepo');

  function makeRing(
    db: import('better-sqlite3').Database,
    playerId: string,
    element: number,
    xp: number,
    maxUses = 5,
    escrowed = 0,
  ): string {
    const id = `mr_${element}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, escrowed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, playerId, element, tierForXp(xp), maxUses, maxUses, xp, escrowed);
    return id;
  }

  function makePlayer(db: import('better-sqlite3').Database): string {
    const id = `mp_${Math.random().toString(36).slice(2)}`;
    db.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      id, `u_${id}`, 'x',
    );
    db.prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    ).run(id);
    return id;
  }

  let db: import('better-sqlite3').Database;

  beforeAll(async () => {
    // Reuse the singleton DB already initialised by the fuseRings suite above.
    repo = await import('../../server/src/persistence/PlayerRepo');
    db = (await import('../../server/src/persistence/db')).db;
  });

  // ── Happy-path ─────────────────────────────────────────────────────────────

  test('two Tier-1 Earth rings merge: xp=sum, tier=tierForXp(sum), max_uses=3+tier, current_uses=max_uses', () => {
    // #431 adversarial: all four result fields derived from XP — verifies no residual
    // parent-uses inheritance from fuseRings code path.
    const p = makePlayer(db);
    const e1 = makeRing(db, p, EARTH, T1_XP);
    const e2 = makeRing(db, p, EARTH, T1_XP);

    const newId = repo.mergeRings(p, e1, e2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(EARTH);
    expect(result!.xp).toBe(T1_XP * 2);
    expect(result!.tier).toBe(tierForXp(T1_XP * 2));
    expect(result!.max_uses).toBe(naturalMaxUses(tierForXp(T1_XP * 2)));
    expect(result!.current_uses).toBe(result!.max_uses);
    // Universal invariant — matches spec §4.7 exactly.
    expect(result!.max_uses).toBe(3 + tierForXp(result!.xp));
  });

  test('both parents consumed after successful merge', () => {
    // #431 adversarial: irreversible DB deletion — verifies the deleteRingOwned loop
    // fires for BOTH parents, not just one.
    const p = makePlayer(db);
    const w1 = makeRing(db, p, WIND, T1_XP);
    const w2 = makeRing(db, p, WIND, T1_XP);

    repo.mergeRings(p, w1, w2);
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(1);
    expect(rings.find((r) => r.id === w1)).toBeUndefined();
    expect(rings.find((r) => r.id === w2)).toBeUndefined();
  });

  test('element = same as both parents (not derived from fusionOf)', () => {
    // #431 adversarial: merge must preserve the parent element, not look up a fusion
    // recipe. A copy-paste from fuseRings that calls fusionOf would produce DUST for
    // WIND+WIND rather than WIND.
    const p = makePlayer(db);
    const w1 = makeRing(db, p, WIND, T1_XP);
    const w2 = makeRing(db, p, WIND, T1_XP);

    const newId = repo.mergeRings(p, w1, w2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.element).toBe(WIND); // must be WIND, not DUST
  });

  test('Steam + Steam (fusion elements) merge succeeds: element=Steam after merge', () => {
    // #431 adversarial: fusion-depth rule — merge does NOT increase fusion depth.
    // A guard copy-pasted from fuseRings that rejects isFusion elements would block
    // this valid case.
    const p = makePlayer(db);
    const s1 = makeRing(db, p, STEAM, T1_XP);
    const s2 = makeRing(db, p, STEAM, T1_XP);

    const newId = repo.mergeRings(p, s1, s2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.element).toBe(STEAM);
  });

  // ── XP boundary ────────────────────────────────────────────────────────────

  test('parent at exactly 499 XP (sub-Tier-1, floor removed) → merge succeeds', () => {
    // #540: the Tier-1 floor was removed — a 499-XP parent (formerly rejected)
    // now merges like any other same-element pair.
    const p = makePlayer(db);
    const f1 = makeRing(db, p, FIRE, 499);
    const f2 = makeRing(db, p, FIRE, 600);

    const newId = repo.mergeRings(p, f1, f2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result).toBeDefined();
    expect(result!.xp).toBe(499 + 600);
  });

  test('parent at exactly 500 XP → merge succeeds', () => {
    // Ordinary same-element merge at the former (now-irrelevant) Tier-1 value.
    const p = makePlayer(db);
    const f1 = makeRing(db, p, FIRE, 500);
    const f2 = makeRing(db, p, FIRE, 500);

    const newId = repo.mergeRings(p, f1, f2);
    expect(repo.getRingsByOwner(p).find((r) => r.id === newId)).toBeDefined();
  });

  test('two 0-XP parents → merge succeeds: xp=0, tier=0, max_uses=3 (naturalMaxUses(0))', () => {
    // #540: merge has no XP floor — two 0-XP rings collapse into one 0-XP ring.
    // This is a net capacity loss (3+3 combined uses down to 3), not an exploit,
    // since merge only sums XP with no multiplier.
    const p = makePlayer(db);
    const e1 = makeRing(db, p, EARTH, 0);
    const e2 = makeRing(db, p, EARTH, 0);

    const newId = repo.mergeRings(p, e1, e2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result).toBeDefined();
    expect(result!.xp).toBe(0);
    expect(result!.tier).toBe(0);
    expect(result!.max_uses).toBe(naturalMaxUses(0));
    expect(result!.max_uses).toBe(3);
    // Both parents deleted.
    expect(repo.getRingsByOwner(p).find((r) => r.id === e1)).toBeUndefined();
    expect(repo.getRingsByOwner(p).find((r) => r.id === e2)).toBeUndefined();
  });

  test('XP overflow: two very high-XP rings (10000+10000) → tier and max_uses correct', () => {
    // #431 adversarial: integer overflow check — very high XP values could expose
    // truncation or a wrong tier-ceiling if tierForXp has a loop limit.
    const p = makePlayer(db);
    const HIGH_XP = 10000;
    const r1 = makeRing(db, p, EARTH, HIGH_XP);
    const r2 = makeRing(db, p, EARTH, HIGH_XP);

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.xp).toBe(HIGH_XP * 2); // 20000
    expect(result!.tier).toBe(tierForXp(HIGH_XP * 2));
    expect(result!.max_uses).toBe(3 + tierForXp(HIGH_XP * 2));
  });

  // ── parent_dominant ─────────────────────────────────────────────────────────

  test('parent_dominant = r1.element when r1.xp > r2.xp', () => {
    // #431 adversarial: for fusion-element merges, parent_dominant records the
    // higher-XP parent's element. Verifies the ternary fires for r1 > r2.
    const p = makePlayer(db);
    const s1 = makeRing(db, p, STEAM, 800); // higher XP → dominant
    const s2 = makeRing(db, p, STEAM, 600);

    const newId = repo.mergeRings(p, s1, s2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.parent_dominant).toBe(STEAM);
  });

  test('parent_dominant = r2.element when r2.xp > r1.xp', () => {
    // #431 adversarial: verifies the ternary also fires for r2 > r1 (not just r1 > r2).
    const p = makePlayer(db);
    const s1 = makeRing(db, p, STEAM, 600);
    const s2 = makeRing(db, p, STEAM, 900); // higher XP → dominant

    const newId = repo.mergeRings(p, s1, s2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.parent_dominant).toBe(STEAM);
  });

  test('parent_dominant = −1 when both parents have equal XP (exact tie)', () => {
    // #431 adversarial: the −1 sentinel must be stored on tie; a missing else branch
    // would store undefined/null which breaks the card renderer's tiebreak lookup.
    const p = makePlayer(db);
    const s1 = makeRing(db, p, STEAM, T1_XP);
    const s2 = makeRing(db, p, STEAM, T1_XP); // equal XP → tie

    const newId = repo.mergeRings(p, s1, s2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.parent_dominant).toBe(-1);
  });

  test('parent_dominant for two base-element rings with different XP uses the higher-XP element', () => {
    // #431 adversarial: non-fusion base elements also go through the parent_dominant
    // ternary. Verifies the rule applies to all merge types, not just STEAM merges.
    const p = makePlayer(db);
    const e1 = makeRing(db, p, EARTH, 1200); // higher
    const e2 = makeRing(db, p, EARTH, 700);

    const newId = repo.mergeRings(p, e1, e2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.parent_dominant).toBe(EARTH);
  });

  // ── Self-merge and ownership guards ────────────────────────────────────────

  test('ringId1 === ringId2 (self-merge) → throws', () => {
    // #431 adversarial: self-merge must be caught before the DB lookup, otherwise
    // the transaction might succeed and produce a doubly-XP ring from one input.
    const p = makePlayer(db);
    const f1 = makeRing(db, p, FIRE, T1_XP);
    expect(() => repo.mergeRings(p, f1, f1)).toThrow(/with itself/i);
    expect(repo.getRingsByOwner(p)).toHaveLength(1); // intact
  });

  test('ring not owned by the player → throws', () => {
    // #431 adversarial: ownership check must cover both r1 and r2. A bug that only
    // checks r1 would allow a cross-player merge of r2.
    const p1 = makePlayer(db);
    const p2 = makePlayer(db);
    const f1 = makeRing(db, p1, FIRE, T1_XP);
    const f2 = makeRing(db, p2, FIRE, T1_XP); // owned by p2

    expect(() => repo.mergeRings(p1, f1, f2)).toThrow(/not found or not owned/);
    // Both rings intact — transaction rolled back.
    expect(repo.getRingsByOwner(p1)).toHaveLength(1);
    expect(repo.getRingsByOwner(p2)).toHaveLength(1);
  });

  // ── Cross-element guard ─────────────────────────────────────────────────────

  test('FIRE + WATER (different elements) → throws with "same element" message, not generic error', () => {
    // #431 adversarial: the element check must throw a descriptive "same element"
    // message, NOT a 500-style generic error. A merged error message lets the UI
    // show a useful rejection reason.
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T1_XP);
    const water = makeRing(db, p, WATER, T1_XP);

    expect(() => repo.mergeRings(p, fire, water)).toThrow(/same element/i);
  });

  // ── Escrowed guard ──────────────────────────────────────────────────────────

  test('escrowed parent (r1 escrowed) → throws', () => {
    // #431 adversarial: escrowed rings cannot be merged — they are locked as
    // collateral in a wager. The guard must cover both r1 and r2 independently.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, WIND, T1_XP, 5, 1 /* escrowed */);
    const r2 = makeRing(db, p, WIND, T1_XP);

    expect(() => repo.mergeRings(p, r1, r2)).toThrow(/escrowed/i);
    expect(repo.getRingsByOwner(p)).toHaveLength(2); // both intact
  });

  test('escrowed parent (r2 escrowed) → throws', () => {
    // #431 adversarial: confirms the escrowed check uses || (not &&). If && were used,
    // only the case where BOTH are escrowed would throw.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, WIND, T1_XP);
    const r2 = makeRing(db, p, WIND, T1_XP, 5, 1 /* escrowed */);

    expect(() => repo.mergeRings(p, r1, r2)).toThrow(/escrowed/i);
    expect(repo.getRingsByOwner(p)).toHaveLength(2);
  });

  // ── Pending (WON) ring guard ────────────────────────────────────────────────

  test('pending WON ring as r1 → throws', () => {
    // #431 adversarial: a pending ring is the unresolved WON overflow; merging it
    // would bypass the accept/discard prompt, destroying an unreviewed reward.
    const p = makePlayer(db);
    const won = makeRing(db, p, EARTH, T1_XP);
    // Mark it as pending.
    db.prepare('UPDATE rings SET pending = 1 WHERE id = ?').run(won);
    const other = makeRing(db, p, EARTH, T1_XP);

    expect(() => repo.mergeRings(p, won, other)).toThrow(/pending/i);
    // Both rings intact.
    expect(repo.getRingsByOwner(p)).toHaveLength(2);
  });

  test('pending WON ring as r2 → throws', () => {
    // #431 adversarial: pending guard must cover r2, not just r1.
    const p = makePlayer(db);
    const other = makeRing(db, p, EARTH, T1_XP);
    const won = makeRing(db, p, EARTH, T1_XP);
    db.prepare('UPDATE rings SET pending = 1 WHERE id = ?').run(won);

    expect(() => repo.mergeRings(p, other, won)).toThrow(/pending/i);
  });

  // ── Loadout slot clearing ───────────────────────────────────────────────────

  test('parent in a loadout slot → slot nulled after merge', () => {
    // #431 adversarial: clearRingFromLoadout must fire before deleteRingOwned.
    // If the delete fires first (or the clear is skipped), the loadout retains a
    // dangling ring reference that breaks the battle-hand display.
    const p = makePlayer(db);
    const e1 = makeRing(db, p, EARTH, T1_XP);
    const e2 = makeRing(db, p, EARTH, T1_XP);
    repo.saveLoadout(p, { a1: e1 });
    expect(repo.getLoadout(p)!.a1).toBe(e1);

    repo.mergeRings(p, e1, e2);

    expect(repo.getLoadout(p)!.a1).toBeNull(); // slot cleared
    expect(repo.getRingsByOwner(p)).toHaveLength(1); // only merged ring remains
  });

  // ── Exact-arithmetic XP ────────────────────────────────────────────────────

  test('child xp === r1.xp + r2.xp exactly — no rounding, no cap', () => {
    // #431 adversarial: asymmetric non-round XP values expose rounding bugs.
    const p = makePlayer(db);
    const XP1 = 617;
    const XP2 = 2983;
    const r1 = makeRing(db, p, WOOD, XP1);
    const r2 = makeRing(db, p, WOOD, XP2);

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.xp).toBe(XP1 + XP2); // 3600 — exact arithmetic
  });

  // ── #540 — non-Tier-1 tier boundaries (floor removal must not disturb tierForXp) ──

  test('#540: merged XP lands exactly on the T1→T2 boundary (1500) → tier=2, max_uses=5', () => {
    // #540 adversarial: the removed floor only gated the OLD T1 boundary (500).
    // This locks in that tierForXp is still consulted correctly for every other
    // boundary — a hardcoded "tier = mergedXp >= 500 ? 1 : 0" regression would fail here.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, WIND, 1499);
    const r2 = makeRing(db, p, WIND, 1); // 1499 + 1 = 1500 exactly

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.xp).toBe(tierStartXp(2));
    expect(result!.tier).toBe(2);
    expect(result!.max_uses).toBe(naturalMaxUses(2));
    expect(result!.max_uses).toBe(5);
  });

  test('#540: merged XP one below the T1→T2 boundary (1499) stays tier=1, max_uses=4', () => {
    // #540 adversarial: complement of the boundary test above — one XP short of
    // the T2 threshold must NOT cross tiers, even though both parents individually
    // clear the old (now-removed) 500-XP floor.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, WIND, 1499);
    const r2 = makeRing(db, p, WIND, 0);

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.xp).toBe(1499);
    expect(result!.tier).toBe(1);
    expect(result!.max_uses).toBe(4);
  });

  // ── #540 — asymmetric sub-floor combinations (the floor's whole purpose was to gate these) ──

  test('#540: 0-XP parent + high-XP parent (asymmetric) merges additively, no floor rejection', () => {
    // #540 adversarial: this is exactly the shape the OLD floor was designed to
    // reject (one parent far below Tier 1). Confirms the guard is gone, not just
    // relaxed, and that the result is purely additive with no XP clamping.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, EARTH, 0);
    const r2 = makeRing(db, p, EARTH, 5000);

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.xp).toBe(5000);
    expect(result!.tier).toBe(tierForXp(5000));
  });

  test('#540: parent_dominant resolves correctly when the lower-XP parent is exactly 0 (falsy-value edge case)', () => {
    // #540 adversarial: 0 is falsy in JS — a ternary rewritten with `r1.xp &&` short-
    // circuit logic (instead of `r1.xp > r2.xp`) would misclassify a 0-XP parent.
    // Verifies the strict numeric comparison still holds at the new reachable floor.
    const p = makePlayer(db);
    const s1 = makeRing(db, p, STEAM, 0);
    const s2 = makeRing(db, p, STEAM, 1200);

    const newId = repo.mergeRings(p, s1, s2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.parent_dominant).toBe(STEAM); // s2 (higher XP) dominates
  });

  test('#540: both parents at exactly 1 XP → xp=2, tier=0, max_uses=3', () => {
    // #540 adversarial: smallest nonzero asymmetry-free case above the new floor
    // of "none" — pins that even trivial XP still sums exactly and stays tier 0.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, FIRE, 1);
    const r2 = makeRing(db, p, FIRE, 1);

    const newId = repo.mergeRings(p, r1, r2);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);
    expect(result!.xp).toBe(2);
    expect(result!.tier).toBe(0);
    expect(result!.max_uses).toBe(3);
  });

  // ── #540 — other guards must still fire independent of the removed floor ──────

  test('#540: escrowed guard still fires when BOTH parents are sub-floor (0 XP) — not silently allowed', () => {
    // #540 adversarial: the most important guard-isolation regression. Before #540,
    // a sub-500-XP escrowed ring would have been rejected by the (now-removed) floor
    // check FIRST, masking whether the escrow guard itself still worked. Now that the
    // floor is gone, this is the only test that proves the escrow guard independently
    // fires for 0-XP rings rather than silently permitting them through.
    const p = makePlayer(db);
    const r1 = makeRing(db, p, WIND, 0, 5, 1 /* escrowed */);
    const r2 = makeRing(db, p, WIND, 0);

    expect(() => repo.mergeRings(p, r1, r2)).toThrow(/escrowed/i);
    expect(repo.getRingsByOwner(p)).toHaveLength(2); // both intact — not merged
  });

  test('#540: pending WON guard still fires when BOTH parents are sub-floor (0 XP)', () => {
    // #540 adversarial: mirrors the escrow case above for the pending-ring guard —
    // proves the pending check is truly independent of XP, not accidentally
    // short-circuited by the floor removal.
    const p = makePlayer(db);
    const won = makeRing(db, p, EARTH, 0);
    db.prepare('UPDATE rings SET pending = 1 WHERE id = ?').run(won);
    const other = makeRing(db, p, EARTH, 0);

    expect(() => repo.mergeRings(p, won, other)).toThrow(/pending/i);
    expect(repo.getRingsByOwner(p)).toHaveLength(2);
  });

  test('#540: cross-element guard still fires for two 0-XP parents (element check, not XP, is the reason)', () => {
    // #540 adversarial: with the floor gone, a 0-XP FIRE + 0-XP WATER pair must be
    // rejected for "same element", not silently pass through some now-dead
    // XP-floor branch that happened to also block cross-element pairs.
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 0);
    const water = makeRing(db, p, WATER, 0);

    expect(() => repo.mergeRings(p, fire, water)).toThrow(/same element/i);
  });

  // ── in_carry inheritance (bug fix: child mirrors parent1, not DEFAULT 0) ─────
  // Regression guard for the pre-existing insertFusionRing bug that Merge inherited
  // from Fusion: the shared INSERT never set in_carry, so every merged ring silently
  // took the schema DEFAULT (0) and landed resting in the Reliquary — even when its
  // parents were carried — which also bypassed the Reliquary cap. The fix mirrors
  // parent1's in_carry. All four (r1, r2) combinations are pinned.

  /** Merge two same-element EARTH rings with the given in_carry flags on the parents. */
  function mergeWithCarry(carry1: number, carry2: number): number {
    const p = makePlayer(db);
    const e1 = makeRing(db, p, EARTH, T1_XP);
    const e2 = makeRing(db, p, EARTH, T1_XP);
    db.prepare('UPDATE rings SET in_carry = ? WHERE id = ?').run(carry1, e1);
    db.prepare('UPDATE rings SET in_carry = ? WHERE id = ?').run(carry2, e2);
    const newId = repo.mergeRings(p, e1, e2);
    return repo.getRingsByOwner(p).find((r) => r.id === newId)!.in_carry;
  }

  test('both parents carried (1,1) → merged ring carried (in_carry=1)', () => {
    expect(mergeWithCarry(1, 1)).toBe(1);
  });

  test('both parents resting (0,0) → merged ring rests (in_carry=0)', () => {
    expect(mergeWithCarry(0, 0)).toBe(0);
  });

  test('mixed (parent1 carried, parent2 resting) → mirrors parent1 (in_carry=1)', () => {
    // The load-bearing case: proves the child mirrors parent1, not parent2.
    expect(mergeWithCarry(1, 0)).toBe(1);
  });

  test('mixed the other way (parent1 resting, parent2 carried) → mirrors parent1 (in_carry=0)', () => {
    // Complement: a bug mirroring parent2 (or ORing the two flags) would yield 1 here.
    expect(mergeWithCarry(0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #540 — Tier-1 floor removal: spec conformance (server source + fusion isolation)
// ---------------------------------------------------------------------------

describe('Tier-1 floor removal — spec conformance (#540)', () => {
  let repo: typeof import('../../server/src/persistence/PlayerRepo');
  let db: import('better-sqlite3').Database;

  function makeRing(
    dbArg: import('better-sqlite3').Database,
    playerId: string,
    element: number,
    xp: number,
    maxUses = 5,
  ): string {
    const id = `sc_${element}_${Math.random().toString(36).slice(2)}`;
    dbArg.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, playerId, element, tierForXp(xp), maxUses, maxUses, xp);
    return id;
  }

  function makePlayer(dbArg: import('better-sqlite3').Database): string {
    const id = `scp_${Math.random().toString(36).slice(2)}`;
    dbArg.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      id, `u_${id}`, 'x',
    );
    dbArg.prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    ).run(id);
    return id;
  }

  beforeAll(async () => {
    repo = await import('../../server/src/persistence/PlayerRepo');
    db = (await import('../../server/src/persistence/db')).db;
  });

  // #540 adversarial: the exact removed error string must not exist anywhere in
  // server source — a leftover dead branch (unreachable but still present) would
  // pass every functional test above while leaving stale, confusing code behind.
  test('"Both rings must reach Tier 1 to merge" no longer exists in PlayerRepo.ts source', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(__dirname, '../../server/src/persistence/PlayerRepo.ts'),
      'utf8',
    );
    expect(repoSrc).not.toContain('Both rings must reach Tier 1 to merge');
  });

  // #540 adversarial: the single most important guard-isolation regression — Fusion
  // (a completely separate code path, fuseRings) must still enforce its own
  // independent Tier-1 floor. A shared-helper refactor that accidentally deleted
  // the check from both functions would only be caught here, not by merge tests.
  test('fuseRings still rejects a sub-500 XP parent with /Tier 1/ (fusion floor untouched by #540)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, 499);
    const water = makeRing(db, p, WATER, 600);

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/Tier 1/);
    expect(repo.getRingsByOwner(p)).toHaveLength(2); // both intact — fusion rejected
  });

  // #540 adversarial: complement — MIN_FUSION_PARENT_XP must remain exactly 500 so
  // fusion's balance is byte-for-byte unchanged by the merge-side spec change.
  test('MIN_FUSION_PARENT_XP is still exactly 500 after #540 (fusion floor unchanged)', () => {
    expect(MIN_FUSION_PARENT_XP).toBe(500);
  });
});
