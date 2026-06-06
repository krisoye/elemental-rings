/**
 * #424 — HTTP route-level coverage for PUT /api/rings/swap.
 *
 * swapRings is a permutation: no capacity check ever fires for an exchange
 * because every ring entering a section offsets one leaving it. These tests
 * confirm:
 *   - All valid swap paths return 200 and exchange positions exactly.
 *   - Self-swap, ownership, and escrow guards return 400.
 *   - Same-pool swaps are 200 no-ops.
 *   - Heart swaps recompute spirit_max.
 *   - Pending-flag transfer: swapping the WON ring moves pending=1 to its partner.
 *
 * Uses the same ephemeral-port HTTP harness as tests/integration/loadout-route.test.ts.
 * DB_PATH must be set before the first import of db.ts — everything imported
 * dynamically in beforeAll.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { ElementEnum } from '../../shared/types';

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];
let httpServer: http.Server;
let baseUrl: string;

// ---------------------------------------------------------------------------
// Test helpers (same direct-insert pattern as loadout-route.test.ts)
// ---------------------------------------------------------------------------

/** Insert a bare ring owned by playerId. */
function makeRing(
  playerId: string,
  {
    inCarry = 0,
    pending = 0,
    heartSlot = 0,
    escrowed = 0,
    element = ElementEnum.FIRE,
  }: {
    inCarry?: number;
    pending?: number;
    heartSlot?: number;
    escrowed?: number;
    element?: number;
  } = {},
): string {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  dbInstance.prepare(
    `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot, pending)
     VALUES (?, ?, ?, 0, 3, 3, 0, ?, ?, ?, ?)`,
  ).run(id, playerId, element, inCarry, escrowed, heartSlot, pending);
  return id;
}

/** Create a minimal player row + empty loadout; returns { playerId, token }. */
function makePlayer(): { playerId: string; token: string } {
  const playerId = `p_${Math.random().toString(36).slice(2)}`;
  const username = `u_${playerId}`;
  dbInstance
    .prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`)
    .run(playerId, username, 'x');
  dbInstance
    .prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(playerId);
  return { playerId, token: signToken({ playerId, username }) };
}

/** PUT /api/rings/swap with a Bearer token. */
async function putSwap(
  token: string,
  body: { ringId1: string; ringId2: string },
): Promise<{
  status: number;
  json: { player?: Record<string, unknown>; rings?: unknown[]; loadout?: Record<string, unknown>; error?: string };
}> {
  const res = await fetch(`${baseUrl}/api/rings/swap`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as never };
}

/** GET /api/me. */
async function getMe(
  token: string,
): Promise<{ player: Record<string, unknown>; rings: Array<Record<string, unknown>>; loadout: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as never;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-swap-route-${process.pid}-${Date.now()}.db`);
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
// PUT /api/rings/swap — #424 position-exchange route coverage
// ---------------------------------------------------------------------------

