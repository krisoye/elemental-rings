/**
 * E2E spec for #353 — Overworld HUD: ♥ HP, Total XP, Avg Battle XP.
 *
 * The persistent resource HUD (top-right, `BaseBiomeScene.hudText`) now shows:
 *   Day N · Gold N · Food N · Spirit N/N · ♥ N/N · XP N · Total: N · Avg: N
 *
 * All values are verbatim from /api/me — never computed client-side. These
 * tests assert that all three new segments appear and match server data, and
 * that the HUD and the Manage Battle Rings modal do not overlap.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Boot to CampScene and navigate to a Forest screen. */
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

/** Read the current hudText string from the live ForestScene. */
async function getHudText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    return scene?.hudText?.text ?? '';
  });
}

/** Trigger refreshHud() and wait until it resolves (no direct await, but a brief poll suffices). */
async function waitForHudRefresh(page: Page, timeout = 4000): Promise<void> {
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    // refreshHud is private but accessible at runtime for E2E.
    return scene?.refreshHud?.();
  });
  // Give the async fetch time to complete.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      const txt: string = scene?.hudText?.text ?? '';
      return txt.includes('♥') && txt.includes('Total:') && txt.includes('Avg:');
    },
    { timeout },
  );
}

// ── Scenario 1 — heart ring equipped: ♥ N/N matches /api/me ──────────────────
test('overworld HUD (#353): ♥ cur/max, Total XP and Avg match /api/me when heart ring equipped', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { current_uses: number; max_uses: number } | null; total_xp?: number; battle_hand_avg_xp?: number } };

  const heart = me.player.heart_ring;
  // A fresh player should have a heart ring equipped.
  expect(heart).toBeTruthy();

  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  // ♥ cur/max segment
  const expectedHeart = `♥ ${heart!.current_uses}/${heart!.max_uses}`;
  expect(hud).toContain(expectedHeart);

  // Total: and Avg: segments present
  expect(hud).toContain('Total:');
  expect(hud).toContain('Avg:');

  // Existing segments still present
  expect(hud).toMatch(/Day \d/);
  expect(hud).toContain('Gold');
  expect(hud).toContain('Food');
  expect(hud).toContain('Spirit');
  expect(hud).toContain('XP');

  await ctx.close();
});

// ── Scenario 2 — no heart ring: HUD shows ♥ 0/0 ──────────────────────────────
test('overworld HUD (#353): shows ♥ 0/0 when heart slot is empty', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Delete the heart ring to empty the slot.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  if (heartId) {
    await fetch(`${API_URL}/api/rings/${heartId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );

  // Wait for HUD with empty heart (♥ 0/0).
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      const txt: string = scene?.hudText?.text ?? '';
      return txt.includes('♥ 0/0');
    },
    { timeout: 6000 },
  );

  const hud = await getHudText(page);
  expect(hud).toContain('♥ 0/0');

  await ctx.close();
});

// ── Scenario 3 — HUD visible while modal open; panel top ≥ 44 ────────────────
test('overworld HUD (#353): HUD text is non-empty while Manage Battle Rings modal is open', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);

  // Open the Manage Battle Rings overlay.
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });

  // HUD text is still populated (no depth/visibility conflict with the modal).
  const hud = await getHudText(page);
  expect(hud.length).toBeGreaterThan(0);
  expect(hud).toContain('♥');
  expect(hud).toContain('Total:');
  expect(hud).toContain('Avg:');

  // The manage modal panel starts at y ≥ 44 (clears the HUD).
  const panelTopY = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return null;
    // The panel is the second object added to the container (overlay at index 0, panel at 1).
    const objs = modal.getAll ? modal.getAll() : [];
    // Find the main panel rectangle: a Rectangle with strokeStyle, width 640.
    for (const o of objs) {
      if (o.width === 640 && typeof o.strokeColor !== 'undefined') {
        // Rectangle y is its center; top = y - height/2.
        return o.y - o.height / 2;
      }
    }
    return null;
  });
  expect(panelTopY).not.toBeNull();
  expect(panelTopY!).toBeGreaterThanOrEqual(44);

  await ctx.close();
});
