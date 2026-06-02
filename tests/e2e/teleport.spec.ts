import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8B.3 — Teleportation + Sanctum anchoring (#63).
 *
 * The Sanctum's meditation circle exposes a [Teleport] modal listing the
 * waystone catalog in gate state: undiscovered (not attuned) rows are masked,
 * attuned-but-XP-locked rows show their requirement, attuned + unlocked rows
 * offer [Travel]. Traveling re-anchors the Sanctum server-side; the overworld
 * then spawns the player beside the anchored waystone instead of the map spawn.
 *
 * Every assertion reads real state — window.__teleportState (the GET
 * /api/waystones payload the modal publishes), direct server round-trips, and
 * the live __player position — never mocks. The teleport gate (attuned + XP
 * threshold) is enforced by the server; the three rejection cases are exercised
 * end-to-end.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum meditation-circle zone center (client/public/assets/maps/sanctum.json). */
const MEDITATION = { x: 88, y: 88 };
/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 87, y: 152 };

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

/** Walk to the meditation circle, open it, then open the teleport modal. */
async function openTeleportModal(page: Page): Promise<void> {
  await walkToZone(page, MEDITATION, 'meditation');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'meditation', {
    timeout: 5000,
  });
  // The [Teleport] button opens the modal (GETs /api/waystones, publishes state).
  await page.waitForFunction(() => typeof (window as any).__campOpenTeleport === 'function', {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__campOpenTeleport());
  await page.waitForFunction(() => !!(window as any).__teleportState, { timeout: 5000 });
}

/** Seed aggregate XP ≥ amount by setting one carried ring's XP via the test route. */
async function seedAggregateXp(page: Page, amount: number): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__campState?.rings?.length, { timeout: 8000 });
  const ringId = await page.evaluate(() => (window as any).__campState.rings[0].id as string);
  const status = await page.evaluate(
    async ([api, rid, xp]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/test/set-ring-xp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId: rid, xp }),
      });
      return res.status;
    },
    [API_URL, ringId, amount] as const,
  );
  expect(status).toBe(200);
}

/** Drain the player's spirit to 0 via the test route (so a teleport is unaffordable). */
async function drainSpirit(page: Page): Promise<void> {
  const status = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/test/drain-spirit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    [API_URL] as const,
  );
  expect(status).toBe(200);
}

/** Attune a waystone directly via the server (no walking required). */
async function attune(page: Page, waystoneId: string): Promise<void> {
  const status = await page.evaluate(
    async ([api, wid]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/waystones/attune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: wid }),
      });
      return res.status;
    },
    [API_URL, waystoneId] as const,
  );
  expect(status).toBe(200);
}

/** Read the persisted anchor straight from the server. */
async function serverAnchor(page: Page): Promise<string> {
  return page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token');
    const res = await fetch(`${api}/api/waystones`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    return body.anchor as string;
  }, [API_URL] as const);
}

// ── Scenario 1: Spirit-locked destination shows a gate, no Travel (#87 Part B) ─
test('teleport: a spirit-locked waystone shows its gate and is not travelable', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // fresh user — spirit_max = Σ(reliquary max_uses) × multiplier
  const page = await ctx.newPage();
  await loadSanctum(page);
  // §10.8 (#87 Part B): the teleport gate is current spirit, not aggregate XP.
  // Attune forest_glade (so the row is discovered), then drain spirit to 0 so
  // its spiritCost (3) is unaffordable → meetsThreshold false, no Travel button.
  await attune(page, 'forest_glade');
  await drainSpirit(page);
  await openTeleportModal(page);

  const glade = await page.evaluate(
    () => (window as any).__teleportState.rows.find((r: any) => r.id === 'forest_glade') ?? null,
  );
  expect(glade).not.toBeNull();
  expect(glade.meetsThreshold).toBe(false);
  expect(glade.spiritCost).toBeGreaterThan(0);

  // No active Travel button for a spirit-locked row (DOM-free scene lookup).
  const hasTravel = await page.evaluate(() => {
    const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
    return !!scene.children.getByName('travel-forest_glade');
  });
  expect(hasTravel).toBe(false);
  await ctx.close();
});

