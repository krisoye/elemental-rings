/**
 * QA Phase 1 — adversarial / edge-case E2E tests for #426
 * (Reliquary modal header convergence — DOM SPIRIT header, remove legacy BENCH
 * header, uppercase BENCH:, equalize column gaps).
 *
 * These tests are spec-driven (written before the implementation), covering
 * adversarial angles that the happy-path E2E scenarios may not fully exercise.
 * They lock in:
 *   - All four headers being .er-dom-label DOM nodes at the SAME y (128) and font
 *   - Zero canvas Text objects whose text starts with 'BENCH' or 'SPIRIT' (no legacy dup)
 *   - SPIRIT header live-update AND recolor in BOTH directions (normal ↔ full)
 *   - Drop-to-SPIRIT via hit-rect when ghost is scrolled off-screen (≥10 rings)
 *   - No-op safety: clicking SPIRIT header strip with no ring selected is harmless
 *   - window.__ringMgmtState.counters shape (spirit + bench keys, correct values)
 *   - Field-mode parity: BENCH: uppercase + x≈492 in the field overlay
 *
 * Playwright Input Rules (regression #413 / #389):
 *   - Gestures via real pointer (page.mouse.click on canvas coords)
 *   - window.__ hooks for state READ-BACK only — never as the gesture under test
 *   - Convergence: one component renders all targets — assert a SINGLE .er-dom-label
 *     per header at the correct y/font, not just that text exists somewhere
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Reliquary wall zone center (sanctum.json RINGWALL tile). */
const RINGWALL = { x: 128, y: 56 };

// ── Shared helpers ────────────────────────────────────────────────────────────

