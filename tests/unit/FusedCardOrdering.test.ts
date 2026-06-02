import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';
import { tierForXp, tierStartXp } from '../../server/src/game/Tiers';

const { FIRE, WATER, EARTH, WIND, WOOD, STEAM, MUD, DUST } = ElementEnum;

// #263 — two-tone fused ring cards. The dominant (higher-XP) parent at fusion
// time is persisted as rings.parent_dominant and surfaces dominant-first in the
// serialized fusionParents array; equal-XP parents fall back to the static
// FUSION_PARENTS order. Same throwaway-DB pattern as FusionCrafting.test.ts:
// DB_PATH must be set before the first import of any module touching db.ts.

const T2_XP = tierStartXp(2); // 1500 — Tier 2 start
const T2_HIGH_XP = tierStartXp(2) + 400; // still Tier 2 (below T3 start at 3000)

describe('#263 — fused card component ordering', () => {
  let repo: typeof import('../../server/src/persistence/PlayerRepo');
  let db: import('better-sqlite3').Database;

  function makeRing(
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

  function makePlayer(): string {
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

  /** Read the raw parent_dominant column for a ring id. */
  function parentDominant(ringId: string): number {
    return (
      db.prepare('SELECT parent_dominant FROM rings WHERE id = ?').get(ringId) as {
        parent_dominant: number;
      }
    ).parent_dominant;
  }

  beforeAll(async () => {
    const dbFile = path.join(os.tmpdir(), `er-fusedorder-${process.pid}-${Date.now()}.db`);
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
    }
    process.env.DB_PATH = dbFile;
    repo = await import('../../server/src/persistence/PlayerRepo');
    db = (await import('../../server/src/persistence/db')).db;
  });

  // ── fuseRings persists the dominant (higher-XP) parent ─────────────────────

  test('fuseRings stores the HIGHER-XP parent element as parent_dominant', () => {
    const p = makePlayer();
    // Water has more XP than Earth → Water is the dominant component for Mud.
    const water = makeRing(p, WATER, T2_HIGH_XP);
    const earth = makeRing(p, EARTH, T2_XP);

    const id = repo.fuseRings(p, water, earth);
    expect(parentDominant(id)).toBe(WATER);

    const ring = repo.getRingsByOwner(p).find((r) => r.id === id)!;
    expect(ring.element).toBe(MUD);
    // Dominant-first: Water (higher XP) leads, Earth second.
    expect(ring.fusionParents).toEqual([WATER, EARTH]);
  });

  test('fuseRings stores the higher-XP parent even when the OTHER element leads statically', () => {
    const p = makePlayer();
    // Static FUSION_PARENTS for MUD is [WATER, EARTH]. Make EARTH the higher-XP
    // parent so the dynamic order must DIFFER from the static order.
    const earth = makeRing(p, EARTH, T2_HIGH_XP);
    const water = makeRing(p, WATER, T2_XP);

    const id = repo.fuseRings(p, earth, water);
    expect(parentDominant(id)).toBe(EARTH);

    const ring = repo.getRingsByOwner(p).find((r) => r.id === id)!;
    // Dominant-first: Earth leads despite the static order being Water-first.
    expect(ring.fusionParents).toEqual([EARTH, WATER]);
  });

  // ── orderedParents helper ──────────────────────────────────────────────────

  test('orderedParents returns [dominant, other] when parent_dominant >= 0', () => {
    // EARTH dominant for MUD → [EARTH, WATER] (the non-dominant component second).
    expect(repo.orderedParents({ element: MUD, parent_dominant: EARTH })).toEqual([
      EARTH,
      WATER,
    ]);
    expect(repo.orderedParents({ element: MUD, parent_dominant: WATER })).toEqual([
      WATER,
      EARTH,
    ]);
  });

  test('orderedParents falls back to static componentsOf when parent_dominant = -1', () => {
    // Pre-migration / AI-granted fusion → static FUSION_PARENTS order.
    expect(repo.orderedParents({ element: MUD, parent_dominant: -1 })).toEqual([WATER, EARTH]);
    expect(repo.orderedParents({ element: STEAM, parent_dominant: -1 })).toEqual([FIRE, WATER]);
    expect(repo.orderedParents({ element: DUST, parent_dominant: -1 })).toEqual([WIND, EARTH]);
  });

  test('orderedParents on a base ring returns its single element', () => {
    expect(repo.orderedParents({ element: FIRE, parent_dominant: -1 })).toEqual([FIRE]);
  });

  test('orderedParents ignores a dominant that is not a component (corrupt row) → static', () => {
    // WOOD is not a component of MUD (Water+Earth) → fall back to static order.
    expect(repo.orderedParents({ element: MUD, parent_dominant: WOOD })).toEqual([WATER, EARTH]);
  });

  // ── equal-XP tiebreak → static order ────────────────────────────────────────

  test('equal-XP parents store parent_dominant = -1 → static FUSION_PARENTS order, regardless of arg order', () => {
    // Pass EARTH first to prove the rendered order is the static [WATER, EARTH],
    // not the insertion order (Earth-first). This is the AC #3 tiebreak.
    const p1 = makePlayer();
    const earth1 = makeRing(p1, EARTH, T2_XP);
    const water1 = makeRing(p1, WATER, T2_XP);
    const id1 = repo.fuseRings(p1, earth1, water1);
    expect(parentDominant(id1)).toBe(-1);
    const ring1 = repo.getRingsByOwner(p1).find((r) => r.id === id1)!;
    expect(ring1.element).toBe(MUD);
    expect(ring1.fusionParents).toEqual([WATER, EARTH]);

    // Reversed argument order yields the identical static result.
    const p2 = makePlayer();
    const water2 = makeRing(p2, WATER, T2_XP);
    const earth2 = makeRing(p2, EARTH, T2_XP);
    const id2 = repo.fuseRings(p2, water2, earth2);
    const ring2 = repo.getRingsByOwner(p2).find((r) => r.id === id2)!;
    expect(ring2.fusionParents).toEqual([WATER, EARTH]);
  });

  // ── base ring serialization ────────────────────────────────────────────────

  test('getRingsByOwner serializes base rings with an empty fusionParents array', () => {
    const p = makePlayer();
    makeRing(p, FIRE, 100); // base ring, no fusion
    const ring = repo.getRingsByOwner(p)[0];
    expect(ring.element).toBe(FIRE);
    expect(ring.fusionParents).toEqual([]);
    expect(ring.parent_dominant).toBe(-1);
  });
});
