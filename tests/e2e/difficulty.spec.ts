import { test, expect } from '@playwright/test';

/**
 * EPIC #279 (#280 + #283) — difficulty tier system (server-side E2E).
 *
 * - GET /api/me exposes `difficulty` (default 'seeker' for every fresh player).
 * - PUT /api/difficulty { tier } sets the tier, recomputes spirit_max under the
 *   new multiplier (Σ Reliquary max_uses × DIFFICULTY_MULTIPLIERS[tier]), and
 *   clamps spirit_current to the new max. Invalid tiers → 400 { error }.
 *
 * Deterministic setup: empty the Reliquary (carry everything), then seed N
 * resting rings of max_uses=3 so Σ(max_uses) is exactly 3 × N. spirit_max is
 * then 3N × {wanderer:5, seeker:4, ascendant:3}.
 *
 * All assertions are against REAL API responses — never mocked. No browser.
 */

const API_URL = 'http://localhost:2568';

async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return (await res.json()).token;
}

function authJson(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function getMe(token: string): Promise<{ player: any; rings: any[] }> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function putCarry(token: string, ringIds: string[]): Promise<Response> {
  return fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: authJson(token),
    body: JSON.stringify({ ringIds }),
  });
}

async function seedRestingRings(token: string, count: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`seed-resting-rings failed (${res.status})`);
}

async function putDifficulty(token: string, tier: string): Promise<Response> {
  return fetch(`${API_URL}/api/difficulty`, {
    method: 'PUT',
    headers: authJson(token),
    body: JSON.stringify({ tier }),
  });
}

/** Empty the Reliquary, then seed `count` max_uses=3 rings. Returns Σ(max_uses). */
async function seedReliquaryUses(token: string, count: number): Promise<number> {
  const { rings } = await getMe(token);
  expect((await putCarry(token, rings.map((r) => r.id))).status).toBe(200); // empty Reliquary
  expect((await getMe(token)).player.spirit_max).toBe(0);
  await seedRestingRings(token, count);
  return count * 3; // each seeded ring has max_uses = 3
}

// ── #280 — fresh player defaults to 'seeker' ─────────────────────────────────
test('difficulty: GET /api/me returns difficulty seeker for a fresh player', async () => {
  const token = await mintToken();
  const { player } = await getMe(token);
  expect(player.difficulty).toBe('seeker');
});

// ── #283 Scenario 1 — switch to wanderer recomputes spirit_max (×5) ──────────
test('difficulty: PUT wanderer recomputes spirit_max to Σ(max_uses) × 5', async () => {
  const token = await mintToken();
  const usesSum = await seedReliquaryUses(token, 1); // 1 ring → Σ = 3
  // Seeker baseline: 3 × 4 = 12.
  expect((await getMe(token)).player.spirit_max).toBe(usesSum * 4);

  const res = await putDifficulty(token, 'wanderer');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.difficulty).toBe('wanderer');
  expect(body.spirit_max).toBe(usesSum * 5); // 3 × 5 = 15

  // /api/me confirms the persisted tier and recomputed max.
  const { player } = await getMe(token);
  expect(player.difficulty).toBe('wanderer');
  expect(player.spirit_max).toBe(usesSum * 5);
});

// ── #283 Scenario 2 — ascendant yields the ×3 multiplier ─────────────────────
test('difficulty: PUT ascendant recomputes spirit_max to Σ(max_uses) × 3', async () => {
  const token = await mintToken();
  const usesSum = await seedReliquaryUses(token, 2); // 2 rings → Σ = 6

  const res = await putDifficulty(token, 'ascendant');
  expect(res.status).toBe(200);
  expect((await res.json()).spirit_max).toBe(usesSum * 3); // 6 × 3 = 18
  expect((await getMe(token)).player.spirit_max).toBe(usesSum * 3);
});

// ── #283 Scenario 3 — lowering the tier clamps spirit_current ────────────────
test('difficulty: switching to a lower tier clamps spirit_current to the new max', async () => {
  const token = await mintToken();
  const usesSum = await seedReliquaryUses(token, 3); // 3 rings → Σ = 9

  // On seeker, spirit_max = 9 × 4 = 36; rest to fill spirit_current to the max.
  expect((await getMe(token)).player.spirit_max).toBe(usesSum * 4);
  // Seed spirit_current to the seeker max via the test route so the clamp is observable.
  const setSpirit = await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ spirit: usesSum * 4 }),
  });
  expect(setSpirit.status).toBe(200);
  expect((await getMe(token)).player.spirit_current).toBe(usesSum * 4); // 36

  // Switch to ascendant: spirit_max drops to 9 × 3 = 27 → spirit_current clamps to 27.
  const res = await putDifficulty(token, 'ascendant');
  expect(res.status).toBe(200);
  expect((await res.json()).spirit_max).toBe(usesSum * 3); // 27
  const { player } = await getMe(token);
  expect(player.spirit_max).toBe(usesSum * 3);
  expect(player.spirit_current).toBe(usesSum * 3); // clamped down from 36
});

// ── #283 Scenario 4 — invalid tiers are rejected with 400 ────────────────────
test('difficulty: invalid tier strings return 400 { error: invalid tier }', async () => {
  const token = await mintToken();

  const bad = await putDifficulty(token, 'expert');
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toBe('invalid tier');

  // Wrong case must also be rejected (the guard is case-sensitive).
  const wrongCase = await putDifficulty(token, 'SEEKER');
  expect(wrongCase.status).toBe(400);
  expect((await wrongCase.json()).error).toBe('invalid tier');

  // A missing tier is rejected too.
  const missing = await fetch(`${API_URL}/api/difficulty`, {
    method: 'PUT',
    headers: authJson(token),
    body: JSON.stringify({}),
  });
  expect(missing.status).toBe(400);
});
