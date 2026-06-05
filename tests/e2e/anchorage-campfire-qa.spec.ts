/**
 * QA Phase 1 — adversarial / edge-case E2E tests for #417 (campfire close gestures).
 *
 * These tests are spec-driven (written before the implementation fix), covering
 * adversarial angles that the original 13-test suite never exercised because the
 * modal was never actually opened. They lock in correct close-gesture behavior and
 * probe interaction-state edges that the normal happy-path scenarios skip.
 *
 * MECHANICS (per #417 spec):
 *  - Open modal: position player on zone center from __zoneCenters, press real KeyE,
 *    wait for __campfireModal != null (loose check — covers both null and undefined)
 *  - Close gestures: real page.keyboard.press / page.mouse.click only
 *  - Hooks (__campfireRest, __campfireSummon, modal.close()) are NEVER called for
 *    the gesture under test; only for state inspection
 *
 * Canvas logical size: CANVAS_W=1024, CANVAS_H=576
 * ✕ button: px + width/2 - 18, py - height/2 + 16 = 512+210-18, 288-140+16 = (704, 164)
 */

import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page, BrowserContext } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// ── Shared setup helpers ──────────────────────────────────────────────────────

/** Navigate to forest_anchorage screen (waits for __zoneCenters to be published). */
async function waitForForest(page: Page, screenId: string): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, screenId);
}

/**
 * Position the player on the named campfire zone (read from __zoneCenters) then
 * press KeyE to open the campfire modal. Waits until __campfireModal != null
 * (loose — catches both null-initialized and undefined-initialized hook).
 *
 * #417 adversarial rationale: the original suite used `!== null` which resolves
 * immediately when __campfireModal is undefined, causing all downstream assertions
 * to run with no modal open. This helper uses the correct loose check.
 */
async function openCampfireModal(page: Page, zoneId: string): Promise<void> {
  // State-seed: move player body onto the campfire zone center so handleInteract()
  // fires activeZone.interact() when E is pressed. Hook use is OK for setup.
  await page.evaluate((id: string) => {
    const scene = (window as any).__scene as any;
    const centers = (window as any).__zoneCenters as Record<string, { x: number; y: number }>;
    const center = centers?.[id];
    if (!center) throw new Error(`zone "${id}" not found in __zoneCenters`);
    scene?.player?.setPosition?.(center.x, center.y);
  }, zoneId);

  // Let updateActiveZone() pick up the new position before the keypress.
  await page.waitForTimeout(100);

  // Real keyboard gesture — must go through Phaser input pipeline.
  await page.keyboard.press('KeyE');

  // #417: loose != null covers both null (initial) and undefined (never assigned).
  await page.waitForFunction(() => (window as any).__campfireModal != null, { timeout: 8000 });
}

/**
 * Scale logical canvas coordinates to physical screen coordinates.
 * Canvas logical size is always 1024×576; the Vite dev server may scale the canvas.
 */
async function canvasCoords(
  page: Page,
  logicalX: number,
  logicalY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas not found');
  const scaleX = box.width / 1024;
  const scaleY = box.height / 576;
  return { x: Math.round(box.x + logicalX * scaleX), y: Math.round(box.y + logicalY * scaleY) };
}

/** Buy food via API so the player can afford Rest (costs 25 food). */
async function seedFood(token: string, quantity = 30): Promise<void> {
  const res = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ item: 'food', quantity }),
  });
  if (!res.ok) throw new Error(`seedFood: buy failed (${res.status})`);
}

/** Set spirit to a given value via test API so Summon can succeed. */
async function setSpirit(token: string, spirit: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spirit }),
  });
  if (!res.ok) throw new Error(`setSpirit failed (${res.status})`);
}

