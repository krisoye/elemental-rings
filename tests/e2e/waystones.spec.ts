import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8B.1 — Forest biome waystone attunement.
 *
 * Walking onto a waystone and pressing E attunes it; attunement is persisted
 * server-side and survives reloads. Markers render attuned vs. unattuned. All
 * assertions read real state — window.__waystones (the GET /api/waystones
 * payload the scene publishes) and direct server round-trips — never mocks.
 *
 * 8E (#107) — the Forest is a multi-screen region with generated maps; the
 * forest_glade Anchorage lives on the `forest_glade` screen (not the hub). Tests
 * use enterForestScreen() to stand on the relevant screen and read zone positions
 * from window.__zoneCenters dynamically instead of hardcoding pixel coordinates.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 87, y: 152 };

/** Read a named interaction zone's world center on the current screen (#107). */
async function zoneCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  await page.waitForFunction((n) => !!(window as any).__zoneCenters?.[n], name, { timeout: 8000 });
  return page.evaluate((n) => (window as any).__zoneCenters[n] as { x: number; y: number }, name);
}

/**
 * The sanctum_return zone is built dynamically at the anchored waystone (8B.4.1),
 * not a fixed map rectangle. The scene publishes its world center as
 * window.__sanctumReturnCenter once loadWaystones has positioned the Sanctum.
 */
async function getSanctumReturnPos(page: Page): Promise<{ x: number; y: number }> {
  await page.waitForFunction(() => !!(window as any).__sanctumReturnCenter, { timeout: 8000 });
  return page.evaluate(() => (window as any).__sanctumReturnCenter as { x: number; y: number });
}

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Enter the overworld via the Sanctum door and wait for its waystones to load. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  // The scene GETs /api/waystones on create and publishes the payload.
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
}

/** Place the live player at a point and wait for the named zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

/** Read a waystone entry from the published __waystones payload. */
async function readWaystone(page: Page, id: string): Promise<{ attuned: boolean } | null> {
  return page.evaluate((wid) => {
    const payload = (window as any).__waystones;
    return payload?.waystones?.find((w: any) => w.id === wid) ?? null;
  }, id);
}

// ── Scenario 1: Attune a waystone ────────────────────────────────────────────
test('waystones: walking onto Glade and pressing E attunes it (server round-trip)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  // 8E (#107): the Glade Anchorage lives on the forest_glade screen. Enter it.
  await enterForestScreen(page, 'forest_glade');

  // Glade starts unattuned for a fresh user (only forest_entry is pre-attuned).
  expect((await readWaystone(page, 'forest_glade'))?.attuned).toBe(false);

  // Walk onto the Anchorage center (read dynamically) and press E.
  const glade = await zoneCenter(page, 'forest_glade');
  await walkToZone(page, glade, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());

  // The POST round-trips and the scene republishes __waystones with attuned=true.
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // forest_glade is an Anchorage (campfire + ground ring), NOT a standing stone:
  // its named campfire graphic exists and there is NO Waystone standing stone.
  const visuals = await page.evaluate(() => {
    const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
    return {
      hasFire: !!scene.children.getByName('anchorage-fire-forest_glade'),
      hasStone: !!scene.children.getByName('waystone-forest_glade'),
    };
  });
  expect(visuals.hasFire).toBe(true);
  expect(visuals.hasStone).toBe(false);
  await ctx.close();
});

// ── Scenario 2: Persists across reload ───────────────────────────────────────
test('waystones: attunement survives a reload (server-backed, not localStorage)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterForestScreen(page, 'forest_glade');

  const glade = await zoneCenter(page, 'forest_glade');
  await walkToZone(page, glade, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // Reload from scratch and re-enter the Glade screen; the fresh GET must report
  // the attunement (it lives in the server DB, not browser storage).
  await page.reload();
  await loadSanctum(page);
  await enterForestScreen(page, 'forest_glade');

  expect((await readWaystone(page, 'forest_glade'))?.attuned).toBe(true);
  await ctx.close();
});

// ── Scenario 3: Entry pre-attuned for a fresh user ───────────────────────────
test('waystones: a brand-new user is pre-attuned to forest_entry only', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  expect((await readWaystone(page, 'forest_entry'))?.attuned).toBe(true);
  expect((await readWaystone(page, 'forest_glade'))?.attuned).toBe(false);
  expect((await readWaystone(page, 'forest_depths'))?.attuned).toBe(false);
  await ctx.close();
});

// ── Scenario 4: Unknown waystone rejected ────────────────────────────────────
test('waystones: POST attune with an unknown id is rejected (HTTP 400, no row)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  const status = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/waystones/attune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'nope' }),
      });
      return res.status;
    },
    [API_URL],
  );
  expect(status).toBe(400);

  // No spurious row: a fresh GET still shows only the three catalog waystones,
  // none of them named 'nope', and the bogus id never becomes attuned.
  const ids = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/waystones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      return body.waystones.map((w: any) => w.id);
    },
    [API_URL],
  );
  expect(ids).not.toContain('nope');
  await ctx.close();
});

// ── Scenario 5: 8A regression — sanctum_return still works ───────────────────
test('waystones: sanctum_return still transitions back to CampScene with reloaded state', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  const returnPos = await getSanctumReturnPos(page);
  await walkToZone(page, returnPos, 'sanctum_return');
  await page.evaluate(() => (window as any).__sanctumInteract());

  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 8000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 8000 });
  const rings = await page.evaluate(() => (window as any).__campState.rings.length);
  expect(rings).toBeGreaterThanOrEqual(10);
  await ctx.close();
});
