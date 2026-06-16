import { test, expect, type Page } from '@playwright/test';
import { seedAuthToken } from './helpers';

const URL = 'http://localhost:8090';

/**
 * #477 — Restart Game affordance in CampScene Settings.
 *
 * Covers the end-to-end flows for the destructive reset action:
 *   1. Cancel flow: Restart Game → Cancel → assert no POST /api/me/reset fired
 *      and the confirm modal closes (camp state unchanged).
 *   2. Confirm flow: Restart Game → Confirm → assert POST /api/me/reset fired,
 *      window.__campState reflects a fresh-start account (seeker, 200 gold).
 *   3. Error flow: Restart Game → Confirm with a 500 intercepted → assert error
 *      toast appears and the confirm modal stays open.
 *
 * All interactions use emitPointerdown() (obj.emit('pointerdown') via page.evaluate).
 * window.__* hooks are read-only state channels only.
 */

/** Wait until CampScene has fully loaded /api/me and the Settings hook is wired. */
async function waitForCamp(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as any).__campState !== undefined &&
      typeof (window as any).__campOpenSettings === 'function',
    { timeout: 8000 },
  );
}

/**
 * Emit a 'pointerdown' event on a named Phaser GameObject (walking Container
 * children recursively). Returns true if the object was found and the event
 * emitted. This matches the established pattern in difficulty-modal.spec.ts —
 * Phaser Container children live in game-world coordinate space; page.mouse.click()
 * coordinates do not reliably map to Container child hit areas in this setup.
 */
async function emitPointerdown(page: Page, name: string): Promise<boolean> {
  return page.evaluate((n) => {
    const walk = (obj: any): any => {
      if (obj?.name === n) return obj;
      const kids: any[] = typeof obj?.getAll === 'function' ? obj.getAll() : [];
      for (const k of kids) {
        const hit = walk(k);
        if (hit) return hit;
      }
      return null;
    };
    const scene = (window as any).__scene as { children: { getAll: () => any[] } };
    for (const root of scene.children.getAll()) {
      const obj = walk(root);
      if (obj) {
        obj.emit('pointerdown');
        return true;
      }
    }
    return false;
  }, name);
}

/**
 * Open Settings via the established __campOpenSettings() helper (same pattern as
 * difficulty-modal.spec.ts). The settings-btn uses setOrigin(1, 0), so its world
 * transform tx lands at the right edge of the text (1008px) — clicking there misses.
 * __campOpenSettings() calls openDifficultyModal() directly, exercising the real
 * client code path without pixel-coordinate fragility.
 */
async function clickOpenSettings(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__campOpenSettings());
  await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
    timeout: 5000,
  });
}

/**
 * Emit pointerdown on the [Restart Game] button inside the difficulty modal.
 * Waits for __difficultyState to clear (modal closed) then for
 * __resetConfirmOpen to become true (confirm dialog opened).
 */
async function clickRestartGameBtn(page: Page): Promise<void> {
  const found = await emitPointerdown(page, 'difficulty-restart-btn');
  if (!found) throw new Error('difficulty-restart-btn not found in scene graph');
  // Difficulty modal closes before the callback fires.
  await page.waitForFunction(() => (window as any).__difficultyState === undefined, {
    timeout: 5000,
  });
  // Reset confirm dialog opens.
  await page.waitForFunction(() => (window as any).__resetConfirmOpen === true, {
    timeout: 5000,
  });
}

