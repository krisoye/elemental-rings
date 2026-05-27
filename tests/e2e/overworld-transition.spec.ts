import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';

/**
 * Phase 8A.3 — Overworld stub + scene transition.
 *
 * The Sanctum's exit door transitions into ForestScene; a sanctum_return zone
 * walks back to CampScene. The dev "Set Out →" shortcut still routes to
 * EncounterScene. All assertions read real game state via page.evaluate (no
 * mocks). "Walking to a zone" places the live player avatar at the zone center
 * and lets the per-frame overlap check pick it up.
 */

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 1088, y: 608 };

/**
 * The sanctum_return zone is no longer a fixed map rectangle (8B.4.1): it is
 * built dynamically at the anchored waystone, co-located with the visible
 * Sanctum exterior. The scene publishes its world center as
 * window.__sanctumReturnCenter once loadWaystones has positioned it.
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

/** Place the live player at a point and wait for the named zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

// ── Scenario 1: Sanctum → Overworld ──────────────────────────────────────────
test('overworld: Sanctum door transitions into ForestScene at spawn', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());

  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  // 8B.4.1 anchor-derived Sanctum: the scene places the Sanctum exterior at the
  // anchored waystone (toward map center) and spawns the player just outside its
  // door. The spawn is within ~door-offset of the published Sanctum center.
  const spawnRef = await getSanctumReturnPos(page);
  const pos = await page.evaluate(() => ({
    x: (window as any).__player.x,
    y: (window as any).__player.y,
  }));
  expect(Math.abs(pos.x - spawnRef.x)).toBeLessThan(80);
  expect(Math.abs(pos.y - spawnRef.y)).toBeLessThan(80);
  await ctx.close();
});

// ── Scenario 2: Movement in overworld ────────────────────────────────────────
test('overworld: player moves right on ArrowRight', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });

  const x0 = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => (window as any).__player.x);
  expect(x1).toBeGreaterThan(x0);
  await ctx.close();
});

// ── Scenario 3: Overworld perimeter collision ────────────────────────────────
test('overworld: player collides with the west perimeter wall', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });

  // 8B.3 anchor-derived spawn is async (loadWaystones runs after create). Wait for
  // __waystones to be set (cachePayload fires at the end of loadWaystones) so the
  // anchor reposition has already happened, then override to x=100 for the wall test.
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
  await page.evaluate(() => (window as any).__player.setPosition(100, 248));
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(1500);
  const blocked = await page.evaluate(() => (window as any).__player.body.blocked.left);
  const x = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.up('ArrowLeft');

  expect(blocked).toBe(true);
  expect(x).toBeGreaterThan(32); // stopped at the wall's east edge, not through it
  expect(x).toBeLessThan(64);
  await ctx.close();
});

// ── Scenario 4: Overworld → Sanctum ──────────────────────────────────────────
test('overworld: sanctum_return transitions back to CampScene with reloaded state', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  // Wait for anchor-derived spawn to finish before repositioning.
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });

  const returnPos = await getSanctumReturnPos(page);
  await walkToZone(page, returnPos, 'sanctum_return');
  await page.evaluate(() => (window as any).__sanctumInteract());

  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 8000 });
  // The Sanctum reloads its authoritative state from /api/me.
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 8000 });
  const rings = await page.evaluate(() => (window as any).__campState.rings.length);
  expect(rings).toBeGreaterThanOrEqual(10);
  await ctx.close();
});

// ── Scenario 5: Dev shortcut intact ──────────────────────────────────────────
test('overworld: __campGoEncounter dev shortcut still routes to EncounterScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await page.evaluate(() => (window as any).__campGoEncounter());
  await page.waitForFunction(() => (window as any).__game.scene.isActive('EncounterScene'), {
    timeout: 8000,
  });
  const active = await page.evaluate(() => (window as any).__game.scene.isActive('EncounterScene'));
  expect(active).toBe(true);
  await ctx.close();
});
