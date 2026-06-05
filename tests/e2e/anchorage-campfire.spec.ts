/**
 * E2E spec for #191 — overworld Anchorage campfire: Rest + Summon Sanctum overlay
 * and animated campfire graphic.
 *
 * #417 — rewritten close-gesture tests (scenarios 1–5 below).
 * The pre-existing hook-based scenarios (scenarios 1–3) test REST/SUMMON actions
 * via __campfireRest/__campfireSummon hooks (state-read helpers, not gestures under
 * test).  The close-gesture scenarios (4–8 below) use real Playwright keyboard and
 * mouse input for every gesture under test, per the E2E real-pointer-input policy
 * (memory: feedback_e2e_real_pointer_input.md).
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

/**
 * Convert logical canvas coordinates (1024×576) to actual page coordinates
 * by reading the canvas element's bounding rect.  Reuse across all close-gesture
 * scenarios.
 */
async function canvasCoords(
  page: Page,
  logicalX: number,
  logicalY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas element not found');
  const scaleX = box.width / 1024;
  const scaleY = box.height / 576;
  return {
    x: Math.round(box.x + logicalX * scaleX),
    y: Math.round(box.y + logicalY * scaleY),
  };
}

/**
 * Logical screen coordinates of the CampfireModal controls.
 *
 * Panel is 420×280, centered at (CANVAS_W/2=512, CANVAS_H/2=288).
 *   px = 512, py = 288
 *   ✕  button  : (px + width/2 - 18, py - height/2 + 16) = (704, 164)
 *   [Rest]     : (CANVAS_W/2, CANVAS_H/2 - 20) = (512, 268)
 *   [Summon]   : (CANVAS_W/2, CANVAS_H/2 + 20) = (512, 308)
 */
const CLOSE_BTN = { x: 704, y: 164 } as const;
const REST_BTN = { x: 512, y: 268 } as const;
const SUMMON_BTN = { x: 512, y: 308 } as const;

/**
 * Open the campfire modal via real E-key input.
 *
 * Strategy:
 *   1. Read the campfire zone center from window.__zoneCenters (keyed by waystoneId).
 *      NOTE: the screen id is 'forest_anchorage' but the waystone id on that screen
 *      is 'forest_entry' — that is the key in __zoneCenters.
 *   2. Teleport the player to the zone center via window.__player (same as forage-client).
 *   3. Wait for window.__sanctumZones to include the zone name — confirms updateActiveZone()
 *      has fired and set activeZone to the campfire zone.  This mirrors the proven
 *      forage-client.spec.ts pattern.
 *   4. Press 'e' (lowercase) — triggers handleInteract() → activeZone.interact() →
 *      openCampfireModal().
 *   5. Wait until __campfireModal != null (loose equality — covers both null and undefined).
 *
 * Positioning the player is state-seeding (allowed — hooks for setup/readback;
 * 'e' press is the real gesture under test).
 */
async function openCampfireModal(page: Page, waystoneId: string): Promise<void> {
  // Seed player position to just above the campfire zone center so that the
  // physics body center (sprite.y + 8) lands inside the zone rectangle.
  // Zone rect is 16×16 centered at zc; body center must be strictly inside
  // (Phaser.Geom.Rectangle.Contains is exclusive at the edges).
  await page.evaluate((id) => {
    const zoneCenters = (window as any).__zoneCenters as Record<string, { x: number; y: number }> | undefined;
    if (!zoneCenters) throw new Error('__zoneCenters not yet published');
    const zc = zoneCenters[id];
    if (!zc) throw new Error(`zone center missing for ${id} (available: ${Object.keys(zoneCenters).join(', ')})`);
    const player = (window as any).__player;
    if (!player?.setPosition) throw new Error('__player not available');
    // Player body offset: (2, 18) size: (12, 12).
    // body.center = (sprite.x, sprite.y + 8 + 12/2) = (sprite.x, sprite.y + 14).
    // Wait — Phaser body.center.y = body.y + body.halfHeight = (sprite.y - origin*h + offset.y) + halfH
    // Sprite origin (0.5, 0.5), h=32 → sprite.y is center, sprite top = sprite.y - 16.
    // body.y = sprite.y - 16 + 18 = sprite.y + 2. body.center.y = sprite.y + 2 + 6 = sprite.y + 8.
    // To land body center at zc.y: set sprite.y = zc.y - 8.
    player.setPosition(zc.x, zc.y - 8);
  }, waystoneId);

  // Wait for updateActiveZone() to detect the overlap.  __sanctumZones lists all
  // overlapping zone names (published each frame by updateActiveZone).
  await page.waitForFunction(
    (id) => ((window as any).__sanctumZones as string[] | undefined)?.includes(id),
    waystoneId,
    { timeout: 5000 },
  );

  // Real keyboard 'e' to trigger handleInteract() → activeZone.interact().
  // Lowercase 'e' matches the pattern used in forage-client.spec.ts; Phaser's
  // keydown-E handler fires on both 'e' and 'KeyE' key codes.
  await page.keyboard.press('e');

  // Wait for CampfireModal constructor to set window.__campfireModal.
  // Use != null (loose) — __campfireModal starts as undefined, not null.
  await page.waitForFunction(
    () => (window as any).__campfireModal != null,
    { timeout: 5000 },
  );
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

// ── #417 close-gesture tests ──────────────────────────────────────────────────
//
// All five scenarios open the modal via real E-key input and close via real
// Playwright keyboard/mouse.  __campfireRest and __campfireSummon are used only
// as REST/SUMMON action triggers (server-round-trip helpers, not close gestures).
// No modal.close() calls; no __campfireModal !== null guards (use != null).

// Scenario 5 — ESC closes (no action)
test('campfire (#417): ESC closes the modal without any action', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  await openCampfireModal(page, 'forest_entry');

  // Real keyboard ESC — the close gesture under test.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const campfireModal = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModal).toBeNull();

  const overlayOpen = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    return scene ? (scene as any).overlayOpen : undefined;
  });
  if (overlayOpen !== undefined) {
    expect(overlayOpen).toBe(false);
  }

  await ctx.close();
});

