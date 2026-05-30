import { test, expect } from '@playwright/test';

/**
 * #171 — XP-driven spare carry capacity (server-side E2E).
 *
 * carry_cap = 5 + floor(aggregate_xp / 100)
 * aggregate_xp = SUM(xp) WHERE in_carry = 0  (Reliquary rings only)
 *
 * Scenarios:
 *   1. GET /api/me: fresh player has spareCapacity 0 (aggregate_xp = 0 in_carry=0).
 *      The REST response exposes spare_capacity for client consumption.
 *   2. PUT /api/loadout with carried-ring count > cap (5) → 400.
 *   4. After retiring ≥ 200 XP to the Reliquary (in_carry=0), spareCapacity
 *      becomes ≥ 2 and carry cap updates live — no server restart required.
 *
 * Uses test-only routes (drain-spirit, set-ring-xp) following the pattern in
 * spirit.spec.ts and teleport.spec.ts. All assertions are server-state only
 * (REST API round-trips) — no Playwright browser needed.
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

/** PUT /api/carry — set the carried set to exactly these ring ids. */
async function putCarry(token: string, ringIds: string[]): Promise<Response> {
  return fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds }),
  });
}

/** PUT /api/loadout — update slot assignments. */
async function putLoadout(token: string, partial: Record<string, string | null>): Promise<Response> {
  return fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(partial),
  });
}

// ── Scenario 1: GET /api/me exposes spareCapacity = 0 for a fresh player ───────
test('spare-carry: fresh player has spareCapacity 0 and carry cap 5', async () => {
  const token = await mintToken();
  const { player, rings } = await getMe(token);

  // Fresh player: aggregate_xp = 0 (all rings are carried with xp=0, Reliquary
  // is empty of XP-bearing rings). spareCapacity = floor(0/100) = 0.
  expect(player.aggregate_xp).toBe(0);
  // PUT /api/carry: 5 rings = at cap → 200; 6 rings = over cap → 400.
  const carried = rings.filter((r: any) => r.in_carry === 1).map((r: any) => r.id);
  expect(carried.length).toBe(5); // default battle slots

  const atCap = await putCarry(token, carried.slice(0, 5));
  expect(atCap.status).toBe(200);

  const allRingIds = rings.map((r: any) => r.id).slice(0, 6);
  const overCap = await putCarry(token, allRingIds);
  expect(overCap.status).toBe(400);
});

// ── Scenario 2: PUT /api/loadout rejects when carry count > 5 + spareCapacity ──
test('spare-carry: PUT /api/loadout 400 when carried count exceeds cap', async () => {
  const token = await mintToken();
  const { rings } = await getMe(token);
  // First attempt to carry 6 rings — this should fail (via packLoadout guard).
  const sixIds = rings.slice(0, 6).map((r: any) => r.id);
  const carryRes = await putCarry(token, sixIds);
  expect(carryRes.status).toBe(400);

  // Confirm carried count is unchanged (still 5 from createPlayer defaults).
  const { rings: after } = await getMe(token);
  const carriedCount = after.filter((r: any) => r.in_carry === 1).length;
  expect(carriedCount).toBe(5);

  // Now PUT /api/loadout when carry count == cap (5 == 5): should succeed.
  const { rings: current, loadout } = await getMe(token);
  const carried = current.filter((r: any) => r.in_carry === 1);
  const loadoutRes = await putLoadout(token, { a1: carried[0]?.id ?? null });
  expect(loadoutRes.status).toBe(200);
});

// ── Scenario 4: live increment after retiring ≥ 200 XP to Reliquary ────────────
// Retire 2 rings with 100 XP each (in_carry = 0 → aggregate_xp = 200).
// spareCapacity = floor(200 / 100) = 2. carry cap updates live: 5 + 2 = 7.
test('spare-carry: retiring 200 XP to Reliquary raises carry cap from 5 to 7', async () => {
  const token = await mintToken();
  const { rings } = await getMe(token);

  // Set 2 uncarried rings to 100 XP each (XP on in_carry=0 rings = aggregate_xp).
  const reliquary = rings.filter((r: any) => r.in_carry === 0);
  expect(reliquary.length).toBeGreaterThanOrEqual(2);
  await setRingXP(token, reliquary[0].id, 100);
  await setRingXP(token, reliquary[1].id, 100);

  // GET /api/me reflects the updated aggregate_xp and spareCapacity.
  const { player: after } = await getMe(token);
  expect(after.aggregate_xp).toBe(200);

  // Carry cap is now 7 (5 + 2 spare). We can carry 7 rings without error.
  const allRings = (await getMe(token)).rings;
  const sevenIds = allRings.slice(0, 7).map((r: any) => r.id);
  const carryRes = await putCarry(token, sevenIds);
  // packLoadout now allows 7 because getCarryCap returns 7.
  expect(carryRes.status).toBe(200);

  // 8 rings exceeds the new cap (7 + 1 = 8 > 7).
  const eightIds = allRings.slice(0, 8).map((r: any) => r.id);
  const overRes = await putCarry(token, eightIds);
  expect(overRes.status).toBe(400);
});