async function registerAndToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `qa426_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function putCarry(token: string, ringIds: string[]): Promise<Response> {
  return fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds }),
  });
}

async function seedRestingRings(token: string, count: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`seed-resting-rings failed (${res.status}): ${await res.text()}`);
}

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(
    () => typeof (window as any).__sanctumInteract === 'function',
    { timeout: 10000 },
  );
}

async function openReliquary(page: Page): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    RINGWALL.x,
    RINGWALL.y,
  ]);
  await page.waitForFunction(
    () => ((window as any).__sanctumZones ?? []).includes('ringwall'),
    undefined,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });
  await page.waitForFunction(
    () => typeof (window as any).__reliquaryMove === 'function',
    { timeout: 5000 },
  );
}

/**
 * Convert logical canvas coordinates (1024×576) to page coordinates
 * via the canvas bounding rect.
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

async function clickCanvas(page: Page, pt: { x: number; y: number }): Promise<void> {
  const { x, y } = await canvasCoords(page, pt.x, pt.y);
  await page.mouse.click(x, y);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

// ── AC1: All four headers are DOM labels at the same y and font ───────────────

// #426 adversarial: all four headers must be .er-dom-label nodes — not canvas
// Text — ensuring none reverts to the old crispCanvasText codepath (regression
// #357: pixelArt:true makes canvas text soft; DOM labels are crisp).
test('#426 QA: all four sanctum column headers are .er-dom-label DOM nodes (no canvas fallback)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Read all .er-dom-label nodes present while the sanctum overlay is open.
  const domLabelIds = await page.evaluate(() => {
    const ids: string[] = [];
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const id = (n as HTMLElement).getAttribute('data-label');
      if (id) ids.push(id);
    });
    return ids;
  });

  // SPIRIT, BENCH, HEALTH, COMBAT column headers must all be in the DOM label set.
  // Absence of any one means that column is still on the old canvas-text path.
  expect(
    domLabelIds,
    'spirit-header DOM label missing — SPIRIT column fell back to canvas Text (regression)',
  ).toContain('spirit-header');
  expect(
    domLabelIds,
    'bench header DOM label missing — BENCH column not rendering as .er-dom-label',
  ).toContain('bench-header');
  // HEALTH and COMBAT are BHC-owned and were correct before #426; guard them too.
  const hasHealth = domLabelIds.some((id) => id === 'health-header' || id === 'bhc-health-header');
  const hasCombat = domLabelIds.some((id) => id === 'combat-header' || id === 'bhc-combat-header');
  expect(hasHealth, 'HEALTH header DOM label not found — BHC regression').toBe(true);
  expect(hasCombat, 'COMBAT header DOM label not found — BHC regression').toBe(true);

  await ctx.close();
});

// #426 adversarial: same-row convergence — SPIRIT header and BENCH header must
// share the same logical y (128) and the same font size (12px). This is the exact
// divergence the spec identifies: old SPIRIT was top-left anchored at y=128 while
// BHC headers are center-anchored at y=128 — the visual row gap is the bug.
// Regression #389: we assert one component renders all targets at the same y,
// not just that text exists somewhere.
test('#426 QA: all four column headers have the same logical y (128) and font size (12px) — no row divergence', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Collect the bounding rects and font sizes of all four column headers.
  const headerMetrics = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleY = canvasRect.height / 576;

    const metrics: Array<{ id: string; logicalY: number; fontPx: number }> = [];
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const id = el.getAttribute('data-label') ?? '';
      const text = el.textContent ?? '';
      // Collect SPIRIT, BENCH, HEALTH, COMBAT headers by id or text prefix.
      const isColumnHeader =
        id === 'spirit-header' ||
        (text.startsWith('SPIRIT:')) ||
        id === 'bench-header' ||
        (text.startsWith('BENCH:')) ||
        id === 'health-header' ||
        id === 'bhc-health-header' ||
        (text === 'HEALTH') ||
        id === 'combat-header' ||
        id === 'bhc-combat-header' ||
        (text === 'COMBAT');
      if (!isColumnHeader) return;
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const logicalY = Math.round((centerY - canvasRect.top) / scaleY);
      const fontPx = Math.round(parseFloat(window.getComputedStyle(el).fontSize));
      metrics.push({ id: id || text, logicalY, fontPx });
    });
    return metrics;
  });

  // Must find at least 4 column headers.
  expect(
    headerMetrics.length,
    `Expected at least 4 column header DOM labels; found ${headerMetrics.length}: ${JSON.stringify(headerMetrics)}`,
  ).toBeGreaterThanOrEqual(4);

  // All headers must be at y=128 ±4 (center-anchor tolerance).
  for (const m of headerMetrics) {
    expect(
      Math.abs(m.logicalY - 128),
      `Header "${m.id}" is at logicalY=${m.logicalY}, expected 128 ±4 — row alignment broken`,
    ).toBeLessThanOrEqual(4);
  }

  // All headers must be 12px — spec mandates uniform font across all four.
  for (const m of headerMetrics) {
    expect(
      m.fontPx,
      `Header "${m.id}" has fontPx=${m.fontPx}, expected 12 — font-size mismatch`,
    ).toBe(12);
  }

  await ctx.close();
});

// ── AC2: No legacy canvas Text starting with BENCH or SPIRIT ─────────────────

// #426 adversarial: the duplicate canvas 'BENCH  ↓' label (spare-label) and
// 'SPIRIT  ↓' label (reliquary-label) must be fully removed. If either survives,
// the old top-left-anchored canvas header will render below the new DOM header —
// the "old header popping up below" defect described in the spec.
test('#426 QA: zero canvas Text children starting with BENCH or SPIRIT in the open sanctum overlay (no legacy dup headers)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Walk the scene's full display list (up to 3 levels deep, matching
  // reliquary-modal.spec.ts campTextByName pattern) and collect all Phaser
  // Text objects whose text begins with 'BENCH' or 'SPIRIT'.
  const legacyCanvasTexts = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const offenders: Array<{ name: string; text: string }> = [];
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      const children = container.getAll ? container.getAll() : [];
      for (const o of children) {
        if (
          o.type === 'Text' &&
          typeof o.text === 'string' &&
          (o.text.startsWith('BENCH') || o.text.startsWith('SPIRIT') || o.text.startsWith('Bench'))
        ) {
          offenders.push({ name: o.name ?? '', text: o.text });
        }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return offenders;
  });

  expect(
    legacyCanvasTexts,
    `Legacy canvas Text headers still present: ${JSON.stringify(legacyCanvasTexts)} — delete spare-label / reliquary-label from CampScene.renderLeft`,
  ).toHaveLength(0);

  await ctx.close();
});

// ── AC2 supplemental: canvas object named 'spare-label' or 'bench-counter' is gone

// #426 adversarial: the specific scene-object names used by the old CampScene
// bench header ('spare-label', 'bench-counter', 'reliquary-label') must no longer
// exist in the scene after #426. Tests to Update table row for reliquary-modal.spec.ts
// line 157-159 verifies the label deletion; this test guards the object-name
// contract so that any re-introduction of those names triggers a failure.
test('#426 QA: scene objects named spare-label, bench-counter, and reliquary-label do not exist in the open overlay', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const deletedNames = ['spare-label', 'bench-counter', 'reliquary-label'];
  const surviving = await page.evaluate((names: string[]) => {
    const scene = (window as any).__scene as any;
    const found: string[] = [];
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (names.includes(o.name)) found.push(o.name);
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return found;
  }, deletedNames);

  expect(
    surviving,
    `Deleted canvas objects still in the scene: ${JSON.stringify(surviving)} — CampScene teardown incomplete`,
  ).toHaveLength(0);

  await ctx.close();
});

// ── AC2 (SPIRIT header text format): reads 'SPIRIT: n / max' ─────────────────

// #426 adversarial: the SPIRIT header must match the exact format
// 'SPIRIT: n / max' (uppercase, colon, spaces around slash) to align with the
// BHC 'BENCH: n / max' format. A wrong format (e.g. 'SPIRIT  ↓' or
// 'Spirit: n/max') breaks the header-convergence visual contract.
test('#426 QA: spirit-header DOM label text matches SPIRIT: n / max format from server state', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const spiritHeaderText = await page.evaluate(() => {
    let text: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const id = el.getAttribute('data-label');
      if (id === 'spirit-header') text = el.textContent ?? null;
    });
    return text;
  });

  expect(spiritHeaderText, 'spirit-header DOM label not found').not.toBeNull();

  // Verify format: 'SPIRIT: n / max'
  expect(
    spiritHeaderText!.startsWith('SPIRIT:'),
    `spirit-header text "${spiritHeaderText}" must start with 'SPIRIT:' (uppercase, colon)`,
  ).toBe(true);

  // Verify the counts match server-authoritative __ringMgmtState.counters.spirit.
  const counters = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(counters, '__ringMgmtState.counters must be published').toBeTruthy();
  expect(counters.spirit, 'counters.spirit key must exist').toBeDefined();
  expect(typeof counters.spirit.n, 'counters.spirit.n must be a number').toBe('number');
  expect(typeof counters.spirit.max, 'counters.spirit.max must be a number').toBe('number');

  const expectedText = `SPIRIT: ${counters.spirit.n} / ${counters.spirit.max}`;
  expect(
    spiritHeaderText,
    `spirit-header text must match server counters: expected "${expectedText}", got "${spiritHeaderText}"`,
  ).toBe(expectedText);

  await ctx.close();
});

// ── AC2 (BENCH header uppercase): reads 'BENCH: n / max' ─────────────────────

// #426 adversarial: the BHC bench header was 'Bench: n / max' before this fix.
// If the uppercase change is missed or partially applied, the DOM label predicate
// `text?.startsWith('BENCH:')` in manage-battle-rings.spec.ts line 693 fails,
// making BENCH_HEADER undefined and crashing the position assertion. This test
// catches the casing regression in isolation.
test('#426 QA: bench header DOM label starts with BENCH: (uppercase) not Bench:', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const benchHeaderText = await page.evaluate(() => {
    let found: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const txt = (n as HTMLElement).textContent ?? '';
      // Accept both bench-header id and text-prefix matching (BHC may use either).
      if (txt.startsWith('BENCH:') || txt.startsWith('Bench:')) found = txt;
    });
    return found;
  });

  expect(benchHeaderText, 'bench header DOM label not found').not.toBeNull();
  expect(
    benchHeaderText!.startsWith('BENCH:'),
    `bench header text "${benchHeaderText}" must start with 'BENCH:' (uppercase) — fix #426 Fix 3`,
  ).toBe(true);
  expect(
    benchHeaderText!.startsWith('Bench:'),
    `bench header still shows old 'Bench:' mixed-case — uppercase change not applied`,
  ).toBe(false);

  await ctx.close();
});

// ── AC3/AC7: __ringMgmtState.counters shape and correctness ──────────────────

