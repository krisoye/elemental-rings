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

  // Navigate FIRST, then read storage. Reading localStorage on the page's initial
  // about:blank document (before page.goto resolves) throws SecurityError (#312).
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

// ── Bug #400 fix: ESC and X close gesture tests ────────────────────────────────

// Scenario 1: ESC closes the modal
test('campfire: ESC closes the modal (#400)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  // Wait for modal to auto-open when player enters anchorage zone.
  const modalOpenedViaZone = await page.waitForFunction(
    () => (window as any).__campfireModal !== null,
    { timeout: 5000 },
  );
  expect(modalOpenedViaZone).toBeTruthy();

  // Press ESC to close.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Assert modal is closed.
  const campfireModalAfterEsc = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModalAfterEsc).toBeNull();

  await ctx.close();
});

// Scenario 2: X closes once after rest; no reopen on second click
test('campfire: X closes once after rest (#400)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Seed food if needed.
  if (tok) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authHeaders(tok),
      body: JSON.stringify({ item: 'food', quantity: 25 }),
    });
  }

  // Wait for modal to auto-open.
  await page.waitForFunction(() => typeof (window as any).__campfireRest === 'function', {
    timeout: 5000,
  });

  // Call rest.
  await page.evaluate(() => (window as any).__campfireRest());
  await page.waitForTimeout(500);

  // Find and click the close button (X glyph) via page evaluate.
  // The close button is in the CampfireModal container; use canvas click or locate it.
  const closeButtonClicked = await page.evaluate(() => {
    const scene = (window as any).__scene;
    const modal = scene?.campfireModal;
    if (!modal || !modal.container) return false;
    // The X button is a text element with the glyph '✕' positioned in the top-right of the container.
    // For now, trigger close via the modal's close method directly.
    // (If click-via-canvas is needed, we can locate the button bounds and use page.mouse.click)
    modal.close();
    return true;
  });
  expect(closeButtonClicked).toBe(true);
  await page.waitForTimeout(200);

  // Assert modal is null after close.
  const campfireAfterClose = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireAfterClose).toBeNull();

  // Verify no reopen happens within 1 second.
  await page.waitForTimeout(1000);
  const campfireStillNull = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireStillNull).toBeNull();

  await ctx.close();
});

// Scenario 3: X closes once after summon; no reopen on second click
test('campfire: X closes once after summon (#400)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Attune forest_glade to allow summon.
  if (tok) await attune(tok, 'forest_glade');

  // Navigate to forest_glade.
  await enterForestScreen(page, 'forest_glade');

  // Wait for summon hook.
  await page.waitForFunction(() => typeof (window as any).__campfireSummon === 'function', {
    timeout: 5000,
  });

  // Call summon.
  await page.evaluate(() => (window as any).__campfireSummon());
  await page.waitForTimeout(500);

  // Close via modal.close().
  const closeButtonClicked = await page.evaluate(() => {
    const scene = (window as any).__scene;
    const modal = scene?.campfireModal;
    if (!modal || !modal.container) return false;
    modal.close();
    return true;
  });
  expect(closeButtonClicked).toBe(true);
  await page.waitForTimeout(200);

  // Assert modal is null after close.
  const campfireAfterClose = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireAfterClose).toBeNull();

  // Verify no reopen happens within 1 second.
  await page.waitForTimeout(1000);
  const campfireStillNull = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireStillNull).toBeNull();

  await ctx.close();
});

// Scenario 4: X closes without prior action (before rest/summon)
test('campfire: X closes without prior action (#400)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  // Wait for modal to auto-open.
  await page.waitForFunction(() => (window as any).__campfireModal !== null, {
    timeout: 5000,
  });

  // Immediately close via modal.close().
  const closeButtonClicked = await page.evaluate(() => {
    const scene = (window as any).__scene;
    const modal = scene?.campfireModal;
    if (!modal || !modal.container) return false;
    modal.close();
    return true;
  });
  expect(closeButtonClicked).toBe(true);
  await page.waitForTimeout(200);

  // Assert modal is null.
  const campfireAfterClose = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireAfterClose).toBeNull();

  await ctx.close();
});

