import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8C.2 — Swamp biome + the teleport-only hidden Forest alcove.
 *
 * The Swamp was re-authored (#311 / #287): the single `swamp_entry` screen now
 * carries TWO Anchorages — `swamp_anchor_1` (Mire) and `swamp_anchor_2` (Deepmuck)
 * — that auto-attune on walk-in (GDD §10.7). The old `forest_sw_stone` attunement
 * gate and the `swamp_secret_forest` (Ironbark Rune) reveal mechanic were REMOVED:
 *   - the Forest→Swamp biome_exit (forest_swamp_gate) is now UNGATED — a boss
 *     physically blocks the path rather than an attunement gate (BaseBiomeScene
 *     .tryBiomeExit no longer reads a `gate` waystone), so any player can transition.
 *   - the hidden Forest alcove Anchorage (`forest_hidden_anchor`, on the
 *     forest_hidden_alcove screen) has no walking path and is reached only by
 *     teleporting to it once attuned — there is no longer a swamp Rune that reveals it.
 *
 * Every assertion reads real state — window.__waystones (the GET /api/waystones
 * payload the scenes publish), window.__activeScene, and direct server
 * round-trips — never mocks. Anchorage world centers are read dynamically from
 * window.__zoneCenters (zoneCenter below) rather than hardcoded pixel literals, so
 * a future map re-export can't silently re-break the spec. "Walking to a zone"
 * places the live player avatar at a point and lets the per-frame overlap register.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 87, y: 152 };

/** Read a named interaction zone's world center on the current screen (#107). */
async function zoneCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  await page.waitForFunction((n) => !!(window as any).__zoneCenters?.[n], name, { timeout: 8000 });
  return page.evaluate((n) => (window as any).__zoneCenters[n] as { x: number; y: number }, name);
}

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

// ── Scenario 1: Catalog includes both Swamp Anchorages; attuning persists ────
test('swamp: the Swamp catalog is present and attuning swamp_anchor_1 persists', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // The re-authored Swamp exposes both Anchorages in the shared catalog.
  const before = await serverWaystones(page);
  expect(before.waystones.some((w) => w.id === 'swamp_anchor_1')).toBe(true);
  expect(before.waystones.some((w) => w.id === 'swamp_anchor_2')).toBe(true);

  // Attuning a Swamp Anchorage persists server-side.
  expect(await attune(page, 'swamp_anchor_1')).toBe(200);
  const after = await serverWaystones(page);
  expect(after.waystones.find((w) => w.id === 'swamp_anchor_1')?.attuned).toBe(true);
  await ctx.close();
});

// ── Scenario 2: Forest→Swamp biome exit is ungated (transitions for any player) ─
test('swamp: the forest_swamp_gate biome_exit transitions a fresh player to SwampScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // fresh user — no attunement prerequisite anymore
  const page = await ctx.newPage();
  await loadSanctum(page);
  // 8E (#107): the SW biome_exit lives on the forest_swamp_gate screen.
  await enterForestScreen(page, 'forest_swamp_gate');

  // The exit is ungated (a boss physically blocks the path, not an attunement
  // gate): pressing E at the biome_exit transitions straight into the Swamp.
  await walkToZone(page, await zoneCenter(page, 'biome_exit'), 'biome_exit');
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
  await enterForestScreen(page, 'forest_swamp_gate');

  await walkToZone(page, await zoneCenter(page, 'biome_exit'), 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });

  // Walk onto the Anchorage center (read dynamically) — discovery is automatic
  // (GDD §10.7).
  const anchor1 = await zoneCenter(page, 'swamp_anchor_1');
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    anchor1.x,
    anchor1.y,
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

// ── Scenario 4: the second Swamp Anchorage also auto-attunes on walk-in ───────
test('swamp: walking onto swamp_anchor_2 auto-attunes it (server round-trip)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterForestScreen(page, 'forest_swamp_gate');

  await walkToZone(page, await zoneCenter(page, 'biome_exit'), 'biome_exit');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'SwampScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });

  // swamp_anchor_2 (Deepmuck) starts unattuned for a fresh user.
  expect((await readWaystone(page, 'swamp_anchor_2'))?.attuned).toBe(false);

  // Walk onto its center (read dynamically) — discovery is automatic (GDD §10.7).
  const anchor2 = await zoneCenter(page, 'swamp_anchor_2');
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    anchor2.x,
    anchor2.y,
  ]);
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'swamp_anchor_2')
        ?.attuned === true,
    { timeout: 8000 },
  );
  // Confirm against a fresh server GET (the attunement is server-persisted).
  const ws = await serverWaystones(page);
  expect(ws.waystones.find((w) => w.id === 'swamp_anchor_2')?.attuned).toBe(true);
  await ctx.close();
});

// ── Scenario 5: Teleport to the hidden alcove, then exit into the hidden screen ─
test('swamp: teleporting to forest_hidden_anchor routes the Sanctum door to the hidden Forest screen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // The hidden alcove Anchorage is a normal catalog Anchorage (the old swamp-Rune
  // reveal is gone); attune it directly so it becomes a valid teleport destination.
  expect(await attune(page, 'forest_hidden_anchor')).toBe(200);
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
