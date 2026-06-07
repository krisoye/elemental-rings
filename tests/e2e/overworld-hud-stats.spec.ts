/**
 * E2E spec for #353/#355 — Overworld HUD: ♥ HP, Total XP, Avg Battle XP; two-row location label.
 *
 * The persistent resource HUD (top-right, `BaseBiomeScene.hudText`) now shows:
 *   Day N · Gold N · Food N · Spirit N/N · ♥ N/N · XP N · Avg XP N
 *
 * All values are verbatim from /api/me — never computed client-side. These
 * tests assert that all segments appear and match server data, and
 * that the HUD and the Manage Battle Rings modal do not overlap.
 * The location label (biomeTitle) renders as two rows (biome / area) when area exists.
 *
 * #362 — the HUD line, the two-row location label, and the NPC prompt are now
 * rendered as DOM elements (`addDomLabel`) layered over the WebGL canvas, NOT as
 * Phaser Text in the scene graph. These assertions therefore query the DOM nodes
 * (`[data-label="overworld-hud"]`, `[data-label="biome-title"]`, etc.) via the
 * Playwright browser context rather than scene/canvas hooks.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Boot to CampScene and navigate to a Forest screen. */
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

/**
 * Read the current HUD text from the DOM node (#362 migration). The HUD line is
 * now a DOM element with `data-label="overworld-hud"`, not a Phaser Text object.
 */
async function getHudText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.querySelector('[data-label="overworld-hud"]');
    return node?.textContent ?? '';
  });
}

/**
 * Read the two-row location label text from its DOM node (#362). The biome title
 * is a DOM element with `data-label="biome-title"`; its `textContent` preserves
 * the `\n` between biome (line 1) and area (line 2).
 */
async function getBiomeTitleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.querySelector('[data-label="biome-title"]');
    return node?.textContent ?? '';
  });
}

/** Trigger refreshHud() and wait until the HUD DOM node reflects the update. */
async function waitForHudRefresh(page: Page, timeout = 4000): Promise<void> {
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    // refreshHud is private but accessible at runtime for E2E.
    return scene?.refreshHud?.();
  });
  // Give the async fetch time to complete; poll the DOM node, not a scene object.
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="overworld-hud"]');
      const txt: string = node?.textContent ?? '';
      return txt.includes('♥') && txt.includes('Avg XP');
    },
    { timeout },
  );
}

// ── Scenario 1 — heart ring equipped: ♥ N/N matches /api/me ──────────────────
test('overworld HUD (#353): ♥ cur/max, Total XP and Avg match /api/me when heart ring equipped', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { current_uses: number; max_uses: number } | null; total_xp?: number; battle_hand_avg_xp?: number } };

  const heart = me.player.heart_ring;
  // A fresh player should have a heart ring equipped.
  expect(heart).toBeTruthy();

  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  // ♥ cur/max segment
  const expectedHeart = `♥ ${heart!.current_uses}/${heart!.max_uses}`;
  expect(hud).toContain(expectedHeart);

  // XP and Avg XP segments present (no "Total:" prefix)
  const expectedXp = `XP ${me.player.total_xp?.toLocaleString() ?? '0'}`;
  expect(hud).toContain(expectedXp);
  expect(hud).toContain('Avg XP');

  // Existing segments still present
  expect(hud).toMatch(/Day \d/);
  expect(hud).toContain('Gold');
  expect(hud).toContain('Food');
  expect(hud).toContain('Spirit');
  // Note: do not assert "XP" alone — it could match XP anywhere. The expectedXp check above is precise.

  await ctx.close();
});

