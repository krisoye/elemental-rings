/**
 * EPIC #302 / #304 — heart-slot HP wiring through a live BattleRoom.
 *
 * The heart ring is the player's HP pool: a duel starts with hearts =
 * min(current_uses, max_uses) of the equipped heart ring (NOT the default
 * STARTING_HEARTS), an empty / drained heart slot is 0 HP which the 0-HP guard
 * rejects before the duel begins, and the surviving HP is written back to the
 * heart ring's current_uses on a (non-practice) duel end. The heart ring earns
 * no XP and is never escrowed.
 *
 * Boots a real Colyseus server over the WebSocket transport (like battle.test.ts)
 * against a throwaway SQLite DB (like frost-sentinel.test.ts). DB_PATH must be set
 * before the first import of db.ts (a process-level singleton), so PlayerRepo / the
 * BattleRoom class / the auth signer are all loaded dynamically in beforeAll.
 *
 * Default loadout (seatPlayer for the no-token opponent): thumb=FIRE, a1=FIRE,
 * a2=WATER, d1=WOOD, d2=EARTH. The token human is seated from its DB loadout
 * (the createPlayer starter package).
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../../server/src/game/constants';

let colyseus: ColyseusTestServer<any>;
let repo: typeof import('../../server/src/persistence/PlayerRepo');
let getRingById: (typeof import('../../server/src/persistence/ringRows'))['getRingById'];
let db: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];

const RESOLVE_BUFFER_MS = 250;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-heart-slot-hp-${process.pid}-${Date.now()}.db`);
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
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

/**
 * Create a fully-equipped starter player and return its id + a signed token.
 * The createPlayer starter package equips a Wind heart ring (3 uses by default).
 */
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

/**
 * Connect a token human and a no-token opponent; resolve at ATTACK_SELECT.
 * The first-seated client is the opening attacker (BattleRoom uses ids[0]). Pass
 * `opponentFirst` to make the opponent the opener so the human starts as defender.
 */
async function joinDuel(token: string, opponentFirst = false) {
  const room = await colyseus.createRoom<any>('battle', {});
  let human: any;
  let opponent: any;
  if (opponentFirst) {
    opponent = await colyseus.connectTo(room, {});
    human = await colyseus.connectTo(room, { token });
  } else {
    human = await colyseus.connectTo(room, { token });
    opponent = await colyseus.connectTo(room, {});
  }
  await room.waitForNextPatch();
  await room.waitForNextPatch();
  return { room, human, opponent };
}

async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

/**
 * The current attacker throws an uncontested FIRE (a1) hit; the (idle) defender
 * loses a heart and initiative ALTERNATES to the former defender (GDD §6.3 — a
 * resolved chain passes the turn to the non-holder). Resolves at the next
 * ATTACK_SELECT. `clients` maps sessionId → SDK client.
 */
async function noBlockHit(room: any, clients: Record<string, any>) {
  const attacker = clients[room.state.currentAttackerId];
  attacker.send('selectAttack', { slot: 'a1' });
  await waitForResolve();
}

/**
 * Forfeit from `client`. handleForfeit only fires when the forfeiter is the
 * current attacker in ATTACK_SELECT; the caller must invoke it while `client`
 * holds the turn. Resolves once the room is ENDED.
 */
async function forfeitAsAttacker(room: any, client: any) {
  expect(room.state.phase).toBe('ATTACK_SELECT');
  expect(room.state.currentAttackerId).toBe(client.sessionId);
  client.send('forfeit');
  await sleep(250);
}

describe('start-of-duel HP comes from the heart ring (#304)', () => {
  test('a 5-use heart ring starts the duel at 5 HP', async () => {
    const { playerId, token } = makePlayer();
    setHeartUses(playerId, 5, 5);

    const { room, human } = await joinDuel(token);
    expect(room.state.players.get(human.sessionId).hearts).toBe(5);
    await room.disconnect();
  });

  test('a heart ring drained below its max starts at current_uses, not max', async () => {
    const { playerId, token } = makePlayer();
    setHeartUses(playerId, 2, 5); // current 2 < max 5

    const { room, human } = await joinDuel(token);
    expect(room.state.players.get(human.sessionId).hearts).toBe(2);
    await room.disconnect();
  });
});

describe('0-HP guard rejects the duel (#304)', () => {
  test('a 0-use heart ring is rejected with a clear error', async () => {
    const { playerId, token } = makePlayer();
    setHeartUses(playerId, 0, 5);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    expect(room.state.players.size).toBe(0); // no stale seat left behind
    await room.disconnect();
  });

  test('an empty heart slot is 0 HP and is rejected (no STARTING_HEARTS fallback)', async () => {
    const { playerId, token } = makePlayer();
    // Clear the heart slot entirely: heart_ring_id → NULL.
    db.prepare(`UPDATE players SET heart_ring_id = NULL WHERE id = ?`).run(playerId);
    expect(repo.getHeartRing(playerId)).toBeNull();

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    await room.disconnect();
  });
});

