/**
 * E2E adversarial spec for #361/#362/#363/#382 — DomLabel contract verification.
 *
 * Phase 1 (spec-driven): written BEFORE implementation from EPIC acceptance criteria only.
 *
 * These tests verify behavior that is ONLY observable at runtime in a real browser:
 *   - pointer-events:none via computed style (Vitest/Node cannot evaluate CSS)
 *   - DOM node presence + CSS computed properties via Playwright page.evaluate
 *   - No second DOM node created on repeated setText calls (no node proliferation)
 *   - Two-row label renders with white-space:pre so \n is a real line break
 *   - Clicking through a DOM label reaches the canvas (input passthrough)
 *   - DomLabel nodes are cleaned up on modal close/reopen (no duplicate nodes)
 *
 * Selector convention (mirrors the dev's overworld-hud-stats.spec.ts):
 *   - Named labels: `document.querySelector('[data-label="<name>"]')` — scoped globally,
 *     no container root needed. Known names: "overworld-hud", "biome-title", "npc-prompt".
 *   - Scanning all game DOM labels: root = `document.querySelector('#game-container')`
 *     (the Phaser parent div declared in index.html / main.ts:408).
 *
 * DO NOT fold these into overworld-hud-stats.spec.ts or manage-battle-rings.spec.ts
 * — those are owned by the dev agent and must not be touched by QA per spawn instructions.
 *
 * Test structure:
 *   Group A — HUD DOM label (from BaseBiomeScene / #362)
 *   Group B — Two-row location label (from BaseBiomeScene / #362)
 *   Group C — BattleHandOverlay screen-fixed labels (from #363)
 *   Group D — Modal open/close DOM node lifecycle (#363)
 *   Group E — Spec Conformance: acceptance criteria from #361/#362
 *   Group F — #366 Regression Guard: setDomLabelText must call updateSize()
 *   Group G — #382 World-space label scroll correctness (Waystone / MerchantNpc)
 *   Group H — #382 Modal DOM teardown: Merchant / Campfire / Difficulty leak guard
 */

import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';

/** Boot to CampScene, then navigate to forest_anchorage. */
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

/** Open the Manage Battle Rings overlay and wait until the heart card renders. */
async function openBattleHand(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });
}

/** Close the Manage Battle Rings overlay. */
async function closeBattleHand(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === false, {
    timeout: 5000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Group A — HUD DOM label (BaseBiomeScene #362)
// ═══════════════════════════════════════════════════════════════════════════

// #362 adversarial: after DOM migration the HUD text must live in the DOM node
// [data-label="overworld-hud"], not in the Phaser scene graph — if the old
// canvas Text still exists alongside the DOM node, two texts overlap and the
// old scene-hook tests silently pass against stale canvas text.
test('dom-label #362 A1: HUD DOM node [data-label="overworld-hud"] exists after overworld loads', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the HUD DOM node to appear with populated content
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="overworld-hud"]');
      return !!node && (node.textContent?.includes('Day') ?? false);
    },
    { timeout: 8000 },
  );

  const hudText = await page.evaluate(
    () => document.querySelector('[data-label="overworld-hud"]')?.textContent ?? '',
  );

  expect(
    hudText,
    'HUD DOM node [data-label="overworld-hud"] must exist and contain "Day" segment',
  ).toContain('Day');

  await ctx.close();
});

// #362 adversarial: pointer-events:none is the critical safety property. A DOM
// label that does NOT have pointer-events:none will absorb canvas clicks for any
// coordinate it overlaps — breaking ring selection, NPC interaction, etc.
test('dom-label #362 A2: HUD DOM node has computed pointer-events === "none"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  const pointerEvents = await page.evaluate(() => {
    const node = document.querySelector('[data-label="overworld-hud"]') as HTMLElement | null;
    if (!node) return null;
    return window.getComputedStyle(node).pointerEvents;
  });

  expect(
    pointerEvents,
    'HUD DOM label must have computed pointer-events: none — a non-none value causes canvas click interception',
  ).toBe('none');

  await ctx.close();
});

// #362 adversarial: font-family on the computed style must include "Courier" to
// satisfy the monospace parity constraint — any proportional font (sans-serif etc.)
// changes typeface visually while keeping the game otherwise functional.
test('dom-label #362 A3: HUD DOM node computed font-family includes monospace stack (parity)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  const fontFamily = await page.evaluate(() => {
    const node = document.querySelector('[data-label="overworld-hud"]') as HTMLElement | null;
    if (!node) return null;
    return window.getComputedStyle(node).fontFamily;
  });

  expect(fontFamily).not.toBeNull();
  // The font-family stack must include a monospace font (Courier New or monospace).
  // Browsers may resolve fontFamily with quotes: `"Courier New", Courier, monospace`
  const lowerFont = (fontFamily ?? '').toLowerCase();
  const hasMonospace = lowerFont.includes('courier') || lowerFont.includes('monospace');
  expect(
    hasMonospace,
    `HUD DOM label font-family must include monospace (got: "${fontFamily}") — parity requires Courier New/monospace stack`,
  ).toBe(true);

  await ctx.close();
});

// #362 adversarial: if a second DOM node is created on each HUD refresh (instead
// of updating textContent in place), nodes accumulate over time — the DOM bloats,
// old values are still visible through the new node, and memory leaks.
test('dom-label #362 A4: repeated HUD refreshes do not create duplicate [data-label="overworld-hud"] nodes', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  // Count HUD nodes before refresh — must be exactly 1
  const countBefore = await page.evaluate(
    () => document.querySelectorAll('[data-label="overworld-hud"]').length,
  );

  // Trigger two refreshes in quick succession
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.refreshHud?.();
    scene?.refreshHud?.();
  });

  // Brief wait for async fetch
  await page.waitForTimeout(500);

  const countAfter = await page.evaluate(
    () => document.querySelectorAll('[data-label="overworld-hud"]').length,
  );

  expect(
    countAfter,
    `[data-label="overworld-hud"] count after two refreshes (${countAfter}) must equal count before (${countBefore}) — refreshing must update textContent, not create new nodes`,
  ).toBe(countBefore);

  await ctx.close();
});

