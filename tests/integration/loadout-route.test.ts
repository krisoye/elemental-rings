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
});