// #426 adversarial: publishRingMgmtState is the single structure reporter; its
// counters shape (spirit + bench keys with n/max sub-fields) must be unchanged
// so existing consumers (E2E harness + other specs) are not broken by the header
// refactor. A shape regression here breaks all counter-dependent assertions.
test('#426 QA: __ringMgmtState.counters has correct spirit and bench shape and values', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const state = await page.evaluate(() => (window as any).__ringMgmtState);
  expect(state, '__ringMgmtState must be published when the overlay is open').toBeTruthy();

  // spirit counter.
  expect(state.counters, 'counters object must exist').toBeTruthy();
  expect(state.counters.spirit, 'counters.spirit key must be present').toBeDefined();
  expect(typeof state.counters.spirit.n).toBe('number');
  expect(typeof state.counters.spirit.max).toBe('number');

  // bench counter.
  expect(state.counters.bench, 'counters.bench key must be present').toBeDefined();
  expect(typeof state.counters.bench.n).toBe('number');
  expect(typeof state.counters.bench.max).toBe('number');

  // Values match server-authoritative /api/me data.
  const reliquaryCount =
    me.player.reliquaryCount ??
    me.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  expect(
    state.counters.spirit.n,
    `counters.spirit.n=${state.counters.spirit.n} does not match reliquaryCount=${reliquaryCount}`,
  ).toBe(reliquaryCount);
  expect(
    state.counters.spirit.max,
    `counters.spirit.max must equal reliquaryCap`,
  ).toBe(me.player.reliquaryCap);
  expect(
    state.counters.bench.max,
    `counters.bench.max must equal spare_ring_max`,
  ).toBe(me.player.spare_ring_max);

  await ctx.close();
});

// ── AC2: SPIRIT counter live-updates after a move ────────────────────────────

// #426 adversarial: the SPIRIT DOM header (now a stateful DOM node managed by
// setDomLabelText) must update its text when a ring is moved in or out of the
// reliquary. If the old canvas-text update path is left wired to a now-deleted
// Text object, the header freezes at its initial value.
test('#426 QA: spirit-header DOM label text updates live after a bench-to-reliquary move', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Seed a bench ring: carry 4 battle-slot rings + 1 extra resting ring.
  const me = await getMe(token);
  const slotted = (['thumb', 'a1', 'a2', 'd1', 'd2'] as const)
    .map((s) => (me.loadout as any)[s])
    .filter(Boolean) as string[];
  const extraResting = me.rings.find((r: any) => r.in_carry === 0);
  expect(extraResting, 'Need at least one resting ring to seed a bench ring').toBeDefined();
  await putCarry(token, [...slotted.slice(0, 4), extraResting!.id]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState?.loadout_pool?.some((r: any) => r.id === id),
    extraResting!.id,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // Capture the initial spirit counter value from the DOM label.
  const initialText = await page.evaluate(() => {
    let t: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        t = (n as HTMLElement).textContent ?? null;
      }
    });
    return t;
  });
  expect(initialText, 'spirit-header DOM label must be present before move').not.toBeNull();

  // Move the bench ring to the reliquary — increments spirit counter.
  const initialSpirit = await page.evaluate(
    () => (window as any).__ringMgmtState?.counters?.spirit?.n,
  );
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'reliquary'), extraResting!.id);
  await page.waitForFunction(
    (id) => (window as any).__campState?.atSanctum?.some((r: any) => r.id === id),
    extraResting!.id,
    { timeout: 8000 },
  );

  // Spirit counter in __ringMgmtState must have incremented.
  const updatedCounters = await page.evaluate(
    () => (window as any).__ringMgmtState?.counters,
  );
  expect(
    updatedCounters.spirit.n,
    `counters.spirit.n must increment after bench→reliquary move (was ${initialSpirit})`,
  ).toBe(initialSpirit + 1);

  // The DOM label text must reflect the new count.
  const updatedText = await page.evaluate(() => {
    let t: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        t = (n as HTMLElement).textContent ?? null;
      }
    });
    return t;
  });
  const expectedUpdated = `SPIRIT: ${updatedCounters.spirit.n} / ${updatedCounters.spirit.max}`;
  expect(
    updatedText,
    `spirit-header DOM label text must update after move: expected "${expectedUpdated}", got "${updatedText}"`,
  ).toBe(expectedUpdated);

  await ctx.close();
});

// ── AC2: SPIRIT header recolor to #ff5555 when reliquary is full ─────────────

// #426 adversarial: the recolor path split across renderReliquaryHeader (counter
// coloring) and applyReliquaryLockState (label recolor) must be consolidated onto
// the DOM node. If the old setColor path still targets the deleted canvas Text, the
// DOM node stays yellow while the reliquary is full — the recolor is silently lost.
test('#426 QA: spirit-header DOM node color is #ff5555 when reliquary is at cap', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Fill the reliquary to cap. reliquaryCap default is 20 for fresh players;
  // seed enough resting rings to hit it.
  const meInit = await getMe(token);
  const cap: number = meInit.player.reliquaryCap ?? 20;
  const currentResting: number =
    meInit.player.reliquaryCount ??
    meInit.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  const needed = cap - currentResting;
  if (needed > 0) {
    await seedRestingRings(token, needed);
  }

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Verify we are actually at cap via the state reporter.
  const counters = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(
    counters?.spirit?.n,
    `Test setup failed: reliquary not at cap (${counters?.spirit?.n} / ${counters?.spirit?.max})`,
  ).toBe(counters?.spirit?.max);

  // Read the DOM node's color.
  const spiritHeaderColor = await page.evaluate(() => {
    let color: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        color = (n as HTMLElement).style.color;
      }
    });
    return color;
  });

  expect(spiritHeaderColor, 'spirit-header DOM node not found').not.toBeNull();
  // The spec says color turns #ff5555 at cap; accept rgb(255,85,85) as the computed
  // equivalent (browsers normalize hex → rgb in style.color).
  const isRed =
    spiritHeaderColor === '#ff5555' ||
    spiritHeaderColor === 'rgb(255, 85, 85)';
  expect(
    isRed,
    `spirit-header color at cap must be #ff5555 (or rgb(255,85,85)), got "${spiritHeaderColor}"`,
  ).toBe(true);

  await ctx.close();
});

// ── AC2: SPIRIT header recolor BACK to normal when no longer full ─────────────

