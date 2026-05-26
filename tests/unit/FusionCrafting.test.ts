import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { fusionOf } from '../../server/src/game/Fusions';

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
// ---------------------------------------------------------------------------

describe('fuseRings — DB transaction', () => {
  // Loaded after DB_PATH is set, in beforeAll.
  let repo: typeof import('../../server/src/persistence/PlayerRepo');
  let TIER1_XP_CAP: number;

  /** Insert a Tier 1 ring owned by playerId with the given element/xp. */
  function makeRing(
    db: import('better-sqlite3').Database,
    playerId: string,
    element: number,
    xp: number,
  ): string {
    const id = `ring_${element}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
       VALUES (?, ?, ?, 1, 3, 3, ?)`,
    ).run(id, playerId, element, xp);
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
    ({ TIER1_XP_CAP } = await import('../../server/src/game/constants'));
  });

  test('XP-capped parents → correct fusion result ring', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, TIER1_XP_CAP);
    const water = makeRing(db, p, WATER, TIER1_XP_CAP);

    const newId = repo.fuseRings(p, fire, water);
    const result = repo.getRingsByOwner(p).find((r) => r.id === newId);

    expect(result).toBeDefined();
    expect(result!.element).toBe(STEAM);
    expect(result!.tier).toBe(2);
    expect(result!.max_uses).toBe(5);
    expect(result!.current_uses).toBe(5);
    expect(result!.xp).toBe(TIER1_XP_CAP * 2); // 200
  });

  test('un-capped parent throws and leaves inventory untouched', () => {
    const p = makePlayer(db);
    const fire = makeRing(db, p, FIRE, TIER1_XP_CAP);
    const water = makeRing(db, p, WATER, TIER1_XP_CAP - 50); // 50, below cap

    expect(() => repo.fuseRings(p, fire, water)).toThrow(/has not reached XP cap/);
    // Both parents still present; no fusion ring created.
    const rings = repo.getRingsByOwner(p);
    expect(rings).toHaveLength(2);
    expect(rings.every((r) => r.tier === 1)).toBe(true);
  });

  test('ring not owned by the player throws', () => {
    const p1 = makePlayer(db);
    const p2 = makePlayer(db);
    const fire = makeRing(db, p1, FIRE, TIER1_XP_CAP);
    const water = makeRing(db, p2, WATER, TIER1_XP_CAP); // owned by p2

    expect(() => repo.fuseRings(p1, fire, water)).toThrow(/not found or not owned/);
  });

  test('same element parents throw (no valid fusion)', () => {
    const p = makePlayer(db);
    const fire1 = makeRing(db, p, FIRE, TIER1_XP_CAP);
    const fire2 = makeRing(db, p, FIRE, TIER1_XP_CAP);

    expect(() => repo.fuseRings(p, fire1, fire2)).toThrow(/do not form a valid fusion/);
  });

  test('parents are consumed (deleted) from the DB after fusion', () => {
    const p = makePlayer(db);
    const wind = makeRing(db, p, WIND, TIER1_XP_CAP);
    const earth = makeRing(db, p, EARTH, TIER1_XP_CAP);

    const newId = repo.fuseRings(p, wind, earth);
    const rings = repo.getRingsByOwner(p);

    expect(rings).toHaveLength(1); // only the fusion ring remains
    expect(rings[0].id).toBe(newId);
    expect(rings[0].element).toBe(DUST);
    expect(rings.find((r) => r.id === wind)).toBeUndefined();
    expect(rings.find((r) => r.id === earth)).toBeUndefined();
  });

  test('parent assigned to a loadout slot → slot nulled, fusion proceeds', () => {
    const p = makePlayer(db);
    const wood = makeRing(db, p, WOOD, TIER1_XP_CAP);
    const earth = makeRing(db, p, EARTH, TIER1_XP_CAP);

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