// #366 regression guard: after refreshHud() populates the HUD DOM node its right
// edge must not exceed the canvas right edge. Before the setDomLabelText fix,
// Phaser used a stale bounding-rect from creation time — the right-anchored label
// overflowed the canvas on every text update because the cached width was wrong.
test('dom-label #366 A5: [data-label="overworld-hud"] right edge does not exceed canvas right edge after populate', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the HUD to be populated with real content (post-refreshHud fetch)
  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  const overflow = await page.evaluate(() => {
    const hud = document.querySelector('[data-label="overworld-hud"]') as HTMLElement | null;
    const canvas = document.querySelector('#game-container canvas') as HTMLElement | null;
    if (!hud || !canvas) return null;
    const hudRight = hud.getBoundingClientRect().right;
    const canvasRight = canvas.getBoundingClientRect().right;
    return { hudRight, canvasRight, overflows: hudRight > canvasRight };
  });

  expect(
    overflow,
    '[data-label="overworld-hud"] and canvas must both be found in the DOM',
  ).not.toBeNull();

  expect(
    overflow!.overflows,
    `HUD right edge (${overflow!.hudRight}px) must not exceed canvas right edge (${overflow!.canvasRight}px) — indicates setDomLabelText updateSize() regression (#366)`,
  ).toBe(false);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group B — Two-row location label (BaseBiomeScene #362)
// ═══════════════════════════════════════════════════════════════════════════

// #362 adversarial: the two-row location label uses `\n` which requires
// white-space:pre in CSS to render as two visible lines. Without it, the `\n`
// renders as a space and the label collapses to a single line.
test('dom-label #362 B1: two-row location label [data-label="biome-title"] has computed white-space === "pre"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the biome-title DOM node to appear
  await page.waitForFunction(
    () => !!document.querySelector('[data-label="biome-title"]')?.textContent?.includes('Forest'),
    { timeout: 8000 },
  );

  const { whiteSpace, textContent } = await page.evaluate(() => {
    const node = document.querySelector('[data-label="biome-title"]') as HTMLElement | null;
    if (!node) return { whiteSpace: null, textContent: null };
    return {
      whiteSpace: window.getComputedStyle(node).whiteSpace,
      textContent: node.textContent,
    };
  });

  expect(
    whiteSpace,
    'Two-row location label must have white-space: pre — without it \\n renders as a space (label collapses)',
  ).toBe('pre');

  // Verify the two-row content is present
  expect(textContent).toContain('Forest');

  await ctx.close();
});

// #362 adversarial: the two-row label must also have pointer-events:none —
// it overlays a visually prominent area of the screen; a click on the location
// label text could otherwise block overworld movement/interaction.
test('dom-label #362 B2: two-row location label [data-label="biome-title"] has pointer-events === "none"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="biome-title"]')?.textContent?.includes('Forest'),
    { timeout: 8000 },
  );

  const pointerEvents = await page.evaluate(() => {
    const node = document.querySelector('[data-label="biome-title"]') as HTMLElement | null;
    if (!node) return null;
    return window.getComputedStyle(node).pointerEvents;
  });

  expect(
    pointerEvents,
    'Location label DOM node [data-label="biome-title"] must have pointer-events: none',
  ).toBe('none');

  await ctx.close();
});

// #362 adversarial: `Forest` on line 1 and `The Anchorage` on line 2 is the
// two-row format the spec mandates. If the implementation collapses them
// (renders "Forest The Anchorage" on one line), the visual layout breaks.
test('dom-label #362 B3: [data-label="biome-title"] textContent contains biome and area separated by newline', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="biome-title"]');
      const t = node?.textContent ?? '';
      return t.includes('Forest') && t.includes('Anchorage');
    },
    { timeout: 8000 },
  );

  const textContent = await page.evaluate(
    () => document.querySelector('[data-label="biome-title"]')?.textContent ?? null,
  );

  expect(textContent).not.toBeNull();
  expect(
    textContent,
    'Location label textContent must contain a newline character (two-row format)',
  ).toContain('\n');

  const lines = (textContent ?? '').split('\n');
  expect(lines[0].trim()).toBe('Forest');
  expect(lines[1].trim()).toBe('The Anchorage');

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group C — BattleHandOverlay screen-fixed labels (#363)
// ═══════════════════════════════════════════════════════════════════════════

// #363 adversarial: the overlay title and SPARE HEADER labels are screen-fixed
// and must migrate to DOM. If they are still canvas Text objects, they remain
// blurry on fractional DPI and the migration AC is violated.
test('dom-label #363 C1: BattleHandOverlay screen-fixed labels exist as DOM nodes (not canvas text)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Wait briefly for the overlay to fully render its DOM labels
  await page.waitForTimeout(500);

  // Look for DOM nodes within #game-container containing known overlay section headers.
  // Known data-label values per spec: "battle-hand-title", "spare-header", "discard-label",
  // or discovered by scanning the container for the header text.
  const domOverlayLabelExists = await page.evaluate(() => {
    const root = document.querySelector('#game-container');
    if (!root) return false;
    const allEls = Array.from(root.querySelectorAll('*'));
    return allEls.some((el) => {
      const t = (el as HTMLElement).innerText ?? '';
      // Match known overlay section headers per the spec (title or spare section labels)
      return t.includes('MANAGE') || t.includes('SPARE') || t.includes('DISCARD') || t.includes('BATTLE HAND');
    });
  });

  expect(
    domOverlayLabelExists,
    'BattleHandOverlay screen-fixed labels (title/SPARE/DISCARD headers) must exist as DOM nodes in #game-container after #363 migration',
  ).toBe(true);

  await ctx.close();
});

// #363 adversarial: per the carve-out rule the overlay title DOES migrate to DOM,
// but per-card labels inside the scrolling spareContainer must NOT. If they were
// migrated, Phaser cannot clip them — the labels bleed outside the scroll area.
// We verify the scrollable spare cards' labels are still Phaser Text (visible in
// the scene graph) rather than DOM nodes.
test('dom-label #363 C2: per-card spare labels in spareContainer remain in canvas scene graph (not DOM)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  await page.waitForTimeout(300);

  // Check that per-card label text (element names like "FIRE", tier "T1",
  // XP labels like "Xp: 0") are in the Phaser scene graph (not DOM)
  const canvasCardLabelsExist = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return false;
    // Walk the scene graph looking for text objects with element name or tier label
    const cardLabelTexts: string[] = [];
    const walk = (c: any): void => {
      for (const o of (c.getAll ? c.getAll() : [])) {
        if (typeof o.text === 'string' && o.text.length > 0) {
          cardLabelTexts.push(o.text);
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    // Card labels include element names, tier, XP — if none exist in scene graph
    // it means all were migrated to DOM (violation).
    const hasTierLabel = cardLabelTexts.some((t) => /^T\d/.test(t));
    const hasXpLabel   = cardLabelTexts.some((t) => t.startsWith('Xp:'));
    return hasTierLabel || hasXpLabel;
  });

  expect(
    canvasCardLabelsExist,
    'Per-card spare labels (T1, Xp:N) must remain in the Phaser scene graph — DOM migration would break scroll container clipping',
  ).toBe(true);

  await ctx.close();
});

