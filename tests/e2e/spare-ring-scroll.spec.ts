/**
 * E2E spec for #194 — BattleHandOverlay spare-ring scrollable viewport.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

async function loadForest(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
}

async function openBattleHand(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
}

// Seed N spare rings (element 0=fire, not in battle slots) via carry API.
async function seedSpareRings(token: string, count: number): Promise<void> {
  // Buy rings first.
  for (let i = 0; i < count; i++) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
    });
  }
  // Carry all of them via PUT /api/carry.
  const me = await (
    await fetch(`${API_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json() as { rings: Array<{ id: string }> };
  const allIds = me.rings.map((r) => r.id);
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: allIds }),
  });
}

// Scenario 1 — single row: no visible change with ≤6 spare rings.
test('spare-ring-scroll: single row — overlay opens and recharge buttons present', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Recharge buttons should be present.
  const rechargeBtnExists = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    if (!scene?.battleHand?.manageModal) return false;
    const allText = scene.battleHand.manageModal.getAll().map((o: any) => o.text ?? '');
    return allText.some((t: string) => t.includes('[Recharge]'));
  });
  expect(rechargeBtnExists).toBe(true);

  await ctx.close();
});

// Scenario 2 — second row scrollable.
test('spare-ring-scroll: second row scrolls into view with 8+ spare rings', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  // Navigate FIRST, then read storage. Reading localStorage on the page's initial
  // about:blank document (before page.goto resolves) throws SecurityError (#312).
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });

  // Seed 8 spare rings.
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  if (tok) await seedSpareRings(tok, 8);

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // With 8 rings and a 6-column grid, the overlay should have spareScrollY=0
  // and the spareContainer should start at y=0 (no offset).
  const initialScroll = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.spareScrollY ?? 0;
  });
  expect(initialScroll).toBe(0);

  // Fire a wheel event to scroll down.
  await page.locator('canvas').dispatchEvent('wheel', { deltaY: 90 });
  await page.waitForTimeout(100);

  const afterScroll = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.spareScrollY ?? 0;
  });
  expect(afterScroll).toBeGreaterThan(0);

  await ctx.close();
});

// Scenario 3 — scroll position preserved across re-render (swap triggers re-render).
test('spare-ring-scroll: scroll position preserved after re-render', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  if (tok) await seedSpareRings(tok, 8);

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // Scroll down.
  await page.locator('canvas').dispatchEvent('wheel', { deltaY: 90 });
  await page.waitForTimeout(100);

  const scrollBefore = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.spareScrollY ?? 0;
  });
  expect(scrollBefore).toBeGreaterThan(0);

  // Trigger a re-render: recharge-all (fast op that doesn't change ring count).
  const tok2 = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  if (tok2) {
    await fetch(`${API_URL}/api/spirit/recharge-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok2}` },
    });
  }
  // Re-render via the overlay's own refresh action.
  await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    // Trigger a data refresh that causes re-render (same as recharge-all button).
    scene?.battleHand?.refreshManageData?.();
  });
  await page.waitForTimeout(300);

  const scrollAfter = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.spareScrollY ?? 0;
  });
  // Scroll preserved (not reset to 0).
  expect(scrollAfter).toBe(scrollBefore);

  await ctx.close();
});
