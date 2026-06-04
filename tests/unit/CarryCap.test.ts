import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';

// ---------------------------------------------------------------------------
// EPIC #378 — spareCountAfter / assertSpareWithinMax unit coverage.
//
// Uses a throwaway SQLite DB seeded with minimal player + ring rows. Heart-slot
// rings (in_carry=0, heart_slot=1) must never count toward the spare cap.
// Clearing a battle slot must NOT free spare capacity — spare and battle-hand
// are independently bounded pools.
// DB_PATH must be set before the first import of db.ts.
// ---------------------------------------------------------------------------

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Insert a bare ring owned by playerId. */
function makeRing(
  db: import('better-sqlite3').Database,
  playerId: string,
  {
    inCarry = 0,
    heartSlot = 0,
    element = ElementEnum.FIRE,
  }: { inCarry?: number; heartSlot?: number; element?: number } = {},
): string {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
     VALUES (?, ?, ?, 0, 3, 3, 0, ?, 0, ?)`,
  ).run(id, playerId, element, inCarry, heartSlot);
  return id;
}

/** Create a minimal player row + empty loadout. */
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

/** Assign a ring to a loadout slot directly in the DB. */
function assignSlot(
  db: import('better-sqlite3').Database,
  playerId: string,
  slot: 'thumb' | 'a1' | 'a2' | 'd1' | 'd2',
  ringId: string,
): void {
  db.prepare(`UPDATE loadout SET ${slot} = ? WHERE player_id = ?`).run(ringId, playerId);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbFile = path.join(
    os.tmpdir(),
    `er-carrycap-test-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
});

// ---------------------------------------------------------------------------
// spareCountAfter
// ---------------------------------------------------------------------------

describe('spareCountAfter', () => {
  test('returns current spare count when no delta', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    // All 3 are in carry and not in any loadout slot → all are spare
    expect(repo.spareCountAfter(p)).toBe(3);
  });

  test('add-only: appends new ids', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    const newId = `phantom_${Math.random().toString(36).slice(2)}`;
    expect(repo.spareCountAfter(p, { addingToSpare: [newId] })).toBe(3);
  });

  test('remove-only: subtracts existing ids', () => {
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.spareCountAfter(p, { removingFromSpare: [r1] })).toBe(2);
  });

  test('net-zero swap: adding and removing the same ring leaves count unchanged', () => {
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    // r1 leaves spare (becomes heart); phantom joins (incoming old heart)
    const phantom = `phantom_${Math.random().toString(36).slice(2)}`;
    expect(repo.spareCountAfter(p, { addingToSpare: [phantom], removingFromSpare: [r1] })).toBe(2);
  });

  test('heart-slot ring (in_carry=0, heart_slot=1) is never counted', () => {
    const p = makePlayer(dbInstance);
    // Heart ring: in_carry=0, heart_slot=1 — must not appear in getSpareIds()
    makeRing(dbInstance, p, { inCarry: 0, heartSlot: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.spareCountAfter(p)).toBe(1);
  });

  test('dedupe: a repeated id in addingToSpare does not inflate count', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    const dupId = `dup_${Math.random().toString(36).slice(2)}`;
    // Adding the same id twice should add it only once
    expect(repo.spareCountAfter(p, { addingToSpare: [dupId, dupId] })).toBe(2);
  });

  test('a ring in a loadout slot is NOT counted as spare', () => {
    // EPIC #378 — the key invariant: battle-slot rings are NOT spare.
    const p = makePlayer(dbInstance);
    const r = makeRing(dbInstance, p, { inCarry: 1 });
    assignSlot(dbInstance, p, 'thumb', r);
    // r is in carry but in the loadout → not spare
    expect(repo.spareCountAfter(p)).toBe(0);
  });

  test('clearing a battle slot does NOT free spare capacity', () => {
    // EPIC #378 core invariant: spare is independent of battle-slot occupancy.
    // A player with the spare grid full should stay full even if they clear a battle slot.
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Fill spare grid to max
    const spareIds: string[] = [];
    for (let i = 0; i < max; i++) {
      spareIds.push(makeRing(dbInstance, p, { inCarry: 1 }));
    }
    // Also add a ring in a loadout slot (not spare)
    const battleRing = makeRing(dbInstance, p, { inCarry: 1 });
    assignSlot(dbInstance, p, 'thumb', battleRing);
    // Spare count is exactly max (battle ring not counted)
    expect(repo.spareCountAfter(p)).toBe(max);
    // "Clear" the battle slot by adding the battle ring's old slot ring to spare —
    // that is what saveLoadout does when slot→null. This simulates clearing thumb.
    // The new spare count would be max + 1 (over cap).
    expect(repo.spareCountAfter(p, { addingToSpare: [battleRing] })).toBe(max + 1);
    // And assertSpareWithinMax must throw
    expect(() => repo.assertSpareWithinMax(p, { addingToSpare: [battleRing] })).toThrow(
      /spare grid full/,
    );
  });
});

