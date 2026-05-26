import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8B.2 — Compass HUD.
 *
 * A camera-pinned arrow in OverworldScene pulls toward the nearest UNATTUNED
 * waystone within COMPASS_RANGE (400px), brightening/growing as the player
 * approaches, and hides when none is in range or all are attuned. All
 * assertions read real state via window.__compass (published every update
 * frame); positions are driven by placing the live player avatar, exactly as
 * the 8B.1 waystone spec does.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';
const COMPASS_RANGE = 400; // mirrors client/src/Constants.ts

/** Waystone marker centers (client/public/assets/maps/overworld.json). */
const FOREST_GLADE = { x: 304, y: 336 };

/**
 * The sanctum_return zone is built dynamically at the anchored waystone (8B.4.1).
 * The scene publishes its world center as window.__sanctumReturnCenter once
 * loadWaystones has positioned the Sanctum.
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

/** Enter the overworld via the Sanctum door and wait for waystones to load. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, { x: 1088, y: 608 }, 'door'); // Sanctum door center
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
  // The compass hook is published on create (then every frame).
  await page.waitForFunction(() => !!(window as any).__compass, { timeout: 8000 });
}

/** Place the live player at a point and wait for the named zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

/** Move the player to a point (no zone wait) and let one update frame run. */
async function moveTo(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  // Wait two animation frames so the next update() recomputes the compass.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Read the live compass snapshot. */
async function readCompass(
  page: Page,
): Promise<{ visible: boolean; targetId: string | null; angle: number | null; intensity: number | null }> {
  return page.evaluate(() => (window as any).__compass);
}

// ── Scenario 1: points at nearest unattuned ──────────────────────────────────
test('compass: points at the nearest unattuned waystone within range', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // ~200px directly below the Glade (glade is unattuned for a fresh user).
  const pos = { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 200 };
  await moveTo(page, pos);

  const c = await readCompass(page);
  expect(c.visible).toBe(true);
  expect(c.targetId).toBe('forest_glade');
  // Expected bearing = atan2(gy - py, gx - px) (== Phaser.Math.Angle.Between).
  const expected = Math.atan2(FOREST_GLADE.y - pos.y, FOREST_GLADE.x - pos.x);
  expect(Math.abs((c.angle as number) - expected)).toBeLessThan(0.1);
  await ctx.close();
});

// ── Scenario 2: intensity rises on approach ──────────────────────────────────
test('compass: intensity increases as the player approaches', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  await moveTo(page, { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 350 });
  const far = await readCompass(page);
  expect(far.visible).toBe(true);
  expect(far.targetId).toBe('forest_glade');

  await moveTo(page, { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 150 });
  const near = await readCompass(page);
  expect(near.visible).toBe(true);
  expect(near.targetId).toBe('forest_glade');

  expect(near.intensity as number).toBeGreaterThan(far.intensity as number);
  await ctx.close();
});

// ── Scenario 3: out-of-range hides the compass ───────────────────────────────
test('compass: hides when no unattuned waystone is within range', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // (700,100): >400px from both glade (≈461) and depths (≈779); on floor tiles.
  await moveTo(page, { x: 700, y: 100 });
  const c = await readCompass(page);
  expect(c.visible).toBe(false);
  expect(c.targetId).toBeNull();
  await ctx.close();
});

// ── Scenario 4: all-attuned hides the compass ────────────────────────────────
test('compass: hides when every waystone is attuned', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Attune all three catalog waystones via the 8B.1 POST route, then re-enter.
  await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      for (const id of ['forest_entry', 'forest_glade', 'forest_depths']) {
        await fetch(`${api}/api/waystones/attune`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ waystoneId: id }),
        });
      }
    },
    [API_URL],
  );

  // Return to the Sanctum, then re-enter so the scene reloads attunement state.
  const returnPos = await getSanctumReturnPos(page);
  await walkToZone(page, returnPos, 'sanctum_return');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 8000 });
  await enterOverworld(page);

  // Place the player right on the glade — still hidden, since nothing is unattuned.
  await moveTo(page, { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 50 });
  const c = await readCompass(page);
  expect(c.visible).toBe(false);
  expect(c.targetId).toBeNull();
  await ctx.close();
});

// ── Scenario 5: retargets after attune ───────────────────────────────────────
test('compass: stops targeting a waystone once it is attuned', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Stand ~200px from the glade so it is the active compass target.
  await walkToZone(page, FOREST_GLADE, 'forest_glade');
  await moveTo(page, { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 200 });
  expect((await readCompass(page)).targetId).toBe('forest_glade');

  // Walk onto the glade and attune it (same E flow as 8B.1).
  await walkToZone(page, FOREST_GLADE, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // Next frame: the glade is no longer a target (depths is out of range here, so
  // the compass either retargets a nearer unattuned one or hides — never glade).
  await moveTo(page, { x: FOREST_GLADE.x, y: FOREST_GLADE.y + 200 });
  expect((await readCompass(page)).targetId).not.toBe('forest_glade');
  await ctx.close();
});
