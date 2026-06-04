import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';

// ---------------------------------------------------------------------------
// #376 — carriedCountAfter / assertCarryWithinCap unit coverage.
//
// Uses a throwaway SQLite DB seeded with minimal player + ring rows. Heart-slot
// rings (in_carry=0, heart_slot=1) must never count toward the carry cap.
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
// carriedCountAfter
// ---------------------------------------------------------------------------

describe('carriedCountAfter', () => {
  test('returns current carry count when no delta', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.carriedCountAfter(p)).toBe(3);
  });

  test('add-only: appends new ids', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    const newId = `phantom_${Math.random().toString(36).slice(2)}`;
    expect(repo.carriedCountAfter(p, { adding: [newId] })).toBe(3);
  });

  test('remove-only: subtracts existing ids', () => {
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.carriedCountAfter(p, { removing: [r1] })).toBe(2);
  });

  test('net-zero swap: adding and removing the same ring leaves count unchanged', () => {
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    // r1 leaves (becomes heart), phantom joins (becomes carried)
    const phantom = `phantom_${Math.random().toString(36).slice(2)}`;
    expect(repo.carriedCountAfter(p, { adding: [phantom], removing: [r1] })).toBe(2);
  });

  test('heart-slot ring (in_carry=0, heart_slot=1) is never counted', () => {
    const p = makePlayer(dbInstance);
    // Heart ring: in_carry=0, heart_slot=1 — must not appear in getCarry()
    makeRing(dbInstance, p, { inCarry: 0, heartSlot: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.carriedCountAfter(p)).toBe(1);
  });

  test('dedupe: a repeated id in adding does not inflate count', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    const dupId = `dup_${Math.random().toString(36).slice(2)}`;
    // Adding the same id twice should add it only once
    expect(repo.carriedCountAfter(p, { adding: [dupId, dupId] })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// assertCarryWithinCap
// ---------------------------------------------------------------------------

describe('assertCarryWithinCap', () => {
  test('does not throw when carry is below cap', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    expect(() => repo.assertCarryWithinCap(p)).not.toThrow();
  });

  test('does not throw when carry equals cap exactly', () => {
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    for (let i = 0; i < cap; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    expect(() => repo.assertCarryWithinCap(p)).not.toThrow();
  });

  test('throws carry cap exceeded when count exceeds cap', () => {
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    for (let i = 0; i < cap; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    // Adding one more phantom pushes over cap
    const phantom = `ovr_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertCarryWithinCap(p, { adding: [phantom] })).toThrow(
      /carry cap exceeded/,
    );
  });

  test('net-zero spare→heart swap at cap does not throw', () => {
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Fill carry to cap
    for (let i = 0; i < cap; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    const carried = repo.getCarry(p);
    const incomingSpare = carried[0].id; // spare about to become heart (leaves carry)
    const oldHeartPhantom = `oldheart_${Math.random().toString(36).slice(2)}`; // old heart joins carry
    // Net-zero: adding old-heart, removing incoming-spare
    expect(() =>
      repo.assertCarryWithinCap(p, { adding: [oldHeartPhantom], removing: [incomingSpare] }),
    ).not.toThrow();
  });

  test('releasing heart to empty spare at cap throws (net-grow)', () => {
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    for (let i = 0; i < cap; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    const oldHeartPhantom = `oldheart2_${Math.random().toString(36).slice(2)}`;
    // No incoming ring → removing=[]; adding=[oldHeart] → count = cap + 1 → throws
    expect(() =>
      repo.assertCarryWithinCap(p, { adding: [oldHeartPhantom], removing: [] }),
    ).toThrow(/carry cap exceeded/);
  });

  test('pending won ring (in_carry=0) not in carry set → delete is no-op → net +1 → correctly blocked at cap', () => {
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Fill carry to exactly the cap.
    for (let i = 0; i < cap; i++) {
      makeRing(dbInstance, p, { inCarry: 1 });
    }
    // phantomOldHeart simulates the old heart ring that would join the carry.
    const phantomOldHeart = `oldheart_pending_${Math.random().toString(36).slice(2)}`;
    // notInCarry simulates a pending won ring (in_carry=0): it is NOT in the carry
    // set, so Set.delete is a no-op and the guard sees count = cap + 1.
    const notInCarry = `pending_won_${Math.random().toString(36).slice(2)}`;
    expect(() =>
      repo.assertCarryWithinCap(p, { adding: [phantomOldHeart], removing: [notInCarry] }),
    ).toThrow(/carry cap exceeded/);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 adversarial edge cases (#376)
// ---------------------------------------------------------------------------

describe('carriedCountAfter — adversarial edge cases (#376)', () => {
  test('adding an id already in the carried set does not inflate count above actual carry', () => {
    // #376 adversarial: Set.add on an existing id must be idempotent — a caller cannot
    // smuggle an extra ring past the cap guard by repeating a carried id in the adding array
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    makeRing(dbInstance, p, { inCarry: 1 });
    // r1 is already in carry; adding it again must keep count at 2, not inflate to 3
    expect(repo.carriedCountAfter(p, { adding: [r1] })).toBe(2);
  });

  test('removing more ids than are in carry does not produce a negative count', () => {
    // #376 adversarial: Set.delete is a no-op for missing ids, so over-removing can never
    // drive count negative — a crafted removing list should not trick the guard into thinking
    // there is phantom free capacity
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    const phantom1 = `phantom_rm1_${Math.random().toString(36).slice(2)}`;
    const phantom2 = `phantom_rm2_${Math.random().toString(36).slice(2)}`;
    // 1 ring in carry, removing 3 ids (1 real + 2 phantoms) — result must be 0, never negative
    const count = repo.carriedCountAfter(p, { removing: [r1, phantom1, phantom2] });
    expect(count).toBe(0);
  });

  test('empty adding + empty removing at exactly cap returns cap without throwing', () => {
    // #376 adversarial: no-op delta at the cap boundary — carriedCountAfter(p, {}) must
    // equal cap and assertCarryWithinCap(p, {}) must NOT throw (the contract is n > cap, not >=)
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    for (let i = 0; i < cap; i++) makeRing(dbInstance, p, { inCarry: 1 });
    expect(repo.carriedCountAfter(p, { adding: [], removing: [] })).toBe(cap);
    expect(() => repo.assertCarryWithinCap(p, { adding: [], removing: [] })).not.toThrow();
  });

  test('assertCarryWithinCap at post-delta count exactly equal to cap does not throw', () => {
    // #376 adversarial: boundary n === cap must NOT throw — the off-by-one between > and >=
    // would silently block valid swaps that land precisely at the cap
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Seed cap-1 rings in carry, then add one phantom → post-delta count = cap exactly
    for (let i = 0; i < cap - 1; i++) makeRing(dbInstance, p, { inCarry: 1 });
    const newId = `exact_cap_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertCarryWithinCap(p, { adding: [newId] })).not.toThrow();
  });

  test('assertCarryWithinCap with post-delta count one above cap throws carry cap exceeded', () => {
    // #376 adversarial: count = cap + 1 must throw — confirms the guard fires precisely at
    // cap+1 and no sooner; this is the companion test to the cap-exactly-does-not-throw case
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Seed exactly cap rings, then try adding one more phantom → count = cap + 1
    for (let i = 0; i < cap; i++) makeRing(dbInstance, p, { inCarry: 1 });
    const overflow = `overflow_${Math.random().toString(36).slice(2)}`;
    expect(() => repo.assertCarryWithinCap(p, { adding: [overflow] })).toThrow(
      /carry cap exceeded/,
    );
  });

  test('three repetitions of the same id in adding are deduplicated to a single slot', () => {
    // #376 adversarial: must handle >2 repetitions; a naive loop-push would inflate count
    // by N-1 extra phantom insertions, bypassing the cap guard for any N≥2
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, { inCarry: 1 }); // 1 in carry
    const dupId = `tripleDup_${Math.random().toString(36).slice(2)}`;
    // Adding the same phantom id three times must add it only once → count stays at 2
    expect(repo.carriedCountAfter(p, { adding: [dupId, dupId, dupId] })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 implementation-aware tests (#376)
// ---------------------------------------------------------------------------

describe('packLoadout — carry cap migration (#376)', () => {
  test('packLoadout with exactly cap rings succeeds without throwing', () => {
    // #376 adversarial: packLoadout uses assertCarryWithinCap(playerId, { adding: unique, removing: getCarry(...) })
    // — a net-zero swap should never throw at cap; previously the inline unique.length > cap
    // used the new count directly and could off-by-one on the swap delta
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Build a set of exactly cap ring ids, all owned by the player (in_carry starts 0)
    const ringIds: string[] = [];
    for (let i = 0; i < cap; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    // The heart ring from createPlayer is counted separately — but this bare test uses makePlayer
    // from the unit helper which does NOT call createPlayer, so there is no heart ring here.
    // packLoadout should succeed: the player owns exactly cap rings, none currently in carry.
    expect(() => repo.packLoadout(p, ringIds)).not.toThrow();
    // All cap rings are now carried
    expect(repo.getCarry(p).length).toBe(cap);
  });

  test('packLoadout with one ring above cap throws carry cap exceeded', () => {
    // #376 adversarial: packLoadout with cap+1 rings must throw; this was already guarded
    // by the inline check before the migration — confirms the primitive replacement is equivalent
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    const ringIds: string[] = [];
    for (let i = 0; i < cap + 1; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    expect(() => repo.packLoadout(p, ringIds)).toThrow(/carry cap exceeded/);
  });

  test('packLoadout still enforces the reliquary cap guard independently of carry cap', () => {
    // #376 adversarial: carrying fewer rings than cap but owning more rings than reliquary_cap
    // must throw Reliquary full — the #182 guard must not be silently removed by the carry-cap
    // primitive migration
    const p = makePlayer(dbInstance);
    const reliquaryCap = repo.getReliquaryCap(p); // default RELIQUARY_BASE_CAP = 9
    const carryCount = 2; // well within carry cap
    const carryIds: string[] = [];
    for (let i = 0; i < carryCount; i++) {
      carryIds.push(makeRing(dbInstance, p, { inCarry: 0 }));
    }
    // Fill the reliquary above cap: create reliquaryCap+1 extra non-carried rings
    for (let i = 0; i < reliquaryCap + 1; i++) {
      makeRing(dbInstance, p, { inCarry: 0 });
    }
    // packLoadout with just carryIds — total non-escrow rings = carryCount + reliquaryCap + 1
    // resulting reliquary = (carryCount + reliquaryCap + 1) - carryCount = reliquaryCap + 1 > reliquaryCap
    expect(() => repo.packLoadout(p, carryIds)).toThrow(/Reliquary full/);
  });
});

describe('saveLoadout — carry cap migration (#376)', () => {
  test('saveLoadout at carry cap succeeds (pointer swap, not a carry count change)', () => {
    // #376 adversarial: saveLoadout calls assertCarryWithinCap(playerId) with no delta,
    // which checks current carry count ≤ cap — a player at cap who is merely swapping
    // loadout slot assignments (no carry count change) must not be blocked
    const p = makePlayer(dbInstance);
    const cap = repo.getCarryCap(p);
    // Seed cap rings all in carry
    const ringIds: string[] = [];
    for (let i = 0; i < cap; i++) {
      ringIds.push(makeRing(dbInstance, p, { inCarry: 1 }));
    }
    // Save a loadout reassigning existing carried rings — carry count stays at cap
    // (saveLoadout only changes which carried ring maps to which slot, not carry count)
    const partial = { thumb: ringIds[0], a1: ringIds[1], a2: ringIds[2], d1: ringIds[3], d2: ringIds[4] };
    expect(() => repo.saveLoadout(p, partial)).not.toThrow();
  });
});

describe('setHeartRing removing — non-carry ids do not create negative phantom capacity (#376)', () => {
  test('assertCarryWithinCap removing list with a mix of carried and non-carried ids floors at 0', () => {
    // #376 adversarial: the removing array in assertCarryWithinCap may include ids that are NOT
    // in the current carry set (e.g. a pending won ring with in_carry=0); Set.delete must be
    // a no-op for those ids so the resulting count is never lower than 0 — no phantom capacity
    const p = makePlayer(dbInstance);
    const r1 = makeRing(dbInstance, p, { inCarry: 1 });
    const r2 = makeRing(dbInstance, p, { inCarry: 1 });
    const notCarried = makeRing(dbInstance, p, { inCarry: 0 }); // in reliquary
    // Removing 2 carried + 1 non-carried; the non-carried delete is a no-op
    const count = repo.carriedCountAfter(p, { removing: [r1, r2, notCarried] });
    expect(count).toBe(0); // only the 2 carried were deleted; non-carried was a no-op
  });
});
