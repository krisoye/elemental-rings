import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';

// ---------------------------------------------------------------------------
// #182 — Reliquary capacity cap + Shard expansion.
//
// Each test section shares a single throwaway DB (one beforeAll per describe).
// DB_PATH must be set before the first import of db.ts (a process-level singleton).
// We use a single process-wide DB_PATH here, initialised once in the outermost
// beforeAll, because vitest's `threads` pool gives each file its own module
// registry, so dynamic import picks up the env that is set at import time.
// ---------------------------------------------------------------------------

const RELIQUARY_BASE_CAP = 20;
const RELIQUARY_SHARD_INCREMENT = 10;

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;

// Helpers -------------------------------------------------------------------

/** Insert a bare ring owned by playerId (not in_carry, not escrowed). */
function makeRing(
  db: import('better-sqlite3').Database,
  playerId: string,
  element: number = ElementEnum.FIRE,
  inCarry = 0,
  escrowed = 0,
): string {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed)
     VALUES (?, ?, ?, 0, 3, 3, 0, ?, ?)`,
  ).run(id, playerId, element, inCarry, escrowed);
  return id;
}

/** Create a player row + empty loadout; no starter rings. */
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
    `er-reliquary-test-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
});

// ---------------------------------------------------------------------------
// getReliquaryCount
// ---------------------------------------------------------------------------