test.describe('reset-game (#477)', () => {
  test('Cancel: no POST /api/me/reset fired, confirm modal closes', async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();

    // Track any POST /api/me/reset requests (should be zero).
    let resetFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/me/reset') && req.method() === 'POST') {
        resetFired = true;
      }
    });

    await page.goto(URL);
    await waitForCamp(page);

    // Record camp state before any action.
    const difficultyBefore = await page.evaluate(
      () => (window as any).__campState?.player?.difficulty ?? (window as any).__campState?.difficulty,
    );

    // Open Settings → click Restart Game.
    await clickOpenSettings(page);
    await clickRestartGameBtn(page);

    // Emit pointerdown on the Cancel button.
    const cancelFound = await emitPointerdown(page, 'reset-confirm-no');
    expect(cancelFound, 'reset-confirm-no button must be present in scene graph').toBe(true);

    // Confirm dialog must close.
    await page.waitForFunction(() => (window as any).__resetConfirmOpen !== true, {
      timeout: 5000,
    });

    // Assert no POST fired.
    expect(resetFired, 'POST /api/me/reset must NOT fire when Cancel is tapped').toBe(false);

    // Camp state difficulty must be unchanged.
    const difficultyAfter = await page.evaluate(
      () => (window as any).__campState?.player?.difficulty ?? (window as any).__campState?.difficulty,
    );
    expect(difficultyAfter).toBe(difficultyBefore);

    await ctx.close();
  });

  test('Confirm: POST /api/me/reset fired, __campState reflects fresh-start values', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    // Watch for the POST /api/me/reset request.
    const resetPromise = page.waitForRequest(
      (req) => req.url().includes('/api/me/reset') && req.method() === 'POST',
      { timeout: 8000 },
    );

    // Open Settings → click Restart Game → click Confirm.
    await clickOpenSettings(page);
    await clickRestartGameBtn(page);

    const confirmFound = await emitPointerdown(page, 'reset-confirm-yes');
    expect(confirmFound, 'reset-confirm-yes button must be present in scene graph').toBe(true);

    // Wait for POST to fire and the confirm dialog to close.
    await resetPromise;
    await page.waitForFunction(() => (window as any).__resetConfirmOpen !== true, {
      timeout: 8000,
    });

    // __campState must reflect a fresh-start player (seeker, 200 gold).
    await page.waitForFunction(
      () => {
        const s = (window as any).__campState;
        const diff = s?.player?.difficulty ?? s?.difficulty;
        const gold = s?.player?.gold ?? 0;
        return diff === 'seeker' && gold === 200;
      },
      { timeout: 8000 },
    );

    const { difficulty, gold } = await page.evaluate(() => {
      const s = (window as any).__campState;
      return {
        difficulty: s?.player?.difficulty ?? s?.difficulty,
        gold: s?.player?.gold ?? 0,
      };
    });
    expect(difficulty).toBe('seeker');
    expect(gold).toBe(200);

    // The reset confirm modal must be closed.
    const resetConfirmOpen = await page.evaluate(() => (window as any).__resetConfirmOpen);
    expect(resetConfirmOpen).not.toBe(true);

    await ctx.close();
  });

  test('Error: 500 from POST /api/me/reset shows error toast, confirm modal stays open', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    // Intercept POST /api/me/reset and return a 500 error.
    await page.route('**/api/me/reset', (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    // Open Settings → click Restart Game → click Confirm.
    await clickOpenSettings(page);
    await clickRestartGameBtn(page);

    const confirmFound2 = await emitPointerdown(page, 'reset-confirm-yes');
    expect(confirmFound2, 'reset-confirm-yes button must be present in scene graph').toBe(true);

    // Wait for an error toast to appear: a scene-root Text node containing "failed"
    // or "error" with non-zero alpha. The toast is written before doResetGame returns,
    // so its appearance is the reliable sync point. Once it appears we also assert
    // that the confirm modal remained open — both conditions checked in one poll.
    await page.waitForFunction(
      () => {
        const scene = (window as any).__scene as { children: { getAll: () => any[] } };
        const all = scene?.children?.getAll() ?? [];
        return all.some((obj: any) => {
          const t: string = obj?.text ?? '';
          return (
            typeof t === 'string' &&
            (t.toLowerCase().includes('failed') || t.toLowerCase().includes('error')) &&
            obj?.alpha > 0
          );
        });
      },
      { timeout: 5000 },
    );

    // Confirm modal must still be open (doResetGame does not close it on error).
    const resetConfirmOpen = await page.evaluate(() => (window as any).__resetConfirmOpen);
    expect(resetConfirmOpen, 'confirm modal must stay open after a 500 error').toBe(true);

    await ctx.close();
  });
});