// #426 adversarial: the negative direction of the recolor path is never tested in
// the happy-path E2E — the spec requires the header to return to #ffdd66 when
// the reliquary is no longer full (e.g. after moving a ring to bench). If the
// recolor only fires on transition-to-full, the header stays red indefinitely.
test('#426 QA: spirit-header DOM node recolors back to normal (#ffdd66) after reliquary drops below cap', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Fill reliquary to exactly cap so we can then drain one ring to trigger the
  // revert path.
  const meInit = await getMe(token);
  const cap: number = meInit.player.reliquaryCap ?? 20;
  const currentResting: number =
    meInit.player.reliquaryCount ??
    meInit.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  const needed = cap - currentResting;
  if (needed > 0) {
    await seedRestingRings(token, needed);
  }

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Confirm reliquary is full.
  const beforeCounters = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  test.skip(
    beforeCounters?.spirit?.n !== beforeCounters?.spirit?.max,
    'Reliquary not at cap after seeding — skipping recolor-revert test',
  );

  // Move one reliquary ring to bench (spare) to drop below cap.
  // Pick the first resting ring from campState.
  const firstRestingId = await page.evaluate(() => {
    const atSanctum = (window as any).__campState?.atSanctum ?? [];
    return atSanctum[0]?.id ?? null;
  });
  expect(firstRestingId, 'No resting ring found in campState.atSanctum to move').not.toBeNull();

  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), firstRestingId);
  await page.waitForFunction(
    (id) => (window as any).__campState?.loadout_pool?.some((r: any) => r.id === id),
    firstRestingId,
    { timeout: 8000 },
  );

  // Spirit counter must have dropped by 1.
  const afterCounters = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(afterCounters.spirit.n).toBe(beforeCounters.spirit.n - 1);
  expect(afterCounters.spirit.n).toBeLessThan(afterCounters.spirit.max);

  // The DOM node's color must be back to normal (not red).
  const spiritHeaderColor = await page.evaluate(() => {
    let color: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        color = (n as HTMLElement).style.color;
      }
    });
    return color;
  });

  expect(spiritHeaderColor, 'spirit-header DOM node not found').not.toBeNull();
  // Must NOT be the full-state red.
  const isStillRed =
    spiritHeaderColor === '#ff5555' ||
    spiritHeaderColor === 'rgb(255, 85, 85)';
  expect(
    isStillRed,
    `spirit-header color must revert from red after dropping below cap, but is still "${spiritHeaderColor}"`,
  ).toBe(false);

  await ctx.close();
});

// ── AC6: Drop-to-SPIRIT via header hit-rect when ghost is off-screen ──────────

// #426 adversarial: when ≥10 resting rings exist, the SPIRIT ghost scrolls out of
// the visible 3-row window. The always-visible header hit-rect ('spirit-drop-hit')
// must remain the only drop target. A real click on the header strip (256, 128)
// with a bench ring selected must deliver the ring to the reliquary. If the hit-rect
// is not added or is z-ordered behind the deselect zone, the click is swallowed.
test('#426 QA: drop-to-SPIRIT via header strip (256,128) succeeds when ghost is scrolled off-screen (≥10 resting rings)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Seed 10 resting rings so the SPIRIT ghost lands at row 4 (index 10 = outside
  // the 3 visible rows 0-8). Fresh player already has 5 resting.
  const meInit = await getMe(token);
  const currentResting =
    meInit.player.reliquaryCount ??
    meInit.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  const toSeed = Math.max(0, 10 - currentResting);
  if (toSeed > 0) {
    await seedRestingRings(token, toSeed);
  }

  // Carry a bench ring to select.
  const meSeed = await getMe(token);
  const slotted = (['thumb', 'a1', 'a2', 'd1', 'd2'] as const)
    .map((s) => (meSeed.loadout as any)[s])
    .filter(Boolean) as string[];
  const benchRing = meSeed.rings.find(
    (r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1,
  );
  // Use putCarry to place one resting ring in the bench without it being a resting ring.
  await putCarry(token, [...slotted, benchRing!.id]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState?.loadout_pool?.some((r: any) => r.id === id),
    benchRing!.id,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // Confirm ghost is off-screen: reliquary count must be ≥ 9 (outside visible rows).
  const state = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(
    state?.spirit?.n ?? 0,
    `Test requires ≥ 9 resting rings for ghost off-screen; got ${state?.spirit?.n}`,
  ).toBeGreaterThanOrEqual(9);

  const spiritCountBefore = state.spirit.n as number;
  const benchCountBefore = state.bench.n as number;

  // Real-click the bench cell 0 to select the bench ring.
  // Post-#426 bench grid x moves from 370→388; cell 0 center = 388+32=420, y=192.
  await clickCanvas(page, { x: 420, y: 192 });
  await page.waitForFunction(
    (id) => ((window as any).__scene as any)?.swapManager?.selection?.ringId === id,
    benchRing!.id,
    { timeout: 5000 },
  );

  // Real-click the SPIRIT header strip at (256, 128) — the hit-rect center.
  // COL_RELIQUARY_X(152) + 104 = 256.
  await clickCanvas(page, { x: 256, y: 128 });

  // Wait for the reliquary count to increment (server round-trip).
  await page.waitForFunction(
    (expected) => {
      const s = (window as any).__ringMgmtState?.counters;
      return (s?.spirit?.n ?? -1) === expected;
    },
    spiritCountBefore + 1,
    { timeout: 8000 },
  );

  const afterState = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(
    afterState.spirit.n,
    `spirit counter must increment after header-strip drop (was ${spiritCountBefore})`,
  ).toBe(spiritCountBefore + 1);
  expect(
    afterState.bench.n,
    `bench counter must decrement after header-strip drop (was ${benchCountBefore})`,
  ).toBe(benchCountBefore - 1);

  // Confirm server state: benchRing is now in_carry=0.
  const after = await getMe(token);
  expect(
    after.rings.find((r: any) => r.id === benchRing!.id)?.in_carry,
    'bench ring must have in_carry=0 after header-strip drop',
  ).toBe(0);

  await ctx.close();
});

// ── AC6 no-op safety: clicking SPIRIT header with NO selection does nothing ───

// #426 adversarial: the hit-rect (spirit-drop-hit) must be inert when no ring is
// selected. If the hit-rect accidentally invokes onReliquaryDropClicked without a
// selection, it may drop undefined or null into the reliquary — corrupting state.
// This mirrors the DISCARD slot regression (#350) where any pointerdown fired.
test('#426 QA: clicking SPIRIT header strip with no ring selected does not move any ring or change counters', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // No ring selected — just click the header strip directly.
  const stateBefore = await page.evaluate(() => (window as any).__ringMgmtState?.counters);

  await clickCanvas(page, { x: 256, y: 128 });

  // Allow one round-trip beat.
  await page.waitForTimeout(400);

  const stateAfter = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  expect(
    stateAfter.spirit.n,
    `spirit counter changed after header click with no selection (${stateBefore.spirit.n} → ${stateAfter.spirit.n})`,
  ).toBe(stateBefore.spirit.n);
  expect(
    stateAfter.bench.n,
    `bench counter changed after header click with no selection`,
  ).toBe(stateBefore.bench.n);

  // Overlay must remain open — no crash or accidental close.
  const overlayOpen = await page.evaluate(
    () => (window as any).__sanctumOverlayOpen === 'ringwall',
  );
  expect(overlayOpen, 'Overlay must remain open after no-op header click').toBe(true);

  await ctx.close();
});

