import { test, expect } from '@playwright/test';

/**
 * EPIC #279 (#282) — fixed spare carry capacity (server-side E2E).
 *
 * Replaces the former #171 XP-driven curve (carry_cap = 5 + ceil(log_2(aggregate_xp))).
 * Carry cap is now a flat constant for every player:
 *   carry_cap = CORE_SLOTS(5) + SPARE_SLOTS(9) = 14
 * independent of Reliquary XP. /api/me exposes spareCapacity = 9 (fixed).
 *
 * Scenarios:
 *   1. Fresh player → carry_cap 14, spareCapacity 9, regardless of XP.
 *   2. A veteran with high Reliquary XP → still carry_cap 14, spareCapacity 9.
 *   3. Carrying exactly 14 rings succeeds; 15 is rejected.
 *
 * Uses test-only routes (mint-token, set-ring-xp, seed-resting-rings). All
 * assertions are server-state only (REST API round-trips) — no browser needed.
 */

const API_URL = 'http://localhost:2568';

/** Mint a fresh E2E player → token. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return (await res.json()).token;
}

/** GET /api/me → full player snapshot. */
async function getMe(token: string): Promise<{ player: any; rings: any[]; loadout: any }> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** POST /api/test/set-ring-xp to an absolute value. */
async function setRingXP(token: string, ringId: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId, xp }),
  });
  if (!res.ok) throw new Error(`set-ring-xp failed (${res.status}): ${await res.text()}`);
}

/** POST /api/test/seed-resting-rings → add `count` Reliquary rings. */
async function seedRestingRings(token: string, count: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`seed-resting-rings failed (${res.status}): ${await res.text()}`);
}

/** PUT /api/carry — set the carried set to exactly these ring ids. */
async function putCarry(token: string, ringIds: string[]): Promise<Response> {
  return fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds }),
  });
}

// ── Scenario 1: fresh player has spareCapacity 9 and carry cap 14 ─────────────
test('spare-carry: fresh player has spareCapacity 9 and carry cap 14', async () => {
  const token = await mintToken();
  const { player } = await getMe(token);
  expect(player.carry_cap).toBe(14);
  expect(player.spareCapacity).toBe(9);
});

// ── Scenario 2: a veteran with high Reliquary XP still has carry cap 14 ───────
test('spare-carry: high Reliquary XP does not change the flat carry cap of 14', async () => {
  const token = await mintToken();
  const { rings } = await getMe(token);
  // Pile XP onto a Reliquary (in_carry=0) ring — under the old log curve this
  // would have raised the cap well above 5; now it must stay 14.
  const reliquary = rings.filter((r: any) => r.in_carry === 0);
  expect(reliquary.length).toBeGreaterThanOrEqual(1);
  await setRingXP(token, reliquary[0].id, 10000);

  const { player } = await getMe(token);
  expect(player.aggregate_xp).toBe(10000);
  expect(player.carry_cap).toBe(14); // unchanged — flat cap
  expect(player.spareCapacity).toBe(9);
});

// ── Scenario 3: carry exactly 14 succeeds; 15 is rejected ────────────────────
test('spare-carry: carrying 14 rings succeeds, 15 is rejected', async () => {
  const token = await mintToken();
  await seedRestingRings(token, 5); // 10 starters + 5 = 15 owned
  const { rings } = await getMe(token);
  expect(rings.length).toBe(15);

  const fourteen = rings.slice(0, 14).map((r: any) => r.id);
  const atCap = await putCarry(token, fourteen);
  expect(atCap.status).toBe(200);

  const fifteen = rings.slice(0, 15).map((r: any) => r.id);
  const overCap = await putCarry(token, fifteen);
  expect(overCap.status).toBe(400);
});