// ── Scenario 2 — no heart ring: HUD shows ♥ 0/0 ──────────────────────────────
test('overworld HUD (#353): shows ♥ 0/0 when heart slot is empty', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Delete the heart ring to empty the slot.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  try {
    if (heartId) {
      await fetch(`${API_URL}/api/rings/${heartId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok}` },
      });
    }

    await enterForestScreen(page, 'forest_anchorage');
    await page.waitForFunction(
      () => typeof (window as any).__overworldToggleBattleHand === 'function',
      { timeout: 8000 },
    );

    // Wait for HUD with empty heart (♥ 0/0). Poll the DOM node (#362), not a scene object.
    await page.waitForFunction(
      () => {
        const node = document.querySelector('[data-label="overworld-hud"]');
        const txt: string = node?.textContent ?? '';
        return txt.includes('♥ 0/0');
      },
      { timeout: 6000 },
    );

    const hud = await getHudText(page);
    expect(hud).toContain('♥ 0/0');
  } finally {
    // Restore the heart slot so this player's state is clean if auth tokens are
    // ever reused. Seed a new ring into the reliquary, fetch it, then equip it.
    if (heartId) {
      await fetch(`${API_URL}/api/test/seed-resting-rings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      });
      const restored = (await (
        await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
      ).json()) as {
        player: { heart_ring: null };
        rings: { id: string; in_carry: number; heart_slot: number }[];
      };
      const spare = restored.rings.find((r) => r.in_carry === 0 && r.heart_slot === 0);
      if (spare) {
        await fetch(`${API_URL}/api/heart-slot`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ringId: spare.id }),
        });
      }
    }
    await ctx.close();
  }
});

// ── Scenario 3 — HUD visible while modal open; panel top ≥ 44 ────────────────
test('overworld HUD (#353): HUD text is non-empty while Manage Battle Rings modal is open', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);

  // Open the Manage Battle Rings overlay.
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });

  // HUD text is still populated (no depth/visibility conflict with the modal).
  const hud = await getHudText(page);
  expect(hud.length).toBeGreaterThan(0);
  expect(hud).toContain('♥');
  expect(hud).toContain('Avg XP');

  // The manage modal panel starts at y ≥ 44 (clears the HUD).
  const panelTopY = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return null;
    // The panel is the second object added to the container (overlay at index 0, panel at 1).
    const objs = modal.getAll ? modal.getAll() : [];
    // Find the main panel rectangle: a Rectangle with strokeStyle, width 640.
    for (const o of objs) {
      if (o.width === 640 && typeof o.strokeColor !== 'undefined') {
        // Rectangle y is its center; top = y - height/2.
        return o.y - o.height / 2;
      }
    }
    return null;
  });
  expect(panelTopY).not.toBeNull();
  expect(panelTopY!).toBeGreaterThanOrEqual(44);

  await ctx.close();
});

// ── Regression #1 — zero XP/Avg XP (fresh player, no battles) ────────────────
// A freshly-minted player has total_xp=0 and battle_hand_avg_xp=0. The HUD
// must render `XP 0` and `Avg XP 0`, not `NaN`, `undefined`, or an empty
// segment. This locks in the `?? 0` fallbacks in refreshHud().
test('overworld HUD (#353 regression): zero total_xp and avg render as "XP 0" and "Avg XP 0" — not NaN or empty', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });

  // Confirm the fresh-player precondition: battle_hand_avg_xp should be 0 (no
  // battles played yet). Verify the type and capture values for exact matching.
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { total_xp?: number; battle_hand_avg_xp?: number } };
  const totalXp = me.player.total_xp ?? 0;
  const avgXp = me.player.battle_hand_avg_xp ?? 0;
  expect(typeof totalXp).toBe('number');
  expect(typeof avgXp).toBe('number');

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  // Core assertion: neither segment may contain 'NaN' or 'undefined'.
  expect(hud).toContain('Avg XP');
  expect(hud).not.toContain('NaN');
  expect(hud).not.toContain('undefined');

  // Rendered value must match server value processed through the same formatting
  // as the implementation: toLocaleString() for XP, Math.round+toLocaleString for Avg XP.
  const expectedXp = `XP ${totalXp.toLocaleString()}`;
  const expectedAvg = `Avg XP ${Math.round(avgXp).toLocaleString()}`;
  expect(hud).toContain(expectedXp);
  expect(hud).toContain(expectedAvg);

  await ctx.close();
});

// ── Regression #2 — separator consistency ────────────────────────────────────
// The spec mandates ` · ` (space-middot-space style) as the sole separator
// between HUD segments. The implementation uses `  ·  ` (two spaces each side).
// A mixed separator (` - `, `|`) in the new segments would indicate a different
// code path was introduced and the style contract is broken.
test('overworld HUD (#353 regression): all HUD segments use the canonical "  ·  " separator — no mixed styles', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  // No alternative separator variants anywhere in the string.
  expect(hud).not.toMatch(/ - /);    // dash separator
  expect(hud).not.toMatch(/\|/);     // pipe separator
  expect(hud).not.toMatch(/ \| /);   // spaced pipe
  expect(hud).not.toMatch(/·{2,}/);  // doubled middot

  // Splitting on the canonical double-spaced separator yields well-formed tokens.
  const SEPARATOR = '  ·  ';
  const segments = hud.split(SEPARATOR);
  // Spec requires at minimum 7 segments: Day · Gold · Food · Spirit · ♥ · XP · Avg XP
  expect(segments.length).toBeGreaterThanOrEqual(7);
  for (const seg of segments) {
    expect(seg.trim().length, `segment "${seg}" must not be blank`).toBeGreaterThan(0);
  }

  await ctx.close();
});

// ── Regression #3 — segment order ────────────────────────────────────────────
// The spec prescribes the display order: Day … Gold … Food … Spirit … ♥ … XP
// … Avg XP. Tests using only `toContain` cannot catch a correct set of
// segments rendered in the wrong order. This test uses indexOf position
// comparisons to enforce strict left-to-right ordering per the spec.
test('overworld HUD (#355 regression): segment order is Day · Gold · Food · Spirit · ♥ · XP · Avg XP', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  const positions = {
    Day:    hud.indexOf('Day '),
    Gold:   hud.indexOf('Gold '),
    Food:   hud.indexOf('Food '),
    Spirit: hud.indexOf('Spirit '),
    Heart:  hud.indexOf('♥ '),
    XP:     hud.indexOf('  ·  XP '),
    AvgXP:  hud.indexOf('Avg XP'),
  };

  // All segments must be present (indexOf returns −1 when absent).
  for (const [key, pos] of Object.entries(positions)) {
    expect(pos, `segment "${key}" must appear in HUD string`).toBeGreaterThanOrEqual(0);
  }

  // Strict ascending position order per the spec-mandated display sequence.
  expect(positions.Day).toBeLessThan(positions.Gold);
  expect(positions.Gold).toBeLessThan(positions.Food);
  expect(positions.Food).toBeLessThan(positions.Spirit);
  expect(positions.Spirit).toBeLessThan(positions.Heart);
  expect(positions.Heart).toBeLessThan(positions.XP);
  expect(positions.XP).toBeLessThan(positions.AvgXP);

  await ctx.close();
});

// ── Scenario 4 — two-row location label when area exists ──────────────────
test('overworld HUD (#355): location label renders two rows (biome / area) when area name exists', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // #362 — biomeTitle is now a DOM node ([data-label="biome-title"]); textContent
  // preserves the '\n' between biome (line 1) and area (line 2).
  const labelText = await getBiomeTitleText(page);

  // The text should contain a newline when area name is present (forest_anchorage has area name).
  expect(labelText).toContain('\n');
  const lines = labelText.split('\n');
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines[0]).toBe('Forest');
  expect(lines[1]).toBe('The Anchorage');

  await ctx.close();
});

// ── Single-row fallback (edge case, not E2E-tested) ───────────────────────
// When screenId is unknown (not in the screen manifest), refreshHud() renders
// only the biome name with no newline. This edge case cannot be reliably
// triggered via E2E (the manifest provides a name for every real screen), so
// we omit a test for it. The code path is tested via unit tests of the
// formatting logic in refreshHud().

// ══════════════════════════════════════════════════════════════════════════════
// #355 REGRESSION TESTS — lock in HUD XP rename and two-row location label
// ══════════════════════════════════════════════════════════════════════════════

// ── #355 Regression A — no legacy colon-style labels ─────────────────────────
// The old HUD used `Total:` and `Avg:` with colons. The spec renames them to
// `XP` and `Avg XP` (no colons). Any copy-paste reversion would immediately
// re-introduce the colon forms. This test guards that gate.
test('overworld HUD (#355 regression): HUD does not contain legacy "Total:" or "Avg:" colon-style labels', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  // Spec says: rename `Total:` → `XP` and `Avg:` → `Avg XP` — no colons.
  expect(hud, 'HUD must not contain legacy "Total:" label').not.toContain('Total:');
  expect(hud, 'HUD must not contain legacy "Avg:" label').not.toContain('Avg:');

  // Positive assertion: the new-style labels are present.
  expect(hud).toContain('XP');
  expect(hud).toContain('Avg XP');

  await ctx.close();
});

// ── #355 Regression B — aggregate_xp segment not rendered ────────────────────
// The old HUD rendered a separate `XP {aggregate_xp}` segment (Reliquary-only XP)
// between `♥` and the total XP. The spec removes it. When aggregate_xp ≠ total_xp
// (rings split between carry and Reliquary), the old code would produce two
// different XP numbers — the new code must show only total_xp under the `XP` label.
// When aggregate_xp === total_xp (no Reliquary rings), the test degrades to a
// conformance assertion: `XP` label present, no `Total:` label.
test('overworld HUD (#355 regression): aggregate_xp segment is not rendered — only total_xp appears as "XP N"', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as {
    player: {
      aggregate_xp?: number;
      total_xp?: number;
    };
  };

  const aggregateXp = me.player.aggregate_xp ?? 0;
  const totalXp = me.player.total_xp ?? 0;

  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  if (aggregateXp !== totalXp) {
    // When they differ, the Reliquary-only number is distinct from the total.
    // The old HUD would render both; the new HUD must render ONLY total_xp.
    // Guard: aggregate_xp's formatted value must not appear as a separate segment
    // to the LEFT of the `XP` label (i.e. between ♥ and XP).
    const heartPos = hud.indexOf('♥ ');
    const xpPos    = hud.indexOf('  ·  XP ');
    expect(heartPos, 'Heart segment must be present').toBeGreaterThanOrEqual(0);
    expect(xpPos,    'XP segment must be present').toBeGreaterThanOrEqual(0);

    // The substring between ♥ and XP must NOT contain the Reliquary-only number.
    const segmentBetween = hud.slice(heartPos, xpPos);
    const aggregateFormatted = aggregateXp.toLocaleString();
    expect(
      segmentBetween,
      `Reliquary-only aggregate_xp value "${aggregateFormatted}" must not appear between ♥ and XP segments`,
    ).not.toContain(aggregateFormatted);
  } else {
    // aggregate_xp === total_xp: values coincide, cannot distinguish by number alone.
    // Informational: assert the new-style label and absence of old-style label.
    expect(hud).toContain('XP');
    expect(hud).not.toContain('Total:');
  }

  await ctx.close();
});

// ── #355 Regression C — exact segment count ──────────────────────────────────
// The spec defines exactly 7 HUD segments separated by `  ·  ` (two-space middot):
//   Day · Gold · Food · Spirit · ♥ · XP · Avg XP
// That means exactly 6 separators. Fewer means a segment was dropped; more means
// an extra segment was added (e.g. the removed aggregate_xp crept back in).
test('overworld HUD (#355 regression): exactly 6 "  ·  " separators (7 segments: Day · Gold · Food · Spirit · ♥ · XP · Avg XP)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);
  const hud = await getHudText(page);

  const SEPARATOR = '  ·  ';
  // Count occurrences of the canonical separator.
  const separatorCount = (hud.split(SEPARATOR).length - 1);
  expect(
    separatorCount,
    `Expected exactly 6 "  ·  " separators (7 segments) but found ${separatorCount} in: "${hud}"`,
  ).toBe(6);

  await ctx.close();
});

// ── #355 Regression D — biomeTitle newline present for forest_anchorage ──────
// The spec changes the location label separator from `  –  ` to `\n`. Phaser Text
// renders `\n` as a second visible line. This test asserts the newline is present
// for a screen that has an area name, guarding against a reversion to the old
// dash-separated single-line format.
test('overworld HUD (#355 regression): biomeTitle uses newline separator (not dash) when area name exists (forest_anchorage)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);  // loads forest_anchorage, which has area name "The Anchorage"

  const labelText = await getBiomeTitleText(page); // #362 — DOM node textContent

  // Spec says: `${biomeName}\n${areaName}` — newline separator, not ` – `.
  expect(
    labelText,
    'biomeTitle must contain a newline when area name exists (area name is "The Anchorage")',
  ).toContain('\n');

  // Lines must split correctly into biome and area.
  const lines = labelText.split('\n');
  expect(lines[0], 'First line must be the biome name').toBe('Forest');
  expect(lines[1], 'Second line must be the area name').toBe('The Anchorage');

  await ctx.close();
});

// ── #355 Regression E — no old dash separator in biomeTitle ──────────────────
// The old format was `Forest  –  The Anchorage` (two spaces on each side of an
// en-dash). This test asserts that exact pattern is gone, regardless of which
// screen is loaded. Guards against a partial revert that preserves the dash but
// removes one space, or swaps the character — the complete old token must be absent.
test('overworld HUD (#355 regression): biomeTitle does not use old "  –  " dash separator', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);  // loads forest_anchorage

  const labelText = await getBiomeTitleText(page); // #362 — DOM node textContent

  // Spec says: separator is `\n`, not `  –  `. The old three-space-dash pattern must be gone.
  expect(
    labelText,
    'biomeTitle must not use the old "  –  " dash separator',
  ).not.toContain('  –  ');

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// #362 — DOM-overlay migration: HUD / location label / NPC prompt are DOM nodes
// ══════════════════════════════════════════════════════════════════════════════

// ── #362 A — HUD, location label, and NPC prompt render as DOM nodes ─────────
// After the DOM migration these are real DOM elements layered over the WebGL
// canvas (addDomLabel), NOT Phaser Text in the scene graph. Assert the DOM nodes
// exist and carry the expected content.
test('overworld DOM (#362): HUD line and two-row location label are DOM nodes, not Phaser Text', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);

  // HUD DOM node exists with the populated stat line.
  const hud = await getHudText(page);
  expect(hud).toContain('♥');
  expect(hud).toContain('Avg XP');

  // Location-label DOM node exists with the two-row biome/area content.
  const loc = await getBiomeTitleText(page);
  expect(loc).toBe('Forest\nThe Anchorage');

  // The migrated objects must NOT be Phaser Text in the scene graph anymore:
  // hudText/npcPrompt are DOMElement instances; the scene no longer exposes a
  // `.text` string on them. Assert the DOM nodes are the source of truth.
  const domCounts = await page.evaluate(() => ({
    hud: document.querySelectorAll('[data-label="overworld-hud"]').length,
    title: document.querySelectorAll('[data-label="biome-title"]').length,
  }));
  expect(domCounts.hud).toBe(1);
  expect(domCounts.title).toBe(1);

  await ctx.close();
});

// ── #362 B — DOM labels are non-interactive (pointer-events: none) ───────────
// The EPIC mandates `pointer-events: none` on every DomLabel so the label never
// intercepts a click meant for the canvas beneath it. Verify via computed style.
test('overworld DOM (#362): HUD and location DOM labels have pointer-events:none (do not intercept canvas clicks)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);

  const pe = await page.evaluate(() => {
    const read = (sel: string) => {
      const node = document.querySelector(sel) as HTMLElement | null;
      return node ? getComputedStyle(node).pointerEvents : 'MISSING';
    };
    return {
      hud: read('[data-label="overworld-hud"]'),
      title: read('[data-label="biome-title"]'),
    };
  });
  expect(pe.hud).toBe('none');
  expect(pe.title).toBe('none');

  await ctx.close();
});

// ── #362 C — NPC prompt DOM node shows on zone enter, hides on exit ──────────
// The Approach [E] prompt is a lazily-created DOM label. Show/hide must continue
// to work via setVisible after the migration.
test('overworld DOM (#362): NPC prompt is a DOM node that shows when detected and hides when not', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);

  // Drive the prompt directly through the scene's private API (accessible at
  // runtime) so the test does not depend on NPC placement/pathing.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.showNpcPrompt?.('Approach [E]', false);
  });
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="npc-prompt"]') as HTMLElement | null;
      // Phaser DOMElement.setVisible toggles the node's CSS display.
      return !!node && node.textContent === 'Approach [E]' && getComputedStyle(node).display !== 'none';
    },
    { timeout: 4000 },
  );

  // pointer-events:none on the prompt too.
  const promptPe = await page.evaluate(() => {
    const node = document.querySelector('[data-label="npc-prompt"]') as HTMLElement | null;
    return node ? getComputedStyle(node).pointerEvents : 'MISSING';
  });
  expect(promptPe).toBe('none');

  // Hide it; the node persists but becomes display:none (reused next detection).
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.hideNpcPrompt?.();
  });
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-label="npc-prompt"]') as HTMLElement | null;
      return !!node && getComputedStyle(node).display === 'none';
    },
    { timeout: 4000 },
  );

  await ctx.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// #460 — field-modal [RECHARGE] must repaint the overworld spirit HUD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert logical canvas coordinates (1024×576) to page coordinates via the
 * canvas bounding rect — mirrors the helper in manage-battle-rings.spec.ts.
 */
async function canvasCoords(
  page: Page,
  logicalX: number,
  logicalY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas element not found');
  return {
    x: Math.round(box.x + logicalX * (box.width / 1024)),
    y: Math.round(box.y + logicalY * (box.height / 576)),
  };
}

// ── #460 — [RECHARGE] click in the field overlay repaints the HUD behind it ──
// Regression: BattleHandOverlay.onRecharge refreshed only the overlay; nothing
// called back into BaseBiomeScene.refreshHud(), so the overworld HUD kept the
// stale spirit value until the next unrelated repaint. The fix wires an
// onAfterRecharge callback through the overlay constructor.
//
// Setup note: there is no test route to deplete a carried ring's uses without a
// full duel, so the server-side recharge is a no-op here; the divergence between
// the painted HUD and the server's spirit value is seeded via /api/test/set-spirit
// instead. That detects the exact regression — a stale HUD that only the new
// post-recharge repaint can correct. The [RECHARGE] gesture itself is REAL
// pointer input (page.mouse.click on the canvas), never a hook.
test('overworld HUD (#460): field-modal [RECHARGE] repaints the spirit segment without closing the overlay', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await waitForHudRefresh(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { spirit_current?: number; spirit_max?: number } };
  const spiritMax = me.player.spirit_max ?? 0;
  const painted = me.player.spirit_current ?? 0;
  expect(spiritMax).toBeGreaterThan(0);

  // HUD currently shows the painted (full) spirit value.
  expect(await getHudText(page)).toContain(`Spirit ${painted}/${spiritMax}`);

  // Seed the server/HUD divergence: server spirit drops; the HUD must NOT know yet.
  const target = painted - 5;
  expect(target).toBeGreaterThanOrEqual(0);
  const setRes = await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ spirit: target }),
  });
  expect(setRes.ok).toBe(true);
  expect(await getHudText(page)).toContain(`Spirit ${painted}/${spiritMax}`); // still stale

  // Open the field battle-hand overlay (setup — hook allowed).
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });

  // Gesture under test: REAL pointer click on [RECHARGE] at logical (660, 389)
  // (COL_HEALTH_X, ROW_COMBAT1_Y in BenchHealthCombat.ts).
  const pt = await canvasCoords(page, 660, 389);
  await page.mouse.click(pt.x, pt.y);

  // The overworld HUD behind the modal must repaint to the server value (all
  // carried rings are full on a fresh player, so recharge-all leaves spirit at
  // the seeded target).
  await page.waitForFunction(
    (expected) => {
      const node = document.querySelector('[data-label="overworld-hud"]');
      return (node?.textContent ?? '').includes(expected);
    },
    `Spirit ${target}/${spiritMax}`,
    { timeout: 5000 },
  );

  // The overlay stayed open throughout — the repaint must not close it.
  expect(await page.evaluate(() => (window as any).__overworldBattleHandOpen)).toBe(true);

  // Server-authoritative cross-check: the HUD now matches /api/me exactly.
  const after = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { spirit_current?: number } };
  expect(after.player.spirit_current).toBe(target);

  await ctx.close();
});
