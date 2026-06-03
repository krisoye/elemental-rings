/**
 * E2E adversarial spec for #361/#362/#363 — DomLabel contract verification.
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
