import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { fusionOf } from '../../server/src/game/Fusions';
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
// Fusion rules (GDD §4.6): both parents must share the same XP-derived tier, that
// tier must be ≥ 1 (≥ 500 XP), XP is additive, fused tier = tierForXp(sum), and fused
// max_uses = naturalMaxUses(fusedTier) = 3 + fusedTier — the same pure-XP rule every
// natural ring obeys (no min(parents)−1 penalty). Tier is derived from XP, so tests
// seed XP at/above the relevant tierStartXp threshold rather than the old hard caps.
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

  test('different-tier pair (Tier 2 + Tier 3) throws (rejected → 400)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP); // Tier 2
    const water = makeRing(db, p, WATER, T3_XP); // Tier 3

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/same tier/);
    // Both parents still present; no fusion ring created.
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(2);
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
});
