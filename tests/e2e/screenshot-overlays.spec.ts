/**
 * Visual QA helper — NOT registered in SOLO_SPECS, so it does not run in CI.
 *
 * Run manually to screenshot all three ring-management overlay modes:
 *
 *   1. Temporarily add 'screenshot-overlays.spec.ts' to SOLO_SPECS in playwright.config.ts
 *   2. npx playwright test --project solo --grep "screenshot:" --workers 1
 *   3. Screenshots land at /tmp/overlay-field.png, overlay-sanctum.png, overlay-fusion.png
 *   4. Remove from SOLO_SPECS when done
 *
 * Use after any layout or geometry change to visually verify column order and card placement.
 */
import { test } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const BASE = 'http://localhost:8090';
const RINGWALL = { x: 128, y: 56 }; // sanctum ringwall zone position — matches reliquary-modal.spec.ts

test('screenshot: field overlay', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(() => typeof (window as any).__overworldToggleBattleHand === 'function', { timeout: 8000 });
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/overlay-field.png' });
  await ctx.close();
});

test('screenshot: sanctum overlay', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 15000 });
  await page.evaluate(([x, y]) => (window as any).__player?.setPosition(x, y), [RINGWALL.x, RINGWALL.y]);
  await page.waitForFunction(() => ((window as any).__sanctumZones ?? []).includes('ringwall'), { timeout: 5000 });
  await page.evaluate(() => (window as any).__sanctumInteract?.());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/overlay-sanctum.png' });
  await ctx.close();
});

test('screenshot: fusion overlay', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).__campOpenFusion === 'function', { timeout: 10000 });
  await page.evaluate(() => (window as any).__campOpenFusion());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/overlay-fusion.png' });
  await ctx.close();
});
