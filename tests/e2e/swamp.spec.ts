import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8C.2 — Swamp biome + hidden Forest alcove (#82).
 *
 * The Forest's SW biome_exit transitions to the Swamp once `forest_sw_stone`
 * (Bogwood Sentinel) is attuned; otherwise the player hits a barrier and stays.
 * In the Swamp, Anchorages auto-attune on walk-in and the `swamp_secret_forest`
 * (Ironbark Rune) Waystone — when attuned with E — REVEALS the hidden Forest
 * alcove Anchorage (`forest_hidden_anchor`), which has no walking path and is
 * reachable only by teleporting. The Sanctum door is biome-aware: after anchoring
 * at the hidden alcove, exiting lands in the unified ForestScene on the hidden
 * alcove screen (8E folded the standalone hidden scene into a Forest region screen).
 *
 * Every assertion reads real state — window.__waystones (the GET /api/waystones
 * payload the scenes publish), window.__activeScene, and direct server
 * round-trips — never mocks. "Walking to a zone" places the live player avatar at
 * a point and lets the per-frame overlap check register it.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 1088, y: 608 };
/** Overworld SW biome_exit center (overworld.json: tile 2,24). */
const FOREST_SWAMP_EXIT = { x: 80, y: 784 };
/** Swamp object centers (swamp.json). */
const SWAMP_ANCHOR_1 = { x: 272, y: 208 };
const SWAMP_SECRET = { x: 912, y: 784 };

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Enter the Forest overworld via the Sanctum door and wait for its waystones. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
}

/** Place the live player at a point and wait for the named zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

/** Read a waystone entry from the published __waystones payload. */
async function readWaystone(page: Page, id: string): Promise<{ attuned: boolean } | null> {
  return page.evaluate((wid) => {
    const payload = (window as any).__waystones;
    return payload?.waystones?.find((w: any) => w.id === wid) ?? null;
  }, id);
}

/** Attune a waystone directly via the server (no walking required). */
async function attune(page: Page, waystoneId: string): Promise<number> {
  return page.evaluate(
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
}

/** GET /api/waystones straight from the server (bypasses the published cache). */
async function serverWaystones(
  page: Page,
): Promise<{ anchor: string; waystones: Array<{ id: string; attuned: boolean }> }> {
  return page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token');
    const res = await fetch(`${api}/api/waystones`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }, [API_URL] as const);
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

// ── Scenario 1: Catalog includes the Swamp; attuning the SW stone persists ───
test('swamp: attuning forest_sw_stone persists and the Swamp catalog is present', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const status = await attune(page, 'forest_sw_stone');
  expect(status).toBe(200);

  const ws = await serverWaystones(page);
  const swStone = ws.waystones.find((w) => w.id === 'forest_sw_stone');
  expect(swStone?.attuned).toBe(true);
  // The Swamp entries are now part of the shared catalog (server-driven).
  expect(ws.waystones.some((w) => w.id === 'swamp_anchor_1')).toBe(true);
  await ctx.close();
});

// ── Scenario 2: Forest→Swamp biome exit gated on forest_sw_stone ─────────────
test('swamp: SW biome_exit is barred until forest_sw_stone is attuned, then opens', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // fresh user → forest_sw_stone NOT attuned
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Without attunement, pressing E at the biome_exit shows a barrier and stays.
  await walkToZone(page, FOREST_SWAMP_EXIT, 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__activeScene)).toBe('ForestScene');

  // Attune the SW stone server-side, then re-enter the overworld so the scene's
  // cached payload reflects it (the gate reads window.__waystones).
  expect(await attune(page, 'forest_sw_stone')).toBe(200);
  await page.reload();
  await loadSanctum(page);
  await enterOverworld(page);

  await walkToZone(page, FOREST_SWAMP_EXIT, 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', {
    timeout: 8000,
  });
  await ctx.close();
});

// ── Scenario 3: Swamp Anchorage auto-attunes on walk-in ──────────────────────
test('swamp: walking onto swamp_anchor_1 auto-attunes it (server round-trip)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await attune(page, 'forest_sw_stone'); // unlock the Swamp transition
  await enterOverworld(page);

  await walkToZone(page, FOREST_SWAMP_EXIT, 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });

  // Walk onto the Anchorage center — discovery is automatic (GDD §10.7).
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    SWAMP_ANCHOR_1.x,
    SWAMP_ANCHOR_1.y,
  ]);
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'swamp_anchor_1')
        ?.attuned === true,
    { timeout: 8000 },
  );
  expect((await readWaystone(page, 'swamp_anchor_1'))?.attuned).toBe(true);
  await ctx.close();
});

// ── Scenario 4: Ironbark Rune reveals the hidden Forest alcove Anchorage ──────
test('swamp: pressing E at swamp_secret_forest reveals forest_hidden_anchor', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await seedAggregateXp(page, 800); // the Ironbark Rune sits at threshold 800
  await attune(page, 'forest_sw_stone');
  await enterOverworld(page);

  await walkToZone(page, FOREST_SWAMP_EXIT, 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });

  // The hidden Forest Anchorage starts unrevealed (unattuned).
  expect((await readWaystone(page, 'forest_hidden_anchor'))?.attuned).toBe(false);

  // Walk onto the Ironbark Rune and press E → server attunes it AND its reveal.
  await walkToZone(page, SWAMP_SECRET, 'swamp_secret_forest');
  await page.evaluate(() => (window as any).__sanctumInteract());

  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_hidden_anchor')
        ?.attuned === true,
    { timeout: 8000 },
  );
  // Confirm against a fresh server GET (the reveal is server-persisted).
  const ws = await serverWaystones(page);
  expect(ws.waystones.find((w) => w.id === 'forest_hidden_anchor')?.attuned).toBe(true);
  await ctx.close();
});

// ── Scenario 5: Teleport to the hidden alcove, then exit into the hidden screen ─
test('swamp: teleporting to forest_hidden_anchor routes the Sanctum door to the hidden Forest screen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await seedAggregateXp(page, 800); // ≥ forest_hidden_anchor threshold (800)

  // Attuning the Ironbark Rune reveals (attunes) the hidden Anchorage server-side.
  expect(await attune(page, 'swamp_secret_forest')).toBe(200);
  expect((await serverWaystones(page)).waystones.find((w) => w.id === 'forest_hidden_anchor')
    ?.attuned).toBe(true);

  // POST /api/teleport re-anchors the Sanctum at the hidden alcove → 200.
  const teleport = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_hidden_anchor' }),
      });
      return { status: res.status, body: await res.json() };
    },
    [API_URL] as const,
  );
  expect(teleport.status).toBe(200);
  expect(teleport.body.anchor).toBe('forest_hidden_anchor');

  // Exit the Sanctum via the (now biome-aware) door → lands in the unified
  // ForestScene on the hidden alcove screen (8E: the hidden Forest is now a Forest
  // region screen, not its own scene).
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(
    () => (window as any).__forestScreenId === 'forest_hidden_alcove',
    { timeout: 8000 },
  );
  await ctx.close();
});