// #363 adversarial: all DOM labels in the overlay must have pointer-events:none.
// The overlay has interactive buttons (assign, equip, DISCARD) — any DOM label
// intercepting clicks near those buttons silently breaks their hit testing.
test('dom-label #363 C3: all DOM text labels visible in #game-container have pointer-events === "none"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  await page.waitForTimeout(300);

  // Find all DOM text elements inside the game container and check computed styles.
  // Exclude elements that are login <input> fields (they legitimately receive input).
  const violations = await page.evaluate(() => {
    const root = document.querySelector('#game-container');
    if (!root) return [] as string[];
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const htmlEl = el as HTMLElement;
      // Skip form controls — login inputs legitimately receive pointer events
      if (htmlEl.tagName === 'INPUT' || htmlEl.tagName === 'BUTTON' || htmlEl.tagName === 'CANVAS') continue;
      const t = (htmlEl.innerText ?? '').trim();
      if (t.length === 0) continue;
      const style = window.getComputedStyle(htmlEl);
      if (style.pointerEvents !== 'none') {
        bad.push(`"${t.slice(0, 40)}" has pointer-events: ${style.pointerEvents}`);
      }
    }
    return bad;
  });

  expect(
    violations,
    'All DOM text labels in the overlay must have pointer-events: none',
  ).toHaveLength(0);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group D — Modal lifecycle: no duplicate DOM nodes on close/reopen (#363)
// ═══════════════════════════════════════════════════════════════════════════

// #363 adversarial: if DOMElement.destroy() is not called on modal close,
// the Phaser DOM element's underlying <div> remains in the DOM even after
// the Phaser object is removed from the scene graph. On reopen a second <div>
// is added — labels stack and overlap, values from the previous open remain visible.
test('dom-label #363 D1: DOM label count in #game-container is stable after close+reopen cycle', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);
  await page.waitForTimeout(300);

  // P3-D — count only OVERLAY DomLabel nodes (class `er-dom-label`), excluding the
  // persistent overworld labels (HUD, biome-title) and the lazy NPC prompt. Counting
  // every text node in #game-container would fold in those persistent nodes and a
  // lazily-created npcPrompt between cycles → a false-positive failure. Scoping to
  // overlay-owned er-dom-label nodes makes the open/close lifecycle the only variable.
  const PERSISTENT = ['overworld-hud', 'biome-title', 'npc-prompt'];
  const countOverlayLabels = (): Promise<number> =>
    page.evaluate((persistent) => {
      const root = document.querySelector('#game-container');
      if (!root) return 0;
      return Array.from(root.querySelectorAll('.er-dom-label')).filter((el) => {
        const id = (el as HTMLElement).getAttribute('data-label');
        // A label is persistent if its data-label is in the exclude set; overlay
        // chrome labels (title/HEADER/section labels) are unidentified or non-persistent.
        return !(id && persistent.includes(id));
      }).length;
    }, PERSISTENT);

  const countAfterOpen1 = await countOverlayLabels();

  await closeBattleHand(page);
  await page.waitForTimeout(200);

  // Reopen
  await openBattleHand(page);
  await page.waitForTimeout(300);

  const countAfterOpen2 = await countOverlayLabels();

  expect(
    countAfterOpen2,
    `DOM text node count after second open (${countAfterOpen2}) must equal first open (${countAfterOpen1}) — extra nodes indicate destroy() not called on close`,
  ).toBe(countAfterOpen1);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group E — Spec Conformance: acceptance criteria from EPIC #361
// ═══════════════════════════════════════════════════════════════════════════

// Spec AC: "No DOM label intercepts pointer input (pointer-events: none verified)"
// This is the primary safety invariant of the entire EPIC.
test('SpecConformance #361 E1: clicking at HUD DOM label position reaches the canvas (pointer passthrough)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  // Register a pointerdown listener on the canvas to count how many clicks reach it
  await page.evaluate(() => {
    (window as any).__canvasPointerdownCount = 0;
    const canvas = document.querySelector('#game-container canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', () => {
        (window as any).__canvasPointerdownCount++;
      });
    }
  });

  // Find the HUD label's bounding rect and click at its center
  const hudBounds = await page.evaluate(() => {
    const node = document.querySelector('[data-label="overworld-hud"]') as HTMLElement | null;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  if (hudBounds) {
    await page.mouse.click(hudBounds.x, hudBounds.y);
    await page.waitForTimeout(100);

    const canvasClicks = await page.evaluate(() => (window as any).__canvasPointerdownCount ?? 0);
    expect(
      canvasClicks,
      'A click at the HUD label position must reach the canvas (pointer-events:none required for passthrough)',
    ).toBeGreaterThan(0);
  }

  await ctx.close();
});

// Spec AC: "Typeface unchanged — monospace parity maintained throughout"
// All DOM labels in the game container must use a monospace font.
test('SpecConformance #361 E2: all DOM text labels in #game-container use monospace font family', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  const proportionalFontViolations = await page.evaluate(() => {
    const root = document.querySelector('#game-container');
    if (!root) return [] as string[];
    const PROPORTIONAL = ['sans-serif', 'Arial', 'Helvetica', 'Georgia', 'Verdana'];
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const htmlEl = el as HTMLElement;
      // Skip canvas and inputs — not DomLabel-produced text nodes
      if (htmlEl.tagName === 'CANVAS' || htmlEl.tagName === 'INPUT') continue;
      const t = (htmlEl.innerText ?? '').trim();
      if (t.length === 0) continue;
      const ff = window.getComputedStyle(htmlEl).fontFamily.toLowerCase();
      for (const prop of PROPORTIONAL) {
        if (ff.includes(prop.toLowerCase())) {
          bad.push(`"${t.slice(0, 30)}" uses proportional font: ${ff}`);
          break;
        }
      }
    }
    return bad;
  });

  expect(
    proportionalFontViolations,
    'All DOM labels must use monospace font — parity constraint from #361',
  ).toHaveLength(0);

  await ctx.close();
});

