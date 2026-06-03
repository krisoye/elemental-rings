/**
 * #318 — the heart ring shatters on a 0-HP loss; a forfeit (hearts > 0) preserves it.
 *
 * EPIC #302 made a player's HP the current uses of their equipped heart ring,
 * written back to the DB after every duel. #318 adds the one missing branch: a
 * player who LOSES by depletion (hearts reach 0) has their heart ring PERMANENTLY
 * destroyed (ring row deleted, players.heart_ring_id nulled). A forfeit always
 * ends with hearts > 0, so the heart ring survives — only the Thumb stake + 25
 * gold are forfeited. A winner never finishes at 0, so a win still writes the
 * surviving HP back.
 *
 * Boots a real Colyseus server over the WebSocket transport against a throwaway
 * SQLite DB. DB_PATH must be set before the first import of db.ts (a process-level
 * singleton), so PlayerRepo / the BattleRoom class / the auth signer are all loaded
 * dynamically in beforeAll. Mirrors the harness in heart-slot-hp.test.ts.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import {
  TELEGRAPH_MS,
  BLOCK_WINDOW_MS,
  GOLD_FORFEIT_PENALTY,
} from '../../server/src/game/constants';

let colyseus: ColyseusTestServer<any>;
let repo: typeof import('../../server/src/persistence/PlayerRepo');
let getRingById: (typeof import('../../server/src/persistence/ringRows'))['getRingById'];
let db: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];

const RESOLVE_BUFFER_MS = 250;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-heart-ring-shatter-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  getRingById = (await import('../../server/src/persistence/ringRows')).getRingById;
  db = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const { BattleRoom } = await import('../../server/src/rooms/BattleRoom');

  const server = new Server();
  server.define('battle', BattleRoom);
  server.define('battle-ai', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Create a fully-equipped starter player and return its id + a signed token. */
function makePlayer(): { playerId: string; token: string } {
  const username = `u_${Math.random().toString(36).slice(2)}`;
  const playerId = repo.createPlayer(username, 'x');
  return { playerId, token: signToken({ playerId, username }) };
}

/** Force the player's equipped heart ring to an exact uses configuration. */
function setHeartUses(playerId: string, currentUses: number, maxUses: number): string {
  const heartRing = repo.getHeartRing(playerId);
  if (!heartRing) throw new Error('player has no heart ring');
  db.prepare(`UPDATE rings SET max_uses = ?, current_uses = ? WHERE id = ?`).run(
    maxUses,
    currentUses,
    heartRing.id,
  );
  return heartRing.id;
}

async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

/**
 * Seat a token human into a vsAI room (the AI is seated first → it opens as the
 * attacker). The human's HP comes from its equipped heart ring (EPIC #302).
 */
async function joinVsAI(token: string, options: Record<string, unknown> = {}) {
  const room = await colyseus.createRoom<any>('battle', {
    vsAI: true,
    personality: 'AGGRESSIVE',
    aiSeed: 7,
    ...options,
  });
  const human = await colyseus.connectTo(room, { token });
  await room.waitForNextPatch();
  await sleep(20);
  return { room, human };
}

/**
 * Idle (bounded) until the duel ends. The AI auto-plays its turns; an idle human
 * never blocks, so it loses a heart on each AI attack — driving a low-HP human to
 * 0 and an ENDED duel. Returns once the room is ENDED (or the loop budget runs out).
 */
async function idleUntilEnded(room: any, maxIters = 30): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    if (room.state.phase === 'ENDED') return;
    await waitForResolve();
  }
}

describe('#318 — heart ring shatters on a 0-HP loss by depletion', () => {
  test('a human driven to 0 HP vsAI has their heart ring destroyed and the pointer nulled', async () => {
    const { playerId, token } = makePlayer();
    // 1-use heart ring → the human starts at 1 HP; a single uncontested AI hit
    // drops it to 0 and ends the duel as a loss by depletion.
    const heartRingId = setHeartUses(playerId, 1, 5);

    const { room, human } = await joinVsAI(token);
    expect(room.state.players.get(human.sessionId).hearts).toBe(1);

    await idleUntilEnded(room);
    expect(room.state.phase).toBe('ENDED');
    // The human lost (the AI is the winner) at 0 HP.
    expect(room.state.players.get(human.sessionId).hearts).toBe(0);
    expect(room.state.winnerId).not.toBe(human.sessionId);

    // #318 — the heart ring is permanently destroyed: the ring row is gone and the
    // players.heart_ring_id pointer is nulled (getHeartRing → null).
    expect(getRingById(heartRingId)).toBeUndefined();
    expect(repo.getHeartRing(playerId)).toBeNull();
    const row = db.prepare('SELECT heart_ring_id FROM players WHERE id = ?').get(playerId) as {
      heart_ring_id: string | null;
    };
    expect(row.heart_ring_id).toBeNull();

    await room.disconnect();
  });

  test('destroyHeartRing leaves spirit_max untouched (heart ring is excluded from the sum)', () => {
    // Direct unit-level check: the heart ring rests with heart_slot = 1, so it is
    // already excluded from the spirit sum. Destroying it must NOT recompute or
    // change spirit_max — mirroring discardRing's reasoning.
    const { playerId } = makePlayer();
    const heartRingId = setHeartUses(playerId, 5, 5);
    const spiritBefore = repo.getPlayerById(playerId)!.spirit_max;

    repo.destroyHeartRing(heartRingId, playerId);

    expect(getRingById(heartRingId)).toBeUndefined();
    expect(repo.getHeartRing(playerId)).toBeNull();
    expect(repo.getPlayerById(playerId)!.spirit_max).toBe(spiritBefore);
  });

  test('re-equip path: after destruction the player can seat a new ring and duel again', async () => {
    const { playerId, token } = makePlayer();
    setHeartUses(playerId, 1, 5);

    const { room } = await joinVsAI(token);
    await idleUntilEnded(room);
    expect(room.state.phase).toBe('ENDED');
    expect(repo.getHeartRing(playerId)).toBeNull();
    await room.disconnect();

    // Without a heart ring, seating is rejected by the 0-HP guard.
    const blocked = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 7,
    });
    await expect(colyseus.connectTo(blocked, { token })).rejects.toThrow(/No HP/);
    await blocked.disconnect();

    // Equip a fresh ring into the heart slot, then seat into a new duel cleanly.
    const replacementId = repo.grantRing(playerId, 0 /* FIRE */);
    repo.setHeartRing(playerId, replacementId, 'reliquary');
    expect(repo.getHeartRing(playerId)?.id).toBe(replacementId);

    const { room: room2, human } = await joinVsAI(token);
    expect(room2.state.players.get(human.sessionId).hearts).toBe(3); // 3-use starter ring
    await room2.disconnect();
  });
});

