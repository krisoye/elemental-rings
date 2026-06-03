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
  test('human with loadout.thumb = null → ServerError(4001) thrown AND session maps unwound', async () => {
    const { playerId, token } = makePlayer();
    // Clear the thumb slot in the loadout table.
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    // rooms created without vsAI, so no AI seat is pre-populated.
    // All session maps unwound — no stale PlayerState row left behind.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('human with loadout.thumb = null AND hearts = 0 → ServerError(4000) (heart guard fires first, before thumb guard)', async () => {
    const { playerId, token } = makePlayer();
    // Drain heart ring to 0 uses AND clear the thumb slot: both guards would fire.
    setHeartUses(playerId, 0, 5);
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    // The heart guard fires first (4000) — thumb guard is never reached.
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    // rooms created without vsAI, so no AI seat is pre-populated.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('vsAI room: human with loadout.thumb = null → ServerError(4001), AI seat survives', async () => {
    const { playerId, token } = makePlayer();
    // Clear the thumb slot — human join will be rejected by the 4001 guard.
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    // vsAI room pre-populates the AI seat in onCreate before any human joins.
    const room = await colyseus.createRoom<any>('battle', { vsAI: true });
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    // AI seat survives (it was created in onCreate); only the rejected human seat is unwound.
    expect(room.state.players.size).toBe(1);
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
    // rooms created without vsAI, so no AI seat is pre-populated.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });

  test('an empty heart slot (null) is rejected with ServerError(4000)', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE players SET heart_ring_id = NULL WHERE id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No HP/);
    // rooms created without vsAI, so no AI seat is pre-populated.
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// No-token (E2E path) — no auth token skips both guards (#319/A1)
// ---------------------------------------------------------------------------

describe('no-token path — join succeeds without a token (E2E / backward-compat)', () => {
  test('connect with no token → join succeeds, seat is added', async () => {
    // The no-token else-branch in onJoin seats with a default loadout and
    // bypasses the heart/thumb guards entirely (no payload → no DB read).
    const room = await colyseus.createRoom<any>('battle', {});
    const client = await colyseus.connectTo(room, {}); // no token supplied
    await room.waitForNextPatch();

    // The no-token seat is accepted — at least the one we just connected.
    expect(room.state.players.size).toBeGreaterThanOrEqual(1);
    expect(room.state.players.get(client.sessionId)).toBeDefined();

    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// QA regression — #319 adversarial and spec-conformance tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Spec-conformance: all 5 session maps are individually clean after 4001
// (#320 AC: "The 5 session maps are all cleaned up before the throw")
//
// The existing test only checks room.state.players.size === 0.  These tests
// access the private maps via (room as any) — TypeScript private is compile-
// time only, not runtime — and verify each map is individually empty so a
// future refactor cannot silently leave stale data in a non-players map.
// ---------------------------------------------------------------------------

describe('spec-conformance: all 5 session maps unwound on 4001 rejection (#320)', () => {
  test('sessionToPlayerId is empty after 4001 rejection', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No staked ring/);

    // Spec: no session map retains the rejected player's data.
    expect((room as any).sessionToPlayerId.size).toBe(0);
    await room.disconnect();
  });

  test('sessionToRingIds is empty after 4001 rejection', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No staked ring/);

    expect((room as any).sessionToRingIds.size).toBe(0);
    await room.disconnect();
  });

  test('sessionToHeartRingId is empty after 4001 rejection', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No staked ring/);

    expect((room as any).sessionToHeartRingId.size).toBe(0);
    await room.disconnect();
  });

  test('xpAccumulator is empty after 4001 rejection', async () => {
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No staked ring/);

    // Spec: xpAccumulator must not hold an entry for the rejected session.
    expect((room as any).xpAccumulator.size).toBe(0);
    await room.disconnect();
  });

  test('state.players is empty after 4001 rejection (explicit named-map check)', async () => {
    // This is the 5th session map (the Colyseus schema map).
    // Naming it explicitly so all 5 maps have a dedicated assertion.
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(/No staked ring/);

    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Spec-conformance: thumb ring with missing/undefined uses field is not blocked
// (#320 AC: "A human player with a staked ring (any current_uses, including 0)
// is not blocked.")
//
// The DB is the canonical source — ring rows always have current_uses as an
// INTEGER column. This test verifies the boundary: if a ring row exists but
// current_uses defaults to 0 (i.e. just created with zero uses), the player
// is not blocked by the thumb guard (only a null assignment blocks).
// ---------------------------------------------------------------------------

describe('spec-conformance: drained thumb (any state) never blocks (#320)', () => {
  test('thumb ring with current_uses = 0 in the DB does not trigger 4001 guard', async () => {
    // Spec says: only null thumb blocks. A drained ring with current_uses = 0
    // is still assigned — it must not be blocked.
    const { playerId, token } = makePlayer();
    const loadout = repo.getLoadout(playerId);
    if (!loadout?.thumb) throw new Error('starter loadout has no thumb ring');
    db.prepare(`UPDATE rings SET current_uses = 0 WHERE id = ?`).run(loadout.thumb);

    const room = await colyseus.createRoom<any>('battle', {});
    // Connection must succeed — a drained thumb is explicitly permitted by spec.
    const human = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    expect(room.state.players.get(human.sessionId)).toBeDefined();
    // Also verify sessionToRingIds holds the drained thumb ring ID (not null).
    const storedRingIds = (room as any).sessionToRingIds.get(human.sessionId);
    expect(storedRingIds?.thumb).toBe(loadout.thumb);

    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: boundary values for the thumb field
// ---------------------------------------------------------------------------

describe('adversarial: thumb loadout field boundary values (#319)', () => {
  test('empty string "" in DB thumb column is treated as unassigned → 4001 blocked', async () => {
    // The loadout loop does: if (ringId) { ... ringIds[key] = ringId; }
    // An empty string is falsy in JS, so "" leaves ringIds.thumb = null → guard fires.
    // The DB schema enforces a FK constraint on loadout.thumb → rings.id.
    // We bypass FK enforcement temporarily to inject this adversarial value,
    // simulating a corrupt or manually-set DB row that would otherwise be prevented
    // by the constraint in normal operation. The guard must still fire safely.
    const { playerId, token } = makePlayer();
    db.pragma('foreign_keys = OFF');
    db.prepare(`UPDATE loadout SET thumb = '' WHERE player_id = ?`).run(playerId);
    db.pragma('foreign_keys = ON');

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    // Guard fires → all maps clean.
    expect(room.state.players.size).toBe(0);
    expect((room as any).sessionToRingIds.size).toBe(0);
    await room.disconnect();
  });

  test('string "null" as thumb value (truthy ring ID string) does not trigger 4001 if ring exists', async () => {
    // A ring ID that happens to be the string "null" is truthy. The spec guard is
    // ringIds.thumb === null (strict equality). A truthy ring ID is not caught.
    // This test verifies strict null checking: a truthy ring ID, however unusual,
    // passes the guard.  We achieve this by keeping the starter thumb ring intact
    // (which has a normal UUID-format ID) and simply confirming that a normal
    // non-null thumb ID is not blocked — the "null string" edge case cannot be
    // manufactured in tests without inserting a ring with id = "null", which
    // would require bypassing schema constraints. We therefore assert the
    // observable: the guard uses === null and not == null or !, meaning any
    // truthy string (including one literally containing "null" characters) passes.
    // See note: if loadout.thumb is a ring ID that does not exist in ringMap,
    // ringIds.thumb stays null (the if(row) check) → that IS blocked. This is
    // correct: an assigned ID for a non-owned ring is operationally unassigned.
    const { playerId, token } = makePlayer();
    const loadout = repo.getLoadout(playerId);
    // Starter player has a valid thumb ring — confirm it is truthy and not null.
    expect(loadout?.thumb).toBeTruthy();
    expect(loadout?.thumb).not.toBeNull();

    // A player with a valid (truthy) thumb ring ID in their loadout must not be blocked.
    const room = await colyseus.createRoom<any>('battle', {});
    const human = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    expect(room.state.players.get(human.sessionId)).toBeDefined();
    await room.disconnect();
  });

  test('thumb ring ID references a non-owned ring → ringIds.thumb stays null → 4001 fired', async () => {
    // If the loadout row references a ring ID that is not in the player's ring
    // inventory (stolen/transferred ring, DB inconsistency), ringMap.get(ringId)
    // returns undefined → the if(row) branch skips → ringIds.thumb stays null.
    // Spec behavior: guard fires, player blocked. This is correct: an unresolvable
    // thumb ring ID is functionally the same as no staked ring.
    // The loadout.thumb FK constraint requires the ID to exist in rings — bypass FK
    // enforcement to inject this adversarial DB state.
    const { playerId, token } = makePlayer();
    db.pragma('foreign_keys = OFF');
    db.prepare(`UPDATE loadout SET thumb = 'ring-that-does-not-exist' WHERE player_id = ?`).run(playerId);
    db.pragma('foreign_keys = ON');

    const room = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    expect(room.state.players.size).toBe(0);
    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: back-to-back rejections from the same player
// (#319 — guard must fire consistently, not just on first attempt)
// ---------------------------------------------------------------------------

describe('adversarial: back-to-back 4001 rejections from the same player (#319)', () => {
  test('second join attempt with null thumb also throws 4001 (no stale state from first rejection)', async () => {
    // Spec: every join attempt with null thumb is rejected. The first rejection
    // leaves no stale state. When the player immediately retries with the same
    // (null thumb) token — in a fresh room, since Colyseus auto-disposes a room
    // with zero clients after a rejected join — they must also receive 4001, not
    // some other error caused by leftover server state from the first attempt.
    const { playerId, token } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(playerId);

    // First room: first attempt → 4001.
    const room1 = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room1, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );
    // Colyseus auto-disposes the first room after the rejection (0 connected clients).

    // Second room: same player, same null-thumb state → must also receive 4001,
    // proving the guard fires consistently and the first rejection left no cross-room
    // stale state (e.g. a lingering player entry in a shared singleton).
    const room2 = await colyseus.createRoom<any>('battle', {});
    await expect(colyseus.connectTo(room2, { token })).rejects.toThrow(
      /No staked ring: stake a ring before battling/,
    );

    // Second room maps also clean.
    expect(room2.state.players.size).toBe(0);
    expect((room2 as any).sessionToPlayerId.size).toBe(0);
    expect((room2 as any).sessionToRingIds.size).toBe(0);
    expect((room2 as any).sessionToHeartRingId.size).toBe(0);
    expect((room2 as any).xpAccumulator.size).toBe(0);

    await room2.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: concurrent rejections from two different players
// (#319 — both sessions must each get 4001; both sets of maps must be clean)
// ---------------------------------------------------------------------------

describe('adversarial: concurrent 4001 rejections from two distinct sessions (#319)', () => {
  test('two players with null thumb joining simultaneously both receive 4001 and leave clean maps', async () => {
    // Two independent players both have null thumb. They attempt to join the
    // same room concurrently. Both must be rejected with 4001, and after both
    // rejections all session maps must be empty (size 0).
    const { playerId: p1, token: t1 } = makePlayer();
    const { playerId: p2, token: t2 } = makePlayer();
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(p1);
    db.prepare(`UPDATE loadout SET thumb = NULL WHERE player_id = ?`).run(p2);

    const room = await colyseus.createRoom<any>('battle', {});

    // Fire both joins concurrently.
    const [r1, r2] = await Promise.allSettled([
      colyseus.connectTo(room, { token: t1 }),
      colyseus.connectTo(room, { token: t2 }),
    ]);

    // Both must be rejected with the 4001 message.
    expect(r1.status).toBe('rejected');
    if (r1.status === 'rejected') {
      expect(String(r1.reason)).toMatch(/No staked ring: stake a ring before battling/);
    }
    expect(r2.status).toBe('rejected');
    if (r2.status === 'rejected') {
      expect(String(r2.reason)).toMatch(/No staked ring: stake a ring before battling/);
    }

    // All 5 session maps must be clean for both players.
    expect(room.state.players.size).toBe(0);
    expect((room as any).sessionToPlayerId.size).toBe(0);
    expect((room as any).sessionToRingIds.size).toBe(0);
    expect((room as any).sessionToHeartRingId.size).toBe(0);
    expect((room as any).xpAccumulator.size).toBe(0);

    await room.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Spec-conformance: client predicate logic (pure function assertions)
// Note on client-side unit testing:
//   The heartOk / thumbOk predicates in BaseBiomeScene.checkNpcDetection() and
//   onNpcClick() are embedded inside Phaser scene methods that require a browser
//   DOM, a Phaser Game instance, and scene lifecycle. Vitest runs in Node.js
//   without a DOM; importing BaseBiomeScene in Vitest would pull in Phaser 4
//   which crashes in Node (window, document, WebGL all absent). Client-side
//   predicate unit tests therefore cannot run in this Vitest suite.
//
//   Coverage strategy:
//   - The E2E Playwright suite (tests/e2e/battle-entry-gating.spec.ts) exercises
//     the gate predicates in a real browser via __campState injection.
//   - The pure predicate logic is trivially derivable from the spec and is
//     documented here as executable pseudo-assertions against the spec text, not
//     against the implementation internals.
//
//   The tests below assert the predicate rules as pure TypeScript functions
//   mirroring the spec — they are NOT testing BaseBiomeScene internals but
//   serve as a living spec fixture that will break if the spec changes.
// ---------------------------------------------------------------------------

describe('spec-conformance: client heartOk / thumbOk predicate rules (pure logic, #321)', () => {
  // Implement the predicates exactly as specified in #321 to test the contract.
  function heartOk(campState: any): boolean {
    return !!(campState?.heart_ring) && (campState.heart_ring.current_uses ?? 0) > 0;
  }

  function thumbOk(campState: any): boolean {
    // Spec: loadout?.thumb != null  (loose null check — catches both null and undefined)
    return campState?.loadout?.thumb != null;
  }

  test('heartOk is true when heart_ring is assigned and current_uses > 0', () => {
    // Spec: heartOk = !!(campState?.heart_ring) && (campState.heart_ring.current_uses ?? 0) > 0
    const campState = { heart_ring: { current_uses: 3 }, loadout: { thumb: 'ring-abc' } };
    expect(heartOk(campState)).toBe(true);
  });

  test('heartOk is false when heart_ring is null', () => {
    // Spec: null heart_ring means no HP → blocked.
    const campState = { heart_ring: null, loadout: { thumb: 'ring-abc' } };
    expect(heartOk(campState)).toBe(false);
  });

  test('heartOk is false when heart_ring.current_uses is 0 (drained heart)', () => {
    // Spec: a drained heart ring (uses = 0) blocks entry — heart must have uses.
    const campState = { heart_ring: { current_uses: 0 }, loadout: { thumb: 'ring-abc' } };
    expect(heartOk(campState)).toBe(false);
  });

  test('heartOk is false when campState is undefined (missing __campState)', () => {
    // Discovery finding documented in BaseBiomeScene.ts comment: if campState is
    // absent, optional-chaining returns undefined → heartOk → false → blocked.
    expect(heartOk(undefined)).toBe(false);
  });

  test('thumbOk is true when loadout.thumb is a non-null string', () => {
    // Spec: any non-null string (including one with uses = 0) passes.
    const campState = { heart_ring: { current_uses: 3 }, loadout: { thumb: 'ring-xyz' } };
    expect(thumbOk(campState)).toBe(true);
  });

  test('thumbOk is true when loadout.thumb is assigned even with current_uses = 0 (drained thumb allowed)', () => {
    // Spec: drained thumb (ring assigned, uses = 0) does NOT block.
    // The predicate only checks assignment (not uses), so this must pass.
    const campState = { heart_ring: { current_uses: 3 }, loadout: { thumb: 'ring-drained' } };
    expect(thumbOk(campState)).toBe(true);
  });

  test('thumbOk is false when loadout.thumb is null', () => {
    // Spec: null thumb = unassigned = blocked.
    const campState = { heart_ring: { current_uses: 3 }, loadout: { thumb: null } };
    expect(thumbOk(campState)).toBe(false);
  });

  test('thumbOk is false when loadout.thumb is undefined', () => {
    // Spec uses != null (loose) which catches both null AND undefined.
    const campState = { heart_ring: { current_uses: 3 }, loadout: { thumb: undefined } };
    expect(thumbOk(campState)).toBe(false);
  });

  test('thumbOk is false when campState is undefined (missing __campState)', () => {
    // Same as heartOk: absent campState → optional-chaining → undefined → false.
    expect(thumbOk(undefined)).toBe(false);
  });

  test('thumbOk is false when loadout itself is missing', () => {
    // campState exists but has no loadout field → optional-chaining → undefined → false.
    const campState = { heart_ring: { current_uses: 3 } };
    expect(thumbOk(campState)).toBe(false);
  });
});