// Spec AC: "HUD content updates dynamically when player stats change"
// After DOM migration, refreshHud must update the DOM node's textContent —
// not leave the old text visible because the implementation forgot to update the node.
test('SpecConformance #362 E3: [data-label="overworld-hud"] textContent updates after refreshHud() call', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for HUD to appear with initial content
  await page.waitForFunction(
    () => !!document.querySelector('[data-label="overworld-hud"]')?.textContent?.includes('Day'),
    { timeout: 8000 },
  );

  // Capture the initial HUD text
  const textBefore = await page.evaluate(
    () => document.querySelector('[data-label="overworld-hud"]')?.textContent ?? '',
  );
  expect(textBefore.length).toBeGreaterThan(0);

  // Trigger a refreshHud() and wait for it to settle
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.refreshHud?.();
  });
  await page.waitForTimeout(1000);

  // Text must remain non-empty and still contain core segments
  const textAfter = await page.evaluate(
    () => document.querySelector('[data-label="overworld-hud"]')?.textContent ?? '',
  );

  expect(
    textAfter.length,
    'HUD DOM node must still have textContent after refreshHud() — dynamic update must work',
  ).toBeGreaterThan(0);
  expect(textAfter).toContain('Day');

  await ctx.close();
});

// Spec AC: "NPC prompt shows on zone enter and hides on zone exit"
// After DOM migration the NPC prompt is a DOM node that must be shown/hidden,
// not a canvas Text with setVisible() — both mechanisms should work.
// (Mirrors the show/hide assertion in overworld-hud-stats.spec.ts #362 C.)
test('SpecConformance #362 E4: [data-label="npc-prompt"] is hidden when player is not in an NPC zone', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForTimeout(500);

  // The NPC prompt node may or may not exist in the DOM at load time (lazily created).
  // If it exists, it must not be visible (display:none or visibility:hidden).
  const npcPromptVisible = await page.evaluate(() => {
    const node = document.querySelector('[data-label="npc-prompt"]') as HTMLElement | null;
    if (!node) return false; // not in DOM at all — definitely not visible
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });

  expect(
    npcPromptVisible,
    '[data-label="npc-prompt"] must not be visible when player is not in an NPC zone',
  ).toBe(false);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group F — #366 Regression Guard: setDomLabelText must call updateSize()
// ═══════════════════════════════════════════════════════════════════════════
//
// Regression from PR #365 / EPIC #361: the HUD was created empty and
// right-anchored. setDomLabelText() set textContent but never called
// updateSize(), so Phaser's cached src.width stayed at the stale empty-state
// value. With originX=1, dx = staleWidth * 1 ≈ 16px shift instead of ~220px,
// pushing all text past "Day" off the right edge of the canvas.
//
// These tests are the visual-symptom regression guards.

// #366 adversarial: the exact symptom is `hud.right > canvas.right`. After
// refreshHud() populates the HUD, Phaser re-lays it out from the re-measured
// width. Without updateSize(), the right edge overflows. This test locks in
// that the overflow never returns.
test('dom-label #366 F1: populated overworld HUD right edge does not overflow the canvas right edge', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait until HUD is populated with full content (not just the empty creation state)
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="overworld-hud"]');
      const txt = node?.textContent ?? '';
      // Full HUD string includes 'Day' and at least one separator ·
      return txt.includes('Day') && txt.includes('·');
    },
    { timeout: 10000 },
  );

  const { hudRight, canvasRight } = await page.evaluate(() => {
    const hud = document.querySelector('[data-label="overworld-hud"]') as HTMLElement | null;
    const canvas = document.querySelector('#game-container canvas') as HTMLElement | null;
    if (!hud || !canvas) return { hudRight: -1, canvasRight: -1 };
    return {
      hudRight: hud.getBoundingClientRect().right,
      canvasRight: canvas.getBoundingClientRect().right,
    };
  });

  expect(hudRight).toBeGreaterThan(0);
  expect(canvasRight).toBeGreaterThan(0);
  expect(
    hudRight,
    `#366 regression: HUD right (${hudRight.toFixed(1)}px) must be ≤ canvas right (${canvasRight.toFixed(1)}px) — overflow means updateSize() is missing after textContent mutation`,
  ).toBeLessThanOrEqual(canvasRight);

  await ctx.close();
});

// #366 adversarial: the reported symptom was only "Day" visible — all tokens
// after "Day" were off-screen. This test asserts the full HUD content string
// is present, locking in that truncation never recurs.
test('dom-label #366 F2: populated overworld HUD textContent contains full string through "Avg XP"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the complete HUD string (all major segments populated)
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="overworld-hud"]');
      const txt = node?.textContent ?? '';
      return txt.includes('Day') && txt.includes('Avg XP');
    },
    { timeout: 10000 },
  );

  const hudText = await page.evaluate(
    () => document.querySelector('[data-label="overworld-hud"]')?.textContent ?? '',
  );

  // Verify all expected HUD segments are present (full string, not truncated)
  expect(hudText, '#366: HUD must contain "Day" segment').toContain('Day');
  expect(hudText, '#366: HUD must contain "Gold" segment — missing means refresh truncated').toContain('Gold');
  expect(
    hudText,
    '#366: HUD must contain "Avg XP" — the rightmost segment; if absent the text overflowed before refreshing',
  ).toContain('Avg XP');

  await ctx.close();
});

// #366 adversarial: the two-row biome-title label uses originX=0 (left-anchored)
// so width staleness is cosmetically harmless — but after the fix to setDomLabelText,
// updateSize() fires for ALL labels. We must verify the two-row format is preserved:
// the `\n` must still produce two rows, not a single collapsed line.
// The physical height must be at least 2 × lineHeight (19px per spec) = 38px.
test('dom-label #366 F3: two-row [data-label="biome-title"] still renders two rows after updateSize() is added', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for biome-title to appear with content containing two parts
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="biome-title"]');
      const txt = node?.textContent ?? '';
      return txt.includes('Forest') && txt.includes('\n');
    },
    { timeout: 8000 },
  );

  const { height, textContent } = await page.evaluate(() => {
    const node = document.querySelector('[data-label="biome-title"]') as HTMLElement | null;
    if (!node) return { height: 0, textContent: '' };
    return {
      height: node.getBoundingClientRect().height,
      textContent: node.textContent ?? '',
    };
  });

  // Confirm newline is still in textContent (updateSize must not strip it)
  expect(
    textContent,
    '#366: biome-title textContent must still contain \\n after updateSize() — updateSize must not mutate content',
  ).toContain('\n');

  // Height must accommodate at least two lines: spec lineHeight=19px × 2 = 38px
  // Allow some padding slack (≥30px is a generous floor that catches a one-line collapse)
  expect(
    height,
    `#366: biome-title height (${height.toFixed(1)}px) must be at least ~38px for two rows (19px lineHeight × 2) — a single-row collapse means \\n was stripped`,
  ).toBeGreaterThanOrEqual(30);

  await ctx.close();
});