describe('post-duel HP write-back (#304)', () => {
  test('losing 2 HP persists current_uses=3 on the heart ring', async () => {
    const { playerId, token } = makePlayer();
    const heartRingId = setHeartUses(playerId, 5, 5);

    // The opponent opens, so the token human starts as defender. Initiative
    // ALTERNATES after each uncontested hit, so the human takes a hit on the
    // opponent's turns and the opponent absorbs one in between (it has the default
    // 3 STARTING_HEARTS and survives):
    //   1. opponent → human:  human 5 → 4   (init → human)
    //   2. human    → opponent: opp 3 → 2   (init → opponent)
    //   3. opponent → human:  human 4 → 3   (init → human)
    // The human ends as the current attacker at 3 HP, then forfeits.
    const { room, human, opponent } = await joinDuel(token, /* opponentFirst */ true);
    const clients = { [human.sessionId]: human, [opponent.sessionId]: opponent };
    expect(room.state.currentAttackerId).toBe(opponent.sessionId);

    await noBlockHit(room, clients); // opp → human: 5 → 4
    await noBlockHit(room, clients); // human → opp:  3 → 2
    await noBlockHit(room, clients); // opp → human: 4 → 3
    expect(room.state.players.get(human.sessionId).hearts).toBe(3);

    // The human (now the attacker at 3 HP) forfeits — a real, non-practice loss.
    // finalizeEnded → persistBattleResult writes the surviving 3 HP back. A loser's
    // surviving HP is persisted just like a winner's (the write-back is unconditional).
    await forfeitAsAttacker(room, human);
    expect(room.state.phase).toBe('ENDED');

    const after = getRingById(heartRingId);
    expect(after?.current_uses).toBe(3);
    await room.disconnect();
  });

  test('the heart ring earns no XP from the duel', async () => {
    const { playerId, token } = makePlayer();
    const heartRingId = setHeartUses(playerId, 5, 5);
    const xpBefore = getRingById(heartRingId)?.xp ?? 0;

    // Human opens and lands an uncontested FIRE hit (its a1 attack ring earns XP),
    // initiative alternates to the opponent, which lands a hit back; initiative
    // returns to the human, which then forfeits. The duel awards battle-ring XP —
    // but the heart ring must be untouched (it is never in xpAccumulator).
    const { room, human, opponent } = await joinDuel(token);
    const clients = { [human.sessionId]: human, [opponent.sessionId]: opponent };
    expect(room.state.currentAttackerId).toBe(human.sessionId);

    await noBlockHit(room, clients); // human → opp  (a1 earns XP); init → opp
    await noBlockHit(room, clients); // opp → human;             init → human
    await forfeitAsAttacker(room, human);
    expect(room.state.phase).toBe('ENDED');

    const after = getRingById(heartRingId);
    expect(after?.xp).toBe(xpBefore); // heart ring is excluded from xpAccumulator
    await room.disconnect();
  });
});