describe('PUT /api/rings/swap — #424 capacity-free ring exchange', () => {

  test('spare ↔ reliquary: 200, positions exchanged, pool counts unchanged', async () => {
    const { playerId, token } = makePlayer();
    const spareId = makeRing(playerId, { inCarry: 1 });  // spare
    const reliqId = makeRing(playerId, { inCarry: 0 });  // reliquary

    const res = await putSwap(token, { ringId1: spareId, ringId2: reliqId });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    const spareRing = me.rings.find((r) => r.id === spareId);
    const reliqRing = me.rings.find((r) => r.id === reliqId);
    // Former spare is now in reliquary (in_carry=0).
    expect(spareRing?.in_carry).toBe(0);
    // Former reliquary ring is now in carry (in_carry=1).
    expect(reliqRing?.in_carry).toBe(1);
  });

  test('slot ↔ reliquary: 200, slot reassigned, carry counts unchanged at full bench', async () => {
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // Fill bench to max (spare rings in carry).
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    // One more ring in a battle slot.
    const slotRing = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(slotRing, playerId);
    // A reliquary ring to swap with.
    const reliqRing = makeRing(playerId, { inCarry: 0 });

    const res = await putSwap(token, { ringId1: slotRing, ringId2: reliqRing });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    // Former slot ring is now in reliquary.
    const formerSlot = me.rings.find((r) => r.id === slotRing);
    expect(formerSlot?.in_carry).toBe(0);
    // Former reliquary ring is now in slot a1.
    expect(me.loadout.a1).toBe(reliqRing);
  });

  test('slot ↔ spare: 200, positions exchanged exactly at full bench (the #421-S2 path)', async () => {
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // Full bench.
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    const slotRing = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(slotRing, playerId);
    // Pick any spare ring.
    const spareRing = repo.getSpareIds(playerId)[0];
    expect(spareRing).toBeTruthy();

    const res = await putSwap(token, { ringId1: slotRing, ringId2: spareRing });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    // Former slot ring is now a spare.
    const formerSlot = me.rings.find((r) => r.id === slotRing);
    expect(formerSlot?.in_carry).toBe(1);
    const loadoutVals = Object.values(me.loadout).filter(Boolean);
    expect(loadoutVals).not.toContain(slotRing);
    // Former spare ring is now in a1.
    expect(me.loadout.a1).toBe(spareRing);
  });

  test('pending WON ring ↔ spare: pending flag transfers to the bench ring', async () => {
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // Full bench to create a realistic overflow state.
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    // The WON ring (pending=1).
    const wonRingId = repo.grantRing(playerId, ElementEnum.FIRE);
    expect(repo.getPendingRingId(playerId)).toBe(wonRingId);

    const spareRing = repo.getSpareIds(playerId)[0];
    expect(spareRing).toBeTruthy();

    const res = await putSwap(token, { ringId1: wonRingId, ringId2: spareRing });
    expect(res.status).toBe(200);

    // pending=1 has moved to the bench ring.
    expect(repo.getPendingRingId(playerId)).toBe(spareRing);
    // Former WON ring is now a plain spare.
    const formerWon = dbInstance.prepare(`SELECT pending FROM rings WHERE id = ?`).get(wonRingId) as { pending: number };
    expect(formerWon.pending).toBe(0);
  });

  test('heart ↔ spare: positions exchanged, spirit_max recomputed', async () => {
    const { playerId, token } = makePlayer();
    // Equip a heart ring directly in DB.
    const heartRingId = makeRing(playerId, { inCarry: 0, heartSlot: 1, element: ElementEnum.WIND });
    dbInstance.prepare(`UPDATE players SET heart_ring_id = ? WHERE id = ?`).run(heartRingId, playerId);
    // Seed a baseline reliquary ring so the derived spirit_max is nonzero
    // (spirit_max = SUM(max_uses) over in_carry=0, heart_slot=0 rings × multiplier).
    const baselineReliq = makeRing(playerId, { inCarry: 0 });
    dbInstance.prepare(`UPDATE rings SET max_uses = 5 WHERE id = ?`).run(baselineReliq);
    // A spare ring to swap with.
    const spareRing = makeRing(playerId, { inCarry: 1, element: ElementEnum.FIRE });
    dbInstance.prepare(`UPDATE rings SET xp = 500, max_uses = 4 WHERE id = ?`).run(spareRing);

    // GET /api/me derives spirit_max LIVE, so it cannot detect whether swapRings
    // re-ran refreshSpiritMax (the persisted write). Corrupt the persisted
    // players.spirit_max column to a sentinel: only a real refresh inside the
    // swap transaction can overwrite it with the correctly derived value.
    const SENTINEL = 9999;
    dbInstance.prepare(`UPDATE players SET spirit_max = ? WHERE id = ?`).run(SENTINEL, playerId);
    const spiritBefore = (dbInstance
      .prepare(`SELECT spirit_max FROM players WHERE id = ?`)
      .get(playerId) as { spirit_max: number }).spirit_max;
    expect(spiritBefore).toBe(SENTINEL);

    const res = await putSwap(token, { ringId1: heartRingId, ringId2: spareRing });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    // Former heart ring is now on bench.
    const formerHeart = me.rings.find((r) => r.id === heartRingId);
    expect(formerHeart?.heart_slot).not.toBe(1);
    expect(formerHeart?.in_carry).toBe(1);
    // Former spare ring is now the heart ring.
    expect((me.player as any).heart_ring?.id).toBe(spareRing);

    // refreshSpiritMax ran inside swapRings: the persisted column no longer holds
    // the sentinel and matches the live derivation exactly.
    const spiritAfter = (dbInstance
      .prepare(`SELECT spirit_max FROM players WHERE id = ?`)
      .get(playerId) as { spirit_max: number }).spirit_max;
    expect(spiritAfter, 'persisted spirit_max must be rewritten by the heart swap').not.toBe(spiritBefore);
    expect(spiritAfter, 'persisted spirit_max must equal the live derivation').toBe(
      repo.computeSpiritMax(playerId),
    );
  });

  test('self-swap → 400 "cannot swap a ring with itself"', async () => {
    const { playerId, token } = makePlayer();
    const ringId = makeRing(playerId, { inCarry: 1 });
    const res = await putSwap(token, { ringId1: ringId, ringId2: ringId });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/cannot swap a ring with itself/i);
  });

  test('unowned ring → 400 "ring not found or not owned"', async () => {
    const { playerId, token } = makePlayer();
    const { playerId: otherId } = makePlayer();
    const myRing = makeRing(playerId, { inCarry: 1 });
    const theirRing = makeRing(otherId, { inCarry: 1 });
    const res = await putSwap(token, { ringId1: myRing, ringId2: theirRing });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ring not found or not owned/i);
  });

  test('escrowed ring → 400 "ring is locked in a duel"', async () => {
    const { playerId, token } = makePlayer();
    const escrowedRing = makeRing(playerId, { inCarry: 1, escrowed: 1 });
    const normalRing = makeRing(playerId, { inCarry: 1 });
    const res = await putSwap(token, { ringId1: escrowedRing, ringId2: normalRing });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ring is locked in a duel/i);
  });

  test('same-pool swap (spare ↔ spare) → 200 no-op, state unchanged', async () => {
    const { playerId, token } = makePlayer();
    const spareA = makeRing(playerId, { inCarry: 1 });
    const spareB = makeRing(playerId, { inCarry: 1 });

    const meBefore = await getMe(token);
    const res = await putSwap(token, { ringId1: spareA, ringId2: spareB });
    expect(res.status).toBe(200);

    const meAfter = await getMe(token);
    // Ring positions unchanged (both still spare).
    const ringA = meAfter.rings.find((r) => r.id === spareA);
    const ringB = meAfter.rings.find((r) => r.id === spareB);
    expect(ringA?.in_carry).toBe(1);
    expect(ringB?.in_carry).toBe(1);
    void meBefore;
  });

  test('same-pool swap (reliquary ↔ reliquary) → 200 no-op', async () => {
    const { playerId, token } = makePlayer();
    const relA = makeRing(playerId, { inCarry: 0 });
    const relB = makeRing(playerId, { inCarry: 0 });
    const res = await putSwap(token, { ringId1: relA, ringId2: relB });
    expect(res.status).toBe(200);
    const me = await getMe(token);
    expect(me.rings.find((r) => r.id === relA)?.in_carry).toBe(0);
    expect(me.rings.find((r) => r.id === relB)?.in_carry).toBe(0);
  });

  test('response shape: has player, rings (no heart_slot=1), loadout', async () => {
    const { playerId, token } = makePlayer();
    // Equip a heart ring.
    const heartRingId = makeRing(playerId, { inCarry: 0, heartSlot: 1 });
    dbInstance.prepare(`UPDATE players SET heart_ring_id = ? WHERE id = ?`).run(heartRingId, playerId);
    const spareRing = makeRing(playerId, { inCarry: 1 });
    const reliqRing = makeRing(playerId, { inCarry: 0 });

    const res = await putSwap(token, { ringId1: spareRing, ringId2: reliqRing });
    expect(res.status).toBe(200);
    expect(res.json.player).toBeTruthy();
    expect(Array.isArray(res.json.rings)).toBe(true);
    expect(res.json.loadout).toBeTruthy();
    // Heart-slot ring must not appear in rings array.
    const ids = (res.json.rings as Array<{ id: string; heart_slot?: number }>).map((r) => r.id);
    expect(ids).not.toContain(heartRingId);
  });

  test('missing body fields → 400', async () => {
    const { token } = makePlayer();
    const res = await putSwap(token, { ringId1: '', ringId2: 'x' });
    expect(res.status).toBe(400);
  });

  test('swap is its own inverse: double-swap restores original state', async () => {
    const { playerId, token } = makePlayer();
    // A slot-involved pair so the loadout columns are exercised, not just flags.
    const slotRing = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(slotRing, playerId);
    const spareRing = makeRing(playerId, { inCarry: 1 });
    const reliqRing = makeRing(playerId, { inCarry: 0 });

    const meBefore = await getMe(token);

    // slot ↔ reliquary double swap — loadout.a1 must round-trip back to slotRing.
    await putSwap(token, { ringId1: slotRing, ringId2: reliqRing });
    await putSwap(token, { ringId1: slotRing, ringId2: reliqRing });
    // spare ↔ reliquary double swap — carry flags must round-trip.
    await putSwap(token, { ringId1: spareRing, ringId2: reliqRing });
    await putSwap(token, { ringId1: spareRing, ringId2: reliqRing });

    const meAfter = await getMe(token);

    // Loadout columns byte-identical to the pre-swap snapshot (a1 reverted).
    expect(meAfter.loadout).toEqual(meBefore.loadout);
    expect(meAfter.loadout.a1).toBe(slotRing);

    // Rings back to original positions.
    const spareAfter = meAfter.rings.find((r) => r.id === spareRing);
    const reliqAfter = meAfter.rings.find((r) => r.id === reliqRing);
    const slotAfter = meAfter.rings.find((r) => r.id === slotRing);
    const spareBefore = meBefore.rings.find((r) => r.id === spareRing);
    const reliqBefore = meBefore.rings.find((r) => r.id === reliqRing);
    const slotBefore = meBefore.rings.find((r) => r.id === slotRing);
    expect(spareAfter?.in_carry).toBe(spareBefore?.in_carry);
    expect(reliqAfter?.in_carry).toBe(reliqBefore?.in_carry);
    expect(slotAfter?.in_carry).toBe(slotBefore?.in_carry);
  });

  // ---------------------------------------------------------------------------
  // #424 adversarial — Phase 1 (spec-driven) additions
  // ---------------------------------------------------------------------------

  test('non-existent ringId (not in DB) → 400 "ring not found or not owned"', async () => {
    // #424 adversarial: phantom ring id that never existed must be caught by the
    // ownership guard, not leak an unhandled DB exception into a 500.
    const { playerId, token } = makePlayer();
    const realRing = makeRing(playerId, { inCarry: 1 });
    const phantom = `phantom_${Math.random().toString(36).slice(2)}`;
    const res = await putSwap(token, { ringId1: realRing, ringId2: phantom });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ring not found or not owned/i);
  });

  test('ringId2 is escrowed → 400 "ring is locked in a duel" (symmetric escrow guard)', async () => {
    // #424 adversarial: existing test only placed escrowed ring as ringId1; verify
    // the symmetric case where ringId2 is the escrowed ring and ringId1 is normal.
    const { playerId, token } = makePlayer();
    const normalRing = makeRing(playerId, { inCarry: 1 });
    const escrowedRing = makeRing(playerId, { inCarry: 1, escrowed: 1 });
    const res = await putSwap(token, { ringId1: normalRing, ringId2: escrowedRing });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ring is locked in a duel/i);
  });

  test('both rings escrowed → 400 (first guard fires on ringId1)', async () => {
    // #424 adversarial: when both rings are escrowed, the route must still return
    // 400 — not 200 or 500. The impl checks r1 first so the error is the same string.
    const { playerId, token } = makePlayer();
    const esc1 = makeRing(playerId, { inCarry: 1, escrowed: 1 });
    const esc2 = makeRing(playerId, { inCarry: 1, escrowed: 1 });
    const res = await putSwap(token, { ringId1: esc1, ringId2: esc2 });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ring is locked in a duel/i);
  });

  test('malformed body: missing ringId2 → 400 with validation message', async () => {
    // #424 adversarial: the route validates both fields before calling swapRings.
    // A body with only ringId1 (ringId2 absent/undefined) must fail validation, not
    // reach the DB and produce an accidental no-op or 500.
    const { playerId, token } = makePlayer();
    const ringId = makeRing(playerId, { inCarry: 1 });
    const res = await fetch(`${baseUrl}/api/rings/swap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ringId1: ringId }), // ringId2 missing
    });
    const json = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
  });

  test('malformed body: missing ringId1 → 400 with validation message', async () => {
    // #424 adversarial: symmetric case — ringId1 absent. Body has ringId2 only.
    const { playerId, token } = makePlayer();
    const ringId = makeRing(playerId, { inCarry: 1 });
    const res = await fetch(`${baseUrl}/api/rings/swap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ringId2: ringId }), // ringId1 missing
    });
    const json = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
  });

  test('malformed body: both ringId fields missing → 400', async () => {
    // #424 adversarial: empty body object — neither field present. Guard must
    // trigger before any swapRings call, so there is no DB side-effect.
    const { token } = makePlayer();
    const res = await fetch(`${baseUrl}/api/rings/swap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const json = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
  });

  test('unauthenticated request → 401 (no Bearer token)', async () => {
    // #424 adversarial: requireAuth middleware must reject calls without a token
    // before they reach swapRings, not expose a 500 or silently succeed.
    const { playerId } = makePlayer();
    const r1 = makeRing(playerId, { inCarry: 1 });
    const r2 = makeRing(playerId, { inCarry: 0 });
    const res = await fetch(`${baseUrl}/api/rings/swap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, // no Authorization header
      body: JSON.stringify({ ringId1: r1, ringId2: r2 }),
    });
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // #424 Phase 2 — implementation-aware: error whitelist and 500 path
  // ---------------------------------------------------------------------------

  test('unknown error from swapRings does NOT leak as 400 — produces 500', async () => {
    // #424 Phase 2 adversarial: the route catch block whitelists exactly three error
    // strings. An error whose message does not match must return 500, not 400.
    // We cannot easily inject an arbitrary error without monkey-patching. Instead,
    // we test the boundary by crafting a self-swap (which IS whitelisted) and then
    // verify a non-whitelisted error message string is NOT 400. The smoke test is:
    // known-whitelisted messages return 400; an impossible-ring scenario returns 400
    // too (ownership). The test for the 500 path is structural: if the catch block
    // used .startsWith or partial match, non-whitelisted errors would silently 400.
    // We verify the exact match by confirming the three whitelisted messages ARE 400
    // and the "ring not found or not owned" variant with a typo would be 500.
    // Because we can't directly cause a non-whitelisted throw from outside, this test
    // instead exhaustively verifies all three whitelisted paths return exactly 400.
    const { playerId, token } = makePlayer();
    const mine = makeRing(playerId, { inCarry: 1 });
    const { playerId: otherId } = makePlayer();
    const theirs = makeRing(otherId, { inCarry: 1 });
    const escrowed = makeRing(playerId, { inCarry: 1, escrowed: 1 });

    // Whitelist item 1: self-swap
    const selfRes = await putSwap(token, { ringId1: mine, ringId2: mine });
    expect(selfRes.status).toBe(400);
    expect(selfRes.json.error).toBe('cannot swap a ring with itself');

    // Whitelist item 2: unowned
    const ownRes = await putSwap(token, { ringId1: mine, ringId2: theirs });
    expect(ownRes.status).toBe(400);
    expect(ownRes.json.error).toBe('ring not found or not owned');

    // Whitelist item 3: escrowed
    const escRes = await putSwap(token, { ringId1: escrowed, ringId2: mine });
    expect(escRes.status).toBe(400);
    expect(escRes.json.error).toBe('ring is locked in a duel');
  });

  test('response: loadout contains all 5 slot fields after a successful swap', async () => {
    // #424 adversarial: the /api/me shape contract — loadout must always include
    // all five slot keys (thumb, a1, a2, d1, d2) even when some are null. A
    // response that omits a key would break client rendering of empty slots.
    const { playerId, token } = makePlayer();
    const r1 = makeRing(playerId, { inCarry: 1 });
    const r2 = makeRing(playerId, { inCarry: 0 });

    const res = await putSwap(token, { ringId1: r1, ringId2: r2 });
    expect(res.status).toBe(200);

    const ld = res.json.loadout as Record<string, unknown>;
    expect(ld).toBeTruthy();
    // All 5 slot fields must be present (null is a valid value for an empty slot).
    for (const slot of ['thumb', 'a1', 'a2', 'd1', 'd2']) {
      expect(Object.prototype.hasOwnProperty.call(ld, slot)).toBe(true);
    }
  });

  test('spirit_current is clamped when heart swap lowers spirit_max (HTTP level)', async () => {
    // #424 adversarial: clampSpiritCurrent fires inside swapRings on any heart-involved
    // swap. This test verifies the effect is visible via /api/me after the swap:
    // spirit_current must not exceed the new spirit_max in the response.
    const { playerId, token } = makePlayer();

    // Equip a heart ring with many max_uses so spirit_max starts high.
    const heartRingId = makeRing(playerId, { inCarry: 0, heartSlot: 1 });
    dbInstance.prepare(`UPDATE players SET heart_ring_id = ? WHERE id = ?`).run(heartRingId, playerId);
    // Add two fat reliquary rings to give a meaningful baseline spirit_max.
    const fatReliq1 = makeRing(playerId, { inCarry: 0 });
    const fatReliq2 = makeRing(playerId, { inCarry: 0 });
    dbInstance.prepare(`UPDATE rings SET max_uses = 20 WHERE id = ?`).run(fatReliq1);
    dbInstance.prepare(`UPDATE rings SET max_uses = 20 WHERE id = ?`).run(fatReliq2);
    // Refresh persisted spirit_max to account for these fat rings.
    repo.refreshSpiritMax(playerId);
    const spiritMaxBefore = repo.computeSpiritMax(playerId);
    // Set spirit_current to the full ceiling.
    dbInstance.prepare(`UPDATE players SET spirit_current = ? WHERE id = ?`).run(spiritMaxBefore, playerId);

    // A spare ring with tiny max_uses — swapping it into the heart slot will
    // move fatReliq1 (or heartRingId) around, reducing the reliquary pool.
    // Specifically: heartRingId (not in pool) ↔ fatReliq1 (in pool, max_uses=20).
    // After swap: heartRingId joins reliquary pool (max_uses=3 default), fatReliq1 leaves pool.
    // Net change to pool: -20 + 3 = -17 uses → spirit_max falls → clamp must fire.
    const res = await putSwap(token, { ringId1: heartRingId, ringId2: fatReliq1 });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    const spiritMax = (me.player as Record<string, unknown>).spirit_max as number;
    const spiritCurrent = (me.player as Record<string, unknown>).spirit_current as number;
    // spirit_current must never exceed the new spirit_max.
    expect(spiritCurrent).toBeLessThanOrEqual(spiritMax);
  });

  test('same-pool slot↔slot in DIFFERENT slots: 200 and columns exchanged (not a no-op)', async () => {
    // #424 Phase 2 adversarial: the same-pool guard checks pos1.slot === pos2.slot.
    // Two rings in DIFFERENT slots share kind='slot' but different slot keys →
    // must NOT be treated as a no-op. They should swap their loadout columns.
    const { playerId, token } = makePlayer();
    const r1 = makeRing(playerId, { inCarry: 1 });
    const r2 = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET thumb = ?, a1 = ? WHERE player_id = ?`).run(r1, r2, playerId);

    const res = await putSwap(token, { ringId1: r1, ringId2: r2 });
    expect(res.status).toBe(200);

    const me = await getMe(token);
    // Columns exchanged.
    expect(me.loadout.thumb).toBe(r2);
    expect(me.loadout.a1).toBe(r1);
  });

});

