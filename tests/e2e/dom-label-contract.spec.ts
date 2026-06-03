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

// #362 adversarial: after DOM migration the HUD text must live in the DOM, not
// in the Phaser scene graph — if the old canvas Text still exists alongside the
// DOM node, two texts overlap and the old scene-hook tests silently pass against
// stale canvas text.
test('dom-label #362 A1: HUD DOM node exists in the Phaser DOM container after overworld loads', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for HUD content — the DOM node must appear with at least Day/Gold/Food
  await page.waitForFunction(
    () => {
      const container = document.querySelector('#phaser-game [data-ph-dom]') ??
                        document.querySelector('#phaser-game div');
      if (!container) return false;
      // Look for any element whose textContent includes 'Day'
      return Array.from(container.querySelectorAll('*'))
        .some((el) => el.textContent?.includes('Day'));
    },
    { timeout: 8000 },
  );

  // The HUD DOM node must exist somewhere within the Phaser canvas wrapper
  const hudDomExists = await page.evaluate(() => {
    // Phaser DOM elements are inserted into the div#phaser-game DOM container
    const root = document.querySelector('#phaser-game');
    if (!root) return false;
    const allEls = Array.from(root.querySelectorAll('*'));
    return allEls.some((el) => (el as HTMLElement).innerText?.includes('Day'));
  });

  expect(
    hudDomExists,
    'HUD DOM node with "Day" segment must exist in the Phaser game container',
  ).toBe(true);

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
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Day'));
    },
    { timeout: 8000 },
  );

  const pointerEvents = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return null;
    const hudEl = Array.from(root.querySelectorAll('*'))
      .find((el) => (el as HTMLElement).innerText?.includes('Day')) as HTMLElement | undefined;
    if (!hudEl) return null;
    return window.getComputedStyle(hudEl).pointerEvents;
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
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Day'));
    },
    { timeout: 8000 },
  );

  const fontFamily = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return null;
    const hudEl = Array.from(root.querySelectorAll('*'))
      .find((el) => (el as HTMLElement).innerText?.includes('Day')) as HTMLElement | undefined;
    if (!hudEl) return null;
    return window.getComputedStyle(hudEl).fontFamily;
  });

  expect(fontFamily).not.toBeNull();
  // The font-family stack must include a monospace font (Courier New or monospace).
  // Browser resolved fontFamily may quote names: `"Courier New", Courier, monospace`
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
test('dom-label #362 A4: repeated HUD refreshes do not create duplicate DOM nodes', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Count HUD-like nodes before refresh
  const countBefore = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return 0;
    return Array.from(root.querySelectorAll('*'))
      .filter((el) => (el as HTMLElement).innerText?.includes('Day')).length;
  });

  // Trigger a refresh by calling refreshHud twice
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.refreshHud?.();
    scene?.refreshHud?.();
  });

  // Brief wait for async fetch
  await page.waitForTimeout(500);

  const countAfter = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return 0;
    return Array.from(root.querySelectorAll('*'))
      .filter((el) => (el as HTMLElement).innerText?.includes('Day')).length;
  });

  expect(
    countAfter,
    `HUD DOM node count after two refreshes (${countAfter}) must equal count before (${countBefore}) — refreshing must update textContent, not create new nodes`,
  ).toBe(countBefore);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// Group B — Two-row location label (BaseBiomeScene #362)
// ═══════════════════════════════════════════════════════════════════════════

// #362 adversarial: the two-row location label uses `\n` which requires
// white-space:pre in CSS to render as two visible lines. Without it, the `\n`
// renders as a space and the label collapses to a single line.
test('dom-label #362 B1: two-row location label DOM node has computed white-space === "pre"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for the location label to appear (it contains "Forest")
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Forest'));
    },
    { timeout: 8000 },
  );

  const { whiteSpace, textContent } = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return { whiteSpace: null, textContent: null };
    // Find the label that contains "Forest" and also contains "Anchorage" or a newline
    const locationEl = Array.from(root.querySelectorAll('*'))
      .find((el) => {
        const t = (el as HTMLElement).innerText ?? '';
        return t.includes('Forest') && (t.includes('\n') || t.includes('Anchorage'));
      }) as HTMLElement | undefined;
    if (!locationEl) return { whiteSpace: null, textContent: null };
    return {
      whiteSpace: window.getComputedStyle(locationEl).whiteSpace,
      textContent: locationEl.textContent,
    };
  });

  expect(
    whiteSpace,
    'Two-row location label must have white-space: pre — without it \\n renders as a space (label collapses)',
  ).toBe('pre');

  // Verify the two-row content
  expect(textContent).toContain('Forest');

  await ctx.close();
});

// #362 adversarial: the two-row label must also have pointer-events:none —
// it overlays a visually prominent area of the screen; a click on the location
// label text could otherwise block overworld movement/interaction.
test('dom-label #362 B2: two-row location label DOM node has pointer-events === "none"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Forest'));
    },
    { timeout: 8000 },
  );

  const pointerEvents = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return null;
    const locationEl = Array.from(root.querySelectorAll('*'))
      .find((el) => {
        const t = (el as HTMLElement).innerText ?? '';
        return t.includes('Forest');
      }) as HTMLElement | undefined;
    if (!locationEl) return null;
    return window.getComputedStyle(locationEl).pointerEvents;
  });

  expect(
    pointerEvents,
    'Location label DOM node must have pointer-events: none',
  ).toBe('none');

  await ctx.close();
});

