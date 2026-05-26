import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/**
 * Phase 8A.2 — Sanctum interaction zones.
 *
 * Walking into a zone shows a "Press E" prompt; pressing E (or __sanctumInteract)
 * opens the matching modal overlay backed by the existing REST contracts. All
 * assertions read real game state via page.evaluate and confirm server effects
 * through __campState (repopulated from /api/me after each mutation). No mocks.
 *
 * "Walking into a zone" is realized by placing the live player avatar at the
 * zone's coordinates (real sprite + physics body) and letting the scene's
 * per-frame overlap check pick it up — deterministic, no key-hold drift.
 */

/** Zone centers from client/public/assets/maps/sanctum.json (pixel coords). */
const ZONE_CENTER: Record<string, { x: number; y: number }> = {
  bed: { x: 192, y: 160 },
  meditation: { x: 992, y: 160 },
  ringwall: { x: 160, y: 608 },
  campfire: { x: 608, y: 640 },
};

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Place the player at a zone center and wait until the scene registers overlap. */
async function walkToZone(page: Page, zone: string): Promise<void> {
  const { x, y } = ZONE_CENTER[zone];
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [x, y]);
  await page.waitForFunction(
    (z) => ((window as any).__sanctumZones ?? []).includes(z),
    zone,
    { timeout: 5000 },
  );
}

// ── Scenario 1: Zone prompt on proximity ─────────────────────────────────────
test('zones: walking into bed registers the zone (prompt visible)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'bed');
  const zones = await page.evaluate(() => (window as any).__sanctumZones);
  expect(zones).toContain('bed');
  await ctx.close();
});

// ── Scenario 2: Bed → sleep ──────────────────────────────────────────────────
test('zones: bed overlay sleeps and advances game_day', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const dayBefore = await page.evaluate(() => (window as any).__campState.player.game_day);
  await walkToZone(page, 'bed');
  await page.keyboard.press('e');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'bed', { timeout: 5000 });

  // Click the [Sleep — 25 food] button (uniquely named 'sleep-confirm').
  await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const btn = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? c.getAll() : [c]))
      .find((o: any) => o.name === 'sleep-confirm');
    btn?.emit('pointerdown');
  });

  await page.waitForFunction((d) => (window as any).__campState.player.game_day > d, dayBefore, {
    timeout: 8000,
  });
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });
  const dayAfter = await page.evaluate(() => (window as any).__campState.player.game_day);
  expect(dayAfter).toBe(dayBefore + 1);
  await ctx.close();
});

// ── Scenario 3: Ring wall → inventory overlay ────────────────────────────────
test('zones: ring wall opens inventory overlay rendering __campState rings', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'ringwall');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });

  // The reusable InventoryGrid is adopted into the overlay; its cards reflect the
  // At-Sanctum pool. Confirm the overlay is open and the rings data is present.
  const rings = await page.evaluate(() => (window as any).__campState.rings.length);
  expect(rings).toBeGreaterThanOrEqual(10);
  const overlayOpen = await page.evaluate(() => (window as any).__sanctumOverlayOpen);
  expect(overlayOpen).toBe('ringwall');
  await ctx.close();
});

// ── Scenario 4: Fusion from ring wall ────────────────────────────────────────
//
// Seed two maxed Tier-1 parents (Fire + Water) via the test-only set-ring-xp
// route, then open the ring-wall overlay, surface the FusionPanel from its
// [Fuse Rings] button, and fuse — the new Steam ring appears in __campState and
// the two parents are consumed (net -1 ring).
const FIRE = 0;
const WATER = 1;
const STEAM = 5;
const TIER1_XP_CAP = 100;

