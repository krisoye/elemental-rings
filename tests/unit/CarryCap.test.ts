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
});
