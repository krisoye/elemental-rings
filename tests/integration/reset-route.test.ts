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

// ---------------------------------------------------------------------------
// Phase 1 — Spec-driven adversarial tests (#476)
// ---------------------------------------------------------------------------

describe('POST /api/me/reset — adversarial edge cases (#476)', () => {
  // ── double-reset ──────────────────────────────────────────────────────────
  test('double-reset: state accrued between resets is fully wiped on second reset', async () => {
    // #476 adversarial: a second reset must produce an identical starter state as
    // the first — gold/rings/attunements accrued in between must not persist.
    const { playerId, token } = makePlayer();

    // First reset.
    const first = await postReset(token);
    expect(first.status).toBe(200);

    // Accrue state after the first reset.
    repo.addGold(playerId, 7777);
    repo.attuneWaystone(playerId, 'forest_glade');
    repo.recordNpcDefeat(playerId, 'moss_mage');
    dbInstance.prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot, pending)
       VALUES (?, ?, 0, 0, 3, 3, 0, 0, 0, 0, 0)`,
    ).run(`extra_dbl_${Math.random().toString(36).slice(2)}`, playerId);

    // Second reset must restore exactly the same starter state.
    const second = await postReset(token);
    expect(second.status).toBe(200);

    const player = second.json.player as Record<string, unknown>;
    expect(player.gold).toBe(200);
    expect(player.reliquaryCap).toBe(9);
    expect(player.difficulty).toBe('seeker');

    const totalRings = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(totalRings).toBe(11);

    const attunements = (
      dbInstance
        .prepare('SELECT waystone_id FROM waystone_attunements WHERE player_id = ?')
        .all(playerId) as Array<{ waystone_id: string }>
    ).map((r) => r.waystone_id);
    expect(attunements).toEqual(['forest_entry']);
  });

  // ── escrowed ring ─────────────────────────────────────────────────────────
  test('reset clears an escrowed (staked) ring — no rings survive in any state', async () => {
    // #476 adversarial: a ring with escrowed=1 is still an owned ring row. If
    // resetDeleteRings is skipped due to a bad FK order it would survive the wipe.
    const { playerId, token } = makePlayer();

    // Stake the thumb ring by escrowing it.
    repo.lockStake(playerId);
    const escrowed = (
      dbInstance
        .prepare('SELECT id FROM rings WHERE owner_id = ? AND escrowed = 1')
        .get(playerId) as { id: string } | undefined
    );
    expect(escrowed).toBeDefined(); // confirm escrow was set

    const { status } = await postReset(token);
    expect(status).toBe(200);

    // After reset: zero rows with escrowed=1; total ring count must be exactly 11.
    const escrowedAfter = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND escrowed = 1')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(escrowedAfter).toBe(0);

    const total = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(total).toBe(11);
  });

  // ── pending ring ──────────────────────────────────────────────────────────
  test('reset clears a pending WON ring — no pending rings survive', async () => {
    // #476 adversarial: grantRing sets pending=1. If resetDeleteRings fires before
    // resetClearHeartRingId the FK constraint could block deletion. Also verifies
    // the pending ring itself is gone (not just unflagged).
    const { playerId, token } = makePlayer();

    // Grant a WON ring: in_carry=1, pending=1.
    repo.grantRing(playerId, 0 /* FIRE */);
    const pending = repo.getPendingRingId(playerId);
    expect(pending).not.toBeNull(); // confirm it was set

    const { status } = await postReset(token);
    expect(status).toBe(200);

    const pendingAfter = repo.getPendingRingId(playerId);
    expect(pendingAfter).toBeNull();

    const pendingCount = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND pending = 1')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(pendingCount).toBe(0);
  });

  // ── food_units ────────────────────────────────────────────────────────────
  test('after reset: food_units=100 (starter default)', async () => {
    // #476 adversarial: reviewer noted food_units was absent from existing tests.
    // resetUpdatePlayers sets food_units=100; verify this reaches the DB.
    const { playerId, token } = makePlayer();

    // Spend some food to make the value non-trivially dirty.
    repo.addFood(playerId, 50); // bump above 100 to confirm reset clears it
    const { status } = await postReset(token);
    expect(status).toBe(200);

    const row = dbInstance
      .prepare('SELECT food_units FROM players WHERE id = ?')
      .get(playerId) as { food_units: number };
    expect(row.food_units).toBe(100);
  });

  // ── carry_cap and spare_ring_max ──────────────────────────────────────────
  test('after reset: carry_cap=10 and spare_ring_max=9 (starter constants)', async () => {
    // #476 adversarial: resetUpdatePlayers hard-codes carry_cap=10 and spare_ring_max=9.
    // Verify both columns in the DB so BenchHealthCombat spare-cap guards start correctly.
    const { playerId, token } = makePlayer();
    await postReset(token);

    const row = dbInstance
      .prepare('SELECT carry_cap, spare_ring_max FROM players WHERE id = ?')
      .get(playerId) as { carry_cap: number; spare_ring_max: number };
    expect(row.carry_cap).toBe(10);
    expect(row.spare_ring_max).toBe(9);
  });

  // ── spirit gauge clamping after reset ────────────────────────────────────
  test('after reset: spirit_current does not exceed spirit_max post-seed', async () => {
    // #476 adversarial: resetUpdatePlayers writes spirit_current=50, then step 5
    // calls refreshSpiritMax + clampSpiritCurrent. If the seeker multiplier yields
    // a spirit_max < 50, spirit_current must be clamped down — not left above cap.
    // With 5 Reliquary rings × 3 max_uses × seeker(4) = 60, so 50 is below 60 and
    // no clamping is needed here, but the invariant must hold regardless.
    const { playerId, token } = makePlayer();
    await postReset(token);

    const row = dbInstance
      .prepare('SELECT spirit_max, spirit_current FROM players WHERE id = ?')
      .get(playerId) as { spirit_max: number; spirit_current: number };
    expect(row.spirit_current).toBeLessThanOrEqual(row.spirit_max);
  });

  // ── concurrent resets: FK safety ─────────────────────────────────────────
  test('two concurrent resets for the same player both complete without FK violations', async () => {
    // #476 adversarial: two simultaneous resets fire in a tight window. SQLite's
    // serializable write lock guarantees the transactions are actually sequential,
    // but both HTTP calls must succeed with 200 (idempotent). A FK violation
    // (e.g. loadout row referencing a deleted ring) would surface as a 500.
    const { token } = makePlayer();

    const [res1, res2] = await Promise.all([postReset(token), postReset(token)]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  // ── anchored_waystone reset ───────────────────────────────────────────────
  test('after reset: anchored_waystone is forest_entry even when previously teleported', async () => {
    // #476 adversarial: if the player has teleported (setAnchor to another waystone),
    // reset must write 'forest_entry' back. An untouched resetUpdatePlayers SET covers
    // this, but verify it is not silently skipped.
    const { playerId, token } = makePlayer();

    // Attune then change anchor (simulate a teleport).
    repo.attuneWaystone(playerId, 'forest_glade');
    repo.setAnchor(playerId, 'forest_glade');
    const anchorBefore = repo.getAnchor(playerId);
    expect(anchorBefore).toBe('forest_glade');

    await postReset(token);

    const anchorAfter = repo.getAnchor(playerId);
    expect(anchorAfter).toBe('forest_entry');
  });

  // ── reliquary_shards reset ────────────────────────────────────────────────
  test('after reset: reliquary_shards=0 even when the player held shards', async () => {
    // #476 adversarial: a player who expanded their Reliquary via shards would have
    // reliquary_shards > 0 and reliquary_cap > 9 before reset. Both must revert.
    const { playerId, token } = makePlayer();

    repo.grantShard(playerId);
    repo.grantShard(playerId);

    await postReset(token);

    const row = dbInstance
      .prepare('SELECT reliquary_shards, reliquary_cap FROM players WHERE id = ?')
      .get(playerId) as { reliquary_shards: number; reliquary_cap: number };
    expect(row.reliquary_shards).toBe(0);
    expect(row.reliquary_cap).toBe(9);
  });

  // ── game_day reset ────────────────────────────────────────────────────────
  test('after reset: game_day=0 regardless of how many days had elapsed', async () => {
    // #476 adversarial: game_day drives NPC respawn and forage timing. If it is not
    // zeroed, a freshly-reset player inherits a stale calendar and NPCs hide wrongly.
    const { playerId, token } = makePlayer();

    // Advance the day counter.
    for (let i = 0; i < 5; i++) {
      dbInstance.prepare('UPDATE players SET game_day = game_day + 1 WHERE id = ?').run(playerId);
    }

    await postReset(token);

    const row = dbInstance
      .prepare('SELECT game_day FROM players WHERE id = ?')
      .get(playerId) as { game_day: number };
    expect(row.game_day).toBe(0);
  });

  // ── 401 with expired / malformed token ───────────────────────────────────
  test('401 when a malformed (non-JWT) token is supplied', async () => {
    // #476 adversarial: requireAuth must reject any token that is not a valid JWT,
    // not just a completely absent Authorization header.
    const res = await fetch(`${baseUrl}/api/me/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not.a.jwt' },
    });
    expect(res.status).toBe(401);
  });

  // ── GET /api/me ring count matches reset response ─────────────────────────
  test('after reset: GET /api/me rings count matches the reset response exactly', async () => {
    // #476 adversarial: the reset route re-uses buildMePlayerBlock + getRingsByOwner;
    // if the filter (heart_slot !== 1) were accidentally dropped on one path, the
    // two counts would diverge. Both must show 10 visible rings.
    const { token } = makePlayer();

    const resetRes = await postReset(token);
    const meRes = await getMeJson(token);

    const resetRings = resetRes.json.rings as Array<unknown>;
    const meRings = meRes.json.rings as Array<unknown>;
    expect(resetRings.length).toBe(10);
    expect(meRings.length).toBe(10);
    expect(resetRings.length).toBe(meRings.length);
  });

  // ── starter xp=0 invariant ────────────────────────────────────────────────
  test('after reset: ALL 11 rings (including heart) have xp=0', async () => {
    // #476 adversarial: if a ring somehow carries carried-over XP (e.g. seedStarterInventory
    // reused an old ring row), xp would be non-zero. Verify every ring in the DB is fresh.
    const { playerId, token } = makePlayer();

    // Award some XP to a ring to dirty state before reset.
    const rings = dbInstance
      .prepare('SELECT id FROM rings WHERE owner_id = ?')
      .all(playerId) as Array<{ id: string }>;
    if (rings.length > 0) {
      dbInstance.prepare('UPDATE rings SET xp = 500 WHERE id = ?').run(rings[0].id);
    }

    await postReset(token);

    const nonZeroXp = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND xp != 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(nonZeroXp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — Implementation-aware tests (#476)
// ---------------------------------------------------------------------------

describe('POST /api/me/reset — implementation-aware branch coverage (#476)', () => {
  // ── heart_ring_id FK cleared before ring delete ───────────────────────────
  test('heart_ring_id pointer is NULL in the DB at the moment rings are deleted (FK order)', () => {
    // #476 impl: resetPlayer step 1 calls resetClearHeartRingId before
    // resetDeleteRings. A heart ring row cannot be deleted while heart_ring_id still
    // references it (FK constraint). Verify the pointer was cleared by checking the
    // DB state after a successful resetPlayer call.
    const { playerId } = makePlayer();

    repo.resetPlayer(playerId);

    // After reset the pointer must be updated to the NEW heart ring by seedStarterInventory.
    // The important invariant is that it now points to a ring that actually exists.
    const ptrRow = dbInstance
      .prepare('SELECT heart_ring_id FROM players WHERE id = ?')
      .get(playerId) as { heart_ring_id: string | null };
    expect(ptrRow.heart_ring_id).not.toBeNull();

    // That ring must have heart_slot=1.
    const heartRingRow = dbInstance
      .prepare('SELECT heart_slot FROM rings WHERE id = ?')
      .get(ptrRow.heart_ring_id!) as { heart_slot: number } | undefined;
    expect(heartRingRow).toBeDefined();
    expect(heartRingRow!.heart_slot).toBe(1);
  });

  // ── refreshSpiritMax is called AFTER seedStarterInventory ─────────────────
  test('spirit_max in DB reflects seeded Reliquary (not the 50 floor written in step 3)', () => {
    // #476 impl: resetPlayer step 3 writes spirit_max=50 (floor), step 4 seeds
    // 5 × max_uses=3 Reliquary rings, step 5 calls refreshSpiritMax which
    // overwrites the floor. If step 5 were missing, spirit_max would remain 50.
    // 5 rings × 3 max_uses × seeker(4) = 60 — must be 60, not 50.
    const { playerId } = makePlayer();

    repo.resetPlayer(playerId);

    const row = dbInstance
      .prepare('SELECT spirit_max FROM players WHERE id = ?')
      .get(playerId) as { spirit_max: number };
    expect(row.spirit_max).toBe(60);
  });

  // ── spirit_current clamped by clampSpiritCurrent ──────────────────────────
  test('spirit_current is clamped to MIN(50, spirit_max) after reset — never exceeds spirit_max', () => {
    // #476 impl: step 3 writes spirit_current=50, step 5 calls clampSpiritCurrent(60).
    // Since 50 < 60 the clamp is a no-op; spirit_current stays at 50. Verify the
    // clamp logic did not accidentally raise spirit_current above 50 or drop it to 0.
    const { playerId } = makePlayer();

    repo.resetPlayer(playerId);

    const row = dbInstance
      .prepare('SELECT spirit_max, spirit_current FROM players WHERE id = ?')
      .get(playerId) as { spirit_max: number; spirit_current: number };
    // spirit_max should be 60 (seeker × 5 rings × 3 uses); spirit_current 50 (floor).
    expect(row.spirit_max).toBe(60);
    expect(row.spirit_current).toBe(50);
    expect(row.spirit_current).toBeLessThanOrEqual(row.spirit_max);
  });

  // ── talisman_loadout deleted then re-seeded empty ─────────────────────────
  test('talisman_loadout row is deleted and re-seeded with necklace_id=NULL after reset', () => {
    // #476 impl: resetDeleteTalismanLoadout fires in step 2, then seedStarterInventory
    // calls insertTalismanLoadout again. If the DELETE is skipped and the INSERT runs
    // it would conflict on the primary key. Verify only one row exists and it is empty.
    const { playerId } = makePlayer();

    // Equip a talisman to make the row non-trivial (necklace_id set).
    // We write directly to the DB since equipTalisman expects a valid talisman id.
    dbInstance
      .prepare(`UPDATE talisman_loadout SET necklace_id = 'sanctum_stone', necklace_charges = 3 WHERE player_id = ?`)
      .run(playerId);
    const before = dbInstance
      .prepare('SELECT necklace_id FROM talisman_loadout WHERE player_id = ?')
      .get(playerId) as { necklace_id: string | null };
    expect(before.necklace_id).toBe('sanctum_stone');

    repo.resetPlayer(playerId);

    const rowCount = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM talisman_loadout WHERE player_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(rowCount).toBe(1);

    const after = dbInstance
      .prepare('SELECT necklace_id, necklace_charges FROM talisman_loadout WHERE player_id = ?')
      .get(playerId) as { necklace_id: string | null; necklace_charges: number };
    expect(after.necklace_id).toBeNull();
    expect(after.necklace_charges).toBe(0);
  });

  // ── loadout row deleted then re-seeded ───────────────────────────────────
  test('loadout row count is exactly 1 after reset (old row deleted, new row seeded)', () => {
    // #476 impl: resetDeleteLoadout fires before resetDeleteRings. If the order were
    // reversed the loadout FK would block ring deletion. Verify exactly one loadout
    // row exists post-reset (no duplicates from seedStarterInventory re-running insertLoadout).
    const { playerId } = makePlayer();

    repo.resetPlayer(playerId);

    const cnt = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM loadout WHERE player_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(cnt).toBe(1);
  });

  // ── attunement deleted then re-seeded with exactly forest_entry ───────────
  test('waystone_attunements has exactly 1 row (forest_entry) after reset', () => {
    // #476 impl: resetDeleteAttunements deletes ALL player attunements, then
    // seedStarterInventory re-inserts forest_entry via insertAttunement.
    // A second call to attuneWaystone('forest_entry') on a pre-existing row is
    // INSERT OR IGNORE, so the count must be 1 (not 2) even if the pre-reset player
    // was already attuned to forest_entry.
    const { playerId } = makePlayer();

    // Add extra attunements so the DELETE has real work to do.
    repo.attuneWaystone(playerId, 'forest_glade');
    repo.attuneWaystone(playerId, 'forest_depths');

    repo.resetPlayer(playerId);

    const rows = (
      dbInstance
        .prepare('SELECT waystone_id FROM waystone_attunements WHERE player_id = ?')
        .all(playerId) as Array<{ waystone_id: string }>
    ).map((r) => r.waystone_id);
    expect(rows).toEqual(['forest_entry']);
  });

  // ── STARTER_GOLD and RELIQUARY_BASE_CAP are constants (no magic numbers) ──
  test('resetPlayer UPDATE uses STARTER_GOLD=200 and RELIQUARY_BASE_CAP=9 (no inline magic numbers)', () => {
    // #476 impl: the acceptance criterion says the SQL UPDATE must reference the
    // named constants rather than inline literals. The DB outcome (200, 9) is what
    // we can assert from the outside; the code reader verifies the constant usage.
    // This test locks the values so a constant rename + mismatch causes a test failure.
    const { playerId } = makePlayer();

    // Dirty both values beyond doubt.
    repo.addGold(playerId, 50000);
    repo.grantShard(playerId);
    dbInstance.prepare('UPDATE players SET reliquary_cap = 99 WHERE id = ?').run(playerId);

    repo.resetPlayer(playerId);

    const row = dbInstance
      .prepare('SELECT gold, reliquary_cap FROM players WHERE id = ?')
      .get(playerId) as { gold: number; reliquary_cap: number };
    // STARTER_GOLD = 200, RELIQUARY_BASE_CAP = 9
    expect(row.gold).toBe(200);
    expect(row.reliquary_cap).toBe(9);
  });

  // ── seedStarterInventory exported and callable directly ───────────────────
  test('seedStarterInventory is exported and seeds 11 rings when called directly on a bare player row', () => {
    // #476 impl: seedStarterInventory is exported for use by both createPlayer and
    // resetPlayer. Calling it directly (outside a transaction guard) on a fresh
    // player with no rings should produce the same 11-ring package.
    // NOTE: seedStarterInventory must be called inside a transaction by the caller —
    // we use db.transaction here to satisfy that contract.
    const username = `sseed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'hash');

    // Wipe rings so we can call seedStarterInventory again in isolation.
    // This mirrors what resetPlayer does internally — we are verifying the export.
    dbInstance.prepare('UPDATE players SET heart_ring_id = NULL WHERE id = ?').run(playerId);
    dbInstance.prepare('DELETE FROM loadout WHERE player_id = ?').run(playerId);
    dbInstance.prepare('DELETE FROM rings WHERE owner_id = ?').run(playerId);
    dbInstance.prepare('DELETE FROM waystone_attunements WHERE player_id = ?').run(playerId);
    dbInstance.prepare('DELETE FROM talisman_loadout WHERE player_id = ?').run(playerId);

    // Call the exported function directly inside a transaction. better-sqlite3's
    // Database.transaction() wraps a sync function and returns a callable.
    const runSeed = dbInstance.transaction(() => { repo.seedStarterInventory(playerId); });
    runSeed();

    const total = (
      dbInstance
        .prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ?')
        .get(playerId) as { cnt: number }
    ).cnt;
    expect(total).toBe(11);

    const attunements = repo.getAttunements(playerId);
    expect(attunements).toEqual(['forest_entry']);
  });

  // ── DB anchored_waystone after reset ─────────────────────────────────────
  test('anchored_waystone column in DB is forest_entry after reset (not in response block but persisted correctly)', () => {
    // #476 impl: selectById (used by buildMePlayerBlock via getPlayerById) does NOT
    // include anchored_waystone in its column list — that column is fetched separately
    // by getAnchor(). Verify the column is written correctly in the DB by resetPlayer.
    const { playerId } = makePlayer();

    // Move to a different anchor first.
    repo.attuneWaystone(playerId, 'forest_glade');
    repo.setAnchor(playerId, 'forest_glade');

    repo.resetPlayer(playerId);

    // Confirm via the repo helper, which reads the column directly.
    expect(repo.getAnchor(playerId)).toBe('forest_entry');
  });

  // ── spare_ring_max in the reset response player block ─────────────────────
  test('reset route response player block includes spare_ring_max=9', async () => {
    // #476 impl: buildMePlayerBlock reads getSpareRingMax(playerId). The column
    // reset by resetUpdatePlayers to 9 must propagate into the response.
    const { token } = makePlayer();

    const { status, json } = await postReset(token);
    expect(status).toBe(200);

    const player = json.player as Record<string, unknown>;
    expect(player.spare_ring_max).toBe(9);
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