describe('#318 — a forfeit (hearts > 0) preserves the heart ring', () => {
  test('forfeiting vsAI keeps the heart ring with surviving HP; Thumb stake gone; 25 gold lost', async () => {
    const { playerId, token } = makePlayer();
    // 5 HP → comfortably above 0, so the human can forfeit while alive.
    const heartRingId = setHeartUses(playerId, 5, 5);
    const goldBefore = repo.getPlayerById(playerId)!.gold;
    const thumbBefore = repo.getLoadout(playerId)!.thumb!;
    expect(getRingById(thumbBefore)).toBeDefined();

    const { room, human } = await joinVsAI(token);
    expect(room.state.players.get(human.sessionId).hearts).toBe(5);

    // Idle (bounded) until it is the human's ATTACK_SELECT turn, then forfeit.
    let forfeited = false;
    for (let i = 0; i < 20 && !forfeited; i++) {
      if (room.state.phase === 'ENDED') break;
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('forfeit');
        await sleep(250);
        forfeited = true;
        break;
      }
      await waitForResolve();
    }
    expect(room.state.phase).toBe('ENDED');
    expect(forfeited).toBe(true);
    // The forfeiting human did NOT reach 0 HP — hearts survive.
    expect(room.state.players.get(human.sessionId).hearts).toBeGreaterThan(0);

    // Heart ring survives with the surviving HP written back (no damage taken → 5).
    const heartAfter = getRingById(heartRingId);
    expect(heartAfter).toBeDefined();
    expect(heartAfter?.current_uses).toBe(
      room.state.players.get(human.sessionId).hearts,
    );
    expect(repo.getHeartRing(playerId)?.id).toBe(heartRingId);

    // The staked Thumb ring is forfeited (deleted vs the no-DB AI winner).
    expect(getRingById(thumbBefore)).toBeUndefined();
    // GOLD_FORFEIT_PENALTY (25) deducted.
    expect(repo.getPlayerById(playerId)!.gold).toBe(goldBefore - GOLD_FORFEIT_PENALTY);

    await room.disconnect();
  });
});

describe('#318 — a win writes surviving HP back (no behavior change)', () => {
  test('winning keeps the heart ring with current_uses == surviving HP', { timeout: 40000 }, async () => {
    const { playerId, token } = makePlayer();
    // High HP so the human cannot lose; a 1-HP AI dies to the first uncontested
    // human hit, guaranteeing a human win with surviving HP > 0.
    const heartRingId = setHeartUses(playerId, 9, 9);

    // aiHearts: 1 → the AI falls to a single uncontested human hit.
    const { room, human } = await joinVsAI(token, { aiHearts: 1, aiSeed: 2024 });
    expect(room.state.players.get(human.sessionId).hearts).toBe(9);

    // Drive the duel: the human attacks a1 whenever it holds the turn. To make the
    // human win deterministic regardless of the seeded AI loadout, the AI's defense
    // rings are kept extinguished — its auto-defense can never catch, so the first
    // human attack lands uncontested and KOs the 1-HP AI. The high-HP human absorbs
    // the AI's own hits in the meantime (so it survives at hearts > 0).
    const aiPs = room.state.players.get('AI');
    for (let i = 0; i < 120 && room.state.phase !== 'ENDED'; i++) {
      for (const key of ['d1', 'd2'] as const) {
        aiPs[key].currentUses = 0;
        aiPs[key].isExtinguished = true;
      }
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('selectAttack', { slot: 'a1' });
      }
      await sleep(200);
    }
    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(human.sessionId);

    const surviving = room.state.players.get(human.sessionId).hearts;
    expect(surviving).toBeGreaterThan(0);

    // The heart ring still exists with current_uses == surviving HP (write-back) —
    // no behavior change from EPIC #302 for a winner.
    const heartAfter = getRingById(heartRingId);
    expect(heartAfter).toBeDefined();
    expect(heartAfter?.current_uses).toBe(surviving);
    expect(repo.getHeartRing(playerId)?.id).toBe(heartRingId);

    await room.disconnect();
  });
});