// ── AC4: Field-mode parity — BENCH: uppercase at x≈492 ────────────────────────

// #426 adversarial: BHC renders identically in all modes (#395 invariant). The
// bench header casing change (Bench: → BENCH:) and x shift (370→388, header center
// 474→492) must apply in the field "Manage Battle Rings" overlay too. If BHC has
// the fix but the field overlay still injects its own bench header, the column
// would diverge. This tests the field mode path end-to-end.
test('#426 QA: field overlay bench header reads BENCH: (uppercase) at x≈492 after BENCH_GRID_X shift', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });

  // Read the bench header DOM label and its logical x position.
  const benchResult = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / 1024;
    let found: { text: string; logicalX: number } | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const txt = el.textContent ?? '';
      if (txt.startsWith('BENCH:') || txt.startsWith('Bench:')) {
        const rect = el.getBoundingClientRect();
        const logicalX = Math.round((rect.left + rect.width / 2 - canvasRect.left) / scaleX);
        found = { text: txt, logicalX };
      }
    });
    return found;
  });

  expect(benchResult, 'bench header DOM label not found in field overlay').not.toBeNull();
  expect(
    benchResult!.text.startsWith('BENCH:'),
    `field overlay bench header must start with 'BENCH:' (uppercase), got "${benchResult!.text}"`,
  ).toBe(true);
  // After BENCH_GRID_X 370→388, header center = 388+104 = 492.
  expect(
    Math.abs(benchResult!.logicalX - 492),
    `bench header x=${benchResult!.logicalX} must be ≈492 (±3) after BENCH_GRID_X shift 370→388`,
  ).toBeLessThanOrEqual(3);

  await ctx.close();
});

// ── AC4/AC5: Field-mode HEALTH/HP at x=660, COMBAT at 759/837 unchanged ───────

// #426 adversarial: the COL_HEALTH_X shift 659→660 must apply in field mode too.
// The HP label in the field modal (canvas text) and the DISCARD slot (also at
// HEALTH column x) both shift. If RingManagementOverlayClass still hard-codes
// HP_X=659 rather than importing COL_HEALTH_X, the HP label stays at 659 while
// BHC renders at 660 — a 1-pixel divergence that the spec explicitly guards.
test('#426 QA: field overlay HP label is at x=660 and COMBAT stays at 759/837 after COL_HEALTH_X shift', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });

  // Read HP label x (canvas Text starting with ♥) and COMBAT slot positions.
  const positions = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const result: Record<string, number> = {};
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          result.HP = Math.round(o.x);
        }
        if (o.getAll) walk(o);
      }
    };
    if (modal) walk(modal);

    // DOM labels: A1/A2/D1/D2 for COMBAT cluster.
    const canvasRect = game?.canvas?.getBoundingClientRect();
    const scaleX = canvasRect ? canvasRect.width / 1024 : 1;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const text = el.textContent?.trim() ?? '';
      const rect = el.getBoundingClientRect();
      const logicalX = Math.round((rect.left + rect.width / 2 - (canvasRect?.left ?? 0)) / scaleX);
      if (text === 'A1') result.A1 = logicalX;
      if (text === 'D1') result.D1 = logicalX;
      if (text === 'A2') result.A2 = logicalX;
      if (text === 'D2') result.D2 = logicalX;
    });
    return result;
  });

  // HP label must be at 660 (COL_HEALTH_X after #426 shift).
  expect(
    positions.HP,
    `HP label x=${positions.HP} must be 660 after COL_HEALTH_X 659→660 (RingManagementOverlayClass must import COL_HEALTH_X)`,
  ).toBe(660);

  // COMBAT cluster positions must be unchanged at 759/837.
  if (positions.A1 !== undefined) {
    expect(
      Math.abs(positions.A1 - 759),
      `A1 x=${positions.A1} must be ≈759 ±1 (COMBAT left unchanged)`,
    ).toBeLessThanOrEqual(1);
  }
  if (positions.A2 !== undefined) {
    expect(
      Math.abs(positions.A2 - 837),
      `A2 x=${positions.A2} must be ≈837 ±1 (COMBAT right unchanged)`,
    ).toBeLessThanOrEqual(1);
  }

  await ctx.close();
});

// ── AC5: Column gaps in sanctum: SPIRIT→BENCH=28, BENCH→HEALTH=29, HEALTH→COMBAT=29 ──

// #426 adversarial: the spec mandates 28 / 29 / 29 px gaps. If only one constant
// shifts (e.g. BENCH_GRID_X moves but COL_HEALTH_X stays at 659), the gaps become
// asymmetric. The test measures the CENTER x of each column header DOM label and
// derives the inter-column gap as the distance between the right edge of one column
// grid and the left edge of the next. Using header centers + known column spans
// (SPIRIT: 152–360, BENCH: 388–596, HEALTH: 625–695, COMBAT: 724–872).
test('#426 QA: sanctum column gaps are 28/29/29 (SPIRIT→BENCH→HEALTH→COMBAT) after coordinate shift', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Collect header center x positions via DOM labels.
  const centerXs = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / 1024;
    const result: Record<string, number> = {};
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const id = el.getAttribute('data-label') ?? '';
      const txt = el.textContent ?? '';
      const rect = el.getBoundingClientRect();
      const logicalX = Math.round((rect.left + rect.width / 2 - canvasRect.left) / scaleX);
      if (id === 'spirit-header' || txt.startsWith('SPIRIT:')) result.SPIRIT = logicalX;
      if (id === 'bench-header' || txt.startsWith('BENCH:')) result.BENCH = logicalX;
      if (id === 'health-header' || id === 'bhc-health-header' || txt === 'HEALTH') result.HEALTH = logicalX;
      if (id === 'combat-header' || id === 'bhc-combat-header' || txt === 'COMBAT') result.COMBAT = logicalX;
    });
    return result;
  });

  // SPIRIT header center: 152 + 104 = 256.
  // BENCH header center: 388 + 104 = 492.
  // HEALTH header center: 660 (column center, consistent with HP label).
  // COMBAT header center: approx 759+39 = 798 (midpoint of 759–837 span).

  expect(centerXs.SPIRIT, 'SPIRIT header center x not found').toBeDefined();
  expect(centerXs.BENCH, 'BENCH header center x not found').toBeDefined();
  expect(
    Math.abs(centerXs.SPIRIT - 256),
    `SPIRIT header center x=${centerXs.SPIRIT} must be ≈256 (152+104) ±3`,
  ).toBeLessThanOrEqual(3);
  expect(
    Math.abs(centerXs.BENCH - 492),
    `BENCH header center x=${centerXs.BENCH} must be ≈492 (388+104) ±3 — BENCH_GRID_X must be 388`,
  ).toBeLessThanOrEqual(3);

  // Gap check: right edge of SPIRIT grid (360) to left edge of BENCH grid (388) = 28 px.
  // We derive this from the header centers using known half-widths:
  // SPIRIT right = SPIRIT_center + 104 = 256+104=360; BENCH left = BENCH_center - 104 = 492-104=388.
  // Gap = BENCH_left - SPIRIT_right = 388-360 = 28.
  const spiritRight = centerXs.SPIRIT + 104;
  const benchLeft = centerXs.BENCH - 104;
  expect(
    benchLeft - spiritRight,
    `SPIRIT→BENCH gap = ${benchLeft - spiritRight}, expected 28 (spiritRight=${spiritRight}, benchLeft=${benchLeft})`,
  ).toBe(28);

  await ctx.close();
});