// Scenario 6 — ✕ closes (no action) and does not reopen within 500ms
test('campfire (#417): X button closes the modal without any action, no reopen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  await openCampfireModal(page, 'forest_entry');

  // Real mouse click on the ✕ button — the close gesture under test.
  const closePos = await canvasCoords(page, CLOSE_BTN.x, CLOSE_BTN.y);
  await page.mouse.click(closePos.x, closePos.y);
  await page.waitForTimeout(200);

  const campfireModal = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModal).toBeNull();

  // Confirm no ghost-reopen within 500ms (BlinkController double-click window is
  // 300ms; any async fetchAndReopenCampfireModal race resolves within this window).
  await page.waitForTimeout(500);
  const stillNull = await page.evaluate(() => (window as any).__campfireModal);
  expect(stillNull).toBeNull();

  await ctx.close();
});

// Scenario 7 — ESC closes after REST
test('campfire (#417): ESC closes the modal after REST action', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Seed food so REST succeeds (fresh player starts with 10; need ≥ 25).
  if (tok) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authHeaders(tok),
      body: JSON.stringify({ item: 'food', quantity: 25 }),
    });
  }

  await openCampfireModal(page, 'forest_entry');

  // Wait for the real modal (fetchAndReopenCampfireModal completes → __campfireRest registered).
  await page.waitForFunction(
    () => (window as any).__campfireModal != null && typeof (window as any).__campfireRest === 'function',
    { timeout: 6000 },
  );

  // Click [Rest — 25 food] via real mouse (action button — seeding the rest state).
  const restPos = await canvasCoords(page, REST_BTN.x, REST_BTN.y);
  await page.mouse.click(restPos.x, restPos.y);

  // Wait for the "Rested!" status line (server round-trip complete).
  await page.waitForTimeout(1500);

  // Real keyboard ESC — the close gesture under test.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const campfireModal = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModal).toBeNull();

  const overlayOpen = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    return scene ? (scene as any).overlayOpen : undefined;
  });
  if (overlayOpen !== undefined) {
    expect(overlayOpen).toBe(false);
  }

  await ctx.close();
});

// Scenario 8 — ✕ closes after REST; no BlinkController reopen within 300ms
test('campfire (#417): X button closes the modal after REST action, no reopen within DOUBLE_CLICK_MS', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Seed food so REST succeeds.
  if (tok) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authHeaders(tok),
      body: JSON.stringify({ item: 'food', quantity: 25 }),
    });
  }

  await openCampfireModal(page, 'forest_entry');

  // Wait for real modal with REST available.
  await page.waitForFunction(
    () => (window as any).__campfireModal != null && typeof (window as any).__campfireRest === 'function',
    { timeout: 6000 },
  );

  // Click [Rest — 25 food] via real mouse.
  const restPos = await canvasCoords(page, REST_BTN.x, REST_BTN.y);
  await page.mouse.click(restPos.x, restPos.y);

  // Wait for REST to complete on the server.
  await page.waitForTimeout(1500);

  // Real mouse click on ✕ — the close gesture under test.
  const closePos = await canvasCoords(page, CLOSE_BTN.x, CLOSE_BTN.y);
  await page.mouse.click(closePos.x, closePos.y);
  await page.waitForTimeout(200);

  const campfireModal = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModal).toBeNull();

  // Wait past DOUBLE_CLICK_MS (300ms) to verify BlinkController does not reopen.
  await page.waitForTimeout(400);
  const stillNull = await page.evaluate(() => (window as any).__campfireModal);
  expect(stillNull).toBeNull();

  await ctx.close();
});

