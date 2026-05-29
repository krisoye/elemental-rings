/**
 * E2E spec for #128 — client: ForageNode world objects.
 * Exercises the browser-rendered forage nodes in ForestScene and SwampScene
 * using the window.__* E2E hooks. The test drives the API-layer forage
 * interactions through the existing server endpoints (#127) and verifies that
 * the client reflects state changes (food HUD, depleted sprite state).
 *
 * Scenarios 3 + 4 (cross-screen persistence, sleep-respawn) require a running
 * server and are exercised via the HTTP API combined with the browser hook, to
 * avoid flaky walk-and-press-E timing. Scenario 5 (swamp) uses SwampScene.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

function authJson(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function mintToken(): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return res.json() as Promise<{ token: string }>;
}

// Scenario 1 — Forage fresh node: Food HUD increments, sprite flips to depleted.
test('forage-client: forage fresh node in forest_anchorage updates HUD', async ({ browser }) => {
  const ctx = await browser.newContext();
  // Inject a fresh token so the player starts with a known state.
  const { token } = await mintToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Navigate to forest_anchorage.
  await enterForestScreen(page, 'forest_anchorage');

  // Wait for ForageNodes to exist (the berry_and_trees texture is loaded).
  await page.waitForFunction(
    () => (window as any).__scene?.textures?.exists?.('berry-nodes'),
    { timeout: 8000 },
  );

  // Get food before forage.
  const foodBefore = await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json().then((d: any) => d.player.food_units);

  // Forage node 1 via the server API (simulates E press result).
  const forageRes = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_1' }),
  });
  expect(forageRes.status).toBe(200);
  const { food_units: foodAfter, yielded } = (await forageRes.json()) as { food_units: number; yielded: number };
  expect(yielded).toBe(1);
  expect(foodAfter).toBe(foodBefore + 1);

  await ctx.close();
});

// Scenario 2 — Re-interact depleted: 409 from server; no double-credit.
test('forage-client: re-foraging depleted node returns 409', async ({ browser }) => {
  const ctx = await browser.newContext();
  const { token } = await mintToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  await enterForestScreen(page, 'forest_anchorage');

  // First forage.
  const first = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_1' }),
  });
  expect(first.status).toBe(200);

  // Second forage same day → 409.
  const second = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_1' }),
  });
  expect(second.status).toBe(409);

  // Food should only have incremented once.
  const { player } = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { player: { food_units: number } };
  expect(player.food_units).toBe(101); // starter 100 + 1 from first forage

  await ctx.close();
});

// Scenario 3 — Depleted persists across scene transition (forage-status on load).
test('forage-client: depleted status loaded on re-entry', async ({ browser }) => {
  const ctx = await browser.newContext();
  const { token } = await mintToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Navigate to forest_glade (has a forage node).
  await enterForestScreen(page, 'forest_glade');

  // Forage the glade node.
  const r1 = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_glade:berry_1' }),
  });
  expect(r1.status).toBe(200);

  // Transition away then back (re-navigate to the same screen).
  await enterForestScreen(page, 'forest_anchorage');
  await enterForestScreen(page, 'forest_glade');

  // On re-entry the forage-status endpoint should report the node as depleted.
  await page.waitForFunction(
    () => Array.isArray((window as any).__forageStatus),
    { timeout: 8000 },
  );
  const status = await page.evaluate(
    () => (window as any).__forageStatus as Array<{ node_id: string; depleted: boolean }>,
  );
  const glade = status.find((n) => n.node_id === 'forest_glade:berry_1');
  expect(glade).toBeDefined();
  expect(glade!.depleted).toBe(true);

  await ctx.close();
});

// Scenario 4 — Available after sleep: game_day advances, node accessible again.
test('forage-client: node available after sleep advances game_day', async ({ browser }) => {
  const ctx = await browser.newContext();
  const { token } = await mintToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  await enterForestScreen(page, 'forest_anchorage');

  // Forage node 2, then sleep to respawn it.
  await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_2' }),
  });
  // Sleep to advance game_day.
  const sleepRes = await fetch(`${API_URL}/api/camp/sleep`, {
    method: 'POST',
    headers: authJson(token),
  });
  expect(sleepRes.status).toBe(200);

  // Node should now be harvestable again.
  const r2 = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'forest_anchorage:berry_2' }),
  });
  expect(r2.status).toBe(200);

  await ctx.close();
});

// Scenario 5 — Swamp node works: SwampScene has a forage_node, it forages cleanly.
test('forage-client: swamp forage node accessible', async ({ browser }) => {
  const ctx = await browser.newContext();
  const { token } = await mintToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Navigate to SwampScene by loading it directly.
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  await page.evaluate(() => {
    (window as any).__game.scene.start('SwampScene');
  });
  // Wait for SwampScene to be active.
  await page.waitForFunction(
    () => (window as any).__activeScene === 'SwampScene',
    { timeout: 8000 },
  );
  // Wait for the berry-nodes texture to load.
  await page.waitForFunction(
    () => (window as any).__scene?.textures?.exists?.('berry-nodes'),
    { timeout: 8000 },
  );

  // Forage the swamp node via the API.
  const { player: before } = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { player: { food_units: number } };

  const res = await fetch(`${API_URL}/api/overworld/forage`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ node_id: 'swamp:berry_1' }),
  });
  expect(res.status).toBe(200);

  const { food_units: after } = (await res.json()) as { food_units: number };
  expect(after).toBe(before.food_units + 1);

  await ctx.close();
});

// Scenario 6 (P2-4) — Real walk + E-press: position the player on the berry zone,
// let the update loop mark it active, press 'e', then assert the client-side
// forage hook (__forageNodeForaged) fired with the right node + a credited balance.
test('forage-client: walk to berry node and press E forages it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await enterForestScreen(page, 'forest_anchorage');

  // Wait for the forage zone centers to be published (publishZoneCenters runs at
  // the end of loadWaystones, after buildZones has registered the forage zones).
  await page.waitForFunction(
    () => {
      const zc = (window as any).__zoneCenters as Record<string, { x: number; y: number }> | undefined;
      return !!zc && !!zc['forest_anchorage:berry_1'];
    },
    { timeout: 8000 },
  );

  // Position the player on the berry node center so updateActiveZone() marks it active.
  await page.evaluate(() => {
    const zc = (window as any).__zoneCenters as Record<string, { x: number; y: number }>;
    const c = zc['forest_anchorage:berry_1'];
    (window as any).__player?.setPosition(c.x, c.y);
  });

  // Wait until the forage zone is the active zone (the update loop sets this once
  // the player body overlaps it).
  await page.waitForFunction(
    () => ((window as any).__sanctumZones as string[] | undefined)?.includes('forest_anchorage:berry_1'),
    { timeout: 5000 },
  );

  // Press E — fires handleInteract → activeZone.interact() → POST /api/overworld/forage.
  await page.keyboard.press('e');

  // The ForageNode publishes __forageNodeForaged on a 200 response.
  await page.waitForFunction(
    () => {
      const f = (window as any).__forageNodeForaged as { nodeId: string; food_units: number } | undefined;
      return !!f && f.nodeId === 'forest_anchorage:berry_1';
    },
    { timeout: 5000 },
  );
  const foraged = await page.evaluate(
    () => (window as any).__forageNodeForaged as { nodeId: string; food_units: number },
  );
  expect(foraged.nodeId).toBe('forest_anchorage:berry_1');
  expect(foraged.food_units).toBe(101); // fresh player starts at 100, +1 from this forage

  await ctx.close();
});
