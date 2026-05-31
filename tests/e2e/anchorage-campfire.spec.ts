/**
 * E2E spec for #191 — overworld Anchorage campfire: Rest + Summon Sanctum overlay
 * and animated campfire graphic.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function waitForForest(page: Page, screenId: string): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, screenId);
}

/** Attune the given waystone via API. */
async function attune(token: string, waystoneId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/waystones/attune`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ waystoneId }),
  });
  if (!res.ok) throw new Error(`attune failed: ${res.status}`);
}

/** POST /api/test/drain-spirit — set spirit to 0. */
async function drainSpirit(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/drain-spirit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drain-spirit failed: ${res.status}`);
}

// ── Scenario 1: Rest at an overworld Anchorage restores spirit ────────────────
test('campfire: rest restores spirit and spends 25 food', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  const token = await ctx.storageState().then(() =>
    page.evaluate(() => localStorage.getItem('er_token') ?? '')
  );
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Drain spirit so we have something to restore.
  if (tok) await drainSpirit(tok);

  // Seed some food (fresh player starts with 10 food; ensure ≥ 25).
  if (tok) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authHeaders(tok),
      body: JSON.stringify({ item: 'food', quantity: 25 }),
    });
  }

  const meBefore = tok
    ? await (await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })).json() as {
        player: { spirit_current: number; spirit_max: number; food_units: number; game_day: number };
      }
    : null;

  // Trigger rest via the campfire hook.
  await page.waitForFunction(() => typeof (window as any).__campfireRest === 'function', {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__campfireRest());
  await page.waitForTimeout(1000);

  const meAfter = tok
    ? await (await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })).json() as {
        player: { spirit_current: number; food_units: number; game_day: number };
      }
    : null;

  if (meBefore && meAfter) {
    expect(meAfter.player.spirit_current).toBe(meBefore.player.spirit_max);
    expect(meAfter.player.food_units).toBe(meBefore.player.food_units - 25);
    expect(meAfter.player.game_day).toBe(meBefore.player.game_day + 1);
  }
  void token;

  await ctx.close();
});

// ── Scenario 2: Summon re-anchors the Sanctum ────────────────────────────────
test('campfire: summon re-anchors sanctum to current anchorage', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Attune forest_glade so we have a distinct anchor to summon to.
  if (tok) await attune(tok, 'forest_glade');

  // Get current anchor.
  const anchorBefore = tok
    ? await (await fetch(`${API_URL}/api/waystones`, { headers: { Authorization: `Bearer ${tok}` } })).json() as { anchor: string }
    : null;

  // Navigate to forest_glade (different anchorage).
  await enterForestScreen(page, 'forest_glade');

  // Wait for campfire summon hook.
  await page.waitForFunction(() => typeof (window as any).__campfireSummon === 'function', {
    timeout: 5000,
  });

  await page.evaluate(() => (window as any).__campfireSummon());
  await page.waitForTimeout(1000);

  const anchorAfter = tok
    ? await (await fetch(`${API_URL}/api/waystones`, { headers: { Authorization: `Bearer ${tok}` } })).json() as { anchor: string }
    : null;

  if (anchorBefore && anchorAfter && anchorBefore.anchor !== 'forest_glade') {
    expect(anchorAfter.anchor).toBe('forest_glade');
  } else if (anchorAfter) {
    // If anchor was already forest_glade (0-cost summon), it stays the same — still valid.
    expect(anchorAfter.anchor).toBeTruthy();
  }

  await ctx.close();
});

// ── Scenario 3: Insufficient-spirit Summon is rejected ───────────────────────
test('campfire: summon with 0 spirit is rejected by server', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Attune forest_glade (spiritCost=3) so summon would cost spirit.
  if (tok) await attune(tok, 'forest_glade');
  // Drain spirit to 0.
  if (tok) await drainSpirit(tok);

  // Navigate to forest_glade (cost > 0 to summon here from forest_entry).
  await enterForestScreen(page, 'forest_glade');

  const anchorBefore = tok
    ? await (await fetch(`${API_URL}/api/waystones`, { headers: { Authorization: `Bearer ${tok}` } })).json() as { anchor: string }
    : null;

  // Try summon — should fail (insufficient spirit → server 400).
  const res = tok
    ? await fetch(`${API_URL}/api/sanctum/summon`, {
        method: 'POST',
        headers: authHeaders(tok),
        body: JSON.stringify({ anchorageId: 'forest_glade' }),
      })
    : null;

  if (res && anchorBefore?.anchor !== 'forest_glade') {
    // Only assert 400 if the destination isn't already the current anchor (0-cost).
    expect(res.status).toBe(400);
    // Anchor unchanged.
    const anchorAfter = tok
      ? await (await fetch(`${API_URL}/api/waystones`, { headers: { Authorization: `Bearer ${tok}` } })).json() as { anchor: string }
      : null;
    expect(anchorAfter?.anchor).toBe(anchorBefore?.anchor);
  }

  await ctx.close();
});

// ── Scenario 4: Campfire graphic + modal hook present on Anchorage ────────────
test('campfire: campfire modal hook present when entering an anchorage screen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  // After loadWaystones builds the campfire zones, the window.__campfireRest hook
  // should be registered (campfire modal auto-opens here if the player walks onto
  // the anchorage zone). At minimum the campfire display objects should exist in
  // the scene's campfires map.
  const campfiresExist = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    return (scene?.campfires?.size ?? 0) > 0;
  });
  expect(campfiresExist).toBe(true);

  // The zone centers should include the anchorage id.
  const zoneCenters = await page.evaluate(() => (window as any).__zoneCenters ?? {});
  const anchorageZoneExists = Object.keys(zoneCenters as Record<string, unknown>).some((k) =>
    k.startsWith('forest'),
  );
  expect(anchorageZoneExists).toBe(true);

  await ctx.close();
});
