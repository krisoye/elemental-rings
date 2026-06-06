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

});