// Anchorage zone id on the forest_anchorage screen.
// The Tiled `anchorage` object on forest_anchorage.json has waystoneId='forest_entry',
// so the campfire InteractionZone is named 'forest_entry' in __zoneCenters.
const ANCHORAGE_ZONE = 'forest_entry';

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('campfire close gestures — adversarial QA (#417)', () => {
  // ── Test 1: Double-ESC after close — must not throw or reopen ──────────────
  test('double-ESC after modal closed does not reopen or throw', async ({ browser }) => {
    // #417 adversarial: rapid second ESC after close hit overlayOpen bookkeeping
    // in the ESC handler; if the first ESC leaves stale state the second reopens
    // the modal or throws on null.container.destroy().
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await openCampfireModal(page, ANCHORAGE_ZONE);

    // First ESC — should close.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__campfireModal == null, { timeout: 5000 });

    // Capture any console errors from the second ESC.
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    // Second ESC — no modal open; must be a silent no-op.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Modal stays null and overlayOpen stays false.
    const state = await page.evaluate(() => ({
      modal: (window as any).__campfireModal,
      overlayOpen: (window as any).__scene?.overlayOpen ?? false,
    }));
    expect(state.modal, 'double-ESC must not reopen modal').toBeNull();
    // overlayOpen is a private field; proxy via scene's hook is unavailable, so
    // assert no console error instead (a throw would propagate as pageerror).
    expect(errors, 'double-ESC must not throw').toHaveLength(0);

    await ctx.close();
  });

  // ── Test 2: ESC when no modal is open — must be silent no-op ──────────────
  test('ESC on anchorage screen with no open modal is a silent no-op', async ({ browser }) => {
    // #417 adversarial: the ESC handler's else-if chain terminates at
    // `overlayOpen` (battle-hand). If it misreads state after a prior close,
    // pressing ESC could briefly close/toggle the battle-hand overlay or
    // fire a stale reference. Verify the handler exits cleanly on an idle screen.
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    // No modal has been opened; __campfireModal starts undefined/null.
    const before = await page.evaluate(() => (window as any).__campfireModal);
    expect(before == null, 'precondition: no modal before ESC').toBe(true);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => (window as any).__campfireModal);
    expect(after == null, 'ESC must not open modal when none existed').toBe(true);
    expect(errors, 'ESC on idle screen must not throw').toHaveLength(0);

    await ctx.close();
  });

  // ── Test 3: Click ✕ position when modal NOT open — must not ghost anything ─
  test('click at X position when modal not open does not ghost-open a modal', async ({ browser }) => {
    // #417 adversarial: the backdrop and close button are destroyed on close. If
    // the Phaser scene retains a stale interactive hitbox after destroy(), a click
    // at the former ✕ position could fire onClose() on a null container → throw.
    // Also guards against BlinkController reopening the modal via a stray POINTER_DOWN.
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    // Open then close cleanly first so we have destroyed objects on the scene.
    await openCampfireModal(page, ANCHORAGE_ZONE);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__campfireModal == null, { timeout: 5000 });

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Click at ✕ logical coords (704, 164) — modal is closed, no live hitbox.
    const coords = await canvasCoords(page, 704, 164);
    await page.mouse.click(coords.x, coords.y);
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      modal: (window as any).__campfireModal,
    }));
    expect(state.modal == null, 'stale X click must not ghost-open modal').toBe(true);
    expect(errors, 'stale X click must not throw').toHaveLength(0);

    await ctx.close();
  });

  // ── Test 4: Reopen after close must not wedge interaction state ────────────
  test('open via E → close via ESC → press E again → modal reopens correctly', async ({ browser }) => {
    // #417 adversarial: if close() leaves overlayOpen=true or campfireModal in a
    // non-null state, the re-open guard `if (this.campfireModal?.isOpen()) return`
    // silently swallows the second E press and the player is locked out of the
    // campfire for the session. This is the core wedge risk.
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    // First open/close cycle.
    await openCampfireModal(page, ANCHORAGE_ZONE);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__campfireModal == null, { timeout: 5000 });

    // Second open — must succeed (not be silently blocked by stale state).
    await openCampfireModal(page, ANCHORAGE_ZONE);

    const modal = await page.evaluate(() => (window as any).__campfireModal);
    expect(modal, 'modal must reopen after ESC close — stale overlayOpen must not block').not.toBeNull();

    await ctx.close();
  });

  // ── Test 5: Click outside panel while modal open — modal stays open ─────────
  test('click on backdrop (outside panel) while modal open does not close modal', async ({ browser }) => {
    // #417 adversarial: the backdrop rect is interactive (setInteractive()) but its
    // onClose is NOT wired — only the ✕ button and action buttons fire close. A
    // click anywhere on the backdrop that falls outside the panel should be absorbed
    // but NOT close the modal. If the backdrop accidentally fires onClose, the player
    // has no way to use Rest/Summon because any mis-click dismisses the modal.
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await openCampfireModal(page, ANCHORAGE_ZONE);

    // Click on the backdrop: top-left corner of canvas (logical 50, 50) — well
    // outside the panel which occupies (302,148)→(722,428) in logical coords.
    const coords = await canvasCoords(page, 50, 50);
    await page.mouse.click(coords.x, coords.y);
    await page.waitForTimeout(300);

    const modal = await page.evaluate(() => (window as any).__campfireModal);
    expect(modal, 'backdrop click must not close modal — only ✕ and gestures close it').not.toBeNull();

    await ctx.close();
  });

  // ── Test 6: Rapid double-click on ✕ must not throw ─────────────────────────
  test('rapid double-click on X button closes modal exactly once without throwing', async ({ browser }) => {
    // #417 adversarial: the first click calls close() → destroys container → sets
    // container=null. The second click (< 50ms later) lands on a destroyed Phaser
    // game object. If the pointerdown handler retained a reference to the destroyed
    // Text object, Phaser fires on a null scene reference → uncaught error. Also
    // guards against the second click triggering BlinkController to reopen the modal
    // (DOUBLE_CLICK_MS window), since the ✕ position overlaps no blink zone.
    const ctx: BrowserContext = await browser.newContext({ hasTouch: true });
    await seedAuthToken(ctx);
    const page = await ctx.newPage();
    await waitForForest(page, 'forest_anchorage');

    await openCampfireModal(page, ANCHORAGE_ZONE);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const coords = await canvasCoords(page, 704, 164);
    // Double-click at physical mouse speed — two clicks < DOUBLE_CLICK_MS apart.
    await page.mouse.dblclick(coords.x, coords.y);

    // Wait past the blink DOUBLE_CLICK_MS guard (300ms) to verify no reopen.
    await page.waitForTimeout(400);

    const modal = await page.evaluate(() => (window as any).__campfireModal);
    expect(modal, 'modal must be null after double-click on X').toBeNull();
    expect(errors, 'double-click on X must not throw').toHaveLength(0);

    await ctx.close();
  });
});