// ── Scenario 2: Travel to an unlocked waystone re-anchors the Sanctum ────────
test('teleport: traveling to an unlocked waystone re-anchors (server round-trip)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  // §10.8 (#87 Part B): a fresh player's starter Reliquary rings afford forest_glade.
  await attune(page, 'forest_glade');
  await openTeleportModal(page);

  // The glade row is now attuned + affordable (spirit ≥ spiritCost).
  const glade = await page.evaluate(
    () => (window as any).__teleportState.rows.find((r: any) => r.id === 'forest_glade'),
  );
  expect(glade.attuned).toBe(true);
  expect(glade.meetsThreshold).toBe(true);

  await page.evaluate(() => (window as any).__campTeleport('forest_glade'));
  // The anchor is persisted; a fresh GET reports it.
  await page.waitForFunction(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/waystones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      return body.anchor === 'forest_glade';
    },
    [API_URL] as const,
    { timeout: 8000 },
  );
  expect(await serverAnchor(page)).toBe('forest_glade');
  await ctx.close();
});

// ── Scenario 3: Anchor drives the overworld spawn ────────────────────────────
test('teleport: the anchored waystone drives where the overworld spawns the player', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await seedAggregateXp(page, 100);
  await attune(page, 'forest_glade');
  await openTeleportModal(page);
  await page.evaluate(() => (window as any).__campTeleport('forest_glade'));
  await page.waitForFunction(() => (window as any).__teleportState?.anchor === 'forest_glade', {
    timeout: 8000,
  });

  // Leave via the Sanctum door → ForestScene. 8E (#107): the door routes to the
  // screen whose Anchorage matches the anchor, so a forest_glade anchor opens the
  // forest_glade screen, where the Sanctum is placed at the Glade Anchorage.
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => (window as any).__forestScreenId === 'forest_glade', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
  // 8B.4.1: the Sanctum exterior + sanctum_return are placed at the anchored
  // waystone (toward map center) and the player spawns just outside its door.
  // loadWaystones repositions the player AFTER building markers; wait for the
  // published Sanctum center, then assert the player spawned beside that door.
  await page.waitForFunction(() => !!(window as any).__sanctumReturnCenter, { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__zoneCenters?.forest_glade, { timeout: 8000 });
  const sanctum = await page.evaluate(
    () => (window as any).__sanctumReturnCenter as { x: number; y: number },
  );
  // The Glade Anchorage center on this screen (read dynamically, #107).
  const gladeCenter = await page.evaluate(
    () => (window as any).__zoneCenters.forest_glade as { x: number; y: number },
  );

  // The Sanctum is anchor-derived: with SANCTUM_OFFSET=0 its center sits AT the
  // anchored waystone (forest_glade) center — distance ≈ 0, well within ~40px.
  expect(
    Math.hypot(sanctum.x - gladeCenter.x, sanctum.y - gladeCenter.y),
  ).toBeLessThanOrEqual(40);

  await page.waitForFunction(
    ([sx, sy]) => {
      const p = (window as any).__player;
      if (!p) return false;
      return Math.hypot(p.x - sx, p.y - sy) <= 80;
    },
    [sanctum.x, sanctum.y] as const,
    { timeout: 8000 },
  );

  const dist = await page.evaluate(
    ([sx, sy]) => {
      const p = (window as any).__player;
      return Math.hypot(p.x - sx, p.y - sy);
    },
    [sanctum.x, sanctum.y] as const,
  );
  // Player spawns just outside the door: SANCTUM_DOOR_OFFSET (44px) past center.
  expect(dist).toBeLessThanOrEqual(80);
  await ctx.close();
});

// ── Scenario 4: Teleport to an unattuned waystone is rejected ────────────────
test('teleport: POST to an unattuned waystone is rejected (HTTP 400, anchor unchanged)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await seedAggregateXp(page, 100); // meets the gate, but NOT attuned
  // Deliberately do NOT attune forest_glade.

  const result = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_glade' }),
      });
      return { status: res.status, body: await res.json() };
    },
    [API_URL] as const,
  );
  expect(result.status).toBe(400);
  expect(result.body.error).toBe('not attuned');

  // Anchor stays at the default forest_entry.
  expect(await serverAnchor(page)).toBe('forest_entry');
  await ctx.close();
});

// ── Scenario 5: Teleport with insufficient spirit is rejected (#87 Part B) ─────
test('teleport: traveling with insufficient spirit surfaces an error and leaves the anchor', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await attune(page, 'forest_glade'); // attuned, but spirit drained below cost
  await drainSpirit(page);
  await openTeleportModal(page);

  // With 0 spirit forest_glade has no Travel button, so drive the rejection via
  // the hook; the server gate is now §10.8 spirit, not aggregate XP.
  await page.evaluate(() => (window as any).__campTeleport('forest_glade'));
  // The modal surfaces the server's spirit-gate error inline.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
      const err = scene.children.getByName('teleport-error');
      return !!err && /spirit/i.test(err.text ?? '');
    },
    { timeout: 8000 },
  );

  // Anchor unchanged.
  expect(await serverAnchor(page)).toBe('forest_entry');
  await ctx.close();
});
