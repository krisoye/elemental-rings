/**
 * #319/A1 — BattleRoom entry-gate unit tests.
 *
 * Covers the two server-side join guards:
 *   4000 — no usable HP (heart ring absent or fully drained)
 *   4001 — no ring staked to the thumb slot (null thumb)
 *
 * Uses @colyseus/testing with a throwaway SQLite DB so BattleRoom.onJoin runs
 * the real guard logic, including PlayerRepo reads. DB_PATH is set before the
 * first import of db.ts (a process-level singleton), so all BattleRoom and repo
 * imports are loaded dynamically inside beforeAll — matching the heart-slot-hp
 * integration test pattern.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';

let colyseus: ColyseusTestServer<any>;
let repo: typeof import('../../server/src/persistence/PlayerRepo');
let db: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];

beforeAll(async () => {
  const dbFile = path.join(
    os.tmpdir(),
    `er-battle-gates-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  db = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const { BattleRoom } = await import('../../server/src/rooms/BattleRoom');

  const server = new Server();
  server.define('battle', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Create a starter player and return its id + a signed token. */
function makePlayer(): { playerId: string; token: string } {
  const username = `u_${Math.random().toString(36).slice(2)}`;
  const playerId = repo.createPlayer(username, 'x');
  return { playerId, token: signToken({ playerId, username }) };
}

/** Force the player's heart ring to an exact uses configuration. */
function setHeartUses(playerId: string, currentUses: number, maxUses: number): void {
  const heartRing = repo.getHeartRing(playerId);
  if (!heartRing) throw new Error('player has no heart ring');
  db.prepare(`UPDATE rings SET max_uses = ?, current_uses = ? WHERE id = ?`).run(
    maxUses,
    currentUses,
    heartRing.id,
  );
}

// ---------------------------------------------------------------------------
// 4001 — thumb-ring guard (#319/A1)
// ---------------------------------------------------------------------------

describe('4001 thumb-ring guard — null thumb blocks entry (#319/A1)', () => {
  test('human with loadout.thumb = null → ServerError(4001) thrown', async () => {
    const { playerId, token } = makePlayer();
    // Clear the thumb slot in the loadout table.
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    // All session maps unwound — no stale PlayerState row left behind.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('human with loadout.thumb = null → state.players is empty (maps unwound)', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    try {
      await colyseus.connectTo(room, { token });
    } catch {
      // expected rejection
    }
    // Rejection must leave the room's public player map empty.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('human with loadout.thumb = someRingId, current_uses = 0 → no error (drained thumb allowed)', async () => {
    const { playerId, token } = makePlayer();

    // Find the thumb ring (starter package populates it) and drain its uses to 0.
    const loadout = repo.getLoadout(playerId);
    if (!loadout?.thumb) throw new Error('starter loadout has no thumb ring');
    db.prepare(`UPDATE rings SET current_uses = 0 WHERE id = ?`).run(loadout.thumb);

    // Connection should succeed — a drained thumb is permitted.
    const room = await colyseus.createRoom<any>('battle', {});
    const human = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    // The human seat was accepted.
    expect(room.state.players.size).toBeGreaterThanOrEqual(1);
    expect(room.state.players.get(human.sessionId)).toBeDefined();

    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// 4000 — heart/HP guard (regression — must remain unchanged)
// ---------------------------------------------------------------------------

describe('4000 heart/HP guard — preserved unchanged (#304, regression)', () => {
  test('a 0-use heart ring is rejected with ServerError(4000)', async () => {
    const { playerId, token } = makePlayer();
    setHeartUses(playerId, 0, 5);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('an empty heart slot (null) is rejected with ServerError(4000)', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE players SET heart_ring_id = NULL WHERE id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });
});