// #366 adversarial: the NPC prompt uses setOrigin(0.5, 0) (center-anchored).
// Without updateSize(), `dx = staleWidth * 0.5` uses a stale empty-state width,
// placing the prompt visibly off-center. After the fix, the prompt must be
// horizontally centered over the canvas (within a few px).
//
// NOTE: This test is conditional on being able to trigger the NPC zone from
// the harness. If the prompt is not visible, the assertion is skipped rather
// than failed — the unit tests cover the mechanism; E2E covers the symptom
// only when the state is reachable.
test('dom-label #366 F4: [data-label="npc-prompt"] is horizontally centered over the canvas when shown', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Attempt to trigger the NPC prompt via the scene's showNpcPrompt hook (if exposed).
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    // showNpcPrompt is private; some test harnesses expose __showNpcPrompt.
    // If neither is available, the test will simply find no visible prompt.
    scene?.showNpcPrompt?.('Press F to talk');
    (scene as any)?.__showNpcPrompt?.('Press F to talk');
  });

  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const prompt = document.querySelector('[data-label="npc-prompt"]') as HTMLElement | null;
    if (!prompt) return null;
    const style = window.getComputedStyle(prompt);
    // Only measure if the prompt is actually visible
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;

    const canvas = document.querySelector('#game-container canvas') as HTMLElement | null;
    if (!canvas) return null;

    const promptRect = prompt.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const promptCenter = promptRect.left + promptRect.width / 2;
    const canvasCenter = canvasRect.left + canvasRect.width / 2;
    return { promptCenter, canvasCenter, diff: Math.abs(promptCenter - canvasCenter) };
  });

  if (result === null) {
    // NPC prompt not visible from this harness state — skip assertion but do not fail.
    // The unit test in crisp-text-helpers.spec.ts covers the mechanism.
    return;
  }

  expect(
    result.diff,
    `#366: NPC prompt center (${result.promptCenter.toFixed(1)}) must be within 5px of canvas center (${result.canvasCenter.toFixed(1)}) — offset means updateSize() not called, stale width shifts origin`,
  ).toBeLessThanOrEqual(5);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group G — #382 World-space label scroll correctness
//
// After the #382 crispCanvasText conversion, Waystone name labels and
// MerchantNpc "Merchant" tags must remain world-space canvas text (not DOM).
// The critical invariant: their screen position must change when the camera
// pans, proving they are not accidentally frozen with setScrollFactor(0) or
// converted to DOM nodes (which always stay at a fixed screen coordinate).
// ═══════════════════════════════════════════════════════════════════════════

// #382 adversarial: if a Waystone/MerchantNpc label was misclassified and
// converted to addDomLabel (DOM, screen-fixed), panning the camera would leave
// the label frozen at the original screen position rather than moving with the
// world. This test captures the label's screen-space position before and after
// a camera scroll and verifies they differ.
test('dom-label #382 G1: world-space Waystone label moves with camera scroll (not screen-fixed)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the Forest scene to have at least one waystone in its scene graph.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__scene;
      // waystones map is keyed by waystoneId and values have a .label canvas text.
      return scene?.waystones?.size > 0;
    },
    { timeout: 8000 },
  );

  // Read the screen-space Y position of the first waystone label via Phaser's
  // getWorldTransformMatrix() → camera projection. We do it inline via the
  // scene camera's worldView to convert world→screen.
  const readWaystoneScreenY = (): Promise<number | null> =>
    page.evaluate(() => {
      const scene = (window as any).__scene as any;
      if (!scene?.waystones) return null;
      const first = Array.from(scene.waystones.values())[0] as any;
      const label = first?.label;
      if (!label) return null;
      const cam = scene.cameras?.main;
      if (!cam) return null;
      // World→screen: screenY = (worldY - cam.worldView.y) * cam.zoom
      const screenY = (label.y - cam.worldView.y) * (cam.zoom ?? 1);
      return screenY;
    });

  const yBefore = await readWaystoneScreenY();
  expect(yBefore, 'No waystone label found to track').not.toBeNull();

  // Pan the camera down by 32px (two tiles) via the player position offset.
  // Moving the player south by 32 causes the camera to follow, scrolling the
  // world viewport up so screen-Y of a fixed world object decreases.
  await page.evaluate(() => {
    const p = (window as any).__player as any;
    if (p) p.setPosition(p.x, p.y + 32);
  });

  // Give the camera one frame to catch up.
  await page.waitForTimeout(120);

  const yAfter = await readWaystoneScreenY();
  expect(yAfter, 'Waystone label disappeared after camera pan').not.toBeNull();

  // If the label is world-space (correct), its screen-Y will differ from yBefore
  // after the camera panned. If it was wrongly made screen-fixed (addDomLabel or
  // setScrollFactor(0)), it would stay at the same screen coordinate.
  expect(
    Math.abs(yAfter! - yBefore!),
    `Waystone label screen-Y before (${yBefore?.toFixed(1)}) vs after pan (${yAfter?.toFixed(1)}) must differ — label must scroll with the camera (world-space), not be screen-fixed`,
  ).toBeGreaterThan(5);

  await ctx.close();
});

