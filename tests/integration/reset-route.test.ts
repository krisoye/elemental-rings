/**
 * Integration tests for POST /api/me/reset (#476).
 *
 * Verifies the resetPlayer transaction + route: a player who has accrued game
 * state (extra gold, extra ring, NPC defeat, extra attunement) is wiped back to
 * the starter inventory in a single round-trip. Also guards the seedStarterInventory
 * refactor — createPlayer must still yield the same 11-ring starter package.
 *
 * Pattern: ephemeral SQLite DB + production apiRouter on an ephemeral port,
 * matching loadout-route.test.ts.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];
let httpServer: http.Server;
let baseUrl: string;

// ---------------------------------------------------------------------------
// Setup — same ephemeral-DB pattern as loadout-route.test.ts
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-reset-route-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const { apiRouter } = await import('../../server/src/api/routes');

  const app = express();
  app.use(express.json());
  app.use(apiRouter);
  httpServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = httpServer.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port assigned');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    httpServer.close((err) => (err ? reject(err) : resolve())),
  );
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function getMeJson(token: string) {
  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function postReset(token?: string) {
  const res = await fetch(`${baseUrl}/api/me/reset`, {
    method: 'POST',
    headers: token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Register a fresh player via createPlayer + signToken; return { playerId, token }. */
function makePlayer(): { playerId: string; token: string } {
  const username = `reset_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const playerId = repo.createPlayer(username, 'hash-placeholder');
  return { playerId, token: signToken({ playerId, username }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/me/reset (#476)', () => {
  test('401 when no auth token provided', async () => {
    const { status, json } = await postReset();
    expect(status).toBe(401);
    expect(json).toHaveProperty('error');
  });

  test('reset response has identical shape to GET /api/me', async () => {
    const { playerId, token } = makePlayer();
    // Accrue some state so reset is non-trivial.
    repo.addGold(playerId, 500);

    const resetRes = await postReset(token);
    expect(resetRes.status).toBe(200);

    // Response must carry the same top-level keys as GET /api/me.
    expect(resetRes.json).toHaveProperty('player');
    expect(resetRes.json).toHaveProperty('rings');
    expect(resetRes.json).toHaveProperty('loadout');
  });

  test('after reset: player.gold=200, reliquary_cap=9, difficulty="seeker"', async () => {
    const { playerId, token } = makePlayer();

    // Accrue state: extra gold, an extra ring via direct DB insert, an NPC defeat,
    // and a non-forest_entry attunement.
    repo.addGold(playerId, 9000); // gold way above starter
    dbInstance.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot, pending)
       VALUES (?, ?, 0, 0, 3, 3, 0, 0, 0, 0, 0)`,
    ).run(`extra_ring_${Math.random().toString(36).slice(2)}`, playerId);
    repo.attuneWaystone(playerId, 'forest_glade'); // a non-forest_entry attunement
    repo.recordNpcDefeat(playerId, 'moss_mage');

    const { status, json } = await postReset(token);
    expect(status).toBe(200);

    const player = json.player as Record<string, unknown>;
    expect(player.gold).toBe(200);
    expect(player.reliquaryCap).toBe(9);
    expect(player.difficulty).toBe('seeker');
  });

  test('after reset: exactly 10 rings in rings array (heart excluded), 5-slot loadout filled', async () => {
    const { token } = makePlayer();

    const { status, json } = await postReset(token);
    expect(status).toBe(200);

    // GET /api/me filters heart_slot=1 rings → 10 visible rings (5 carry + 5 reliquary).
    const rings = json.rings as Array<Record<string, unknown>>;
    expect(rings.length).toBe(10);
    // All rings must have xp=0 (fresh starter inventory).
    for (const r of rings) {
      expect(r.xp).toBe(0);
    }

    // Loadout must have all 5 slots filled (5 battle-hand rings).
    const loadout = json.loadout as Record<string, string | null> | null;
    expect(loadout).not.toBeNull();
    expect(loadout!.thumb).toBeTruthy();
    expect(loadout!.a1).toBeTruthy();
    expect(loadout!.a2).toBeTruthy();
    expect(loadout!.d1).toBeTruthy();
    expect(loadout!.d2).toBeTruthy();
  });

  test('after reset: total ring count is 11 (1 heart + 5 battle + 5 reliquary)', async () => {
    const { playerId, token } = makePlayer();

    await postReset(token);

    // All rings in the DB for this player = 11.
    const totalRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(totalRings).toBe(11);

    // 1 heart ring.
    const heartRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND heart_slot = 1')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(heartRings).toBe(1);

    // 5 battle-hand rings (in_carry=1, heart_slot=0).
    const carryRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 1 AND heart_slot = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(carryRings).toBe(5);

    // 5 reliquary rings (in_carry=0, heart_slot=0).
    const reliquaryRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 0 AND heart_slot = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(reliquaryRings).toBe(5);
  });

  test('after reset: npc_defeats, shrines, forage_nodes cleared; only forest_entry attunement remains', async () => {
    const { playerId, token } = makePlayer();

    // Seed state that reset must clear.
    repo.attuneWaystone(playerId, 'forest_glade');
    repo.recordNpcDefeat(playerId, 'moss_mage');
    dbInstance.prepare(
      `INSERT OR IGNORE INTO forage_nodes (node_id, player_id, depleted_day) VALUES (?, ?, ?)`,
    ).run('berry_bush_1', playerId, 0);
    dbInstance.prepare(
      `INSERT OR IGNORE INTO shrines (player_id, shrine_id, unlocked_at) VALUES (?, ?, ?)`,
    ).run(playerId, 'thornado_shrine', 0);

    await postReset(token);

    // NPC defeats cleared.
    const npcCount = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM npc_defeats WHERE player_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(npcCount).toBe(0);

    // Shrines cleared.
    const shrineCount = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM shrines WHERE player_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(shrineCount).toBe(0);

    // Forage nodes cleared.
    const forageCount = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM forage_nodes WHERE player_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(forageCount).toBe(0);

    // Only forest_entry attunement remains (seeded by seedStarterInventory).
    const attunements = (
      dbInstance
        .prepare('SELECT waystone_id FROM waystone_attunements WHERE player_id = ?')
        .all(playerId) as Array<{ waystone_id: string }>
    ).map((r) => r.waystone_id);
    expect(attunements).toEqual(['forest_entry']);
  });

  test('after reset: stored players.spirit_max reflects seeded Reliquary (not the 50 floor)', async () => {
    // BattleRoom reads players.spirit_max directly to seed the vsAI gauge / NPC
    // pool, so resetPlayer must refresh the stored column after re-seeding.
    // 5 reliquary rings × 3 max_uses × seeker multiplier (4) = 60.
    const { playerId, token } = makePlayer();
    await postReset(token);
    const row = dbInstance
      .prepare('SELECT spirit_max, spirit_current FROM players WHERE id = ?')
      .get(playerId) as { spirit_max: number; spirit_current: number };
    expect(row.spirit_max).toBe(60);
    // spirit_current is clamped to spirit_max (60); the 50 floor is below the cap,
    // so it remains 50 per the issue's starter-default contract.
    expect(row.spirit_current).toBe(50);
  });

  test('after reset: talisman_loadout has exactly one row (empty necklace)', async () => {
    const { playerId, token } = makePlayer();

    await postReset(token);

    const tRow = dbInstance
      .prepare('SELECT necklace_id, necklace_charges FROM talisman_loadout WHERE player_id = ?')
      .get(playerId) as { necklace_id: string | null; necklace_charges: number } | undefined;
    expect(tRow).toBeDefined();
    expect(tRow!.necklace_id).toBeNull();
    expect(tRow!.necklace_charges).toBe(0);
  });

  test('GET /api/me after reset returns the same data as the reset response', async () => {
    const { token } = makePlayer();

    const resetRes = await postReset(token);
    expect(resetRes.status).toBe(200);

    const meRes = await getMeJson(token);
    expect(meRes.status).toBe(200);

    // Player gold must match between the two responses.
    const resetPlayer = resetRes.json.player as Record<string, unknown>;
    const mePlayer = meRes.json.player as Record<string, unknown>;
    expect(resetPlayer.gold).toBe(mePlayer.gold);
    expect(resetPlayer.reliquaryCap).toBe(mePlayer.reliquaryCap);
    expect(resetPlayer.difficulty).toBe(mePlayer.difficulty);
  });
});