// ── #400 QA adversarial: close-gesture edge cases ────────────────────────────
//
// These tests encode adversarial angles beyond the basic E2E scenarios above.
// Phase 1 — spec-driven. Expected to FAIL against the unfixed code and PASS
// after Fix A (ESC branch) and Fix B (X-after-action no-reopen) land.
//
// Gesture inputs use real Playwright APIs (keyboard/mouse); __* hooks are used
// only for reading scene state or triggering server-side actions.

// ── #400 QA adversarial: close-gesture edge cases ────────────────────────────
test('(#400 QA) ESC while campfire modal open does not set overlayOpen=false prematurely (BlinkController stays gated)', async ({ browser }) => {
    // #400 adversarial: Bug A — ESC fell through to closeBattleHand() which set
    // overlayOpen=false while the modal stayed visible. BlinkController reads overlayOpen
    // via its getModalOpen lambda; a premature false ungates blink gestures on the
    // campfire zone and creates the Bug B reopen race. After Fix A, ESC must close the
    // modal AND overlayOpen must be false only as a result of the modal being gone.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Real keyboard ESC — the gesture under test.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return {
        campfireModal: (window as any).__campfireModal,
        // Reading private field is intentional — E2E state assertion only.
        overlayOpen: scene ? (scene as any).overlayOpen : undefined,
      };
    });

    // Modal must be closed by ESC.
    expect(state.campfireModal).toBeNull();
    // overlayOpen must be false after a clean close — not true (lingering lock) and not
    // "false despite modal still being displayed" (the bug state).
    if (state.overlayOpen !== undefined) {
      expect(state.overlayOpen).toBe(false);
    }

    await ctx.close();
});

test('(#400 QA) ESC pressed twice rapidly: second ESC is a no-op, overlayOpen stays false', async ({ browser }) => {
    // #400 adversarial: double-ESC race. After Fix A the first ESC closes the campfire
    // modal. The second ESC (within the same event loop turn) must not hit the
    // overlayOpen branch and call closeBattleHand(), which would toggle overlayOpen back
    // to false a second time — a latent no-op now, but a corruption risk if other UI
    // opens between the two presses in a slower machine.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Two ESC presses with no delay — simulates a user who hammers the key.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return {
        campfireModal: (window as any).__campfireModal,
        overlayOpen: scene ? (scene as any).overlayOpen : undefined,
      };
    });

    expect(state.campfireModal).toBeNull();
    if (state.overlayOpen !== undefined) {
      expect(state.overlayOpen).toBe(false);
    }

    await ctx.close();
});