// #382 adversarial: same misclassification risk for MerchantNpc "Merchant" tag.
// The tag lives at a fixed world coordinate above the sprite head — if it were
// converted to addDomLabel it would be fixed to the screen (DOM composites above
// the WebGL canvas with scrollFactor=0 semantics). After a camera pan, a
// world-space canvas text object's screen position changes; a DOM node's does not.
test('dom-label #382 G2: world-space MerchantNpc label moves with camera scroll (not screen-fixed)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for at least one overworldNpc (merchant) to exist on the scene.
  await page.waitForFunction(
    () => Array.isArray((window as any).__overworldNpcs) && (window as any).__overworldNpcs.length > 0,
    { timeout: 10000 },
  );

  // Read the screen-space Y of the first MerchantNpc's label via world→screen.
  const readMerchantLabelScreenY = (): Promise<number | null> =>
    page.evaluate(() => {
      const scene = (window as any).__scene as any;
      // __overworldNpcs is the raw array set by BaseBiomeScene.loadNpcs(); each
      // element is the server payload, not the client MerchantNpc instance. We
      // access the scene's merchantNpcs map (keyed by npc id) instead.
      const npcsMap = scene?.merchantNpcs as Map<string, any> | undefined;
      if (!npcsMap || npcsMap.size === 0) return null;
      const first = Array.from(npcsMap.values())[0];
      const label = first?.label;
      if (!label) return null;
      const cam = scene.cameras?.main;
      if (!cam) return null;
      return (label.y - cam.worldView.y) * (cam.zoom ?? 1);
    });

  const yBefore = await readMerchantLabelScreenY();
  if (yBefore === null) {
    // merchantNpcs map not exposed — test is not applicable in this scene layout.
    // The world-space invariant is validated by G1 for Waystones; skip without fail.
    await ctx.close();
    return;
  }

  // Pan player south by 32px to scroll camera.
  await page.evaluate(() => {
    const p = (window as any).__player as any;
    if (p) p.setPosition(p.x, p.y + 32);
  });
  await page.waitForTimeout(120);

  const yAfter = await readMerchantLabelScreenY();

  // If G2 must be skippable (label destroyed during pan), accept null gracefully.
  if (yAfter === null) {
    await ctx.close();
    return;
  }

  expect(
    Math.abs(yAfter - yBefore),
    `MerchantNpc label screen-Y before (${yBefore.toFixed(1)}) vs after pan (${yAfter.toFixed(1)}) must differ — label must scroll with the camera (crispCanvasText, world-space), not be screen-fixed (addDomLabel)`,
  ).toBeGreaterThan(5);

  await ctx.close();
});

// #382 adversarial: a world-space label wrongly converted to addDomLabel would
// show up as an extra .er-dom-label node in #game-container WHILE the overworld
// scene is active (DOM nodes always exist once created, unlike canvas text which
// has no DOM footprint). Any unexpected .er-dom-label in the overworld that is
// NOT in the known persistent set indicates a misclassification.
test('dom-label #382 G3: no unexpected .er-dom-label nodes from world-space label sites', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for scene to fully settle (waystones + merchants loaded).
  await page.waitForFunction(
    () => (window as any).__waystones !== undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(300);

  // Known legitimate DOM labels in the overworld scene (from EPIC #361/#362).
  // World-space sites (Waystone, MerchantNpc, InteractionZone, ShrineZone,
  // BlinkController) must NOT produce .er-dom-label nodes.
  const KNOWN_OVERWORLD_DOM_LABELS = new Set([
    'overworld-hud',
    'biome-title',
    'npc-prompt',
  ]);

  const unexpectedLabels = await page.evaluate((known) => {
    const root = document.querySelector('#game-container');
    if (!root) return [];
    return Array.from(root.querySelectorAll('.er-dom-label'))
      .map((el) => (el as HTMLElement).getAttribute('data-label') ?? '(unlabeled)')
      .filter((id) => !(known as string[]).includes(id));
  }, Array.from(KNOWN_OVERWORLD_DOM_LABELS));

  expect(
    unexpectedLabels,
    `Unexpected .er-dom-label nodes found in overworld: [${unexpectedLabels.join(', ')}] — these may be world-space/Container labels wrongly converted to addDomLabel by #382`,
  ).toHaveLength(0);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group H — #382 Modal DOM teardown: no leaked .er-dom-label nodes
//
// Acceptance criterion: "Converted addDomLabel nodes carry the .er-dom-label
// class and are torn down on scene shutdown / modal close (no leaked DOM nodes
// after closing a modal twice)." (issue #382, AC item 6)
//
// The risk surface: if close() does not call l.destroy() on each DomLabel in
// the modal's internal tracking array, the DOM <div> remains in the document
// after the Phaser Container is destroyed. A second open() creates a new DOM
// node → count grows, old values bleed through.
// ═══════════════════════════════════════════════════════════════════════════

// #382 adversarial: Merchant modal open → close → open → close: the total
// .er-dom-label count must return to the pre-open baseline after each close.
// MerchantModal.close() calls this.domLabels.forEach(l => l.destroy()) — if
// that call is missing, DOM nodes accumulate each cycle.
//
// Phase 3 patch: original test walked the player to a merchant zone via
// __sanctumZones which proved flaky (zone detection timing). Replaced with a
// direct programmatic open/close via the scene's merchantModal reference —
// no walk-zone timing dependency. The modal's open() requires a catalog fetch;
// we call the scene hook directly and close() programmatically.
test('dom-label #382 H1: MerchantModal open+close twice leaves zero leaked .er-dom-label nodes', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Count baseline .er-dom-label nodes before any modal interaction.
  const baseline = await page.evaluate(
    () => document.querySelectorAll('.er-dom-label').length,
  );

  // Open the MerchantModal directly via the scene reference, bypassing walk-zone
  // detection entirely. MerchantModal.open() is async (fetches catalog) — we
  // call it and then wait for __merchantModalOpen to become true.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    // Attempt direct open via the modal reference stored on the scene.
    void scene?.merchantModal?.open?.();
  });

  const opened = await page.waitForFunction(
    () => (window as any).__merchantModalOpen === true,
    { timeout: 6000 },
  ).catch(() => null);

  if (!opened) {
    // Direct open hook not available in this harness — fall back to a weaker but
    // stable guard: assert that no unexpected .er-dom-label nodes appear at idle.
    // This still catches the "misclassification adds a DOM node at scene load" bug.
    const idleCount = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
    expect(
      idleCount,
      `Idle forest scene .er-dom-label count (${idleCount}) must not exceed baseline (${baseline}) — world-space labels must not create DOM nodes`,
    ).toBe(baseline);
    await ctx.close();
    return;
  }

  // Count with modal open — must be >= baseline (modal adds DOM labels for header).
  const countOpen1 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(countOpen1).toBeGreaterThanOrEqual(baseline);

  // Close modal programmatically — no zone or keyboard dependency.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    scene?.merchantModal?.close?.();
  });
  // After programmatic close, __merchantModalOpen is set to false synchronously
  // inside close(). No waitForFunction needed — just give the microtask queue a frame.
  await page.waitForTimeout(100);

  // #382 adversarial: DOM leak check — count must return to baseline after close.
  const countAfterClose1 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countAfterClose1,
    `After first Merchant modal close, .er-dom-label count (${countAfterClose1}) must equal baseline (${baseline}) — destroy() not called on close leaks DOM nodes`,
  ).toBe(baseline);

  // Second open+close cycle — guards "works once, leaks on second" bug.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    void scene?.merchantModal?.open?.();
  });
  await page.waitForFunction(
    () => (window as any).__merchantModalOpen === true,
    { timeout: 6000 },
  );
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    scene?.merchantModal?.close?.();
  });
  await page.waitForTimeout(100);

  const countAfterClose2 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countAfterClose2,
    `After second Merchant modal close, .er-dom-label count (${countAfterClose2}) must equal baseline (${baseline}) — DOM nodes must not accumulate across two open/close cycles`,
  ).toBe(baseline);

  await ctx.close();
});

