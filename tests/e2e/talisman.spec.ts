import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Talisman equipment framework (#81, GDD §14.2/§14.3) — post #180 update.
 *
 * The Sanctum Stone has been retired (#180): re-anchoring is now a natural
 * ability via POST /api/sanctum/summon. The talisman framework (TalismanDef,
 * getTalisman, necklace/bracelet slots, equip/loadout routes) is preserved for
 * future talisman items; the catalog is intentionally empty.
 *
 * Assertions:
 *   1. Fresh player: empty necklace slot (no Stone to auto-equip).
 *   2. GET /api/talisman-loadout still responds (framework intact).
 *   3. POST /api/talisman/equip with 'sanctum_stone' → 400 (catalog empty).
 *   4. POST /api/talisman/activate → 404 (route removed — covered in sanctum-summon.spec.ts).
 *   5. Client ring-wall overlay: talisman loadout fetch resolves to empty necklace.
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

// ── Scenario 1: Fresh player has an empty necklace slot ──────────────────────
test('talisman: fresh player loadout is empty (no necklace, 0 charges)', async () => {
  const token = await mintToken();
  const loadout = await getLoadout(token);
  expect(loadout.necklaceId).toBeNull();
  expect(loadout.necklaceCharges).toBe(0);
});

// ── Scenario 2: GET /api/talisman-loadout responds (framework intact) ─────────
test('talisman: GET /api/talisman-loadout still responds 200', async () => {
  const token = await mintToken();
  const res = await fetch(`${API_URL}/api/talisman-loadout`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  // Shape is preserved even with an empty catalog.
  expect('necklaceId' in body).toBe(true);
  expect('necklaceCharges' in body).toBe(true);
});

// ── Scenario 3: POST /api/talisman/equip with sanctum_stone → 400 (catalog empty) ─
test('talisman: equipping sanctum_stone returns 400 (catalog empty)', async () => {
  const token = await mintToken();
  const res = await fetch(`${API_URL}/api/talisman/equip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ talismanlId: 'sanctum_stone', slot: 'necklace' }),
  });
  expect(res.status).toBe(400);
});

// ── Scenario 4: POST /api/talisman/activate → 404 ────────────────────────────
// Covered in depth by sanctum-summon.spec.ts; quick smoke-check here.
test('talisman: POST /api/talisman/activate → 404 (route removed)', async () => {
  const token = await mintToken();
  const res = await fetch(`${API_URL}/api/talisman/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ talismanlId: 'sanctum_stone', anchorageId: 'forest_entry' }),
  });
  expect(res.status).toBe(404);
});

// ── Scenario 5: Ring-wall overlay reflects empty necklace (client-level) ──────
async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

test('talisman: ring-wall overlay publishes empty necklace loadout (catalog empty)', async ({
  browser,
}) => {
  const token = await mintToken();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // Walk to the ring-wall zone and open the RING STORAGE overlay.
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
    () => (window as any).__talismanLoadout !== undefined,
    { timeout: 8000 },
  );
  const loadout = await page.evaluate(() => (window as any).__talismanLoadout);
  // Catalog is empty: no Stone to equip, necklace slot is null.
  expect(loadout.necklaceId).toBeNull();
  expect(loadout.necklaceCharges).toBe(0);
  await ctx.close();
});
