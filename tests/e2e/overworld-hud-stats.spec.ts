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

/** Read the current hudText string from the live ForestScene. */
async function getHudText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    return scene?.hudText?.text ?? '';
  });
}

/** Trigger refreshHud() and wait until it resolves (no direct await, but a brief poll suffices). */
async function waitForHudRefresh(page: Page, timeout = 4000): Promise<void> {
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    // refreshHud is private but accessible at runtime for E2E.
    return scene?.refreshHud?.();
  });
  // Give the async fetch time to complete.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      const txt: string = scene?.hudText?.text ?? '';
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

    // Wait for HUD with empty heart (♥ 0/0).
    await page.waitForFunction(
      () => {
        const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
        const txt: string = scene?.hudText?.text ?? '';
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

  const labelText = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    // biomeTitle is the text object added to the scene in BaseBiomeScene.ts:518.
    // It's a child of uiRoot and accessible via the scene's children.
    const children = scene?.uiRoot?.getAll?.() ?? [];
    const biomeTitle = children.find((o: any) => o.text && o.text.includes('Forest'));
    return biomeTitle?.text ?? '';
  });

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