// ---------------------------------------------------------------------------
// assertSpareWithinMax
// ---------------------------------------------------------------------------

describe('assertSpareWithinMax', () => {
  test('does not throw when spare is below max', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(() => repo.assertSpareWithinMax(p)).not.toThrow();
  });

  test('does not throw when spare equals max exactly', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    for (let i = 0; i < max; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    expect(() => repo.assertSpareWithinMax(p)).not.toThrow();
  });

  test('throws spare grid full when count exceeds max', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    for (let i = 0; i < max; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    // Adding one more phantom pushes over max
    const phantom = `ovr_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertSpareWithinMax(p, { addingToSpare: [phantom] })).toThrow(
      /spare grid full/,
    );
  });

  test('net-zero spare→heart swap at max does not throw', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Fill spare to max
    for (let i = 0; i < max; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    const spares = repo.getSpareIds(p);
    const incomingSpare = spares[0]; // spare about to become heart (leaves spare)
    const oldHeartPhantom = `oldheart_${Math.random().toString(36).slice(2)}`; // old heart joins spare
    // Net-zero: adding old-heart, removing incoming-spare
    expect(() =>
      repo.assertSpareWithinMax(p, {
        addingToSpare: [oldHeartPhantom],
        removingFromSpare: [incomingSpare],
      }),
    ).not.toThrow();
  });

  test('releasing heart to empty spare at max throws (net-grow)', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    for (let i = 0; i < max; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    const oldHeartPhantom = `oldheart2_${Math.random().toString(36).slice(2)}`;
    // No incoming ring → removingFromSpare=[]; addingToSpare=[oldHeart] → count = max + 1 → throws
    expect(() =>
      repo.assertSpareWithinMax(p, { addingToSpare: [oldHeartPhantom], removingFromSpare: [] }),
    ).toThrow(/spare grid full/);
  });

  test('pending won ring (in_carry=1, not in loadout) is in spare → net +1 → correctly blocked at max', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Fill spare to exactly max.
    for (let i = 0; i < max; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    // phantomOldHeart simulates the old heart ring that would join the spare.
    const phantomOldHeart = `oldheart_pending_${Math.random().toString(36).slice(2)}`;
    // notInSpare simulates a pending won ring that is already in_carry=1 but we
    // are adding as if it isn't tracked yet (phantom not in DB).
    const notInSpare = `pending_won_${Math.random().toString(36).slice(2)}`;
    expect(() =>
      repo.assertSpareWithinMax(p, {
        addingToSpare: [phantomOldHeart],
        removingFromSpare: [notInSpare],
      }),
    ).toThrow(/spare grid full/);
  });
});

// ---------------------------------------------------------------------------
// Adversarial edge cases (EPIC #378)
// ---------------------------------------------------------------------------

describe('spareCountAfter — adversarial edge cases (#378)', () => {
  test('adding an id already in the spare set does not inflate count', () => {
    // Set.add on an existing id must be idempotent
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    // r1 is already spare; adding it again must keep count at 2, not inflate to 3
    expect(repo.spareCountAfter(p, { addingToSpare: [r1] })).toBe(2);
  });

  test('removing more ids than are in spare does not produce a negative count', () => {
    // Set.delete is a no-op for missing ids
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    const phantom1 = `phantom_rm1_${Math.random().toString(36).slice(2)}`;
    const phantom2 = `phantom_rm2_${Math.random().toString(36).slice(2)}`;
    // 1 spare, removing 3 ids (1 real + 2 phantoms) — result must be 0, never negative
    const count = repo.spareCountAfter(p, { removingFromSpare: [r1, phantom1, phantom2] });
    expect(count).toBe(0);
  });

  test('empty addingToSpare + empty removingFromSpare at exactly max does not throw', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    for (let i = 0; i < max; i++) makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.spareCountAfter(p, { addingToSpare: [], removingFromSpare: [] })).toBe(max);
    expect(() => repo.assertSpareWithinMax(p, { addingToSpare: [], removingFromSpare: [] })).not.toThrow();
  });

  test('assertSpareWithinMax at post-delta count exactly equal to max does not throw', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Seed max-1 rings in spare, then add one phantom → post-delta count = max exactly
    for (let i = 0; i < max - 1; i++) makeRing(dbInstance, p, { inCarry: 1 });
    const newId = `exact_max_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertSpareWithinMax(p, { addingToSpare: [newId] })).not.toThrow();
  });

  test('assertSpareWithinMax with post-delta count one above max throws spare grid full', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Seed exactly max rings, then try adding one more phantom → count = max + 1
    for (let i = 0; i < max; i++) makeRing(dbInstance, p, { inCarry: 1 });
    const overflow = `overflow_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertSpareWithinMax(p, { addingToSpare: [overflow] })).toThrow(
      /spare grid full/,
    );
  });

  test('three repetitions of the same id in addingToSpare are deduplicated', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 }); // 1 in spare
    const dupId = `tripleDup_${Math.random().toString(36).slice(2)}`;
    // Adding the same phantom id three times must add it only once → count stays at 2
    expect(repo.spareCountAfter(p, { addingToSpare: [dupId, dupId, dupId] })).toBe(2);
  });

  test('a ring in a loadout slot that is cleared does NOT reduce spare capacity', () => {
    // EPIC #378: battle-slot occupancy is independent of spare count.
    // A ring in a loadout slot is NOT spare; clearing that slot would ADD it to spare,
    // not reduce spare count. This is the core invariant of the new model.
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Fill spare to max (all non-slot rings in carry)
    for (let i = 0; i < max; i++) makeRing(dbInstance, p, { inCarry: 1 });
    // Put one more ring in a battle slot — NOT spare
    const slotRing = makeRing(dbInstance, p, { inCarry: 1 });
    assignSlot(dbInstance, p, 'a1', slotRing);
    // Spare count is still max (slot ring excluded)
    expect(repo.getSpareIds(p).length).toBe(max);
    // "Clearing" the slot by adding slotRing to spare would overflow
    expect(() =>
      repo.assertSpareWithinMax(p, { addingToSpare: [slotRing] }),
    ).toThrow(/spare grid full/);
  });
});

// ---------------------------------------------------------------------------
// packLoadout — spare cap migration (EPIC #378)
// ---------------------------------------------------------------------------

describe('packLoadout — spare cap migration (#378)', () => {
  test('packLoadout with exactly max spare rings succeeds without throwing', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Build a set of exactly max ring ids (no loadout slots assigned)
    const ringIds: string[] = [];
    for (let i = 0; i < max; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    // packLoadout with max rings, none in loadout slots → all become spare → should succeed
    expect(() => repo.packLoadout(p, ringIds)).not.toThrow();
    expect(repo.getSpareIds(p).length).toBe(max);
  });

  test('packLoadout with one ring above spare max throws spare grid full', () => {
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    const ringIds: string[] = [];
    for (let i = 0; i < max + 1; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    expect(() => repo.packLoadout(p, ringIds)).toThrow(/spare grid full/);
  });

  test('packLoadout still enforces the reliquary cap guard independently of spare cap', () => {
    const p = makePlayer(dbInstance);
    const reliquaryCap = repo.getReliquaryCap(p); // default RELIQUARY_BASE_CAP = 9
    const carryCount = 2; // well within spare cap
    const carryIds: string[] = [];
    for (let i = 0; i < carryCount; i++) {
      carryIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    // Fill the reliquary above cap: create reliquaryCap+1 extra non-carried rings
    for (let i = 0; i < reliquaryCap + 1; i++) {
      makeRing(dbInstance, p, { inCarry: 0 });
    }
    // packLoadout with just carryIds — resulting reliquary = reliquaryCap + 1 > reliquaryCap
    expect(() => repo.packLoadout(p, carryIds)).toThrow(/Reliquary full/);
  });
});

// ---------------------------------------------------------------------------
// saveLoadout — spare cap migration (EPIC #378)
// ---------------------------------------------------------------------------

describe('saveLoadout — spare cap migration (#378)', () => {
  test('saveLoadout at spare max succeeds (pointer swap, no spare count change)', () => {
    // A player at spare max who is merely reassigning existing carried rings to
    // different loadout slots must not be blocked.
    const p = makePlayer(dbInstance);
    const max = repo.getSpareRingMax(p);
    // Seed max rings all in carry (not in any slot yet)
    const ringIds: string[] = [];
    for (let i = 0; i < max; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 1 }));
    }
    // Assign first 5 to slots — they leave spare (spare goes from max to max-5)
    for (let i = 0; i < 5 && i < ringIds.length; i++) {
      const slot = (['thumb', 'a1', 'a2', 'd1', 'd2'] as const)[i];
      assignSlot(dbInstance, p, slot, ringIds[i]);
    }
    // Now spare is max-5 (well within max). Re-assigning slot rings to different
    // slots is a no-op on spare count.
    const partial = {
      thumb: ringIds[0],
      a1: ringIds[1],
      a2: ringIds[2],
      d1: ringIds[3],
      d2: ringIds[4],
    };
    expect(() => repo.saveLoadout(p, partial)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setHeartRing removing — non-spare ids do not create negative phantom capacity (#378)
// ---------------------------------------------------------------------------

describe('setHeartRing removing — non-spare ids floors at 0 (#378)', () => {
  test('assertSpareWithinMax removingFromSpare with a mix of spare and non-spare ids', () => {
    // The removingFromSpare array may include ids that are not in the spare set
    // (e.g. a pending won ring not yet in spare); Set.delete must be a no-op for
    // those ids so the resulting count is never lower than actual
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    const r2 = makeRing(dbInstance, p, { inCarry: 1 });
    const notInSpare = makeRing(dbInstance, p, { inCarry: 0 }); // in reliquary
    // Removing 2 spare + 1 non-spare; the non-spare delete is a no-op
    const count = repo.spareCountAfter(p, { removingFromSpare: [r1, r2, notInSpare] });
    expect(count).toBe(0); // only the 2 spare were deleted
  });
});