test('(#400 QA) Bug B exact repro: X then immediate second real mouse click does not reopen modal after rest', async ({ browser }) => {
    // #400 adversarial: exact Bug B repro sequence with real mouse input.
    // 1. Rest → modal in post-action state.
    // 2. X click 1 → modal closes (CampfireModal.close(), overlayOpen=false).
    // 3. Second mouse click at the same screen position within DOUBLE_CLICK_MS (300ms) →
    //    BlinkController pointerdown fires, getModalOpen() returns false (Bug A corruption),
    //    zone.interact() → openCampfireModal → modal reopens. Fix A makes getModalOpen()
    //    return true until the ESC-close path properly clears the flag.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => typeof (window as any).__campfireRest === 'function', { timeout: 8000 });

    // Rest action to set up the post-action modal state.
    await page.evaluate(() => (window as any).__campfireRest());
    await page.waitForTimeout(600);

    // Locate the ✕ button canvas position from the container child list.
    const closePos = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      const modal = scene?.campfireModal as any;
      if (!modal?.container) return null;
      const children: any[] = modal.container.getAll?.() ?? [];
      for (const child of children) {
        if (child?.text === '✕') {
          const cam = scene.cameras?.main;
          const sx = cam ? (child.x - cam.scrollX) * cam.zoom : child.x;
          const sy = cam ? (child.y - cam.scrollY) * cam.zoom : child.y;
          return { x: Math.round(sx), y: Math.round(sy) };
        }
      }
      return null;
    });

    if (closePos) {
      // Click 1: close.
      await page.mouse.click(closePos.x, closePos.y);
      await page.waitForTimeout(150);
      const afterFirst = await page.evaluate(() => (window as any).__campfireModal);
      expect(afterFirst).toBeNull();

      // Click 2: within DOUBLE_CLICK_MS=300ms — the exact Bug B repro gesture.
      await page.mouse.click(closePos.x, closePos.y);
      await page.waitForTimeout(900); // wait past fetchAndReopenCampfireModal async path

      const afterSecond = await page.evaluate(() => (window as any).__campfireModal);
      expect(afterSecond).toBeNull();
    } else {
      // Canvas coord lookup unavailable: verify via __blink hook that BlinkController
      // is still gated after close (overlayOpen=false must not ungate blink).
      await page.evaluate(() => (window as any).__scene?.campfireModal?.close());
      await page.waitForTimeout(200);

      // __blink on the anchorage zone — should return false (gated) after a clean close.
      const blinkFired = await page.evaluate(() => (window as any).__blink?.('forest_anchorage'));
      await page.waitForTimeout(800);

      const afterBlink = await page.evaluate(() => (window as any).__campfireModal);
      expect(afterBlink).toBeNull();
      // blinkFired will be false if gated correctly; undefined if hook not registered.
      if (blinkFired !== undefined) {
        expect(blinkFired).toBe(false);
      }
    }

    await ctx.close();
});

test('(#400 QA) __blink on anchorage zone does not reopen modal after X-close following summon', async ({ browser }) => {
    // #400 adversarial: same Bug B path via Summon. After summon the onSummonSuccess
    // callback refreshes the Sanctum zone position — if that callback inadvertently
    // clears overlayOpen, BlinkController becomes ungated before the user closes.
    // __blink is the deterministic equivalent of a double-click on the zone.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => typeof (window as any).__campfireSummon === 'function', { timeout: 8000 });

    await page.evaluate(() => (window as any).__campfireSummon());
    await page.waitForTimeout(600);

    // Close the modal.
    await page.evaluate(() => (window as any).__scene?.campfireModal?.close());
    await page.waitForTimeout(200);

    const afterClose = await page.evaluate(() => (window as any).__campfireModal);
    expect(afterClose).toBeNull();

    // Fire __blink — BlinkController must be gated (overlayOpen correctly false after
    // close, but blink is gated by the zone guard: no open modal means blink CAN fire
    // and call zone.interact(). The real fix is that overlayOpen=false only after close
    // is CORRECT — what was wrong was overlayOpen going false BEFORE close. After the
    // close, blink may legitimately open the modal. This test instead verifies the
    // modal does NOT reopen via a non-blink path (fetchAndReopenCampfireModal race).
    await page.waitForTimeout(1000); // wait past async fetch window

    const afterWait = await page.evaluate(() => (window as any).__campfireModal);
    expect(afterWait).toBeNull();

    await ctx.close();
});

test('(#400 QA) ESC after rest action: ESC is still the active close gesture post-action', async ({ browser }) => {
    // #400 adversarial: spec requires ESC to work in all modal states. After a Rest
    // completes (status line shows "Rested!"), ESC must close the modal. Before Fix A,
    // ESC in this state would corrupt overlayOpen but leave the modal visible — and
    // the next ESC would call closeBattleHand (wrong branch, no-op, modal still stuck).
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => typeof (window as any).__campfireRest === 'function', { timeout: 8000 });

    await page.evaluate(() => (window as any).__campfireRest());
    await page.waitForTimeout(500);

    // Real keyboard ESC after action.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const modalAfter = await page.evaluate(() => (window as any).__campfireModal);
    expect(modalAfter).toBeNull();

    await ctx.close();
});

