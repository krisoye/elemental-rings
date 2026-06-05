/**
 * #421 — HTTP route-level regression coverage for PUT /api/loadout.
 *
 * The #421 fix removed an outer `getSpareIds > spareMax` pre-check from the
 * PUT /api/loadout route handler (server/src/api/routes.ts). That gate rejected
 * EVERY loadout mutation while the bench was over capacity — deadlocking the very
 * moves that resolve a pending WON-ring overflow. The unit tests in
 * tests/unit/CarryCap.test.ts call saveLoadout directly and would still pass if
 * the outer gate were accidentally re-added, so this suite exercises the real
 * Express route over HTTP: if the gate comes back, the overflow-resolution PUT
 * returns 400 here and the first test fails.
 *
 * Mounts the production apiRouter on a throwaway Express app bound to an
 * ephemeral port, against a throwaway SQLite DB (DB_PATH must be set before the
 * first import of db.ts — a process-level singleton — so everything is imported
 * dynamically in beforeAll, mirroring heart-slot-hp.test.ts).
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
// Test helpers (same direct-insert pattern as tests/unit/CarryCap.test.ts)
// ---------------------------------------------------------------------------

/** Insert a bare ring owned by playerId. */
function makeRing(
  playerId: string,
  { inCarry = 0, pending = 0 }: { inCarry?: number; pending?: number } = {},
): string {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  dbInstance.prepare(
    `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot, pending)
     VALUES (?, ?, ?, 0, 3, 3, 0, ?, 0, 0, ?)`,
  ).run(id, playerId, ElementEnum.FIRE, inCarry, pending);
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

/** PUT /api/loadout with a Bearer token. */
async function putLoadout(
  token: string,
  body: Record<string, string | null>,
): Promise<{ status: number; json: { loadout?: Record<string, string | null>; error?: string } }> {
  const res = await fetch(`${baseUrl}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as never };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-loadout-route-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const { apiRouter } = await import('../../server/src/api/routes');

  // Mount the PRODUCTION router exactly as server/index.ts does (json + router),
  // on an ephemeral port so parallel workspaces never collide.
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
// PUT /api/loadout — #421 overflow-resolution route coverage
// ---------------------------------------------------------------------------

describe('PUT /api/loadout — pending WON ring overflow (#421 route level)', () => {
  test('returns 200 slotting the pending ring while the bench is over capacity', async () => {
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // Fill the bench to exactly spare_ring_max, then grant the WON ring → max + 1.
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    const wonRingId = repo.grantRing(playerId, ElementEnum.FIRE);
    expect(repo.getSpareIds(playerId).length).toBe(max + 1); // confirmed overflow

    // The overflow-resolving move MUST pass the route layer. Before #421 the
    // outer route gate returned 400 'spare grid exceeded' here.
    const res = await putLoadout(token, { a1: wonRingId });
    expect(res.status).toBe(200);
    expect(res.json.loadout?.a1).toBe(wonRingId);
    expect(repo.getPendingRingId(playerId)).toBeNull();
    expect(repo.getSpareIds(playerId).length).toBe(max);
  });

  test('still returns 400 spare grid full for a genuine overflow (slot → full bench)', async () => {
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // One ring in a1, bench at exactly capacity (no pending ring).
    const slotRingId = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(slotRingId, playerId);
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });

    // Clearing a1 would dump its ring onto the full bench — the delta-aware guard
    // inside saveLoadout must still reject through the route's try/catch.
    const res = await putLoadout(token, { a1: null });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/spare grid full/);
  });

  test('slot-to-slot reassignment (a1→a2) at overflow returns 400 — spare still over max', async () => {
    // #421 adversarial (case A clarified): moving a ring from a1 to a2 while in overflow
    // involves the saveLoadout one-slot-per-ring rule silently clearing a1, BUT the sparse
    // delta computation only iterates keys IN partial. Since partial={a2: slotRing} contains
    // only "a2", the loop processes only the a2 assignment: newVal=slotRing, which is NOT in
    // spare (it's in a1 slot) → removingFromSpare=[]. addingToSpare=[].
    // assertSpareWithinMax({}) = spareCountAfter({}) = getSpareIds().length = max+1 > max → 400.
    // This verifies the inner delta guard is still authoritative at overflow — the removed outer
    // gate was not the only blocker; the inner delta guard correctly blocks net-zero-but-at-overflow
    // moves too. Only moves that genuinely reduce spare count (e.g. slotting a spare ring into an
    // empty battle slot) succeed.
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    // Fill bench to max, then grant WON ring → max + 1 (genuine overflow state).
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    repo.grantRing(playerId, ElementEnum.FIRE);
    expect(repo.getSpareIds(playerId).length).toBe(max + 1);
    // Put a ring in a1 (it is in a battle slot — NOT in spare).
    const slotRing = makeRing(playerId, { inCarry: 1 });
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(slotRing, playerId);
    // Attempt to reassign to a2 — delta is actually zero (slotRing was never in spare),
    // BUT spare count is already max+1, so assertSpareWithinMax fires and returns 400.
    const res = await putLoadout(token, { a2: slotRing });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/spare grid full/);
    // This verifies the inner guard is still the authoritative backstop at overflow — the
    // outer gate's removal only unlocks moves with negative spare delta (e.g. slotting the
    // WON ring from spare into an empty slot, which reduces spare from max+1 to max).
  });

  test('empty body at overflow returns 400 — assertSpareWithinMax fires on current spare count', async () => {
    // #421 adversarial: an empty PUT body still triggers assertSpareWithinMax({}) which
    // checks spareCountAfter(playerId, {}) = getSpareIds().length = max+1 > max → 400.
    // This verifies the inner guard fires even on no-op mutations when already over max.
    // The outer gate removal (the #421 fix) does NOT make empty-body-at-overflow succeed.
    const { playerId, token } = makePlayer();
    const max = repo.getSpareRingMax(playerId);
    for (let i = 0; i < max; i++) makeRing(playerId, { inCarry: 1 });
    repo.grantRing(playerId, ElementEnum.FIRE); // overflow → spare = max + 1
    expect(repo.getSpareIds(playerId).length).toBe(max + 1);
    // Empty body: saveLoadout iterates zero keys → assertSpareWithinMax({}) → spare still max+1 → 400.
    const res = await putLoadout(token, {});
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/spare grid full/);
  });

  test('PUT /api/loadout filters unknown slot keys — valid keys in same body still process', async () => {
    // #421 adversarial: a body with mixed valid+invalid keys (e.g. {"badSlot": "id", "a1": "id"})
    // must ignore the unknown key and process the valid key. The route's key-filter loop
    // (`if (!VALID_SLOTS.has(key)) continue`) must not contaminate the partial with bad keys.
    const { playerId, token } = makePlayer();
    const ringId = makeRing(playerId, { inCarry: 1 });
    const res = await putLoadout(token, { badSlot: ringId, a1: ringId } as any);
    expect(res.status).toBe(200);
    // The valid a1 key was processed; the bad key was silently dropped.
    expect(res.json.loadout?.a1).toBe(ringId);
  });

  test('PUT /api/loadout with a ring not owned by the player is silently ignored (no 400)', async () => {
    // #421 adversarial: saveLoadout validates ring ownership — an unowned ring id is
    // silently skipped (the slot remains as-is). This tests the ownership guard path
    // does not throw an unhandled error through the route's try/catch.
    const { playerId, token } = makePlayer();
    const otherPlayerId = `other_${Math.random().toString(36).slice(2)}`;
    dbInstance.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
      otherPlayerId, `u_${otherPlayerId}`, 'x',
    );
    const foreignRing = makeRing(otherPlayerId, { inCarry: 1 });
    // Attempting to assign a ring owned by someone else — silently ignored.
    const res = await putLoadout(token, { a1: foreignRing });
    expect(res.status).toBe(200);
    // a1 remains null (the foreign ring was not assigned).
    expect(res.json.loadout?.a1).toBeNull();
  });
});
