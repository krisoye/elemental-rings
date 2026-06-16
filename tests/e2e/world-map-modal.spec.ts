/**
 * E2E validation for GitHub issue #334 — World Map modal: fit-to-viewport +
 * zoom/pan.
 *
 * Four scenarios:
 *   1. Legend row and "Press M to close" hint are within canvas bounds (y < 576).
 *   2. Extremity node label bounding box is fully on-screen at default fit zoom.
 *   3. Zoom-in then corner-drag is pan-clamped; press 0 resets to fit.
 *   4. Close + reopen resets to fit zoom with no leftover pan offset.
 *
 * Probe-confirmed facts (from world-map-probe.spec.ts diagnostics):
 *   - window.__scene.overworldMap is accessible at JS runtime (TS private is
 *     not enforced at runtime).
 *   - currentScale, panX, panY are all accessible on the modal instance.
 *   - container.list has all HUD children with absolute screen-space coords.
 *   - mapContainer.list has node-label children in content-local coords.
 *   - mapContainer.(x,y) = (MAP_AREA_SCREEN_X + panX, MAP_AREA_SCREEN_Y + panY).
 *   - MAP_AREA_SCREEN_X = 14; MAP_AREA_SCREEN_Y = 72.
 *   - Zoom via keyboard requires key 'Equal' (= sign, keyCode 187) not '+'.
 *     Playwright's keyboard.press('+') sends key="+" which causes a spurious
 *     scene stop (via Playwright's key dispatch interacting with the browser's
 *     keyboard handling). Use page.evaluate to call applyZoom() directly.
 *   - Edge transitions must be suppressed: player must be positioned away from
 *     map edges before opening the modal, otherwise checkEdgeTransition() may
 *     fire and stop the scene during the test.
 *
 * Canvas: 1024 × 576.
 */

import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page, BrowserContext } from '@playwright/test';

const URL = 'http://localhost:8090';

// ── Layout constants (mirrors OverworldMapModal.ts) ──────────────────────────
const CANVAS_W = 1024;
const CANVAS_H = 576;
const MAP_AREA_SCREEN_X = 14;   // PANEL_X(12) + 2
const MAP_AREA_SCREEN_Y = 72;   // PANEL_Y(12) + TITLE_STRIP_H(38) + CTRL_STRIP_H(22)

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setupPage(browser: import('@playwright/test').Browser): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  return { page, ctx };
}

/**
 * Enter forest_glade and position the player at the zone center (far from edges),
 * then suppress edge transitions so the map tests don't race a spurious transition.
 * The player must be > EDGE (24px) from the map edges; zone center is always safe.
 */
async function enterForestSafe(page: Page): Promise<void> {
  await enterForestScreen(page, 'forest_glade');
  // Position player at the glade zone center (the anchorage center), which is
  // well away from map edges. zoneCenters is populated by enterForestScreen.
  await page.waitForFunction(() => !!(window as any).__zoneCenters?.forest_glade, { timeout: 5000 });
  await page.evaluate(() => {
    const center = (window as any).__zoneCenters?.forest_glade;
    if (center) (window as any).__player?.setPosition(center.x, center.y);
    // Suppress edge transitions explicitly so no spurious scene stop fires.
    // Install a watchdog interval that keeps re-applying the suppression flag so
    // it survives any internal reset during loadWaystones or other async paths.
    const scene = (window as any).__scene;
    if (scene) scene.suppressEdgeTransitions = true;
    (window as any).__suppressEdgeWatchdog = setInterval(() => {
      const s = (window as any).__scene;
      if (s && !s.suppressEdgeTransitions) s.suppressEdgeTransitions = true;
    }, 16); // every frame (~60fps)
  });
  // Wait a frame to let any pending input settle (the game loop may still be
  // processing touch input that was in flight when enterForestScreen fired).
  await page.waitForTimeout(100);
}

/**
 * Stop the edge-transition suppression watchdog installed by enterForestSafe().
 * Call this when the test is done to avoid interfering with scene teardown.
 */
async function stopEdgeWatchdog(page: Page): Promise<void> {
  await page.evaluate(() => {
    if ((window as any).__suppressEdgeWatchdog) {
      clearInterval((window as any).__suppressEdgeWatchdog);
      (window as any).__suppressEdgeWatchdog = null;
    }
  });
}

/**
 * Open the map modal by pressing M and wait until overworldMap is set on the scene.
 * window.__scene.overworldMap is set to a non-null OverworldMapModal when open
 * and to null when closed (BaseBiomeScene.toggleOverworldMap).
 */
async function openMap(page: Page): Promise<void> {
  await page.keyboard.press('m');
  await page.waitForFunction(
    () => !!(window as any).__scene?.overworldMap,
    { timeout: 5000 },
  );
}