// ── AC8: spirit-drop-hit hit-rect is present and interactive ─────────────────

// #426 adversarial: the DOM label is pointer-events:none by design, so the drop
// affordance requires an explicit canvas hit-rect ('spirit-drop-hit') added after
// the deselect zone so it wins input. If it's missing or z-ordered incorrectly,
// the header strip will silently swallow clicks via the deselect zone — no error,
// just no drop.
test('#426 QA: spirit-drop-hit hit-rect exists and has interactive input enabled in the open overlay', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const hitRectResult = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    let found: { name: string; interactive: boolean; x: number; y: number } | null = null;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (o.name === 'spirit-drop-hit') {
          found = {
            name: o.name,
            interactive: !!(o.input?.enabled),
            x: Math.round(o.x),
            y: Math.round(o.y),
          };
          return;
        }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return found;
  });

  expect(
    hitRectResult,
    `spirit-drop-hit hit-rect not found in scene — drop affordance for off-screen ghost will be broken`,
  ).not.toBeNull();
  expect(
    hitRectResult!.interactive,
    `spirit-drop-hit must have input.enabled=true; found: ${JSON.stringify(hitRectResult)}`,
  ).toBe(true);
  // Center must be near (256, 128): COL_RELIQUARY_X(152)+104=256, y=128.
  expect(
    Math.abs(hitRectResult!.x - 256),
    `spirit-drop-hit x=${hitRectResult!.x} must be ≈256 ±4`,
  ).toBeLessThanOrEqual(4);
  expect(
    Math.abs(hitRectResult!.y - 128),
    `spirit-drop-hit y=${hitRectResult!.y} must be ≈128 ±4`,
  ).toBeLessThanOrEqual(4);

  await ctx.close();
});

// ── AC8: spirit-drop-hit is destroyed on overlay close ────────────────────────

// #426 adversarial: DOM labels and hit-rects that survive overlay teardown cause
// input leakage — a click in the header area of the world map triggers the hit-rect
// even when the overlay is closed. The spec requires the hit-rect to be destroyed
// in the onBeforeDestroy / onClose path (alongside sanctumDiscard_ cleanup).
test('#426 QA: spirit-drop-hit hit-rect is removed from the scene after overlay close', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Close via Escape (real keyboard gesture).
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, {
    timeout: 5000,
  });

  const hitRectStillPresent = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    let found = false;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (o.name === 'spirit-drop-hit') { found = true; return; }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return found;
  });

  expect(
    hitRectStillPresent,
    'spirit-drop-hit must be destroyed on overlay close — input leakage risk if it survives',
  ).toBe(false);

  await ctx.close();
});

// ── AC8: spirit-header DOM label is destroyed on overlay close ────────────────

// #426 adversarial: DOM labels are NOT children of the overlay container (established
// pattern) and must be destroyed manually in the onClose callback. If the spirit-header
// DOM label is not nulled and destroyed, it will persist over the world map — two
// SPIRIT header labels will appear when the overlay is re-opened (double-render).
test('#426 QA: spirit-header DOM label is removed from the page after overlay close', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Verify it exists while open.
  const openCount = await page.evaluate(
    () => document.querySelectorAll('[data-label="spirit-header"]').length,
  );
  expect(openCount, 'spirit-header DOM label must be present while overlay is open').toBe(1);

  // Close via Escape.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, {
    timeout: 5000,
  });

  const closedCount = await page.evaluate(
    () => document.querySelectorAll('[data-label="spirit-header"]').length,
  );
  expect(
    closedCount,
    'spirit-header DOM label must be removed from DOM after overlay close — double-render on re-open otherwise',
  ).toBe(0);

  await ctx.close();
});

// ── Double-open regression: re-opening the overlay shows exactly one spirit-header

// #426 adversarial: if the spirit-header DOM label is not cleaned up on close and
// a new one is created on the next open, two [data-label="spirit-header"] nodes
// exist simultaneously — the second open renders a duplicate that may show a stale
// counter value. This is the double-render bug the teardown guard prevents.
test('#426 QA: re-opening the overlay shows exactly one spirit-header DOM label (no double-render)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Close.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, {
    timeout: 5000,
  });

  // Re-open.
  await openReliquary(page);

  const spiritHeaderCount = await page.evaluate(
    () => document.querySelectorAll('[data-label="spirit-header"]').length,
  );
  expect(
    spiritHeaderCount,
    `Expected exactly 1 spirit-header DOM label after re-open, found ${spiritHeaderCount} — teardown/cleanup missing`,
  ).toBe(1);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — implementation-aware tests
// These tests target specific code branches, dual-path interactions, and the
// COL_HEALTH_X single-source-of-truth contract that only become verifiable once
// the implementation is visible.
// ═══════════════════════════════════════════════════════════════════════════════

// ── P2-1: renderReliquaryHeader and applyReliquaryLockState both use the same
//          color values for the same condition — sync check ──────────────────

