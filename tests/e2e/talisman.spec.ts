import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 8C.1 — Talisman equipment system + Sanctum Stone (#81, GDD §14.2/§14.3).
 *
 * The first five scenarios are API-level round-trips against the authoritative
 * server (equip → activate → recharge-on-sleep → charge-exhaustion). Scenario 6
 * is client-level: the ring-wall overlay fetches GET /api/talisman-loadout and
 * publishes window.__talismanLoadout, which the test reads. All assertions hit
 * real server state — never mocks.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Mint a fresh E2E player (starter inventory + empty talisman loadout) → token. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return (await res.json()).token;
}

/** GET /api/talisman-loadout for the given token. */
async function getLoadout(
  token: string,
): Promise<{ necklaceId: string | null; necklaceCharges: number }> {
  const res = await fetch(`${API_URL}/api/talisman-loadout`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** POST /api/talisman/equip the Sanctum Stone to the necklace slot. */
async function equipStone(token: string): Promise<Response> {
  return fetch(`${API_URL}/api/talisman/equip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ talismanlId: 'sanctum_stone', slot: 'necklace' }),
  });
}

/** POST /api/talisman/activate at the given anchorage. */
async function activate(token: string, anchorageId: string): Promise<Response> {
  return fetch(`${API_URL}/api/talisman/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ talismanlId: 'sanctum_stone', anchorageId }),
  });
}

/** POST /api/waystones/attune the given waystone. */
async function attune(token: string, waystoneId: string): Promise<Response> {
  return fetch(`${API_URL}/api/waystones/attune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ waystoneId }),
  });
}

/** POST /api/camp/sleep (consumes FOOD_PER_SLEEP=25; fresh player has 100). */
async function sleep(token: string): Promise<Response> {
  return fetch(`${API_URL}/api/camp/sleep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── Scenario 1: Fresh player has an empty necklace slot ──────────────────────
test('talisman: fresh player loadout is empty (no necklace, 0 charges)', async () => {
  const token = await mintToken();
  const loadout = await getLoadout(token);
  expect(loadout.necklaceId).toBeNull();
  expect(loadout.necklaceCharges).toBe(0);
});

// ── Scenario 2: Equip the Sanctum Stone → 3 charges ──────────────────────────
test('talisman: equipping the Sanctum Stone sets 3 charges', async () => {
  const token = await mintToken();
  const res = await equipStone(token);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.necklaceId).toBe('sanctum_stone');
  expect(body.necklaceCharges).toBe(3);
});

// ── Scenario 3: Activate at an attuned Anchorage → re-anchors, spends a charge ─
test('talisman: activating at an attuned Anchorage re-anchors and spends a charge', async () => {
  const token = await mintToken();
  await equipStone(token);

  // Attune forest_glade first (activation requires the anchorage be attuned).
  const attuneRes = await attune(token, 'forest_glade');
  expect(attuneRes.status).toBe(200);

  const res = await activate(token, 'forest_glade');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.anchor).toBe('forest_glade');
  expect(body.necklaceCharges).toBe(2);

  // GET /api/waystones confirms the Sanctum anchor moved to forest_glade.
  const ws = await (await fetch(`${API_URL}/api/waystones`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  expect(ws.anchor).toBe('forest_glade');
});

// ── Scenario 4: Sleeping at the Sanctum refills charges ──────────────────────
test('talisman: sleeping refills the necklace to full charges', async () => {
  const token = await mintToken();
  await equipStone(token);
  await attune(token, 'forest_glade');
  await activate(token, 'forest_glade'); // 3 → 2

  expect((await getLoadout(token)).necklaceCharges).toBe(2);

  const sleepRes = await sleep(token);
  expect(sleepRes.status).toBe(200);

  expect((await getLoadout(token)).necklaceCharges).toBe(3);
});

// ── Scenario 5: Draining all charges blocks a 4th activation (HTTP 400) ───────
test('talisman: activating with no charges left returns HTTP 400', async () => {
  const token = await mintToken();
  await equipStone(token);
  await attune(token, 'forest_glade');

  // Drain all 3 charges with three successful activations.
  for (let i = 0; i < 3; i++) {
    const r = await activate(token, 'forest_glade');
    expect(r.status).toBe(200);
  }
  expect((await getLoadout(token)).necklaceCharges).toBe(0);

  // The 4th activation is rejected.
  const fourth = await activate(token, 'forest_glade');
  expect(fourth.status).toBe(400);
});

// ── Scenario 6: Ring-wall overlay reflects the equipped Stone (client-level) ──
async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

test('talisman: ring-wall overlay publishes necklace charges after equip + sleep', async ({
  browser,
}) => {
  // Equip + sleep server-side BEFORE the page loads so the GET on overlay-open
  // reflects a fully-charged Stone.
  const token = await mintToken();
  await equipStone(token);
  await sleep(token); // refills (already full) — confirms the sleep path is safe

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // Walk to the ring-wall zone (sanctum.json) and open the RING STORAGE overlay.
  await page.evaluate(() => (window as any).__player.setPosition(160, 608));
  await page.waitForFunction(
    () => ((window as any).__sanctumZones ?? []).includes('ringwall'),
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });

  // The overlay fetched GET /api/talisman-loadout and published the result.
  await page.waitForFunction(
    () => (window as any).__talismanLoadout?.necklaceId === 'sanctum_stone',
    { timeout: 8000 },
  );
  const loadout = await page.evaluate(() => (window as any).__talismanLoadout);
  expect(loadout.necklaceCharges).toBe(3);
  await ctx.close();
});
