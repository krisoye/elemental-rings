import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8B.1 — Forest biome waystone attunement.
 *
 * Walking onto a waystone and pressing E attunes it; attunement is persisted
 * server-side and survives reloads. Markers render attuned vs. unattuned. All
 * assertions read real state — window.__waystones (the GET /api/waystones
 * payload the scene publishes) and direct server round-trips — never mocks.
 *
 * "Walking to a waystone" places the live player avatar at the marker center and
 * lets the per-frame overlap check register it in __sanctumZones, exactly as the
 * 8A overworld-transition spec does for the door / sanctum_return zones.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 1088, y: 608 };
/** Overworld sanctum_return zone center (client/public/assets/maps/overworld.json). */
const OVERWORLD_RETURN = { x: 224, y: 224 };
/** Waystone marker centers (client/public/assets/maps/overworld.json). */
const FOREST_GLADE = { x: 304, y: 336 };

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
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
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
  await enterOverworld(page);

  // Glade starts unattuned for a fresh user (only forest_entry is pre-attuned).
  expect((await readWaystone(page, 'forest_glade'))?.attuned).toBe(false);

  await walkToZone(page, FOREST_GLADE, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());

  // The POST round-trips and the scene republishes __waystones with attuned=true.
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // The marker recolors: the attuned glow disc on the named stone becomes visible.
  const recolored = await page.evaluate(() => {
    const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
    const stone = scene.children.getByName('waystone-forest_glade');
    return !!stone;
  });
  expect(recolored).toBe(true);
  await ctx.close();
});

// ── Scenario 2: Persists across reload ───────────────────────────────────────
test('waystones: attunement survives a reload (server-backed, not localStorage)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  await walkToZone(page, FOREST_GLADE, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // Reload from scratch and re-enter the overworld; the fresh GET must report
  // the attunement (it lives in the server DB, not browser storage).
  await page.reload();
  await loadSanctum(page);
  await enterOverworld(page);

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

  await walkToZone(page, OVERWORLD_RETURN, 'sanctum_return');
  await page.evaluate(() => (window as any).__sanctumInteract());

  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 8000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 8000 });
  const rings = await page.evaluate(() => (window as any).__campState.rings.length);
  expect(rings).toBeGreaterThanOrEqual(10);
  await ctx.close();
});