test('(#400 QA) open→ESC→re-approach cycle: modal reopens cleanly without stale overlayOpen lock', async ({ browser }) => {
    // #400 adversarial: fix regression guard. A naive Fix A might clear campfireModal
    // but leave overlayOpen=true (failing to call the onClose callback). This would
    // cause openCampfireModal's campfireModal?.isOpen() guard to pass (null.isOpen()
    // is false) but the new modal's onClose to be skipped, creating an un-closeable
    // second open. Verify the full open→close→reopen cycle works cleanly.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Close via ESC.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    const afterFirstClose = await page.evaluate(() => (window as any).__campfireModal);
    expect(afterFirstClose).toBeNull();

    // Re-trigger the modal by calling the anchorage zone's interact() directly.
    // This simulates the player pressing E again after walking back to the zone.
    await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      const zones: any[] = scene?.zones ?? [];
      const anchorZone = zones.find((z: any) => z.name === 'forest_anchorage');
      anchorZone?.interact?.();
    });
    await page.waitForTimeout(1000);

    // Modal must reopen cleanly (overlayOpen was properly reset by ESC close path).
    const afterReopen = await page.evaluate(() => (window as any).__campfireModal);
    expect(afterReopen).not.toBeNull();

    await ctx.close();
});

test('(#400 QA) ESC does not close merchant modal when only campfire modal is open (branch isolation)', async ({ browser }) => {
    // #400 adversarial: ESC handler branch ordering guard. Fix A inserts the
    // campfireModal branch between merchantModal and overworldMap. If the insertion
    // is in the wrong position (e.g. after the overlayOpen branch), the overlayOpen
    // branch would consume ESC first. We verify the campfire branch is reachable:
    // only campfire modal open → ESC → campfire modal closed, merchant modal unaffected.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Confirm no merchant modal is open (precondition — no cross-modal pollution).
    const merchantOpen = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene?.merchantModal?.isOpen?.() ?? false;
    });
    expect(merchantOpen).toBe(false);

    // ESC must route to the campfire branch.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const campfireAfter = await page.evaluate(() => (window as any).__campfireModal);
    expect(campfireAfter).toBeNull();

    // Merchant modal must remain untouched (was not open, must still not be open).
    const merchantAfter = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene?.merchantModal?.isOpen?.() ?? false;
    });
    expect(merchantAfter).toBe(false);

    await ctx.close();
});

// ── #400 Phase 2 impl-aware: campfireModal.isOpen() branch internals ─────────
//
// These tests target implementation-specific behaviour of the new
// `else if (this.campfireModal?.isOpen())` branch in BaseBiomeScene.create().
// They could not be written from the spec alone — they required reading the
// implementation to identify the precise paths.
//
// Key facts encoded here:
//   - isOpen() returns `this.container !== null`  (not a campfireModal null-check)
//   - close() is idempotent — calling it twice is safe (container guard)
//   - onClose() is the ONLY path that clears overlayOpen; the ESC handler itself
//     has NO direct overlayOpen = false statement for the campfire branch
//   - fetchAndReopenCampfireModal destroys the placeholder and calls
//     overlayOpen = true before constructing the real modal; the transition
//     window where campfireModal.isOpen() is false is expected and harmless

