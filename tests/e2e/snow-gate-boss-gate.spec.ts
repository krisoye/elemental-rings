import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #344 E2E — Snow Gate north exit: roster-authoritative boss gate, warden
 * reposition, and biome-exit auto-fire on edge contact.
 *
 * Three scenarios:
 *   1. Gate-closed block (roster gate, no bypass): with Frost Sentinel alive,
 *      placing the player on the biome_exit zone at cols 14 and 17 shows the
 *      barrier message and the scene stays on forest_snow_gate.
 *   2. Gate-open transition (post-defeat): after seeding a Frost Sentinel defeat
 *      via POST /api/test/seed-npc-defeat (the same path the BattleRoom uses),
 *      re-entering forest_snow_gate and touching the biome_exit zone transitions
 *      to SnowScene.
 *   3. Swamp regression: with Bogwood Warden alive, forest_swamp_gate's INTERIOR
 *      biome_exit still requires E and blocks pre-defeat; after defeat the E-press
 *      transitions to SwampScene.
 *
 * All assertions read live server/scene state — no mocks.
 * Warden positions: Frost Sentinel tx:16,ty:2 → (264,40); biome_exit x:224,y:0,w:64.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// The north biome_exit on forest_snow_gate spans cols 14-17 (x=224..288, y=0..16).
// Pick two x values that sit at the col-14 and col-17 edges to verify no bypass.
const EXIT_CENTER_Y = 8;  // inside the 16px-tall biome_exit zone at y=0
const EXIT_COL14_X = 232; // col 14 center: 14*16 + 8 = 232
const EXIT_COL17_X = 280; // col 17 center: 17*16 + 8 = 280

/** Read a named interaction zone's world center on the current screen. */
async function zoneCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  await page.waitForFunction((n) => !!(window as any).__zoneCenters?.[n], name, { timeout: 8000 });
  return page.evaluate((n) => (window as any).__zoneCenters[n] as { x: number; y: number }, name);
}

/**
 * Navigate to forest_snow_gate via CampScene so __campState is populated,
 * spawning at spawnEdge:'north' to avoid the south-edge-transition race.
 */