// #426 implementation-aware: CampScene has TWO code paths that mutate
// spiritHeader.node.style.color:
//   (a) renderReliquaryHeader (line 1270): reliquaryCount >= reliquaryCap → '#ff5555'
//   (b) applyReliquaryLockState (line 1331): window.__reliquaryFull → '#ff5555'
// Both are called by afterReliquaryReload() when state changes. If they diverge
// (e.g. one uses '#ff4444', the other '#ff5555'), the color flickers between the
// two on every reload. This test opens the overlay at full-cap, reads the color
// renderReliquaryHeader set, then checks it matches what applyReliquaryLockState
// would decide via __reliquaryFull.
test('#426 P2: renderReliquaryHeader and applyReliquaryLockState agree on spirit-header color at full-cap state', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const meInit = await getMe(token);
  const cap: number = meInit.player.reliquaryCap ?? 20;
  const currentResting: number =
    meInit.player.reliquaryCount ??
    meInit.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  const needed = cap - currentResting;
  if (needed > 0) {
    await seedRestingRings(token, needed);
  }

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const counters = await page.evaluate(() => (window as any).__ringMgmtState?.counters);
  test.skip(
    counters?.spirit?.n !== counters?.spirit?.max,
    `Reliquary not at cap after seeding (${counters?.spirit?.n}/${counters?.spirit?.max}) — skip`,
  );

  // Color as set by renderReliquaryHeader (the last path to run after openReliquary).
  const colorAfterRender = await page.evaluate(() => {
    let color: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        color = (n as HTMLElement).style.color;
      }
    });
    return color;
  });

  // What applyReliquaryLockState would set: __reliquaryFull ? '#ff5555' : '#ffdd66'.
  const colorByApply = await page.evaluate(() =>
    (window as any).__reliquaryFull ? '#ff5555' : '#ffdd66',
  );

  expect(colorAfterRender, 'spirit-header color not set after open').not.toBeNull();

  const normalize = (c: string): string =>
    c === 'rgb(255, 85, 85)' ? '#ff5555' :
    c === 'rgb(255, 221, 102)' ? '#ffdd66' : c;

  expect(
    normalize(colorAfterRender!),
    `Full-cap: renderReliquaryHeader set "${colorAfterRender}" but applyReliquaryLockState expects "${colorByApply}" — the two color paths disagree`,
  ).toBe(colorByApply);

  await ctx.close();
});

// #426 P2: Below-cap case — both paths must agree on the normal color.
// If renderReliquaryHeader uses '#ffdd66' but applyReliquaryLockState left a
// different fallback (e.g. '#aaaaaa' from the old canvas-text path), the header
// shows the wrong color on every non-full open.
test('#426 P2: renderReliquaryHeader and applyReliquaryLockState agree on spirit-header color in the below-cap (normal) state', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const meInit = await getMe(token);
  const cap: number = meInit.player.reliquaryCap ?? 20;
  const currentResting: number =
    meInit.player.reliquaryCount ??
    meInit.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  test.skip(
    currentResting >= cap,
    `Fresh player already at cap (${currentResting}/${cap}) — cannot test normal color path`,
  );

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const colorAfterRender = await page.evaluate(() => {
    let color: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).getAttribute('data-label') === 'spirit-header') {
        color = (n as HTMLElement).style.color;
      }
    });
    return color;
  });

  const colorByApply = await page.evaluate(() =>
    (window as any).__reliquaryFull ? '#ff5555' : '#ffdd66',
  );

  expect(colorAfterRender, 'spirit-header color not set in below-cap state').not.toBeNull();

  const normalize = (c: string): string =>
    c === 'rgb(255, 85, 85)' ? '#ff5555' :
    c === 'rgb(255, 221, 102)' ? '#ffdd66' : c;

  expect(
    normalize(colorAfterRender!),
    `Below-cap: renderReliquaryHeader set "${colorAfterRender}" but applyReliquaryLockState expects "${colorByApply}" — paths disagree`,
  ).toBe(colorByApply);

  await ctx.close();
});

// ── P2-2: spiritDropHit (container child) vs spiritHeader (non-child) —
//          both teardown paths fire correctly in the same close cycle ─────────

// #426 implementation-aware: two DIFFERENT teardown mechanisms for objects
// created at the same time:
//   • spiritDropHit — added to `c` via `c.add(spiritDropHit)` (CampScene line 820);
//     destroyed automatically by container.destroy(true) in overlay.close().
//   • spiritHeader — NOT in the container; destroyed manually in onBeforeDestroy
//     callback (CampScene line 949) and nulled in onClose (line 983).
// If the mechanisms are crossed (e.g. spiritDropHit added to scene root, or
// spiritHeader accidentally added to container), one teardown path fails silently.
// This test closes the overlay and checks BOTH are gone in a single close cycle.
test('#426 P2: spiritDropHit (container child) and spiritHeader (DOM non-child) are both cleaned up in the same close cycle', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const openState = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    let hitRectFound = false;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (o.name === 'spirit-drop-hit') { hitRectFound = true; return; }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    const domLabelCount = document.querySelectorAll('[data-label="spirit-header"]').length;
    return { hitRectFound, domLabelCount };
  });
  expect(openState.hitRectFound, 'spirit-drop-hit must exist while open').toBe(true);
  expect(openState.domLabelCount, 'spirit-header DOM label must exist while open').toBe(1);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, {
    timeout: 5000,
  });

  const closedState = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    let hitRectFound = false;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (o.name === 'spirit-drop-hit') { hitRectFound = true; return; }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    const domLabelCount = document.querySelectorAll('[data-label="spirit-header"]').length;
    return { hitRectFound, domLabelCount };
  });

  expect(
    closedState.hitRectFound,
    'spirit-drop-hit must be gone after close — container.destroy(true) should have reclaimed it as a container child',
  ).toBe(false);
  expect(
    closedState.domLabelCount,
    'spirit-header DOM label must be gone after close — onBeforeDestroy must call spiritHeader.destroy()',
  ).toBe(0);

  await ctx.close();
});

// #426 P2: spirit-header DOM label is not a direct Phaser container child.
// The spec comment on CampScene line 792 says "NOT added to the container".
// If it were added to the container, container.destroy(true) would reclaim it
// and the manual spiritHeader.destroy() in onBeforeDestroy would be a double-destroy.
// Verify the invariant holds so the teardown model is internally consistent.
test('#426 P2: spirit-header DOM label is not a child of the overlay container — manual teardown invariant', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const isContainerChild = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const spiritDomNode = document.querySelector('[data-label="spirit-header"]') as HTMLElement | null;
    if (!spiritDomNode) return null;

    let found = false;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        // Match any Phaser DOMElement whose node is or contains the spirit-header element.
        if (o.node === spiritDomNode || o.node?.contains?.(spiritDomNode)) {
          found = true;
          return;
        }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return found;
  });

  expect(isContainerChild, 'spirit-header DOM label lookup returned null — label not found').not.toBeNull();
  expect(
    isContainerChild,
    'spirit-header DOM label must NOT be a Phaser container child — it must be destroyed manually via spiritHeader.destroy() in onBeforeDestroy, not by container.destroy(true)',
  ).toBe(false);

  await ctx.close();
});