describe('getReliquaryCount', () => {
  test('counts only in_carry=0 AND escrowed=0 rings', () => {
    const p = makePlayer(dbInstance);
    // Three resting rings → should count.
    makeRing(dbInstance, p, ElementEnum.FIRE, 0, 0);
    makeRing(dbInstance, p, ElementEnum.WATER, 0, 0);
    makeRing(dbInstance, p, ElementEnum.WOOD, 0, 0);
    // One carried ring → must NOT count.
    makeRing(dbInstance, p, ElementEnum.WIND, 1, 0);
    // One escrowed ring → must NOT count.
    makeRing(dbInstance, p, ElementEnum.EARTH, 0, 1);

    expect(repo.getReliquaryCount(p)).toBe(3);
  });

  test('returns 0 for a player with no resting rings', () => {
    const p = makePlayer(dbInstance);
    // Only carried rings.
    makeRing(dbInstance, p, ElementEnum.FIRE, 1, 0);
    makeRing(dbInstance, p, ElementEnum.WATER, 1, 0);

    expect(repo.getReliquaryCount(p)).toBe(0);
  });

  test('excludes escrowed-only rings', () => {
    const p = makePlayer(dbInstance);
    makeRing(dbInstance, p, ElementEnum.FIRE, 0, 1);
    makeRing(dbInstance, p, ElementEnum.WATER, 0, 1);

    expect(repo.getReliquaryCount(p)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// packLoadout — Reliquary cap guard
// ---------------------------------------------------------------------------

describe('packLoadout — Reliquary cap guard', () => {
  test('call that lands exactly at cap succeeds', () => {
    const p = makePlayer(dbInstance);
    // Create RELIQUARY_BASE_CAP rings total; carry all of them → 0 resting.
    // Then carry (cap−1) of them → 1 resting — which equals cap would be too many.
    // Instead: create cap+1 rings, carry 1, rest = cap → exactly at cap → OK.
    const ringIds: string[] = [];
    for (let i = 0; i <= RELIQUARY_BASE_CAP; i++) {
      ringIds.push(makeRing(dbInstance, p));
    }
    // Carry only the first ring; the rest (RELIQUARY_BASE_CAP) go to the Reliquary.
    expect(() => repo.packLoadout(p, [ringIds[0]])).not.toThrow();
    expect(repo.getReliquaryCount(p)).toBe(RELIQUARY_BASE_CAP);
  });

  test('call that would push resting count over cap throws "Reliquary full"', () => {
    const p = makePlayer(dbInstance);
    // Create RELIQUARY_BASE_CAP + 2 rings total; carry 1 → RELIQUARY_BASE_CAP + 1
    // would rest → over cap → must throw.
    for (let i = 0; i < RELIQUARY_BASE_CAP + 2; i++) {
      makeRing(dbInstance, p);
    }
    const allRings = dbInstance
      .prepare('SELECT id FROM rings WHERE owner_id = ? AND escrowed = 0')
      .all(p) as Array<{ id: string }>;

    // Carry only one ring → rest = RELIQUARY_BASE_CAP + 1 → over cap.
    expect(() => repo.packLoadout(p, [allRings[0].id])).toThrow('Reliquary full');
  });

  test('escrowed rings do not count against Reliquary cap', () => {
    const p = makePlayer(dbInstance);
    // Create RELIQUARY_BASE_CAP resting rings + 5 escrowed rings.
    // Carrying 0 → resting = RELIQUARY_BASE_CAP → exactly at cap (OK).
    const carryIds: string[] = [];
    for (let i = 0; i < RELIQUARY_BASE_CAP; i++) {
      makeRing(dbInstance, p, ElementEnum.FIRE, 0, 0);
    }
    for (let i = 0; i < 5; i++) {
      makeRing(dbInstance, p, ElementEnum.WATER, 0, 1); // escrowed
    }
    // carryIds is empty → carry nothing; resting = RELIQUARY_BASE_CAP (escrowed excluded).
    expect(() => repo.packLoadout(p, carryIds)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// grantShard
// ---------------------------------------------------------------------------

describe('grantShard', () => {
  test('increments reliquary_shards by 1', () => {
    const p = makePlayer(dbInstance);
    expect(repo.getReliquaryShards(p)).toBe(0);

    repo.grantShard(p);
    expect(repo.getReliquaryShards(p)).toBe(1);

    repo.grantShard(p);
    expect(repo.getReliquaryShards(p)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// addReliquaryShardToReliquary
// ---------------------------------------------------------------------------

describe('addReliquaryShardToReliquary', () => {
  test('returns false when the player holds 0 Shards', () => {
    const p = makePlayer(dbInstance);
    expect(repo.getReliquaryShards(p)).toBe(0);

    const result = repo.addReliquaryShardToReliquary(p);
    expect(result).toBe(false);
    // Cap and shards unchanged.
    expect(repo.getReliquaryCap(p)).toBe(RELIQUARY_BASE_CAP);
    expect(repo.getReliquaryShards(p)).toBe(0);
  });

  test('returns true, decrements shards, and increments cap by RELIQUARY_SHARD_INCREMENT', () => {
    const p = makePlayer(dbInstance);
    repo.grantShard(p);
    repo.grantShard(p);
    expect(repo.getReliquaryShards(p)).toBe(2);

    const result = repo.addReliquaryShardToReliquary(p);
    expect(result).toBe(true);
    expect(repo.getReliquaryShards(p)).toBe(1); // 2 − 1
    expect(repo.getReliquaryCap(p)).toBe(RELIQUARY_BASE_CAP + RELIQUARY_SHARD_INCREMENT); // 30

    // Second expansion.
    const result2 = repo.addReliquaryShardToReliquary(p);
    expect(result2).toBe(true);
    expect(repo.getReliquaryShards(p)).toBe(0);
    expect(repo.getReliquaryCap(p)).toBe(RELIQUARY_BASE_CAP + 2 * RELIQUARY_SHARD_INCREMENT); // 40
  });

  test('returns false after all Shards are spent', () => {
    const p = makePlayer(dbInstance);
    repo.grantShard(p);

    expect(repo.addReliquaryShardToReliquary(p)).toBe(true);
    expect(repo.addReliquaryShardToReliquary(p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getReliquaryCap — reads from DB column (not hardcoded)
// ---------------------------------------------------------------------------

describe('getReliquaryCap', () => {
  test('fresh player returns RELIQUARY_BASE_CAP', () => {
    const p = makePlayer(dbInstance);
    expect(repo.getReliquaryCap(p)).toBe(RELIQUARY_BASE_CAP);
  });

  test('after Shard expansion, returns updated cap', () => {
    const p = makePlayer(dbInstance);
    repo.grantShard(p);
    repo.addReliquaryShardToReliquary(p);
    expect(repo.getReliquaryCap(p)).toBe(RELIQUARY_BASE_CAP + RELIQUARY_SHARD_INCREMENT);
  });
});