/**
 * Close the map modal. Calls hide() directly on the modal instance to avoid
 * keyboard dispatch timing issues, then waits for overworldMap to clear.
 */
async function closeMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const modal = (window as any).__scene?.overworldMap;
    if (modal) modal.hide();
  });
  await page.waitForFunction(
    () => !(window as any).__scene?.overworldMap,
    { timeout: 5000 },
  );
}

/** Read the modal's current zoom scale (undefined if modal is closed). */
async function readZoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__scene?.overworldMap?.currentScale);
}

/** Read the modal's current pan offset. */
async function readPan(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({
    x: (window as any).__scene?.overworldMap?.panX,
    y: (window as any).__scene?.overworldMap?.panY,
  }));
}

/**
 * Apply zoom by calling applyZoom() directly on the modal (bypasses keyboard
 * dispatch). This avoids the Playwright key-event quirk where keyboard.press('+')
 * causes an unintended scene stop.
 */
async function applyZoom(page: Page, newScale: number): Promise<void> {
  await page.evaluate((s) => {
    const modal = (window as any).__scene?.overworldMap;
    if (modal && typeof modal.applyZoom === 'function') modal.applyZoom(s);
  }, newScale);
}

// ── Scenario 1: Legend row and close-hint are within canvas bounds ────────────

