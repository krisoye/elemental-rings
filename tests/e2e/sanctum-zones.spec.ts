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
// Zone centers derived from the sanctum.json object layer (240×160 px map).
const ZONE_CENTER: Record<string, { x: number; y: number }> = {
  bed:        { x: 192, y: 96 },
  meditation: { x: 88,  y: 88 },
  ringwall:   { x: 128, y: 56 },
  campfire:   { x: 57,  y: 37 },
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

/** Walk to the ring-wall zone, open the RING STORAGE overlay, and wait for it. */
async function openRingStorage(page: Page): Promise<void> {
  await walkToZone(page, 'ringwall');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });
}

/** Register a fresh player directly and return its JWT (for pre-load loadout seeding). */
async function registerAndToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `sz_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function putLoadout(token: string, partial: Record<string, string | null>): Promise<void> {
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(partial),
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// #78 ① — Ring-storage hitbox scrollFactor fix.
//
// The ring-storage overlay is camera-pinned (scrollFactor 0) but the interactive
// leaf `bg` rectangles previously defaulted to scrollFactor 1, so under camera
// scroll Phaser's hit-test offset the hit area away from the rendered card. The
// __campHitTestRing probe scrolls the camera 200px in each axis, then hit-tests a
// card's bg at its (scroll-independent) render position: with the fix the hit
// area tracks the render and still hits; an unfixed bg would miss.
// ─────────────────────────────────────────────────────────────────────────────

test('hitbox: ring card hit area aligns with render position after camera scroll', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await openRingStorage(page);
  // The hook is registered only while the overlay is open.
  await page.waitForFunction(() => typeof (window as any).__campHitTestRing === 'function', {
    timeout: 5000,
  });

  // The At-Sanctum pool drives the sanctumGrid cards (scenario 3 confirms ≥10).
  const ringId = await page.evaluate(() => (window as any).__campState.atSanctum[0].id);
  const r = await page.evaluate((id) => (window as any).__campHitTestRing(id), ringId);
  expect(r.found).toBe(true);
  expect(r.hit).toBe(true);
  await ctx.close();
});

test('hitbox: alignment holds after inventory grid rebuild', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  await openRingStorage(page);
  await page.waitForFunction(() => typeof (window as any).__campHitTestRing === 'function', {
    timeout: 5000,
  });

  // Pick two At-Sanctum rings: move one to the loadout (forces a grid rebuild),
  // then re-probe the OTHER, still-present card.
  const { moved, keep } = await page.evaluate(() => {
    const at = (window as any).__campState.atSanctum;
    return { moved: at[0].id, keep: at[1].id };
  });

  // __campAddToLoadout PUTs /api/carry and reloads → populate() rebuilds both
  // grids (cards destroyed + recreated with the scrollFactor(0) fix re-applied).
  await page.evaluate((id) => (window as any).__campAddToLoadout(id), moved);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    moved,
    { timeout: 8000 },
  );

  // The kept card now lives in the loadout grid OR the sanctum grid (order shifts
  // after the rebuild); the hook checks both. It must still hit.
  const r = await page.evaluate((id) => (window as any).__campHitTestRing(id), keep);
  expect(r.found).toBe(true);
  expect(r.hit).toBe(true);
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// #78 ④ — Staked-ring passive reminder.
//
// THUMB_PASSIVE_INFO maps base elements 0–4 to a named passive; fusions (5–14)
// have no entry → "no passive". CampScene.refreshPools derives staked_passive
// from loadout.thumb and publishes it to __campState.
// ─────────────────────────────────────────────────────────────────────────────

const FIRE_EL = 0;
const WATER_EL = 1;
const TIER1_XP_CAP_PASSIVE = 100;

test('passive: base element stake shows passive name + effect', async ({ browser }) => {
  // Stake a FIRE ring (element 0) as Thumb before the page loads.
  const token = await registerAndToken();
  const { rings } = await getMe(token);
  const fire = rings.find((r: any) => r.element === FIRE_EL);
  expect(fire).toBeDefined();
  await putLoadout(token, { thumb: fire.id });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openRingStorage(page);

  await page.waitForFunction(
    () => (window as any).__campState.staked_passive?.name === 'Kindling',
    { timeout: 5000 },
  );
  const p = await page.evaluate(() => (window as any).__campState.staked_passive);
  expect(p.name).toBe('Kindling');
  expect(p.effect).toMatch(/Fire rings/);
  await ctx.close();
});

test('passive: fusion stake shows no passive', async ({ browser }) => {
  // Build a fusion ring: max two Tier-1 parents (Fire + Water), fuse → Steam (5),
  // then stake it as Thumb. Fusions have no THUMB_PASSIVE_INFO entry.
  const token = await registerAndToken();
  const { rings } = await getMe(token);
  const fire = rings.find((r: any) => r.element === FIRE_EL);
  const water = rings.find((r: any) => r.element === WATER_EL);
  for (const id of [fire.id, water.id]) {
    await fetch(`${API_URL}/api/test/set-ring-xp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ringId: id, xp: TIER1_XP_CAP_PASSIVE }),
    });
  }
  const fuseRes = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  const { ring: fusionRing } = await fuseRes.json();
  expect(fusionRing.element).toBeGreaterThanOrEqual(5); // a fusion element
  await putLoadout(token, { thumb: fusionRing.id });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openRingStorage(page);

  await page.waitForFunction(
    () =>
      (window as any).__campState.staked_passive != null &&
      (window as any).__campState.staked_passive.name === null,
    { timeout: 5000 },
  );
  const p = await page.evaluate(() => (window as any).__campState.staked_passive);
  expect(p.name).toBe(null);
  expect(p.effect).toMatch(/no passive/);
  await ctx.close();
});

test('passive: no thumb stake returns null', async ({ browser }) => {
  // Explicitly clear the Thumb slot before loading the page.
  const token = await registerAndToken();
  await putLoadout(token, { thumb: null });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openRingStorage(page);

  // __campState is published with staked_passive present; for an empty thumb it
  // is exactly null. Wait for the camp state then assert.
  await page.waitForFunction(() => 'staked_passive' in ((window as any).__campState ?? {}), {
    timeout: 5000,
  });
  const p = await page.evaluate(() => (window as any).__campState.staked_passive);
  expect(p).toBe(null);
  await ctx.close();
});
