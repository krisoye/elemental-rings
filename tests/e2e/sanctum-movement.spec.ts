import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';

const URL = 'http://localhost:8090';

/**
 * Phase 8A.1 — spatial movement engine + Sanctum room shell.
 *
 * Every assertion reads real game state via page.evaluate (no mocks). The player
 * is an Arcade-physics sprite exposed on window.__player; the camera and scene
 * are read from window.__game. Auth is seeded before page creation so BootScene
 * routes straight into CampScene (the Sanctum room).
 */

/** Wait until the Sanctum room is live: player avatar + legacy data layer ready. */
async function loadSanctum(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
}

// ── Scenario 1: Player moves right ───────────────────────────────────────────
test('sanctum: player moves right on ArrowRight', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const x0 = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');

  const x1 = await page.evaluate(() => (window as any).__player.x);
  expect(x1).toBeGreaterThan(x0);
  await ctx.close();
});

// ── Scenario 2: Player moves on WASD ─────────────────────────────────────────
test('sanctum: player moves down on S (WASD)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const y0 = await page.evaluate(() => (window as any).__player.y);
  await page.keyboard.down('s');
  await page.waitForTimeout(500);
  await page.keyboard.up('s');

  const y1 = await page.evaluate(() => (window as any).__player.y);
  expect(y1).toBeGreaterThan(y0);
  await ctx.close();
});

// ── Scenario 3: Wall collision clamps movement ───────────────────────────────
test('sanctum: wall collision clamps rightward movement', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // Hold right until the player reaches and presses against the east perimeter wall.
  // Spawn is at x=640; the east wall fills tile column 39 (1248..1280), so ~3.8s of
  // travel at 160px/s is needed. Under parallel-worker CPU load the Phaser game loop
  // may run at fewer FPS, so we wait for the wall condition (up to 8 s) rather than
  // a fixed 4 s timeout — the assertion itself is unchanged.
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    () => !!(window as any).__player?.body?.blocked?.right,
    undefined,
    { timeout: 8000 },
  ).catch(() => {}); // if we never block, the expect below will catch it

  const blocked = await page.evaluate(() => (window as any).__player.body.blocked.right);
  const x = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.up('ArrowRight');

  expect(blocked).toBe(true);
  // The map is 40 tiles * 32px = 1280px wide; the east wall fills tile column 39
  // (1248..1280). The player center stops before that boundary.
  expect(x).toBeLessThan(1248);
  await ctx.close();
});

// ── Scenario 4: Camera follows the player ────────────────────────────────────
test('sanctum: camera follows player when moving', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // Map is 1280px wide vs the 1024px viewport, so moving right past centre scrolls
  // the camera. Spawn is at x=640; hold right to push the camera off its left edge.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1200);
  await page.keyboard.up('ArrowRight');

  const scrollX = await page.evaluate(
    () => (window as any).__game.scene.getScene('CampScene').cameras.main.scrollX,
  );
  expect(scrollX).toBeGreaterThan(0);
  await ctx.close();
});

// ── Scenario 5: Legacy data layer intact ─────────────────────────────────────
test('sanctum: legacy __campState data layer still populates', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const state = await page.evaluate(() => (window as any).__campState);
  expect(state).toBeTruthy();
  expect(state.player).toBeTruthy();
  expect(Array.isArray(state.rings)).toBe(true);
  expect(state.rings.length).toBeGreaterThanOrEqual(10);
  expect(state.loadout).toBeDefined();
  await ctx.close();
});
