import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { fusionOf } from '../../server/src/game/Fusions';
import { tierForXp, tierStartXp } from '../../server/src/game/Tiers';

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
// tier must be ≥ 2, XP is additive, fused tier = tierForXp(sum), and fused
// max_uses = max(1, min(parents) − 1). Tier is derived from XP, so tests seed XP
// at/above the relevant tierStartXp threshold rather than the old hard caps.
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

  test('same-tier (Tier 2) parents → fused xp=sum, tier=tierForXp(sum), max_uses=min−1', () => {
    const p = makePlayer(db);
    // Both Tier 2: max_uses 5 and 4 → fused uses = min(5,4)−1 = 3.
    const fire = makeRing(db, p, FIRE, T2_XP, 5);
    const water = makeRing(db, p, WATER, T2_XP, 4);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.xp).toBe(T2_XP * 2); // 3000
    expect(result!.tier).toBe(tierForXp(T2_XP * 2)); // 3000 → Tier 3
    expect(result!.max_uses).toBe(3); // min(5,4) − 1
    expect(result!.current_uses).toBe(3);
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

  test('same-tier Tier 1 pair throws (below the Tier 2 minimum)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T1_XP); // Tier 1
    const water = makeRing(db, p, WATER, T1_XP); // Tier 1

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/Tier 2/);
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r.tier === 1)).toBe(true);
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
    expect(result!.max_uses).toBe(5); // min(6,6) − 1
  });

  test('max_uses floors at 1 when a parent has max_uses=1 (min−1 would be 0)', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP, 1); // weaker parent: 1 use
    const water = makeRing(db, p, WATER, T2_XP, 5);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    // Math.max(1, min(1,5) − 1) = Math.max(1, 0) = 1.
    expect(result!.max_uses).toBe(1);
    expect(result!.current_uses).toBe(1);
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

  test('max_uses = min(parents) - 1 when parents differ: max_uses 4 and 6 → result 3', () => {
    // Spec (C7): max_uses = min(parents) − 1. min(4, 6) − 1 = 3.
    // This catches an off-by-one if the implementation uses max() instead of min(),
    // or subtracts from the wrong operand.
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, T2_XP, 4);
    const water = makeRing(db, p, WATER, T2_XP, 6);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result!.max_uses).toBe(3); // min(4, 6) − 1 = 3
    expect(result!.current_uses).toBe(3);
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