describe('practice rematch leaves the heart ring unchanged (#262 / #304)', () => {
  test('a practice duel writes no HP back', async () => {
    const { playerId, token } = makePlayer();
    const heartRingId = setHeartUses(playerId, 5, 5);

    // Practice rematches are vsAI (the practice flag is only honored on a vsAI
    // room). The AI is seated first → it is the opening attacker; the human is the
    // defender. Idle until the human holds an ATTACK_SELECT turn, take a hit or
    // two along the way, then forfeit to end the duel. persistBattleResult returns
    // early for a practice rematch → no HP write-back regardless of HP lost.
    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      isPracticeRematch: true,
      personality: 'AGGRESSIVE',
      aiSeed: 7,
    });
    const human = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    await sleep(20);

    expect(room.state.players.get(human.sessionId).hearts).toBe(5);

    // Idle (bounded) until it is the human's ATTACK_SELECT turn, then forfeit.
    let ended = false;
    for (let i = 0; i < 20 && !ended; i++) {
      if (room.state.phase === 'ENDED') {
        ended = true;
        break;
      }
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('forfeit');
        await sleep(250);
        ended = true;
        break;
      }
      await waitForResolve();
    }
    expect(room.state.phase).toBe('ENDED');

    // current_uses unchanged at 5 — practice never persists HP loss, even if the
    // human took heart damage during the duel.
    const after = getRingById(heartRingId);
    expect(after?.current_uses).toBe(5);
    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// #376 — carry-cap: spare↔heart swap at full carry (pure DB integration, no Colyseus room)
// ---------------------------------------------------------------------------

describe('carry-cap: spare→heart swap at full carry (#376)', () => {
  /**
   * Fill the player's carry to exactly the carry cap by inserting spare rings
   * directly into the DB. The starter player already has 5 carried battle-hand
   * rings, so we top up to cap.
   */
  function fillCarryToCap(playerId: string): void {
    const cap = repo.getCarryCap(playerId);
    const current = repo.getCarry(playerId).length;
    const needed = cap - current;
    for (let i = 0; i < needed; i++) {
      // Insert a minimal ring in carry directly (ElementEnum.FIRE = 0)
      const id = `fill_${Math.random().toString(36).slice(2)}`;
      db.prepare(
        `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
         VALUES (?, ?, 0, 0, 3, 3, 0, 1, 0, 0)`,
      ).run(id, playerId);
    }
  }

  test('spare ring swapped to heart at exactly carry cap succeeds (net-zero carry delta)', () => {
    // #376 adversarial: the original bug used carriedCount + 1 > cap which always rejected
    // the swap when carry was full, even though carry is net-zero (old heart joins carry,
    // incoming spare leaves carry) — this test locks in the fixed net-zero path
    const { playerId } = makePlayer();
    fillCarryToCap(playerId);
    expect(repo.getCarry(playerId).length).toBe(repo.getCarryCap(playerId));

    const carried = repo.getCarry(playerId);
    const incomingSpare = carried[0].id; // a carried ring that becomes the new heart
    const oldHeart = repo.getHeartRing(playerId)!;
    expect(oldHeart).not.toBeNull();

    // spare→heart: incomingSpare leaves carry; oldHeart joins carry → net-zero
    expect(() => repo.setHeartRing(playerId, incomingSpare, 'spare')).not.toThrow();

    // Post-condition: old heart is now in carry; incomingSpare is the new heart (not carried)
    const newHeart = repo.getHeartRing(playerId);
    expect(newHeart?.id).toBe(incomingSpare);
    const newCarry = repo.getCarry(playerId);
    expect(newCarry.map((r: any) => r.id)).toContain(oldHeart.id);
    // carry count unchanged — still at cap
    expect(newCarry.length).toBe(repo.getCarryCap(playerId));
  });

  test('heart release to spare when carry is full and no incoming ring throws carry cap exceeded', () => {
    // #376 adversarial: releasing the heart ring to spare WITHOUT providing a new ring to
    // take the heart slot is a net +1 to carry — must be blocked at full carry.
    // ringId=null means clear heart slot; releaseTo='spare' means old heart goes to carry
    const { playerId } = makePlayer();
    fillCarryToCap(playerId);
    const oldHeart = repo.getHeartRing(playerId)!;
    expect(oldHeart).not.toBeNull();

    // carry is full and old heart would join it → must throw
    expect(() => repo.setHeartRing(playerId, null, 'spare')).toThrow(/carry cap exceeded/);
  });

  test('heart→spare when carry has one free slot succeeds (+1 within cap)', () => {
    // #376 adversarial: releasing heart to spare when there is exactly one free carry slot
    // must succeed — carry goes from cap-1 to cap (at boundary, not over it)
    const { playerId } = makePlayer();
    const cap = repo.getCarryCap(playerId);
    const current = repo.getCarry(playerId).length;
    // Fill to cap-1 (leave exactly one slot open)
    const needed = cap - 1 - current;
    for (let i = 0; i < needed; i++) {
      const id = `onefree_${Math.random().toString(36).slice(2)}`;
      db.prepare(
        `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
         VALUES (?, ?, 0, 0, 3, 3, 0, 1, 0, 0)`,
      ).run(id, playerId);
    }
    expect(repo.getCarry(playerId).length).toBe(cap - 1);

    // Releasing heart to spare: old heart joins carry (+1), carry goes to cap exactly
    expect(() => repo.setHeartRing(playerId, null, 'spare')).not.toThrow();
    expect(repo.getCarry(playerId).length).toBe(cap);
  });

  test('battle-slot to heart slot-for-slot swap at full carry succeeds without regression', () => {
    // #376 adversarial: a battle-slot swap (releaseTo='a1') routes through isBattleSlot,
    // not the spare branch; this path was not changed in #376 but must not have regressed —
    // it is net-zero because the battle ring leaves carry as it becomes the heart
    const { playerId } = makePlayer();
    fillCarryToCap(playerId);
    const carryBefore = repo.getCarry(playerId).length;
    const loadout = repo.getLoadout(playerId)!;
    expect(loadout.a1).not.toBeNull();

    expect(() => repo.setHeartRing(playerId, null, 'a1')).not.toThrow();
    // carry count unchanged (slot-for-slot swap)
    expect(repo.getCarry(playerId).length).toBe(carryBefore);
  });

  test('reliquary release from heart at full carry succeeds (heart is never in carry)', () => {
    // #376 adversarial: setHeartRing with releaseTo='reliquary' sends the old heart ring
    // to in_carry=0 (Reliquary), never to carry — this path must never invoke the carry cap
    // guard, so a full-carry player can always release their heart ring to the Reliquary
    const { playerId } = makePlayer();
    fillCarryToCap(playerId);
    const oldHeart = repo.getHeartRing(playerId)!;
    expect(oldHeart).not.toBeNull();

    // ringId=null, releaseTo='reliquary' — old heart rests in Reliquary (in_carry=0)
    expect(() => repo.setHeartRing(playerId, null, 'reliquary')).not.toThrow();

    // Old heart ring must now be in Reliquary (in_carry=0, heart_slot=0)
    const heartRow = getRingById(oldHeart.id);
    expect(heartRow?.in_carry).toBe(0);
    expect(heartRow?.heart_slot).toBe(0);
    // Carry count still at cap — Reliquary release does not touch carry
    expect(repo.getCarry(playerId).length).toBe(repo.getCarryCap(playerId));
  });
});