async function enterSnowGate(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(
    () =>
      !!(window as any).__campState?.heart_ring &&
      ((window as any).__campState?.heart_ring?.current_uses ?? 0) > 0 &&
      (window as any).__campState?.loadout?.thumb != null,
    { timeout: 8000 },
  );
  await page.evaluate(() => {
    const active = (window as any).__activeScene;
    if (active) (window as any).__game.scene.stop(active);
    (window as any).__game.scene.start('ForestScene', {
      screenId: 'forest_snow_gate',
      spawnEdge: 'north',
    });
  });
  await page.waitForFunction(
    () => (window as any).__forestScreenId === 'forest_snow_gate',
    { timeout: 8000 },
  );
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__zoneCenters, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

/**
 * Seed a Frost Sentinel defeat for the authenticated player via the test-only
 * route (POST /api/test/seed-npc-defeat). This is the same authoritative path
 * the BattleRoom's recordNpcDefeat() uses after a real win — the server marks
 * forest_frost_sentinel as permanently defeated for this player, so the next
 * GET /api/overworld/npcs?screen=forest_snow_gate omits it from the roster.
 */
async function seedSentinelDefeat(page: Page): Promise<void> {
  const status = await page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token');
    const res = await fetch(`${api}/api/test/seed-npc-defeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ npcId: 'forest_frost_sentinel' }),
    });
    return res.status;
  }, [API_URL] as const);
  if (status !== 200) throw new Error(`seedSentinelDefeat: got ${status}`);
}

/**
 * Re-enter forest_snow_gate from any currently-running scene, waiting for the
 * NPC roster (which omits the Sentinel post-defeat) to load.
 */
async function reenterSnowGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = (window as any).__activeScene;
    if (active) (window as any).__game.scene.stop(active);
    (window as any).__game.scene.start('ForestScene', {
      screenId: 'forest_snow_gate',
      spawnEdge: 'north',
    });
  });
  await page.waitForFunction(
    () => (window as any).__forestScreenId === 'forest_snow_gate',
    { timeout: 8000 },
  );
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__zoneCenters, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

// ── Scenario 1: Gate-closed block (no bypass at cols 14 or 17) ───────────────
// With the Frost Sentinel alive in the roster, placing the player on the biome_exit
// zone at either col 14 or col 17 must NOT transition to SnowScene. The
// roster-authoritative gate in tryBiomeExit blocks the transition regardless of
// where on the 4-tile-wide zone the player stands.
test(
  'snow-gate: with Frost Sentinel alive, touching biome_exit at col 14 blocks transition',
  async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await enterSnowGate(page);

    // Confirm sentinel is alive in the roster.
    const alive = await page.evaluate(
      () => ((window as any).__overworldNpcs ?? []).some((n: any) => n.id === 'forest_frost_sentinel'),
    );
    expect(alive, 'Frost Sentinel present in roster').toBe(true);

    // Teleport onto the left edge of the biome_exit zone (col 14 center).
    await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
      EXIT_COL14_X,
      EXIT_CENTER_Y,
    ]);
    // Allow a couple of frames for the physics overlap callback to fire tryBiomeExit.
    await page.waitForTimeout(300);

    const scene = await page.evaluate(() => (window as any).__activeScene);
    expect(scene, 'still in ForestScene at col 14').toBe('ForestScene');
    expect(scene).not.toBe('SnowScene');

    const screenId = await page.evaluate(() => (window as any).__forestScreenId);
    expect(screenId, 'still on forest_snow_gate').toBe('forest_snow_gate');

    await ctx.close();
  },
);

test(
  'snow-gate: with Frost Sentinel alive, touching biome_exit at col 17 blocks transition',
  async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await enterSnowGate(page);

    const alive = await page.evaluate(
      () => ((window as any).__overworldNpcs ?? []).some((n: any) => n.id === 'forest_frost_sentinel'),
    );
    expect(alive, 'Frost Sentinel present in roster').toBe(true);

    // Teleport onto the right edge of the biome_exit zone (col 17 center).
    await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
      EXIT_COL17_X,
      EXIT_CENTER_Y,
    ]);
    await page.waitForTimeout(300);

    const scene = await page.evaluate(() => (window as any).__activeScene);
    expect(scene, 'still in ForestScene at col 17').toBe('ForestScene');
    expect(scene).not.toBe('SnowScene');

    const screenId = await page.evaluate(() => (window as any).__forestScreenId);
    expect(screenId, 'still on forest_snow_gate').toBe('forest_snow_gate');

    await ctx.close();
  },
);

// ── Scenario 2: Gate-open transition (post-defeat) ───────────────────────────
// After seeding a Frost Sentinel defeat via POST /api/test/seed-npc-defeat
// (the same authoritative path BattleRoom uses), re-entering forest_snow_gate
// shows the sentinel absent from the roster, and walking into the biome_exit
// zone auto-fires the transition to SnowScene.
test(
  'snow-gate: after defeating Frost Sentinel, touching biome_exit transitions to SnowScene',
  async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await enterSnowGate(page);

    // Seed the defeat directly via the authoritative test route.
    await seedSentinelDefeat(page);

    // Re-enter forest_snow_gate — the server now excludes the Sentinel.
    await reenterSnowGate(page);

    const gone = await page.evaluate(
      () => !((window as any).__overworldNpcs ?? []).some((n: any) => n.id === 'forest_frost_sentinel'),
    );
    expect(gone, 'Sentinel absent from roster after defeat').toBe(true);

    // The biome_exit is edge-placed (y=0) and auto-fires on contact.
    const exitCenter = await zoneCenter(page, 'biome_exit');
    await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [exitCenter.x, exitCenter.y]);

    await page.waitForFunction(() => (window as any).__activeScene === 'SnowScene', { timeout: 8000 });
    await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });

    const activeScene = await page.evaluate(() => (window as any).__activeScene);
    expect(activeScene, 'transitioned to SnowScene').toBe('SnowScene');

    await ctx.close();
  },
);

// ── Scenario 3: Swamp regression (interior E-press exit unchanged) ────────────
// The forest_swamp_gate biome_exit is an INTERIOR zone (y=256, mapH=288px,
// 32px from the bottom — not caught by the edge discriminator). It still requires
// E to activate. With Bogwood Warden alive, the roster gate blocks the transition;
// after defeat (seeded via the test route), E-press transitions to SwampScene.
test(
  'swamp-regression: interior biome_exit blocks pre-defeat (roster gate) and opens post-defeat on E',
  async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
    await enterForestScreen(page, 'forest_swamp_gate');

    // Bogwood Warden should be alive for a fresh player.
    const wardenAlive = await page.evaluate(
      () => ((window as any).__overworldNpcs ?? []).some((n: any) => n.id === 'forest_bogwood_warden'),
    );
    expect(wardenAlive, 'Bogwood Warden alive for fresh player').toBe(true);

    // Place player on the interior biome_exit zone center.
    const exitCenter = await page.waitForFunction(
      (n) => !!(window as any).__zoneCenters?.[n] && (window as any).__zoneCenters[n],
      'biome_exit',
      { timeout: 8000 },
    ).then(() =>
      page.evaluate((n) => (window as any).__zoneCenters[n] as { x: number; y: number }, 'biome_exit'),
    );
    await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [exitCenter.x, exitCenter.y]);
    // Wait for the E-press zone to become active (it's interior, not auto-fire).
    await page.waitForFunction(
      () => ((window as any).__sanctumZones ?? []).includes('biome_exit'),
      { timeout: 5000 },
    );

    // Pressing E triggers tryBiomeExit; the roster gate should block.
    await page.evaluate(() => (window as any).__sanctumInteract());
    await page.waitForTimeout(300);

    // Scene must stay on ForestScene (swamp gate blocked by roster gate).
    const scenePre = await page.evaluate(() => (window as any).__activeScene);
    expect(scenePre, 'blocked pre-defeat').toBe('ForestScene');

    // Seed a Bogwood Warden defeat.
    const defeatStatus = await page.evaluate(async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/test/seed-npc-defeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ npcId: 'forest_bogwood_warden' }),
      });
      return res.status;
    }, [API_URL] as const);
    expect(defeatStatus, 'seed-npc-defeat returned 200').toBe(200);

    // Re-enter the screen so overworldNpcs refreshes without the warden.
    await enterForestScreen(page, 'forest_swamp_gate');

    const wardenGone = await page.evaluate(
      () => !((window as any).__overworldNpcs ?? []).some((n: any) => n.id === 'forest_bogwood_warden'),
    );
    expect(wardenGone, 'Bogwood Warden absent post-defeat').toBe(true);

    // Place player on the biome_exit and press E → should transition to SwampScene.
    const exitCenter2 = await page.waitForFunction(
      (n) => !!(window as any).__zoneCenters?.[n],
      'biome_exit',
      { timeout: 8000 },
    ).then(() =>
      page.evaluate((n) => (window as any).__zoneCenters[n] as { x: number; y: number }, 'biome_exit'),
    );
    await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [exitCenter2.x, exitCenter2.y]);
    await page.waitForFunction(
      () => ((window as any).__sanctumZones ?? []).includes('biome_exit'),
      { timeout: 5000 },
    );
    await page.evaluate(() => (window as any).__sanctumInteract());

    await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', { timeout: 8000 });
    const scenePost = await page.evaluate(() => (window as any).__activeScene);
    expect(scenePost, 'transitioned to SwampScene post-defeat').toBe('SwampScene');

    await ctx.close();
  },
);
