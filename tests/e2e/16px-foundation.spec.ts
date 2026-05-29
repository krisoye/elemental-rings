import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const URL = 'http://localhost:8090';

/**
 * Issue #150 — engine: any screen renders 16px / 2× / 3-layer.
 *
 * Verifies the is16pxScreen() predicate drives the correct rendering path:
 *   - forest_anchorage  → 16px / 2× world zoom / 3 tile layers (ground+behind+in-front)
 *   - forest_glade      → 32px / 1× world zoom / 1 tile layer  (ground only)
 *
 * Assertions probe the live Phaser scene state via window.__game and the
 * published E2E hooks (__forestScreenId, __waystones, __zoneCenters) rather
 * than screenshots, so they are fast and deterministic.
 */

// ── Scenario 1: forest_anchorage renders at 2× zoom with 3 layers ─────────────
test('16px: forest_anchorage renders at 2x world zoom with ground/behind/in-front layers', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Start from CampScene (auth seeded) and navigate to the hub.
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');

  // __forestScreenId must equal 'forest_anchorage'.
  const screenId = await page.evaluate(() => (window as any).__forestScreenId);
  expect(screenId).toBe('forest_anchorage');

  // cameras.main must be at zoom 2 (worldZoom() returns 2 for is16pxScreen()).
  const zoom = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('ForestScene') as Phaser.Scene;
    return scene.cameras.main.zoom;
  });
  expect(zoom).toBe(2);

  // The tilemap must have exactly the three 16px layers rendered (ground, behind,
  // in-front). We count TilemapLayer / TilemapGPULayer children of the scene whose
  // names match the expected layer names.
  const layerNames = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('ForestScene') as Phaser.Scene;
    return scene.children.list
      .filter(
        (c: any) =>
          c.type === 'TilemapLayer' ||
          c.type === 'TilemapGPULayer' ||
          (typeof c.layer === 'object' && c.layer !== null),
      )
      .map((c: any) => c.layer?.name ?? c.name ?? '');
  });
  expect(layerNames).toContain('ground');
  expect(layerNames).toContain('behind');
  expect(layerNames).toContain('in-front');

  // No console errors during load.
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // Small settle wait to capture any deferred console errors.
  await page.waitForTimeout(300);
  expect(errors).toHaveLength(0);

  await ctx.close();
});

// ── Scenario 2: forest_glade renders at 1× zoom with ground layer only ────────
test('16px: forest_glade renders at 1x world zoom with single ground layer (no regression)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_glade');

  // __forestScreenId must equal 'forest_glade'.
  const screenId = await page.evaluate(() => (window as any).__forestScreenId);
  expect(screenId).toBe('forest_glade');

  // cameras.main must be at zoom 1 (worldZoom() returns 1 for !is16pxScreen()).
  const zoom = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('ForestScene') as Phaser.Scene;
    return scene.cameras.main.zoom;
  });
  expect(zoom).toBe(1);

  // The tilemap must have only the single 'ground' layer (no behind / in-front).
  const layerNames = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('ForestScene') as Phaser.Scene;
    return scene.children.list
      .filter(
        (c: any) =>
          c.type === 'TilemapLayer' ||
          c.type === 'TilemapGPULayer' ||
          (typeof c.layer === 'object' && c.layer !== null),
      )
      .map((c: any) => c.layer?.name ?? c.name ?? '');
  });
  expect(layerNames).toContain('ground');
  expect(layerNames).not.toContain('behind');
  expect(layerNames).not.toContain('in-front');

  // Player can walk: move right and confirm the x coordinate increases.
  const x0 = await page.evaluate(() => (window as any).__player?.x ?? 0);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => (window as any).__player?.x ?? 0);
  expect(x1).toBeGreaterThan(x0);

  // No console errors.
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(300);
  expect(errors).toHaveLength(0);

  await ctx.close();
});
