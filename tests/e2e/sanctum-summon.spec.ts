import { test, expect } from '@playwright/test';

/**
 * Phase 8C / #180 — POST /api/sanctum/summon server E2E.
 *
 * Re-anchoring the Sanctum is now a natural ability (no talisman required).
 * The player pays the spiritCost of their CURRENT anchor (the journey the
 * Sanctum makes to reach the destination). If the Sanctum is already at the
 * destination the cost is 0.
 *
 * Scenarios:
 *   1. Summon from forest_entry to attuned forest_glade → spends forest_entry
 *      spiritCost (0), re-anchors; GET /api/me reflects the new anchor.
 *   2. Drain spirit → summon to forest_glade → 400 (insufficient spirit);
 *      anchor unchanged; /api/camp/sleep restores spirit → summon succeeds.
 *   3. Summon to the current anchor → 0 cost, succeeds.
 *   4. POST /api/talisman/activate → 404 (route removed).
 */

const API_URL = 'http://localhost:2568';

/** Mint a fresh E2E player and return its token. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return (await res.json()).token;
}

/** POST /api/waystones/attune the given waystone. */
async function attune(token: string, waystoneId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/waystones/attune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ waystoneId }),
  });
  if (!res.ok) throw new Error(`attune failed (${res.status})`);
}

/** POST /api/sanctum/summon to the given anchorageId. */
async function summon(token: string, anchorageId: string): Promise<Response> {
  return fetch(`${API_URL}/api/sanctum/summon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ anchorageId }),
  });
}

/** GET /api/waystones and return the current anchor. */
async function getAnchor(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/waystones`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()).anchor as string;
}

/** POST /api/test/drain-spirit — set spirit to 0. */
async function drainSpirit(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/drain-spirit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drain-spirit failed (${res.status})`);
}

/** POST /api/camp/sleep to restore spirit. */
async function sleep(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/camp/sleep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sleep failed (${res.status})`);
}

// ── Scenario 1: summon from attuned anchor spends source spiritCost and re-anchors ─
test('sanctum/summon: summon to attuned anchorage re-anchors and returns new spirit', async () => {
  const token = await mintToken();
  // Attune forest_glade (fresh player already attuned to forest_entry).
  await attune(token, 'forest_glade');

  // forest_entry spiritCost = 0, so this should cost 0 and always succeed.
  const res = await summon(token, 'forest_glade');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.anchor).toBe('forest_glade');
  expect(typeof body.spirit_current).toBe('number');
  // forest_entry → forest_glade: cost is forest_entry.spiritCost = 0.
  expect(body.spiritCost).toBe(0);

  // GET /api/waystones confirms the anchor moved.
  const anchor = await getAnchor(token);
  expect(anchor).toBe('forest_glade');
});

// ── Scenario 2: drain → summon fails → sleep → summon succeeds ────────────────
test('sanctum/summon: drain spirit → summon 400 (anchor unchanged) → sleep → summon succeeds', async () => {
  const token = await mintToken();
  // Attune a costly waystone (forest_depths, spiritCost=6) so the cost is > 0.
  await attune(token, 'forest_glade');
  await attune(token, 'forest_depths');

  // Move anchor to forest_glade first (cost from forest_entry = 0).
  await summon(token, 'forest_glade');
  expect(await getAnchor(token)).toBe('forest_glade');

  // Now drain spirit and try to summon to forest_depths (forest_glade.spiritCost=3).
  await drainSpirit(token);
  const failRes = await summon(token, 'forest_depths');
  expect(failRes.status).toBe(400);
  const failBody = await failRes.json();
  expect(failBody.error).toMatch(/spirit/i);
  // Anchor is unchanged after the failure.
  expect(await getAnchor(token)).toBe('forest_glade');

  // Sleep restores spirit → summon now succeeds.
  await sleep(token);
  const okRes = await summon(token, 'forest_depths');
  expect(okRes.status).toBe(200);
  expect((await okRes.json()).anchor).toBe('forest_depths');
  expect(await getAnchor(token)).toBe('forest_depths');
});

// ── Scenario 3: summon to current anchor costs 0 ─────────────────────────────
test('sanctum/summon: summon to current anchor is free (spiritCost 0)', async () => {
  const token = await mintToken();
  // forest_entry is the default anchor and already attuned.
  const res = await summon(token, 'forest_entry');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.anchor).toBe('forest_entry');
  expect(body.spiritCost).toBe(0);
  expect(await getAnchor(token)).toBe('forest_entry');
});

// ── Scenario 4: POST /api/talisman/activate returns 404 (route removed) ───────
test('sanctum/summon: POST /api/talisman/activate → 404 (route removed)', async () => {
  const token = await mintToken();
  const res = await fetch(`${API_URL}/api/talisman/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ talismanlId: 'sanctum_stone', anchorageId: 'forest_entry' }),
  });
  expect(res.status).toBe(404);
});

// ── Unattuned anchorage → 400 ─────────────────────────────────────────────────
test('sanctum/summon: unattuned anchorageId → 400', async () => {
  const token = await mintToken();
  // Do NOT attune forest_glade.
  const res = await summon(token, 'forest_glade');
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/attuned/i);
  // Anchor unchanged.
  expect(await getAnchor(token)).toBe('forest_entry');
});

// ── Unknown anchorageId → 400 ─────────────────────────────────────────────────
test('sanctum/summon: unknown anchorageId → 400', async () => {
  const token = await mintToken();
  const res = await summon(token, 'not_a_real_waystone');
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/unknown/i);
});