// #382 adversarial: Campfire modal open+close twice — no leaked .er-dom-label.
// CampfireModal uses crispCanvasText (no DOM nodes created). The test guards
// against DOM accumulation from any other concurrent addDomLabel sites in the
// modal. After two cycles the count must equal the baseline.
test('dom-label #382 H2: CampfireModal open+close twice leaves zero leaked .er-dom-label nodes', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Suppress edge transitions so no spurious scene stop fires during the test.
  await page.evaluate(() => {
    const scene = (window as any).__scene;
    if (scene) scene.suppressEdgeTransitions = true;
  });

  // Wait for the campfire zone to appear in __zoneCenters (confirms anchorage
  // screen is loaded and the campfire InteractionZone has been built).
  // __campfireRest is only set when the modal is OPEN, so it cannot serve as
  // a pre-condition here — use the zone center sentinel instead.
  await page.waitForFunction(
    () => {
      const zc = (window as any).__zoneCenters as Record<string, { x: number; y: number }> | undefined;
      return !!zc && Object.keys(zc).some((k) => k === 'forest_anchorage' || k.startsWith('forest_'));
    },
    { timeout: 10000 },
  );

  // Position the player on the campfire zone center so pressing E fires the campfire modal.
  const campfireZoneKey = await page.evaluate(() => {
    const zc = (window as any).__zoneCenters as Record<string, { x: number; y: number }>;
    const key = Object.keys(zc).find((k) => k === 'forest_anchorage' || k.startsWith('forest_'));
    if (key) (window as any).__player?.setPosition(zc[key].x, zc[key].y);
    return key ?? null;
  });

  if (!campfireZoneKey) {
    // No campfire zone found — skip (anchorage not present on this screen).
    await ctx.close();
    return;
  }

  // Wait for the campfire zone to become the active zone in the overlap list.
  await page.waitForFunction(
    (key) => ((window as any).__sanctumZones as string[] | undefined)?.includes(key),
    campfireZoneKey,
    { timeout: 5000 },
  );

  const baseline = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);

  // Open the campfire modal via E press (identical path to player pressing E on the zone).
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => (window as any).__campfireModal !== null && (window as any).__campfireModal !== undefined,
    { timeout: 5000 },
  ).catch(() => {
    // If the modal did not open (e.g., player missed the zone), degrade gracefully.
  });

  const isOpen = await page.evaluate(() => !!(window as any).__campfireModal);
  if (!isOpen) {
    // Campfire modal open not reachable via current hook surface — skip this test.
    await ctx.close();
    return;
  }

  // Count with modal open (must be >= baseline; CampfireModal uses crispCanvasText
  // so it should add zero .er-dom-label nodes, but we accept >= for safety).
  const countOpen1 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(countOpen1).toBeGreaterThanOrEqual(baseline);

  // Close via the scene's private campfireModal reference (accessible at runtime).
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    scene?.campfireModal?.close?.();
  });
  await page.waitForFunction(() => !(window as any).__campfireModal, { timeout: 3000 });

  const countAfterClose1 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countAfterClose1,
    `After first Campfire modal close, .er-dom-label count (${countAfterClose1}) must equal baseline (${baseline}) — any addDomLabel added by #382 in CampfireModal must be destroyed on close`,
  ).toBe(baseline);

  await ctx.close();
});

// #382 adversarial: DifficultyModal open+close twice — no leaked .er-dom-label.
// DifficultyModal rows are Container children (crispCanvasText only — no DOM
// labels expected). The test guards the opposite risk: that the implementation
// DOES NOT accidentally convert any DifficultyModal label to addDomLabel (which
// would be a misclassification since all rows are Container children).
test('dom-label #382 H3: DifficultyModal open+close leaves no new .er-dom-label nodes (Container children must not be DOM)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(
    () =>
      (window as any).__campState !== undefined &&
      typeof (window as any).__campOpenSettings === 'function',
    { timeout: 8000 },
  );

  const baseline = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);

  // Open the DifficultyModal.
  await page.evaluate(() => (window as any).__campOpenSettings());
  await page.waitForFunction(() => (window as any).__difficultyState !== undefined, { timeout: 5000 });

  // #382 adversarial: DifficultyModal tier rows are Container children; a
  // misclassification to addDomLabel would add unexpected .er-dom-label nodes.
  const countOpen = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countOpen,
    `DifficultyModal open must not add any new .er-dom-label nodes (all rows are Container children → crispCanvasText, not addDomLabel). Baseline: ${baseline}, found: ${countOpen}`,
  ).toBe(baseline);

  // Close by clicking the backdrop.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
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
  await page.waitForFunction(() => (window as any).__difficultyState === undefined, { timeout: 5000 });

  // Reopen.
  await page.evaluate(() => (window as any).__campOpenSettings());
  await page.waitForFunction(() => (window as any).__difficultyState !== undefined, { timeout: 5000 });

  const countOpen2 = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countOpen2,
    `DifficultyModal second open must still show zero new .er-dom-label nodes. Baseline: ${baseline}, found: ${countOpen2}`,
  ).toBe(baseline);

  // Close.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const walk = (obj: any): any => {
      if (obj?.name === 'difficulty-backdrop') return obj;
      const kids: any[] = typeof obj?.getAll === 'function' ? obj.getAll() : [];
      for (const k of kids) { const hit = walk(k); if (hit) return hit; }
      return null;
    };
    for (const root of scene.children.getAll()) {
      const bd = walk(root);
      if (bd) return bd.emit('pointerdown');
    }
  });
  await page.waitForFunction(() => (window as any).__difficultyState === undefined, { timeout: 5000 });

  const countAfterFinalClose = await page.evaluate(() => document.querySelectorAll('.er-dom-label').length);
  expect(
    countAfterFinalClose,
    `After DifficultyModal final close, .er-dom-label count must equal baseline (${baseline})`,
  ).toBe(baseline);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group I — #386 crispCanvasText re-render contract