describe('createPlayer regression: starter inventory unchanged after refactor (#476)', () => {
  test('createPlayer produces 11 rings total (1 heart + 5 carry + 5 reliquary)', () => {
    const playerId = repo.createPlayer(
      `cp_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      'hash',
    );

    const totalRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(totalRings).toBe(11);

    const heartRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND heart_slot = 1')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(heartRings).toBe(1);

    const carryRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 1 AND heart_slot = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(carryRings).toBe(5);

    const reliquaryRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 0 AND heart_slot = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(reliquaryRings).toBe(5);
  });

  test('createPlayer seeds a 5-slot loadout fully filled', () => {
    const playerId = repo.createPlayer(
      `cp_loadout_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      'hash',
    );
    const loadout = repo.getLoadout(playerId);
    expect(loadout).toBeDefined();
    expect(loadout!.thumb).toBeTruthy();
    expect(loadout!.a1).toBeTruthy();
    expect(loadout!.a2).toBeTruthy();
    expect(loadout!.d1).toBeTruthy();
    expect(loadout!.d2).toBeTruthy();
  });

  test('createPlayer seeds exactly forest_entry attunement', () => {
    const playerId = repo.createPlayer(
      `cp_att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      'hash',
    );
    const attunements = repo.getAttunements(playerId);
    expect(attunements).toEqual(['forest_entry']);
  });

  test('createPlayer and resetPlayer produce identical starter ring counts', () => {
    const cpId = repo.createPlayer(
      `cp_compare_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      'hash',
    );
    const rpId = repo.createPlayer(
      `rp_compare_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      'hash',
    );

    // Give the reset candidate some state to wipe first.
    repo.addGold(rpId, 9999);
    repo.attuneWaystone(rpId, 'forest_glade');
    repo.recordNpcDefeat(rpId, 'moss_mage');

    // Reset back to starter.
    repo.resetPlayer(rpId);

    const count = (id: string, filter: string): number =>
      (
        dbInstance
          .prepare(`SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND ${filter}`)
          .get(id) as { cnt: number }
      ).cnt;

    // Both players must have identical ring distribution.
    expect(count(rpId, 'heart_slot = 1')).toBe(count(cpId, 'heart_slot = 1'));
    expect(count(rpId, 'in_carry = 1 AND heart_slot = 0')).toBe(
      count(cpId, 'in_carry = 1 AND heart_slot = 0'),
    );
    expect(count(rpId, 'in_carry = 0 AND heart_slot = 0')).toBe(
      count(cpId, 'in_carry = 0 AND heart_slot = 0'),
    );
  });
});
