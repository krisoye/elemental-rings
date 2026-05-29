/**
 * E2E spec for #127 — server forage endpoints.
 * Exercises POST /api/overworld/forage and GET /api/overworld/forage-status
 * directly via authenticated HTTP requests (no browser needed — all scenarios
 * are server-state assertions). Mirrors the auth helper pattern from spirit.spec.ts.
 */
import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:2568';

async function mintToken(): Promise<{ token: string; playerId: string }> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return res.json() as Promise<{ token: string; playerId: string }>;
}

function authJson(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function sleep(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/camp/sleep`, {
    method: 'POST',
    headers: authJson(token),
  });
  if (!res.ok) throw new Error(`sleep failed (${res.status})`);
}

// Scenario 1 — Fresh forage: food_units increments by 1, node recorded.
test('forage: fresh node yields 1 food', async () => {
  const { token } = await mintToken();

  // Baseline food.
  const me0 = await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json() as { player: { food_units: number } };
  const before = me0.player.food_units;

  const res = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_1' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { food_units: number; yielded: number };
  expect(body.yielded).toBe(1);
  expect(body.food_units).toBe(before + 1);
});

// Scenario 2 — Depleted node: same player, same day → 409.
test('forage: depleted node returns 409', async () => {
  const { token } = await mintToken();
  const node = 'forest_anchorage:berry_2';

  // First forage succeeds.
  const first = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: node }),
  });
  expect(first.status).toBe(200);

  // Second forage on same day → 409.
  const second = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: node }),
  });
  expect(second.status).toBe(409);
  const body = (await second.json()) as { error: string };
  expect(body.error).toMatch(/depleted/i);
});

// Scenario 3 — Respawn after sleep: game_day advances +1, node harvestable again.
test('forage: node respawns after FORAGE_RESPAWN_DAYS (1 sleep)', async () => {
  const { token } = await mintToken();
  const node = 'forest_anchorage:berry_3';

  // Forage once (depletes it).
  await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: node }),
  });

  // Sleep to advance game_day by 1.
  await sleep(token);

  // Node should be harvestable again.
  const res = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: node }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { yielded: number };
  expect(body.yielded).toBe(1);
});

// Scenario 4 — Independent per player: two players each forage the same node → both succeed.
test('forage: two players can forage the same node on the same day', async () => {
  const { token: t1 } = await mintToken();
  const { token: t2 } = await mintToken();
  const node = 'forest_anchorage:berry_shared';

  const r1 = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(t1),
    body: JSON.stringify({ node_id: node }),
  });
  expect(r1.status).toBe(200);

  const r2 = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(t2),
    body: JSON.stringify({ node_id: node }),
  });
  expect(r2.status).toBe(200);

  const b1 = (await r1.json()) as { yielded: number };
  const b2 = (await r2.json()) as { yielded: number };
  expect(b1.yielded).toBe(1);
  expect(b2.yielded).toBe(1);
});

// Scenario 5 — GET forage-status reflects correct depleted/available per player.
test('forage-status: reports depleted nodes correctly', async () => {
  const { token } = await mintToken();
  const screen = 'forest_anchorage';
  const node = `${screen}:berry_status_test`;

  // Before foraging: no row for this player on this screen.
  const pre = await (
    await fetch(`${API_URL}/api/overworld/forage-status?screen=${screen}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json() as { nodes: Array<{ node_id: string; depleted: boolean }> };
  // Node should not appear (no depletion record yet → implicitly available).
  expect(pre.nodes.find((n) => n.node_id === node)).toBeUndefined();

  // Forage it.
  await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: node }),
  });

  // Now forage-status reports it as depleted.
  const post = await (
    await fetch(`${API_URL}/api/overworld/forage-status?screen=${screen}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json() as { nodes: Array<{ node_id: string; depleted: boolean }> };
  const entry = post.nodes.find((n) => n.node_id === node);
  expect(entry).toBeDefined();
  expect(entry!.depleted).toBe(true);
});
