import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8B.2 — Compass HUD.
 *
 * A camera-pinned arrow in ForestScene pulls toward the nearest UNATTUNED
 * waystone within COMPASS_RANGE (400px), brightening/growing as the player
 * approaches, and hides when none is in range or all are attuned. All
 * assertions read real state via window.__compass (published every update
 * frame); positions are driven by placing the live player avatar.
 *
 * 8E (#107) — the Forest is multi-screen. These tests stand on the forest_glade
 * screen, whose Glade Anchorage always pulls the compass while unattuned (an
 * Anchorage needs no XP threshold, unlike a discovery stone). The Anchorage center
 * is read dynamically from window.__zoneCenters; the player is positioned well
 * beyond ANCHORAGE_GROUND_RADIUS (80px) so approaching never auto-attunes it
 * mid-test.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';
const COMPASS_RANGE = 400; // mirrors client/src/Constants.ts

/** Read the Glade Anchorage center on the forest_glade screen (#107). */
async function gladeCenter(page: Page): Promise<{ x: number; y: number }> {
  await page.waitForFunction(() => !!(window as any).__zoneCenters?.forest_glade, { timeout: 8000 });
  return page.evaluate(() => (window as any).__zoneCenters.forest_glade as { x: number; y: number });
}

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Enter the forest_glade screen and wait for the compass hook to publish. */
async function enterGlade(page: Page): Promise<void> {
  await enterForestScreen(page, 'forest_glade');
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

// The forest_glade screen's west-exit dirt path runs due west from the Anchorage
// center on walkable tiles, so a position `dist` px west of the center (along y =
// center.y) is always on floor and exactly `dist` from the target — a deterministic
// approach line free of the screen's scattered groves. All distances used are > the
// 80px ANCHORAGE_GROUND_RADIUS so approaching never auto-attunes the Glade.
function westOf(center: { x: number; y: number }, dist: number): { x: number; y: number } {
  return { x: center.x - dist, y: center.y };
}

// ── Scenario 1: points at nearest unattuned ──────────────────────────────────
test('compass: points at the nearest unattuned waystone within range', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterGlade(page);
  const glade = await gladeCenter(page);

  // 200px west of the Glade (glade is unattuned for a fresh user).
  const pos = westOf(glade, 200);
  await moveTo(page, pos);

  const c = await readCompass(page);
  expect(c.visible).toBe(true);
  expect(c.targetId).toBe('forest_glade');
  // Expected bearing = atan2(gy - py, gx - px) (== Phaser.Math.Angle.Between).
  const expected = Math.atan2(glade.y - pos.y, glade.x - pos.x);
  expect(Math.abs((c.angle as number) - expected)).toBeLessThan(0.1);
  await ctx.close();
});

// ── Scenario 2: intensity rises on approach ──────────────────────────────────
test('compass: intensity increases as the player approaches', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterGlade(page);
  const glade = await gladeCenter(page);

  await moveTo(page, westOf(glade, 350));
  const far = await readCompass(page);
  expect(far.visible).toBe(true);
  expect(far.targetId).toBe('forest_glade');

  await moveTo(page, westOf(glade, 150));
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
  await enterGlade(page);
  const glade = await gladeCenter(page);

  // A far map corner on floor tiles, > COMPASS_RANGE (400px) from the Glade.
  const corner = { x: glade.x + 458, y: glade.y + 336 };
  expect(Math.hypot(corner.x - glade.x, corner.y - glade.y)).toBeGreaterThan(COMPASS_RANGE);
  await moveTo(page, corner);
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

  // Attune the Glade Anchorage server-side, then enter its screen: the only
  // compass-eligible waystone on this screen is now attuned → compass stays hidden.
  await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      await fetch(`${api}/api/waystones/attune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_glade' }),
      });
    },
    [API_URL],
  );
  await enterGlade(page);
  const glade = await gladeCenter(page);

  // Stand near the (already attuned) Glade — still hidden, nothing is unattuned.
  await moveTo(page, westOf(glade, 100));
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
  await enterGlade(page);
  const glade = await gladeCenter(page);

  // Stand 200px west of the glade so it is the active compass target. (Do NOT step
  // onto the glade center yet — Anchorage discovery is now automatic, so touching
  // the center would auto-attune it before we can confirm it as the live target.)
  await moveTo(page, westOf(glade, 200));
  expect((await readCompass(page)).targetId).toBe('forest_glade');

  // Walk onto the glade and attune it (auto-attune fires on walk-in; the E flow
  // is kept as a deterministic belt-and-suspenders trigger).
  await walkToZone(page, glade, 'forest_glade');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 8000 },
  );

  // Next frame: the glade is no longer a target (no other eligible unattuned
  // waystone is on this screen, so the compass retargets nothing — never glade).
  await moveTo(page, westOf(glade, 200));
  expect((await readCompass(page)).targetId).not.toBe('forest_glade');
  await ctx.close();
});