// #362 adversarial: `Forest` on line 1 and `The Anchorage` on line 2 is the
// two-row format the spec mandates. If the implementation collapses them
// (renders "Forest The Anchorage" on one line), the visual layout breaks.
test('dom-label #362 B3: location label textContent contains both biome and area separated by newline', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Forest'));
    },
    { timeout: 8000 },
  );

  const textContent = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return null;
    const locationEl = Array.from(root.querySelectorAll('*'))
      .find((el) => {
        const t = (el as HTMLElement).innerText ?? '';
        return t.includes('Forest') && t.includes('Anchorage');
      }) as HTMLElement | undefined;
    return locationEl?.textContent ?? null;
  });

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
test('dom-label #363 C1: BattleHandOverlay title label exists as a DOM node (not canvas text)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // The overlay should have DOM labels for the title/section headers.
  // Wait briefly for the overlay to fully render.
  await page.waitForTimeout(500);

  // Look for DOM nodes containing "MANAGE" or "SPARE" or "BATTLE" (overlay section labels)
  const domOverlayLabelExists = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return false;
    const allEls = Array.from(root.querySelectorAll('*'));
    return allEls.some((el) => {
      const t = (el as HTMLElement).innerText ?? '';
      // Match known overlay section headers per the spec
      return t.includes('MANAGE') || t.includes('SPARE') || t.includes('DISCARD') || t.includes('BATTLE HAND');
    });
  });

  expect(
    domOverlayLabelExists,
    'BattleHandOverlay screen-fixed labels (title/SPARE/DISCARD headers) must exist as DOM nodes after #363 migration',
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

  // Check that per-card label text (element names like "FIRE", "WATER", tier "T1",
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
test('dom-label #363 C3: all DOM labels in the overlay have pointer-events === "none"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  await page.waitForTimeout(300);

  // Find all DOM text elements inside the Phaser container and check computed styles
  const violations = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return [] as string[];
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const htmlEl = el as HTMLElement;
      const t = htmlEl.innerText ?? '';
      if (t.trim().length === 0) continue;
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
test('dom-label #363 D1: DOM label count is stable after close+reopen cycle (no node proliferation)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);
  await page.waitForTimeout(300);

  // Count DOM text nodes after first open
  const countAfterOpen1 = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return 0;
    return Array.from(root.querySelectorAll('*'))
      .filter((el) => (el as HTMLElement).innerText?.trim().length > 0).length;
  });

  await closeBattleHand(page);
  await page.waitForTimeout(200);

  // Reopen
  await openBattleHand(page);
  await page.waitForTimeout(300);

  const countAfterOpen2 = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return 0;
    return Array.from(root.querySelectorAll('*'))
      .filter((el) => (el as HTMLElement).innerText?.trim().length > 0).length;
  });

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
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Day'));
    },
    { timeout: 8000 },
  );

  // Record how many pointer events the canvas receives before the click
  await page.evaluate(() => {
    (window as any).__canvasPointerdownCount = 0;
    const canvas = document.querySelector('#phaser-game canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', () => {
        (window as any).__canvasPointerdownCount++;
      });
    }
  });

  // Find the HUD label's bounding rect and click at its center
  const hudBounds = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return null;
    const hudEl = Array.from(root.querySelectorAll('*'))
      .find((el) => (el as HTMLElement).innerText?.includes('Day')) as HTMLElement | undefined;
    if (!hudEl) return null;
    const rect = hudEl.getBoundingClientRect();
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
// All DOM labels must use a monospace font — verified across HUD, location, overlay.
test('SpecConformance #361 E2: all Phaser DOM container text labels use monospace font family', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForFunction(
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Day'));
    },
    { timeout: 8000 },
  );

  const proportionalFontViolations = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return [] as string[];
    const PROPORTIONAL = ['sans-serif', 'Arial', 'Helvetica', 'Georgia', 'Verdana'];
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const htmlEl = el as HTMLElement;
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
test('SpecConformance #362 E3: HUD DOM node textContent updates after refreshHud() call', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Wait for HUD to appear with initial content
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#phaser-game');
      if (!root) return false;
      return Array.from(root.querySelectorAll('*'))
        .some((el) => (el as HTMLElement).innerText?.includes('Day'));
    },
    { timeout: 8000 },
  );

  // Capture the initial HUD text
  const textBefore = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return '';
    const hudEl = Array.from(root.querySelectorAll('*'))
      .find((el) => (el as HTMLElement).innerText?.includes('Day')) as HTMLElement | undefined;
    return hudEl?.textContent ?? '';
  });

  expect(textBefore.length).toBeGreaterThan(0);

  // Trigger a refreshHud() and wait for it to settle
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.refreshHud?.();
  });
  await page.waitForTimeout(1000);

  // Text should remain non-empty and still contain core segments
  const textAfter = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return '';
    const hudEl = Array.from(root.querySelectorAll('*'))
      .find((el) => (el as HTMLElement).innerText?.includes('Day')) as HTMLElement | undefined;
    return hudEl?.textContent ?? '';
  });

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
test('SpecConformance #362 E4: NPC prompt DOM node hides when not in NPC zone (initially hidden)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  await page.waitForTimeout(500);

  // The NPC prompt should not be visible initially (player not in NPC zone)
  // It may exist in the DOM but should not be visible/displayed
  const npcPromptVisible = await page.evaluate(() => {
    const root = document.querySelector('#phaser-game');
    if (!root) return false;
    // NPC prompt text typically says "Approach [E]" or similar
    const promptEl = Array.from(root.querySelectorAll('*'))
      .find((el) => {
        const t = (el as HTMLElement).innerText ?? '';
        return t.includes('[E]') || t.includes('Approach');
      }) as HTMLElement | undefined;
    if (!promptEl) return false; // not in DOM — definitely hidden
    const style = window.getComputedStyle(promptEl);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });

  expect(
    npcPromptVisible,
    'NPC prompt DOM node must not be visible when player is not in an NPC zone',
  ).toBe(false);

  await ctx.close();
});