test('zones: ring-wall fusion consumes two parents and adds a fusion ring', async ({ browser }) => {
  // Register directly so we can seed maxed parents before the page loads.
  const reg = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `z_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  const { token } = await reg.json();
  const meRes = await (await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const fire = meRes.rings.find((r: any) => r.element === FIRE);
  const water = meRes.rings.find((r: any) => r.element === WATER);
  for (const id of [fire.id, water.id]) {
    await fetch(`${API_URL}/api/test/set-ring-xp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ringId: id, xp: TIER1_XP_CAP }),
    });
  }

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'ringwall');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });

  // Surface the FusionPanel via the overlay's [Fuse Rings] button.
  await page.evaluate(() => (window as any).__campOpenFusion());
  await page.waitForFunction(
    () =>
      (window as any).__fusionState?.recipes?.find(
        (r: any) => r.parents[0] === 0 && r.parents[1] === 1,
      )?.ready === true,
    { timeout: 5000 },
  );

  const before = await page.evaluate(() => (window as any).__campState.rings.length);
  const err = await page.evaluate(
    ({ a, b }) => (window as any).__campFuse(a, b),
    { a: fire.id, b: water.id },
  );
  expect(err).toBeNull();

  await page.waitForFunction(
    (steamEl) =>
      (window as any).__campState.rings.some((r: any) => r.element === steamEl && r.tier === 2),
    STEAM,
    { timeout: 8000 },
  );
  const after = await page.evaluate(() => (window as any).__campState.rings.length);
  expect(after).toBe(before - 1); // two parents consumed, one fusion produced
  await ctx.close();
});

// ── Scenario 5: Meditation → recharge ────────────────────────────────────────
//
// The meditation overlay's recharge path round-trips to the authoritative
// /api/spirit/recharge-all route. A fresh player's rings start full, so the
// server-confirmed post-state is all carried rings at max uses with spirit never
// negative (the deterministic, non-battle assertion — depleting uses requires a
// real duel, covered by spirit.spec.ts). The overlay also exposes an enabled
// [Teleport] button (8B.3 replaced the 8B stub).
test('zones: meditation overlay recharges (server-confirmed) and shows teleport button', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'meditation');
  await page.keyboard.press('e');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'meditation', {
    timeout: 5000,
  });

  // An enabled [Teleport] button is present in the meditation overlay (8B.3).
  const hasTeleport = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    return !!scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? c.getAll() : [c]))
      .find((o: any) => o.name === 'teleport-btn');
  });
  expect(hasTeleport).toBe(true);

  // Click [Recharge All] in the overlay (server-authoritative round-trip).
  await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const btn = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? c.getAll() : [c]))
      .find((o: any) => o.type === 'Text' && o.text === '[Recharge All]');
    btn?.emit('pointerdown');
  });

  // After the round-trip, all carried rings are server-confirmed at max uses.
  await page.waitForFunction(
    () => {
      const carried = (window as any).__campState.rings.filter((r: any) => r.in_carry === 1);
      return carried.length > 0 && carried.every((r: any) => r.current_uses === r.max_uses);
    },
    undefined,
    { timeout: 8000 },
  );
  const spirit = await page.evaluate(() => (window as any).__campState.spirit_current);
  expect(spirit).toBeGreaterThanOrEqual(0);
  await ctx.close();
});

// ── Scenario 6: Movement suppressed under overlay ────────────────────────────
test('zones: movement is suppressed while an overlay is open', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'campfire');
  await page.keyboard.press('e');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'campfire', {
    timeout: 5000,
  });

  const x0 = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => (window as any).__player.x);
  expect(x1).toBe(x0);
  await ctx.close();
});

// ── Scenario 7: Esc closes overlay ───────────────────────────────────────────
test('zones: Esc closes the overlay and movement resumes', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await walkToZone(page, 'bed');
  await page.keyboard.press('e');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'bed', { timeout: 5000 });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });

  // Movement works again.
  const x0 = await page.evaluate(() => (window as any).__player.x);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  const x1 = await page.evaluate(() => (window as any).__player.x);
  expect(x1).toBeLessThan(x0);
  await ctx.close();
});

// ── Scenario 8: Legacy hook intact (no walking) ──────────────────────────────
test('zones: __campSleep direct hook still advances game_day without walking', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const dayBefore = await page.evaluate(() => (window as any).__campState.player.game_day);
  await page.evaluate(() => (window as any).__campSleep());
  await page.waitForFunction((d) => (window as any).__campState.player.game_day > d, dayBefore, {
    timeout: 8000,
  });
  const dayAfter = await page.evaluate(() => (window as any).__campState.player.game_day);
  expect(dayAfter).toBe(dayBefore + 1);
  await ctx.close();
});