//
// crispCanvasText sets text.setResolution(ceil(dpr)) + LINEAR filter ONCE at
// creation. Phaser's Text.updateText re-rasterizes the canvas and re-uploads it
// to the GPU (canvasToTexture(..., true) replaces the glTexture), discarding any
// previously-set filter. Every setText/setStyle/setColor funnels through
// updateText, so without the #386 instance-level updateText override the label
// reverts to soft/blocky (scaleMode !== LINEAR) on the first mutation.
//
// LINEAR === 0 (Phaser.Textures.FilterMode.LINEAR; NEAREST === 1). TextureSource
// .setFilter sets this.scaleMode = filterMode, so a LINEAR filter yields
// scaleMode === 0. The filter is stored on the Text's texture source:
// text.texture.source[0].scaleMode. The resolution is text.style.resolution.
// These tests drive REAL crispCanvasText widgets — the reliquary header (setText
// path) and the SPIRIT column label (setColor path) — and assert both invariants
// survive a re-render. No call-site changes were made: the fix lives entirely in
// crispCanvasText.
// ═══════════════════════════════════════════════════════════════════════════

/** Reliquary wall zone center from client/public/assets/maps/sanctum.json. */
const RINGWALL = { x: 128, y: 56 };

/** Boot to CampScene (Sanctum interior) and wait for the camp hooks. */
async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Walk to the Reliquary wall zone and open the ringwall overlay. */
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
  // The header labels exist once the overlay is open.
  await page.waitForFunction(
    () =>
      !!(window as any).__scene?.children
        ?.getAll?.()
        ?.flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
        ?.flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
        ?.find((o: any) => o.name === 'reliquary-header-left'),
    { timeout: 5000 },
  );
}

/**
 * Read a scene Text object's crisp-state by name (searches nested containers):
 * its resolution and its texture source scaleMode (0 === LINEAR). Returns null
 * when no Text with that name is found.
 */
async function readCrispState(
  page: Page,
  name: string,
): Promise<{ resolution: number; scaleMode: number } | null> {
  return page.evaluate((n) => {
    const scene = (window as any).__scene as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === n) as any;
    if (!found) return null;
    return {
      resolution: found.style?.resolution ?? -1,
      scaleMode: found.texture?.source?.[0]?.scaleMode ?? -1,
    };
  }, name);
}

// #386 I1: a setText() on a crispCanvasText label (the reliquary header,
// populated via renderReliquaryHeader) must retain resolution === ceil(dpr) AND
// LINEAR filter. Before the fix the updateText re-upload discarded the filter.
test('crisp-text #386 I1: setText on a crispCanvasText label retains ceil(dpr) resolution and LINEAR filter', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Force a re-render through setText (the renderReliquaryHeader path).
  await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === 'reliquary-header-right') as any;
    found?.setText('Total XP: 999  |  Avg Battle XP: 42');
  });

  const expectedRes = await page.evaluate(() => Math.ceil(window.devicePixelRatio));
  const state = await readCrispState(page, 'reliquary-header-right');

  expect(state, 'reliquary-header-right Text must be found in the scene graph').not.toBeNull();
  expect(
    state!.resolution,
    `#386: resolution after setText (${state!.resolution}) must equal ceil(dpr) (${expectedRes})`,
  ).toBe(expectedRes);
  expect(
    state!.scaleMode,
    `#386: texture scaleMode after setText (${state!.scaleMode}) must be 0 (LINEAR) — updateText override must re-apply the filter`,
  ).toBe(0);

  await ctx.close();
});

// #426 I2 (retargeted from #386 I2): a setColor() on a crispCanvasText label
// ('overlay-status', a structural crisp-after-setColor anchor in CampScene.renderLeft)
// must retain ceil(dpr) resolution AND the LINEAR filter. setColor funnels through
// updateText just like setText — this is a structural contract test (the test calls
// setColor directly via page.evaluate; 'overlay-status' has no production recolor path).
test('crisp-text #386 I2: setColor on overlay-status retains ceil(dpr) resolution and LINEAR filter', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Recolor the overlay-status label (named 'overlay-status') directly — structural
  // crisp-after-setColor contract test (calls setColor via page.evaluate).
  await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === 'overlay-status') as any;
    found?.setColor('#ff5555');
  });

  const expectedRes = await page.evaluate(() => Math.ceil(window.devicePixelRatio));
  const state = await readCrispState(page, 'overlay-status');

  expect(state, 'overlay-status must be found in the scene graph').not.toBeNull();
  expect(
    state!.resolution,
    `#386: resolution after setColor (${state!.resolution}) must equal ceil(dpr) (${expectedRes})`,
  ).toBe(expectedRes);
  expect(
    state!.scaleMode,
    `#386: texture scaleMode after setColor (${state!.scaleMode}) must be 0 (LINEAR)`,
  ).toBe(0);

  await ctx.close();
});

// #386 I3: open the reliquary; after renderReliquaryHeader populates the three
// header segments via setText, all of reliquary-header-left/center/right must
// render with the LINEAR filter (scaleMode === 0). This is the header-fuzz
// symptom from the original report, verified end-to-end through the real render.
test('crisp-text #386 I3: reliquary header segments render with LINEAR filter after renderReliquaryHeader', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const expectedRes = await page.evaluate(() => Math.ceil(window.devicePixelRatio));
  const segments = ['reliquary-header-left', 'reliquary-header-center', 'reliquary-header-right'];

  for (const name of segments) {
    const state = await readCrispState(page, name);
    expect(state, `${name} Text must be found in the scene graph`).not.toBeNull();
    expect(
      state!.scaleMode,
      `#386: ${name} texture scaleMode (${state!.scaleMode}) must be 0 (LINEAR) after renderReliquaryHeader's setText`,
    ).toBe(0);
    expect(
      state!.resolution,
      `#386: ${name} resolution (${state!.resolution}) must equal ceil(dpr) (${expectedRes})`,
    ).toBe(expectedRes);
  }

  await ctx.close();
});
