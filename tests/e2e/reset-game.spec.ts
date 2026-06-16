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
 * All interactions use page.mouse.click() on canvas coordinates.
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
 * Recursively walk the Phaser scene display list (including container children)
 * to find a named GameObject, returning it or null.
 */
async function findNamedObject(page: Page, name: string): Promise<any> {
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
      const hit = walk(root);
      if (hit) return hit;
    }
    return null;
  }, name);
}

/**
 * Get the canvas-space bounding box of a named Phaser Text/GameObject so
 * page.mouse.click() can tap it by screen coordinate. Uses the object's
 * world transform matrix (tx, ty) which is already in screen space for
 * camera-pinned objects (scrollFactor 0) under the uiCam (zoom 1).
 */
async function getObjectScreenPos(
  page: Page,
  name: string,
): Promise<{ x: number; y: number } | null> {
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
        const m = obj.getWorldTransformMatrix?.();
        if (m) return { x: m.tx, y: m.ty };
        // Fallback: use x/y directly for scene-root objects.
        return { x: obj.x ?? 0, y: obj.y ?? 0 };
      }
    }
    return null;
  }, name);
}

/**
 * Open Settings via page.mouse.click() on the [Settings] button.
 * Waits for __difficultyState to confirm the modal opened.
 */
async function clickOpenSettings(page: Page): Promise<void> {
  const pos = await getObjectScreenPos(page, 'settings-btn');
  if (!pos) throw new Error('settings-btn not found in scene graph');
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
    timeout: 5000,
  });
}

/**
 * Click the [Restart Game] button inside the difficulty modal.
 * Waits for __difficultyState to clear (modal closed) then for
 * __resetConfirmOpen to become true (confirm dialog opened).
 */
async function clickRestartGameBtn(page: Page): Promise<void> {
  const pos = await getObjectScreenPos(page, 'difficulty-restart-btn');
  if (!pos) throw new Error('difficulty-restart-btn not found in scene graph');
  await page.mouse.click(pos.x, pos.y);
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

    // Click Cancel button.
    const cancelPos = await getObjectScreenPos(page, 'reset-confirm-no');
    expect(cancelPos, 'reset-confirm-no button must be present in scene graph').not.toBeNull();
    await page.mouse.click(cancelPos!.x, cancelPos!.y);

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

    const confirmPos = await getObjectScreenPos(page, 'reset-confirm-yes');
    expect(confirmPos, 'reset-confirm-yes button must be present in scene graph').not.toBeNull();
    await page.mouse.click(confirmPos!.x, confirmPos!.y);

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

    const confirmPos = await getObjectScreenPos(page, 'reset-confirm-yes');
    expect(confirmPos, 'reset-confirm-yes button must be present in scene graph').not.toBeNull();
    await page.mouse.click(confirmPos!.x, confirmPos!.y);

    // The confirm modal must remain open after the 500 response.
    // Give a brief moment for the response to be processed.
    await page.waitForTimeout(1000);

    const resetConfirmOpen = await page.evaluate(() => (window as any).__resetConfirmOpen);
    expect(resetConfirmOpen, 'confirm modal must stay open after a 500 error').toBe(true);

    // An error toast text object must be present in the scene graph (transient text
    // lives at the scene root; check for a Text node containing "failed" or "error").
    const toastVisible = await page.evaluate(() => {
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
    });
    expect(toastVisible, 'error toast must be visible after a 500 from POST /api/me/reset').toBe(
      true,
    );

    await ctx.close();
  });
});
