/**
 * Parameterized visual capture harness — registered in the `visual` Playwright
 * project. Never runs in CI (not in SOLO_SPECS or PVP_SPECS).
 *
 * Usage:
 *   CAPTURE_TARGET=overlay:field \
 *     CAPTURE_OUT=/tmp/er-capture-overlay-field.png \
 *     npx playwright test --project visual --grep "visual-capture"
 *
 * Target grammar:
 *   overlay:field | overlay:sanctum | overlay:fusion
 *   screen:<screen_id>
 *   camp
 *   battle:solo  (stretch goal — not yet implemented; see TODO below)
 *
 * CAPTURE_OUT defaults to /tmp/er-capture-<sanitized-target>.png where
 * <sanitized-target> replaces ':' and '/' with '-'.
 */
import { test } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const BASE = 'http://localhost:8090';

/** Sanctum ringwall zone position — matches reliquary-modal.spec.ts */
const RINGWALL = { x: 128, y: 56 };

const rawTarget = process.env.CAPTURE_TARGET ?? 'camp';

/** Sanitize target for use in a filename: replace ':' and '/' with '-'. */
function sanitizeTarget(target: string): string {
  return target.replace(/[:/]/g, '-');
}

const defaultOut = `/tmp/er-capture-${sanitizeTarget(rawTarget)}.png`;
const captureOut = process.env.CAPTURE_OUT ?? defaultOut;

test('visual-capture', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });

  try {
    await seedAuthToken(ctx);
    const page = await ctx.newPage();

    if (rawTarget === 'overlay:field') {
      // ── overlay:field ─────────────────────────────────────────────────────
      await page.goto(BASE);
      await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
      await enterForestScreen(page, 'forest_anchorage');
      await page.waitForFunction(() => typeof (window as any).__overworldToggleBattleHand === 'function', { timeout: 8000 });
      await page.evaluate(() => (window as any).__overworldToggleBattleHand());
      await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, { timeout: 5000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: captureOut });

    } else if (rawTarget === 'overlay:sanctum') {
      // ── overlay:sanctum ───────────────────────────────────────────────────
      // NOTE: readiness check is __campState !== undefined, NOT __activeScene === 'CampScene'
      await page.goto(BASE);
      await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 15000 });
      await page.evaluate(([x, y]) => (window as any).__player?.setPosition(x, y), [RINGWALL.x, RINGWALL.y]);
      await page.waitForFunction(() => ((window as any).__sanctumZones ?? []).includes('ringwall'), { timeout: 5000 });
      await page.evaluate(() => (window as any).__sanctumInteract?.());
      await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', { timeout: 8000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: captureOut });

    } else if (rawTarget === 'overlay:fusion') {
      // ── overlay:fusion ────────────────────────────────────────────────────
      await page.goto(BASE);
      await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
      await page.waitForFunction(() => typeof (window as any).__campOpenFusion === 'function', { timeout: 10000 });
      await page.evaluate(() => (window as any).__campOpenFusion());
      await page.waitForTimeout(1500);
      await page.screenshot({ path: captureOut });

    } else if (rawTarget.startsWith('screen:')) {
      // ── screen:<screen_id> ────────────────────────────────────────────────
      // enterForestScreen internally waits for __forestScreenId, __waystones, __zoneCenters.
      const screenId = rawTarget.slice('screen:'.length);
      await page.goto(BASE);
      await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
      await enterForestScreen(page, screenId);
      await page.screenshot({ path: captureOut });

    } else if (rawTarget === 'camp') {
      // ── camp ──────────────────────────────────────────────────────────────
      await page.goto(BASE);
      await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 15000 });
      await page.screenshot({ path: captureOut });

    } else if (rawTarget === 'battle:solo') {
      // TODO(#408): implement battle:solo capture — navigate to BattleScene via
      // driveAiDuel or a direct scene launch hook, wait for ATTACK_SELECT phase,
      // then screenshot. Skipped for now as a stretch goal.
      throw new Error(`battle:solo capture is not yet implemented (stretch goal). CAPTURE_TARGET=${rawTarget}`);

    } else {
      throw new Error(
        `Unknown CAPTURE_TARGET: "${rawTarget}". ` +
        `Valid values: overlay:field | overlay:sanctum | overlay:fusion | screen:<id> | camp | battle:solo`,
      );
    }
  } finally {
    await ctx.close();
  }
});