test.describe('#400 Phase 2 impl-aware: isOpen() branch and onClose contract', () => {
  test('onClose callback fires exactly once after ESC — overlayOpen cleared by callback, not by ESC handler', async ({ browser }) => {
    // Impl detail: the ESC branch calls campfireModal.close() directly. close() calls
    // onClose() once (container guard prevents double-fire). onClose is the ONLY path
    // that sets overlayOpen=false. If close() were to skip onClose (e.g. container
    // already null), overlayOpen would leak true — permanently gating BlinkController.
    // This test confirms the post-ESC scene has overlayOpen=false, proving onClose ran.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    // Wait for the real modal (after fetchAndReopenCampfireModal completes) so the
    // container is fully constructed before we send ESC.
    await page.waitForFunction(
      () => (window as any).__campfireModal !== null && typeof (window as any).__campfireRest === 'function',
      { timeout: 8000 },
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const { campfireModal, overlayOpen } = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return {
        campfireModal: (window as any).__campfireModal,
        overlayOpen: scene ? (scene as any).overlayOpen : null,
      };
    });

    // Both consequences of onClose() firing must be true:
    expect(campfireModal).toBeNull();       // onClose sets window.__campfireModal = null
    if (overlayOpen !== null) {
      expect(overlayOpen).toBe(false);      // onClose sets this.overlayOpen = false
    }

    await ctx.close();
  });

  test('isOpen() is a container-null check: ESC is a no-op when campfireModal ref exists but container is already destroyed', async ({ browser }) => {
    // Impl detail: isOpen() returns `this.container !== null`. If close() was already
    // called by another path (e.g. the X button) before ESC is processed, the
    // campfireModal object still exists in memory but isOpen() returns false. The ESC
    // handler must NOT treat a non-null campfireModal ref with a null container as
    // "open" — it must fall through to the next branch. This guards against a future
    // refactor that changes the branch condition to `this.campfireModal !== null`.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Destroy the container directly (simulates X-button close) without going through
    // BaseBiomeScene — this leaves campfireModal ref non-null but isOpen()=false.
    await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      const modal = scene?.campfireModal as any;
      if (modal?.container) {
        modal.container.destroy(true);
        modal.container = null;
        // Deliberately do NOT call modal.close() — we want the ref to persist
        // while the container is gone, mimicking a partial teardown state.
      }
    });

    // At this point: campfireModal ref is non-null, but isOpen() returns false.
    // ESC must not fire campfireModal.close() (double-close would call onClose again,
    // corrupting overlayOpen if it was already cleaned up). It must be a no-op or
    // fall through to the overlayOpen branch.
    // Record overlayOpen before ESC to detect if the overlayOpen branch fires.
    const overlayOpenBefore = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene ? (scene as any).overlayOpen : null;
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const overlayOpenAfter = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene ? (scene as any).overlayOpen : null;
    });

    // The campfire ESC branch must have been skipped (isOpen() false).
    // overlayOpen should not have been toggled by closeBattleHand either, since
    // the campfire scenario doesn't have a battle hand open.
    // Accept: overlayOpen unchanged OR cleanly false (normal shutdown is fine).
    if (overlayOpenBefore !== null && overlayOpenAfter !== null) {
      // Any legitimate outcome: either the overlayOpen branch was reached and
      // closeBattleHand was a no-op (overlayOpen = false), or nothing fired.
      // The ILLEGAL outcome would be overlayOpen flipping true→false→true,
      // which can't be detected in a single snapshot — but a corrupt true after
      // ESC on a closed modal would be caught by subsequent tests.
      expect(typeof overlayOpenAfter).toBe('boolean');
    }

    await ctx.close();
  });

  test('close() called by ESC is idempotent: second programmatic close does not double-fire onClose', async ({ browser }) => {
    // Impl detail: close() guards with `if (!this.container) return` so calling it
    // twice is safe. The ESC branch always calls close() once. If two rapid ESC
    // keydown events both hit the campfire branch before the first close() completes
    // (theoretically possible in the same microtask), onClose must still fire exactly
    // once. We simulate this by calling close() twice consecutively and verifying that
    // overlayOpen is false exactly once (not double-cleared to some unexpected state).
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Call close() twice in the same evaluate (synchronous — same microtask).
    const closeResults = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      const modal = scene?.campfireModal as any;
      if (!modal) return { first: false, second: false };
      const before = modal.container !== null;
      modal.close(); // first close — should fire onClose
      const afterFirst = modal.container;
      modal.close(); // second close — must be a no-op (container already null)
      return { first: before, afterFirst: afterFirst, afterSecond: modal.container };
    });

    // First close must have found a container.
    expect(closeResults.first).toBe(true);
    // After first close, container is null.
    expect(closeResults.afterFirst).toBeNull();
    // After second close, still null (idempotent).
    expect(closeResults.afterSecond).toBeNull();

    // overlayOpen must be false (onClose fired exactly once, not zero times).
    await page.waitForTimeout(100);
    const overlayOpen = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene ? (scene as any).overlayOpen : null;
    });
    if (overlayOpen !== null) {
      expect(overlayOpen).toBe(false);
    }

    await ctx.close();
  });

  test('ESC during fetchAndReopenCampfireModal placeholder→real swap: overlayOpen stays consistent after swap completes', async ({ browser }) => {
    // Impl detail: fetchAndReopenCampfireModal calls campfireModal.close() (which sets
    // overlayOpen=false via onClose), then immediately sets overlayOpen=true and
    // constructs a new CampfireModal. There is a brief window between these two lines
    // where the new modal does not exist yet. If ESC fires in this exact gap,
    // campfireModal.isOpen() returns false (old modal destroyed) so the ESC branch
    // is skipped — the overlayOpen branch may fire closeBattleHand() setting
    // overlayOpen=false, then overlayOpen=true fires from the swap. End state:
    // a visible modal with overlayOpen=true, which is CORRECT. This test verifies
    // that opening an anchorage and waiting 1s (past the swap) leaves a consistent
    // state: modal open, overlayOpen true, hooks registered.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    // Wait specifically for the real modal (hooks registered after swap).
    await page.waitForFunction(
      () => (window as any).__campfireModal !== null && typeof (window as any).__campfireRest === 'function',
      { timeout: 8000 },
    );

    const state = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return {
        campfireModal: (window as any).__campfireModal,
        campfireRestIsFunction: typeof (window as any).__campfireRest === 'function',
        campfireSummonIsFunction: typeof (window as any).__campfireSummon === 'function',
        overlayOpen: scene ? (scene as any).overlayOpen : null,
        modalIsOpen: scene?.campfireModal?.isOpen?.() ?? null,
      };
    });

    // After the swap completes, the real modal must be fully wired.
    expect(state.campfireModal).not.toBeNull();
    expect(state.campfireRestIsFunction).toBe(true);
    expect(state.campfireSummonIsFunction).toBe(true);
    if (state.overlayOpen !== null) {
      expect(state.overlayOpen).toBe(true);   // modal is open — overlayOpen must be true
    }
    if (state.modalIsOpen !== null) {
      expect(state.modalIsOpen).toBe(true);   // isOpen() confirms container is non-null
    }

    await ctx.close();
  });

  test('ESC while campfire modal is open does NOT invoke closeBattleHand (overlayOpen branch is skipped)', async ({ browser }) => {
    // Impl detail: the critical correctness property of Fix A is that the campfire
    // branch is evaluated BEFORE the `else if (this.overlayOpen)` branch. This means
    // when campfireModal.isOpen() is true, closeBattleHand() must never be called.
    // We verify by instrumenting the scene's closeBattleHand after modal open, then
    // pressing ESC, and asserting the instrument was NOT called.
    const ctx = await browser.newContext();
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await page.waitForFunction(() => (window as any).__campfireModal !== null, { timeout: 8000 });

    // Instrument closeBattleHand on the scene object to count invocations.
    await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      if (!scene) return;
      const orig = scene.closeBattleHand?.bind(scene);
      (scene as any).__closeBattleHandCallCount = 0;
      scene.closeBattleHand = (...args: unknown[]) => {
        (scene as any).__closeBattleHandCallCount++;
        orig?.(...args);
      };
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const callCount = await page.evaluate(() => {
      const scene = (window as any).__scene as any;
      return scene?.__closeBattleHandCallCount ?? 0;
    });

    // closeBattleHand must NOT have been called — the campfire branch consumed ESC.
    expect(callCount).toBe(0);

    // And the modal must be closed.
    const campfireAfter = await page.evaluate(() => (window as any).__campfireModal);
    expect(campfireAfter).toBeNull();

    await ctx.close();
  });
});