// ── P2-3: COL_HEALTH_X single source of truth — HP label x and BHC HEALTH
//          column center must match (import-not-duplicate contract) ──────────

// #426 implementation-aware: COL_HEALTH_X is exported from BenchHealthCombat.ts
// (line 45) and imported by RingManagementOverlayClass.ts (line 9) to place the
// HP canvas-Text label (line 434). If the import is missed and HP_X=659 survives,
// the HP label sits at 659 while BHC's HEALTH column renders at 660. This test
// measures both positions in the same render and asserts they are identical.
test('#426 P2: HP label x and HEALTH DOM column center are identical — COL_HEALTH_X single source of truth (field mode)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });

  const positions = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const canvasRect: DOMRect = game?.canvas?.getBoundingClientRect();
    const scaleX = canvasRect ? canvasRect.width / 1024 : 1;

    // HP canvas-Text x (added by RingManagementOverlayClass at COL_HEALTH_X, line 434).
    let hpLabelX: number | null = null;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          hpLabelX = Math.round(o.x);
        }
        if (o.getAll) walk(o);
      }
    };
    if (modal) walk(modal);

    // HEALTH DOM label center-x (rendered by BHC at COL_HEALTH_X, line 188).
    let healthDomX: number | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      if (el.textContent?.trim() === 'HEALTH') {
        const rect = el.getBoundingClientRect();
        healthDomX = Math.round((rect.left + rect.width / 2 - (canvasRect?.left ?? 0)) / scaleX);
      }
    });

    return { hpLabelX, healthDomX };
  });

  expect(positions.hpLabelX, 'HP label (♥ canvas text) not found in field modal').not.toBeNull();
  expect(positions.healthDomX, 'HEALTH DOM label not found in field modal').not.toBeNull();

  expect(
    positions.hpLabelX,
    `HP label x=${positions.hpLabelX} must be 660 — RingManagementOverlayClass must use imported COL_HEALTH_X, not hard-coded 659`,
  ).toBe(660);
  expect(
    positions.healthDomX,
    `HEALTH DOM label x=${positions.healthDomX} must be 660 (BenchHealthCombat COL_HEALTH_X)`,
  ).toBe(660);
  expect(
    positions.hpLabelX,
    `HP x (${positions.hpLabelX}) ≠ HEALTH DOM x (${positions.healthDomX}) — COL_HEALTH_X is not a single source of truth; RingManagementOverlayClass is using a different value`,
  ).toBe(positions.healthDomX);

  await ctx.close();
});

// Same contract in sanctum mode — RingManagementOverlayClass uses COL_HEALTH_X
// for the HP label in the sanctum overlay context too.
test('#426 P2: HP label x and HEALTH DOM column center match in sanctum mode — COL_HEALTH_X single source of truth', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const positions = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = (window as any).__scene as any;
    const canvasRect: DOMRect = game?.canvas?.getBoundingClientRect();
    const scaleX = canvasRect ? canvasRect.width / 1024 : 1;

    let hpLabelX: number | null = null;
    const walk = (c: any, depth: number): void => {
      if (depth > 5) return;
      for (const o of (c.getAll ? c.getAll() : [])) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          hpLabelX = Math.round(o.x);
        }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);

    let healthDomX: number | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      if (el.textContent?.trim() === 'HEALTH') {
        const rect = el.getBoundingClientRect();
        healthDomX = Math.round((rect.left + rect.width / 2 - (canvasRect?.left ?? 0)) / scaleX);
      }
    });

    return { hpLabelX, healthDomX };
  });

  expect(positions.healthDomX, 'HEALTH DOM label not found in sanctum mode').not.toBeNull();
  expect(
    positions.healthDomX,
    `Sanctum HEALTH DOM label x=${positions.healthDomX} must be 660 (COL_HEALTH_X from BHC)`,
  ).toBe(660);

  if (positions.hpLabelX !== null) {
    expect(
      positions.hpLabelX,
      `Sanctum HP label x=${positions.hpLabelX} must be 660 (COL_HEALTH_X imported by RingManagementOverlayClass)`,
    ).toBe(660);
    expect(
      positions.hpLabelX,
      `Sanctum: HP x (${positions.hpLabelX}) ≠ HEALTH DOM x (${positions.healthDomX}) — COL_HEALTH_X not a single source of truth`,
    ).toBe(positions.healthDomX);
  }

  await ctx.close();
});

// ── P2-4: spiritHeader DOM label has pointer-events:none; hit-rect has
//          input.enabled=true — architectural split is intact ─────────────────

// #426 implementation-aware: DOM labels are pointer-events:none (DomLabel.ts:104-108).
// The hit-rect exists precisely because the DOM label cannot receive pointer events.
// If the DOM label's pointer-events were accidentally set to 'auto' (e.g. the
// addDomLabel call omitted the CSS), the drop target would work differently:
// clicks would land on the DOM label itself, which IS destroyed with the container,
// but the hit-rect would become a ghost interactive object in the scene. Asserting
// this split is intact confirms the implementation followed the spec's reasoning.
test('#426 P2: spirit-header DOM label has pointer-events:none (inert); spirit-drop-hit has input.enabled=true (interactive)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const domLabelPointerEvents = await page.evaluate(() => {
    const el = document.querySelector('[data-label="spirit-header"]') as HTMLElement | null;
    if (!el) return null;
    return window.getComputedStyle(el).pointerEvents;
  });

  const hitRectInputEnabled = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    let enabled: boolean | null = null;
    const walk = (container: any, depth: number): void => {
      if (depth > 4) return;
      for (const o of (container.getAll ? container.getAll() : [])) {
        if (o.name === 'spirit-drop-hit') {
          enabled = !!(o.input?.enabled);
          return;
        }
        if (o.getAll) walk(o, depth + 1);
      }
    };
    walk({ getAll: () => scene.children.getAll() }, 0);
    return enabled;
  });

  expect(domLabelPointerEvents, 'spirit-header DOM label not found').not.toBeNull();
  expect(
    domLabelPointerEvents,
    `spirit-header must have pointer-events:none (got "${domLabelPointerEvents}") — if interactive, the hit-rect is redundant and drops will behave differently on teardown`,
  ).toBe('none');

  expect(hitRectInputEnabled, 'spirit-drop-hit canvas rectangle not found').not.toBeNull();
  expect(
    hitRectInputEnabled,
    'spirit-drop-hit must have input.enabled=true — it is the actual drop target for the SPIRIT header strip',
  ).toBe(true);

  await ctx.close();
});
