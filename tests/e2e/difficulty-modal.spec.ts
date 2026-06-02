import { test, expect, type Page } from '@playwright/test';
import { seedAuthToken } from './helpers';

const URL = 'http://localhost:8090';

/**
 * EPIC #279 (#284) — DifficultyModal client UI (browser-side E2E).
 *
 * Server-side behaviour (PUT /api/difficulty math, /api/me exposing the tier) is
 * covered exhaustively in difficulty.spec.ts. This spec covers the CampScene UI:
 * the persistent Settings button, the three-tier modal, the highlighted current
 * tier, the PUT-on-select → close → stats-header-refresh flow, and outside-click
 * dismiss.
 *
 * The modal lives at the scene root (main-camera-ignored, rendered via uiCam), so
 * assertions read `window.__difficultyState` (the current/highlighted tier) and
 * the live Phaser text objects by name through `window.__scene`.
 */

/** Wait until CampScene has loaded /api/me and the camp hooks are wired. */
async function waitForCamp(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as any).__campState !== undefined &&
      typeof (window as any).__campOpenSettings === 'function',
    { timeout: 8000 },
  );
}

/** The live CampScene's main stat-line text (parked off-screen but always current). */
async function statLineText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
    return (scene.children.getByName('stat-line')?.text as string) ?? '';
  });
}

/**
 * Recursively search the scene's display list (including container descendants
 * such as uiRoot, where the Settings button lives) for a named object's text.
 * Returns null when not found. `children.getByName` only walks the root list, so
 * the Settings button — added to the uiRoot container — needs a deep walk.
 */
async function findNamedText(page: Page, name: string): Promise<string | null> {
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
      if (hit) return (hit.text as string) ?? '';
    }
    return null;
  }, name);
}

test.describe('difficulty modal (#284)', () => {
  test('Settings button is visible in the camp', async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    const label = await findNamedText(page, 'settings-btn');
    expect(label).toContain('Settings');
    await ctx.close();
  });

  test('clicking Settings opens the modal with three tiers, current tier highlighted', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    // A freshly minted player defaults to 'seeker' (see difficulty.spec.ts).
    const current = await page.evaluate(() => (window as any).__campState?.difficulty);
    expect(current).toBe('seeker');

    await page.evaluate(() => (window as any).__campOpenSettings());
    await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
      timeout: 5000,
    });

    const state = await page.evaluate(() => (window as any).__difficultyState);
    expect(state.tiers).toEqual(['wanderer', 'seeker', 'ascendant']);
    expect(state.current).toBe('seeker');

    // The current tier's row label carries the "(current)" marker.
    const seekerLabel = await findNamedText(page, 'difficulty-label-seeker');
    expect(seekerLabel).toContain('Seeker');
    expect(seekerLabel).toContain('(current)');
    const wandererLabel = await findNamedText(page, 'difficulty-label-wanderer');
    expect(wandererLabel).not.toContain('(current)');
    await ctx.close();
  });

  test('selecting Wanderer PUTs the tier, closes the modal, and updates the stats header', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();

    // Watch for the PUT /api/difficulty request fired by the modal.
    const putPromise = page.waitForRequest(
      (req) => req.url().endsWith('/api/difficulty') && req.method() === 'PUT',
      { timeout: 8000 },
    );

    await page.goto(URL);
    await waitForCamp(page);

    await page.evaluate(() => (window as any).__campOpenSettings());
    await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
      timeout: 5000,
    });

    // Click the Wanderer card (deterministic — same path as a pointer tap).
    await page.evaluate(() => {
      const scene = (window as any).__scene as { children: { getAll: () => any[] } };
      const walk = (obj: any): any => {
        if (obj?.name === 'difficulty-card-wanderer') return obj;
        const kids: any[] = typeof obj?.getAll === 'function' ? obj.getAll() : [];
        for (const k of kids) {
          const hit = walk(k);
          if (hit) return hit;
        }
        return null;
      };
      for (const root of scene.children.getAll()) {
        const card = walk(root);
        if (card) {
          card.emit('pointerdown');
          return;
        }
      }
    });

    const put = await putPromise;
    expect(JSON.parse(put.postData() ?? '{}')).toEqual({ tier: 'wanderer' });

    // Modal closes (state cleared) and the new tier lands in __campState.
    await page.waitForFunction(() => (window as any).__difficultyState === undefined, {
      timeout: 5000,
    });
    await page.waitForFunction(
      () => (window as any).__campState?.difficulty === 'wanderer',
      { timeout: 5000 },
    );

    // Stats header re-rendered with the bracketed Wanderer label.
    const line = await statLineText(page);
    expect(line).toContain('[Wanderer]');
    await ctx.close();
  });

  test('re-opening the modal highlights the newly-selected tier', async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    // Switch to Wanderer through the modal.
    await page.evaluate(() => (window as any).__campOpenSettings());
    await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
      timeout: 5000,
    });
    await page.evaluate(() => {
      const scene = (window as any).__scene as { children: { getAll: () => any[] } };
      const walk = (obj: any): any => {
        if (obj?.name === 'difficulty-card-wanderer') return obj;
        const kids: any[] = typeof obj?.getAll === 'function' ? obj.getAll() : [];
        for (const k of kids) {
          const hit = walk(k);
          if (hit) return hit;
        }
        return null;
      };
      for (const root of scene.children.getAll()) {
        const card = walk(root);
        if (card) return card.emit('pointerdown');
      }
    });
    await page.waitForFunction(
      () => (window as any).__campState?.difficulty === 'wanderer',
      { timeout: 5000 },
    );

    // Re-open: Wanderer is now the highlighted current tier.
    await page.evaluate(() => (window as any).__campOpenSettings());
    await page.waitForFunction(
      () => (window as any).__difficultyState?.current === 'wanderer',
      { timeout: 5000 },
    );
    const wandererLabel = await findNamedText(page, 'difficulty-label-wanderer');
    expect(wandererLabel).toContain('(current)');
    const seekerLabel = await findNamedText(page, 'difficulty-label-seeker');
    expect(seekerLabel).not.toContain('(current)');
    await ctx.close();
  });

  test('clicking the backdrop closes the modal with no tier change', async ({ browser }) => {
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await page.goto(URL);
    await waitForCamp(page);

    const before = await page.evaluate(() => (window as any).__campState?.difficulty);

    await page.evaluate(() => (window as any).__campOpenSettings());
    await page.waitForFunction(() => (window as any).__difficultyState !== undefined, {
      timeout: 5000,
    });

    // Click the dimmed backdrop (outside the panel) → dismiss, no PUT.
    await page.evaluate(() => {
      const scene = (window as any).__scene as { children: { getAll: () => any[] } };
      const walk = (obj: any): any => {
        if (obj?.name === 'difficulty-backdrop') return obj;
        const kids: any[] = typeof obj?.getAll === 'function' ? obj.getAll() : [];
        for (const k of kids) {
          const hit = walk(k);
          if (hit) return hit;
        }
        return null;
      };
      for (const root of scene.children.getAll()) {
        const bd = walk(root);
        if (bd) return bd.emit('pointerdown');
      }
    });

    await page.waitForFunction(() => (window as any).__difficultyState === undefined, {
      timeout: 5000,
    });
    const after = await page.evaluate(() => (window as any).__campState?.difficulty);
    expect(after).toBe(before);
    await ctx.close();
  });
});