test('world-map S1: legend row and close-hint are within canvas bounds', async ({ browser }) => {
  const { page, ctx } = await setupPage(browser);
  await enterForestSafe(page);
  await openMap(page);

  const bounds = await page.evaluate((canvasH) => {
    const modal = (window as any).__scene?.overworldMap;
    if (!modal?.container) return null;
    const results: Array<{ label: string; y: number; bottom: number }> = [];
    for (const child of (modal.container.list ?? [])) {
      if (typeof child?.text !== 'string') continue;
      const text: string = child.text;
      if (text.includes('Press M to close')) {
        // setOrigin(1,1): child.y is the bottom edge's y coordinate in screen space.
        results.push({ label: 'close-hint', y: child.y, bottom: child.y });
      }
      // Legend labels: 'Safe', 'D1', etc. — default top-left origin.
      if (text === 'Safe' || text === 'D1' || text === 'D2') {
        results.push({
          label: `legend-${text}`,
          y: child.y,
          bottom: child.y + (child.height ?? 0),
        });
      }
    }
    return results;
  }, CANVAS_H);

  expect(bounds).not.toBeNull();
  expect(bounds!.length).toBeGreaterThan(0);

  for (const item of bounds!) {
    expect(item.y, `${item.label} top edge must be ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(item.bottom, `${item.label} bottom edge must be < ${CANVAS_H}`).toBeLessThan(CANVAS_H);
  }

  await stopEdgeWatchdog(page);
  await ctx.close();
});

// ── Scenario 2: Extremity node label is fully on-screen at fit zoom ──────────

test('world-map S2: extremity node label is fully on-screen at fit zoom', async ({ browser }) => {
  const { page, ctx } = await setupPage(browser);

  // The extremity screens by (col, row):
  //   MAX_COL = 5 → forest_thornado_shrine (coord {x:5, y:0} → col=5, row=0)
  //   MAX_ROW = 5 → forest_briar_thicket (coord {x:4, y:-5} → col=4, row=5)
  // We test forest_thornado_shrine (the rightmost node) from any forest screen.
  await enterForestSafe(page);
  await openMap(page);

  const nodeBounds = await page.evaluate(
    ([cW, cH]) => {
      const modal = (window as any).__scene?.overworldMap;
      if (!modal?.mapContainer) return { found: null, allTexts: null, error: 'no mapContainer' };
      const mc = modal.mapContainer;
      const scale = mc.scaleX as number;
      const mcX = mc.x as number;
      const mcY = mc.y as number;

      interface NodeBound {
        label: string;
        screenX: number;
        screenY: number;
        screenRight: number;
        screenBottom: number;
      }
      // Look for the Thornado Shrine (col=5, rightmost) or Briar Thicket (row=5, bottommost)
      const extremitySubstrings = ['Thornado', 'Briar\nThicket', 'Briar Thicket', 'Briar'];
      const found: NodeBound[] = [];

      for (const child of (mc.list ?? [])) {
        if (typeof child?.text !== 'string') continue;
        const text: string = child.text;
        if (!extremitySubstrings.some((t) => text.includes(t))) continue;
        // Only include node labels (not boss glyphs which have short text like '⚔')
        if (text.length < 4) continue;

        // Text is in content-local coords; origin (0.5, 0.5) set in modal code.
        const tw = (child.width ?? 0) * scale;
        const th = (child.height ?? 0) * scale;
        const screenX = mcX + (child.x as number) * scale - tw / 2;
        const screenY = mcY + (child.y as number) * scale - th / 2;
        found.push({
          label: text.replace('\n', '\\n'),
          screenX,
          screenY,
          screenRight: screenX + tw,
          screenBottom: screenY + th,
        });
      }

      if (found.length === 0) {
        const allTexts = (mc.list ?? [])
          .filter((c: any) => typeof c?.text === 'string')
          .map((c: any) => ({ text: c.text, x: c.x, y: c.y }));
        return { found: null, allTexts };
      }
      return { found, allTexts: null };
    },
    [CANVAS_W, CANVAS_H] as const,
  );

  expect(nodeBounds).not.toBeNull();
  expect(nodeBounds!.found, `No extremity labels found. All text: ${JSON.stringify(nodeBounds!.allTexts)}`).not.toBeNull();

  for (const nb of nodeBounds!.found!) {
    expect(nb.screenX, `${nb.label}: left edge x >= 0`).toBeGreaterThanOrEqual(0);
    expect(nb.screenY, `${nb.label}: top edge y >= 0`).toBeGreaterThanOrEqual(0);
    expect(nb.screenRight, `${nb.label}: right edge x <= ${CANVAS_W}`).toBeLessThanOrEqual(CANVAS_W);
    expect(nb.screenBottom, `${nb.label}: bottom edge y <= ${CANVAS_H}`).toBeLessThanOrEqual(CANVAS_H);
  }

  await stopEdgeWatchdog(page);
  await ctx.close();
});

// ── Scenario 3: Zoom-in pan is clamped; reset-0 returns to fit zoom ──────────

test('world-map S3: zoom-in pan is clamped; reset-0 returns to fit zoom', async ({ browser }) => {
  const { page, ctx } = await setupPage(browser);
  await enterForestSafe(page);
  await openMap(page);

  // Execute ALL zoom/pan/reset operations in a single synchronous evaluate block.
  // This avoids races where the game loop fires a scene transition between evaluate
  // calls. All state reads and writes happen atomically within one microtask.
  const result = await page.evaluate(() => {
    const modal = (window as any).__scene?.overworldMap;
    if (!modal || typeof modal.applyZoom !== 'function') {
      return { error: `modal=${modal ? 'exists' : 'null'}, applyZoom=${typeof modal?.applyZoom}` };
    }

    const openZoom = modal.currentScale; // #438: opens at OPEN_ZOOM (player-centered), not FIT_SCALE
    if (!openZoom || openZoom <= 0) return { error: `openZoom=${openZoom}` };
    // #438: __FIT_SCALE is the full-fit constant (what the 0-key resets to).
    // It is distinct from OPEN_ZOOM which is the player-centered open scale.
    const trueFitScale = (window as any).__FIT_SCALE ?? openZoom;

    // ── Zoom in 1.2x from open zoom ───────────────────────────────────────────
    const zoomedScale = openZoom * 1.2;
    modal.applyZoom(zoomedScale);
    const afterZoomScale = modal.currentScale;

    // ── Extreme pan (past content bounds) ─────────────────────────────────────
    // Directly set pan then re-apply via applyZoom to trigger clampPan.
    modal.panX = -9999;
    modal.panY = -9999;
    modal.applyZoom(modal.currentScale); // same scale, just re-clamps pan
    const mc = modal.mapContainer;
    const mcYAfterPan = mc ? (mc.y as number) : null;
    const panYAfterPan = modal.panY;

    // ── Full-fit reset (0-key / reset button) ─────────────────────────────────
    // #438: reset-0 still calls applyZoom(FIT_SCALE), not applyZoom(OPEN_ZOOM).
    modal.applyZoom(trueFitScale); // returns to full-fit scale, zeroes pan, re-clamps
    const resetScale = modal.currentScale;
    const resetPanX = modal.panX;
    const resetPanY = modal.panY;
    const mcYAfterReset = mc ? (mc.y as number) : null;

    return {
      openZoom,
      trueFitScale,
      afterZoomScale,
      mcYAfterPan,
      panYAfterPan,
      resetScale,
      resetPanX,
      resetPanY,
      mcYAfterReset,
      modalStillOpen: !!(window as any).__scene?.overworldMap,
    };
  });

  expect(result).not.toHaveProperty('error');
  const r = result as any;

  // #438: open scale is OPEN_ZOOM (>= FIT_SCALE); zoom-in must go above that
  expect(r.afterZoomScale).toBeGreaterThan(r.openZoom);

  // After extreme pan + re-clamp, the container Y must not exceed MAP_AREA_SCREEN_Y
  // (no empty gap at the top). MAP_AREA_SCREEN_Y = 72.
  // mc.y = MAP_AREA_SCREEN_Y + panY. With panY clamped to minY (negative), mc.y < 72.
  if (r.mcYAfterPan !== null) {
    expect(r.mcYAfterPan).toBeLessThanOrEqual(72 + 1); // +1 float tolerance
  }

  // After full-fit reset (0-key), scale returns to FIT_SCALE (not OPEN_ZOOM)
  expect(Math.abs(r.resetScale - r.trueFitScale)).toBeLessThan(0.001);

  // After full-fit reset, pan is centered (>= 0) — at FIT_SCALE content fits the area
  expect(r.resetPanX).toBeGreaterThanOrEqual(0);
  expect(r.resetPanY).toBeGreaterThanOrEqual(0);

  // Modal stayed open throughout
  expect(r.modalStillOpen).toBe(true);

  await stopEdgeWatchdog(page);
  await ctx.close();
});

// ── Scenario 4: Reopen resets fit zoom and clears pan offset ─────────────────

test('world-map S4: reopen resets fit zoom and clears pan from previous session', async ({ browser }) => {
  const { page, ctx } = await setupPage(browser);
  await enterForestSafe(page);

  // First open — use M key (reliable for first open; no prior DOM destruction).
  await openMap(page);

  // Perform ALL of: zoom/pan the first session, close, reopen, and verify — in a SINGLE
  // page.evaluate so the Phaser game loop cannot fire a scene transition between
  // Playwright↔browser round trips.
  //
  // Between every two Playwright messages (waitForFunction → evaluate, evaluate → evaluate)
  // requestAnimationFrame fires and update() runs. A spurious edge-transition (the player
  // spawns at x=24 = EDGE in forest_glade before loadWaystones repositions them) can
  // change window.__scene in that gap, making the next read return null.
  //
  // Fusing close + reopen + verify into one synchronous JS task eliminates every such
  // race window.  TypeScript private access is not enforced at runtime.
  const result = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const modal = scene?.overworldMap;
    if (!modal || typeof modal.applyZoom !== 'function') {
      return { error: 'no-modal' };
    }

    // ── First session: zoom in + pan ──────────────────────────────────────────
    const openZoom = modal.currentScale as number; // OPEN_ZOOM set by show()
    if (!openZoom || openZoom <= 0) return { error: 'bad-scale' };

    modal.applyZoom(openZoom * 1.2);
    const scaleAfterZoom = modal.currentScale as number;

    modal.panY = -50;
    modal.applyZoom(modal.currentScale); // re-clamp
    const panYAfterPan = modal.panY as number;

    // ── Atomic close + reopen ─────────────────────────────────────────────────
    // hide() fires onClose() synchronously → scene.overworldMap = null.
    modal.hide();

    // toggleOverworldMap: sees overworldMap null, overlayOpen false → creates new
    // OverworldMapModal and calls show(), which resets currentScale = OPEN_ZOOM
    // and re-centers panX/panY.
    scene.toggleOverworldMap();

    // ── Verify reopened state ─────────────────────────────────────────────────
    const reopened = scene.overworldMap;
    if (!reopened) return { error: 'reopen-failed' };

    return {
      openZoom,
      scaleAfterZoom,
      panYAfterPan,
      reopenedScale: reopened.currentScale as number,
      reopenedPanX:  reopened.panX as number,
      reopenedPanY:  reopened.panY as number,
      // #438: __OPEN_ZOOM is exposed by show(); used as the authoritative baseline.
      expectedScale: (window as any).__OPEN_ZOOM as number | undefined,
    };
  });

  // First-session zoom check
  expect(result).not.toHaveProperty('error');
  const r = result as Exclude<typeof result, { error: string }>;
  expect(r.scaleAfterZoom).toBeGreaterThan(r.openZoom);

  // #438: show() resets currentScale to OPEN_ZOOM on every open — the 1.2× zoom
  // from session 1 must be gone.
  const expectedOpenZoom = r.expectedScale ?? r.openZoom;
  expect(Math.abs(r.reopenedScale - expectedOpenZoom)).toBeLessThan(0.001);

  // Pan must be within sane map-area bounds.
  // At OPEN_ZOOM the content can extend beyond the viewport vertically (content
  // height > MAP_AREA_H), so panY is clamped to [MAP_AREA_H − scaledH, 0] which
  // is legitimately negative.  The scale assertion above (≈ OPEN_ZOOM, not 1.2×)
  // is the primary proof that show() reset the modal state on reopen.
  expect(Math.abs(r.reopenedPanX)).toBeLessThan(CANVAS_W);
  expect(Math.abs(r.reopenedPanY)).toBeLessThan(CANVAS_H);

  await stopEdgeWatchdog(page);
  await ctx.close();
});