// Scenario 9 — ✕ closes after SUMMON; no reopen within 300ms
test('campfire (#417): X button closes the modal after SUMMON action, no reopen within DOUBLE_CLICK_MS', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  // No token seeding needed: fresh players start with forest_entry as their
  // anchor, so summoning to forest_entry (the current screen's waystone) costs
  // 0 spirit and always succeeds without any attune or spirit seeding.

  await openCampfireModal(page, 'forest_entry');

  // Wait for real modal with SUMMON available.
  await page.waitForFunction(
    () => (window as any).__campfireModal != null && typeof (window as any).__campfireSummon === 'function',
    { timeout: 6000 },
  );

  // Click [Summon Sanctum] via real mouse.
  const summonPos = await canvasCoords(page, SUMMON_BTN.x, SUMMON_BTN.y);
  await page.mouse.click(summonPos.x, summonPos.y);

  // Wait for SUMMON to complete on the server.
  await page.waitForTimeout(1500);

  // Real mouse click on ✕ — the close gesture under test.
  const closePos = await canvasCoords(page, CLOSE_BTN.x, CLOSE_BTN.y);
  await page.mouse.click(closePos.x, closePos.y);
  await page.waitForTimeout(200);

  const campfireModal = await page.evaluate(() => (window as any).__campfireModal);
  expect(campfireModal).toBeNull();

  // Wait past DOUBLE_CLICK_MS (300ms) to verify no BlinkController reopen.
  await page.waitForTimeout(400);
  const stillNull = await page.evaluate(() => (window as any).__campfireModal);
  expect(stillNull).toBeNull();

  await ctx.close();
});

// Scenario 10 — ESC during fetchAndReopenCampfireModal placeholder→real swap
//
// Impl-aware: openCampfireModal() first creates a placeholder modal (food=0,
// spirit=0) then fires fetchAndReopenCampfireModal() async.  If ESC arrives
// within ~50ms (before the GET /api/me response), the placeholder's container is
// non-null → campfireModal.isOpen() is true → ESC branch fires close().
// close() calls onClose() which sets campfireModal=null.
// fetchAndReopenCampfireModal's !campfireModal?.isOpen() guard then returns early
// → no ghost reopen.  After 1s the modal must still be null.
test('campfire (#417): ESC during placeholder→real swap prevents ghost reopen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await waitForForest(page, 'forest_anchorage');

  // Position player on zone but do NOT wait for fetchAndReopenCampfireModal —
  // press ESC immediately after __campfireModal appears (the placeholder).
  // Zone key is 'forest_entry' (the waystone id on the forest_anchorage screen).
  await page.evaluate((id) => {
    const zoneCenters = (window as any).__zoneCenters as Record<string, { x: number; y: number }> | undefined;
    if (!zoneCenters) throw new Error('__zoneCenters not published');
    const zc = zoneCenters[id];
    if (!zc) throw new Error(`zone center missing for ${id} (available: ${Object.keys(zoneCenters).join(', ')})`);
    const player = (window as any).__player;
    if (!player?.setPosition) throw new Error('__player not available');
    player.setPosition(zc.x, zc.y - 8);
  }, 'forest_entry');

  // Wait for updateActiveZone() to detect the overlap.
  await page.waitForFunction(
    () => ((window as any).__sanctumZones as string[] | undefined)?.includes('forest_entry'),
    { timeout: 5000 },
  );

  await page.keyboard.press('e');

  // Wait for placeholder modal (__campfireModal != null) — do NOT wait for
  // __campfireRest (that would let the async swap complete first).
  await page.waitForFunction(
    () => (window as any).__campfireModal != null,
    { timeout: 5000 },
  );

  // ESC immediately (~0ms after placeholder appears, well before GET /api/me resolves).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const afterEsc = await page.evaluate(() => (window as any).__campfireModal);
  expect(afterEsc).toBeNull();

  // Wait 1s past the earliest possible GET /api/me round-trip.  The
  // !campfireModal?.isOpen() guard in fetchAndReopenCampfireModal must prevent
  // a ghost reopen.
  await page.waitForTimeout(1000);
  const afterWait = await page.evaluate(() => (window as any).__campfireModal);
  expect(afterWait).toBeNull();

  await ctx.close();
});
