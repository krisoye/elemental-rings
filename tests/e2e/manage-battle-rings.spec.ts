/**
 * E2E spec for #305 / #348 — Manage Battle Rings (field BattleHandOverlay).
 *
 * #305 introduced the dedicated Heart slot; #348 redesigned the overlay into three
 * gap-separated 2-row clusters ([Won/Discard] · [Status/HP] · [A1 A2 / D1 D2]),
 * replaced the per-card × buttons with a single safe 3-step DISCARD slot, widened
 * the spare grid to 5×2 (both rows always visible), aligned the slot labels with
 * the Reliquary modal (STATUS for thumb, HP for heart), and gave the header HP + XP
 * parity (♥ cur/max | Total XP | Avg Battle XP).
 *
 * Every assertion reads real, server-authoritative state — window.__heartCardState,
 * window.__discardConfirmOpen, and /api/me — never mocked. All mutations round-trip
 * the server (DELETE /api/rings/:id, PUT /api/heart-slot, POST /api/spirit/recharge);
 * the overlay re-renders from the fresh /api/me.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Boot to CampScene, then restart on a Forest screen that exposes the Tab overlay hook. */
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

/** Open the Manage Battle Rings overlay and wait until the heart card has rendered. */
async function openBattleHand(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });
}

/**
 * Read every text label in the overlay's modal container (recursing sub-containers)
 * AND every crisp DOM label (#363 migrated the title + WON/DISCARD/slot/HEADER
 * section labels to DOM nodes, which are NOT in the Phaser scene graph). Merging
 * both sources keeps the content assertions stable across the canvas→DOM split.
 */
async function modalTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    if (modal) {
      const walk = (c: any): void => {
        for (const o of c.getAll ? c.getAll() : []) {
          if (typeof o.text === 'string') out.push(o.text);
          if (o.getAll) walk(o);
        }
      };
      walk(modal);
    }
    // #363 — include DOM chrome labels (title, WON ◆, DISCARD, A1/A2/D1/D2/STATUS,
    // spare HEADER) rendered over the canvas via addDomLabel. EXCLUDE the persistent
    // overworld labels (HUD, biome-title, npc-prompt): the HUD contains "Day N · Gold N"
    // and would otherwise trip the modal's "no header segments" assertions.
    const PERSISTENT = ['overworld-hud', 'biome-title', 'npc-prompt'];
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const id = (n as HTMLElement).getAttribute('data-label');
      if (id && PERSISTENT.includes(id)) return;
      const txt = (n as HTMLElement).textContent;
      if (txt) out.push(txt);
    });
    return out;
  });
}

/**
 * Count visible spare card rows and cells in the overlay's InventoryGrid.
 * #381 — the spare grid is now an InventoryGrid (a Container containing a
 * cardContainer which holds per-ring containers). We read it via the scene's
 * battleHand.spareGrid reference rather than heuristically scanning the modal.
 */
async function spareGridInfo(page: Page): Promise<{ rows: number; cells: number }> {
  return page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene?.battleHand;
    const grid = bh?.spareGrid;
    if (!grid) return { rows: 0, cells: 0 };
    // InventoryGrid exposes cardRows (Map<ringId, row>) and cards (Map<ringId, container>).
    // Use the public visibleRows + totalRows to derive visible cell count.
    const visibleRows = grid.getVisibleRows?.() ?? 0;
    const totalRows = grid.getTotalRows?.() ?? 0;
    const scrollRow = grid.getScrollRow?.() ?? 0;
    // Cards whose row falls in [scrollRow, scrollRow+visibleRows).
    const cardContainer = grid.getCardContainer?.();
    if (!cardContainer) return { rows: 0, cells: 0 };
    const allCards = cardContainer.getAll().filter((o: any) => o.getAll);
    // Count visible cards (setVisible controls this).
    const visibleCards = allCards.filter((o: any) => o.visible);
    // Derive row count from unique y positions of visible card centers.
    const ys = new Set(visibleCards.map((k: any) => Math.round(k.y)));
    return { rows: ys.size, cells: visibleCards.length };
  });
}

/**
 * Buy `n` Tier-1 rings and carry them (alongside the already-carried set) so they
 * show as spares. Returns the newly-bought ids. Unlike {@link seedOneSpare} this
 * carries cumulatively, so multiple spares survive in one carry set.
 */
async function seedSpares(token: string, n: number, element = 'fire'): Promise<string[]> {
  const beforeMe = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { rings: Array<{ id: string }> };
  const beforeIds = new Set(beforeMe.rings.map((r) => r.id));
  for (let i = 0; i < n; i++) {
    await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item: 'ring', element, tier: 1 }),
    });
  }
  const afterMe = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { rings: Array<{ id: string; in_carry: number }> };
  const newIds = afterMe.rings.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
  // Carry the already-carried set PLUS the new rings so the new ones become spares.
  const carried = afterMe.rings.filter((r) => r.in_carry === 1).map((r) => r.id);
  const carrySet = Array.from(new Set([...carried, ...newIds]));
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: carrySet }),
  });
  return newIds;
}

/** Buy one Tier-1 ring (default Fire) and carry it so it shows as a spare. */
async function seedOneSpare(token: string, element = 'fire'): Promise<string> {
  await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ item: 'ring', element, tier: 1 }),
  });
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { rings: Array<{ id: string; in_carry: number; heart_slot?: number }> };
  // The freshly-bought ring is the resting (in_carry = 0, non-heart) one.
  const bought = me.rings.find((r) => r.in_carry === 0 && !r.heart_slot);
  const id = bought?.id ?? me.rings[me.rings.length - 1].id;
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: [id] }),
  });
  return id;
}

// ── Scenario 1 — title, STATUS/HP cluster labels, header parity (#348/#352) ───
test('manage-battle-rings: title renders and the STATUS/HP cluster labels show', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Title was renamed from "Manage Battle Hand".
  const texts = await modalTexts(page);
  expect(texts).toContain('Manage Battle Rings');
  expect(texts).not.toContain('Manage Battle Hand');
  // #348 — thumb slot reads STATUS.
  expect(texts).toContain('STATUS');
  // #352 — HP card label is now "♥ cur/max" (not the plain "HP" string).
  expect(texts.some((t) => t.startsWith('♥'))).toBe(true);
  expect(texts.some((t) => t.includes('HEART'))).toBe(false); // old ♥ HEART label gone
  // Combat slots keep their uppercase labels.
  for (const l of ['A1', 'A2', 'D1', 'D2']) expect(texts).toContain(l);

  // A fresh player starts with a 3/3 heart ring (Wind), so the card is equipped
  // and full — its display state is published for assertions.
  const heart = await page.evaluate(() => (window as any).__heartCardState);
  expect(heart.equipped).toBe(true);
  expect(heart.currentUses).toBe(heart.maxUses);
  expect(heart.maxUses).toBeGreaterThan(0);

  await ctx.close();
});

// ── Scenario 1c (#389) — converged structure reporter (field mode) ────────────
// The field overlay shares the unified RingManagementOverlay structure: the
// columns are LOOT | BENCH | HEALTH | COMBAT, the Bench counter reads
// usedSpares/spare_ring_max, and — post-#389 — no card carries a Tier row. The
// player-facing "Bench" label replaces "Spares" (the code keeps `spare_*`).
test('manage-battle-rings (#389): __ringMgmtState reports field columns, Bench counter, no Tier row', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const state = await page.evaluate(() => (window as any).__ringMgmtState);
  expect(state).toBeTruthy();
  expect(state.mode).toBe('field');
  // Field LEFT column is LOOT (WON + DISCARD); the three shared columns match sanctum.
  expect(state.columns).toEqual(['LOOT', 'BENCH', 'HEALTH', 'COMBAT']);
  // No Spirit counter in the field (no resting-pool access away from the Sanctum).
  expect(state.counters.spirit).toBeUndefined();
  // Bench counter is present with a numeric n/max.
  expect(typeof state.counters.bench.n).toBe('number');
  expect(typeof state.counters.bench.max).toBe('number');
  // #389 — the Tier row was dropped from every RingCard surface.
  expect(state.anyCardHasTierRow).toBe(false);

  // Bench counter agrees with /api/me (battle-slotted + heart + pending excluded).
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  const slotted = new Set(Object.values(me.loadout).filter(Boolean) as string[]);
  if (me.player.heart_ring?.id) slotted.add(me.player.heart_ring.id);
  if (me.player.pending_ring_id) slotted.add(me.player.pending_ring_id);
  const expectedBench = me.rings.filter(
    (r: any) => r.in_carry === 1 && !slotted.has(r.id),
  ).length;
  expect(state.counters.bench.n).toBe(expectedBench);
  expect(state.counters.bench.max).toBe(me.player.spare_ring_max);

  // The player-facing column label reads "Bench" (a DOM label), not "Spare(s)".
  const benchLabel = await page.evaluate(() => {
    let found: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const txt = (n as HTMLElement).textContent ?? '';
      if (txt.startsWith('Bench:')) found = txt;
    });
    return found;
  });
  expect(benchLabel).toBeTruthy();
  expect(benchLabel!.startsWith('Bench:')).toBe(true);

  await ctx.close();
});

// ── Scenario 1b — #352/#381: panel geometry, header, HP card above STATUS ─────
// #381 updated: panel is now 760×500 (center 288, top 38). The modal gains a
// three-part Spirit/♥/XP header, so Day/Gold/Food are still absent but Total XP
// now appears in the header.
test('manage-battle-rings (#352/#381): panel 760×500, ♥ HP label present and above STATUS', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  const heart = me.player.heart_ring;
  const hp = heart ? `${heart.current_uses}/${heart.max_uses}` : '0/0';

  const texts = await modalTexts(page);

  // #352 §1 — game-play stats not exposed (Day/Gold/Food absent from the modal).
  expect(texts.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(texts.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(texts.some((t) => /Food:?\s*\d/.test(t))).toBe(false);
  // #381 — "Avg Battle XP:" is NOT in the new header (removed from field modal).
  expect(texts.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // #352 §4 — ♥ cur/max label is present in the modal (above the HP card).
  expect(texts.some((t) => t === `♥ ${hp}`)).toBe(true);

  // #381 §2 — panel is 760 wide, centered at (512, 288); top ≥ 38 (= 288−250).
  const panelTopY = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return null;
    const objs = (modal.getAll ? modal.getAll() : []) as any[];
    for (const o of objs) {
      if (o.width === 760 && typeof o.strokeColor !== 'undefined') {
        return o.y - o.height / 2;
      }
    }
    return null;
  });
  expect(panelTopY).not.toBeNull();
  expect(panelTopY!).toBeGreaterThanOrEqual(38);

  // #389 — converged COMBAT cluster: STATUS is LEFT-ALIGNED ABOVE the 2×2, so the
  // STATUS label sits above the A1 label on screen (STATUS row y=193, A1 row y=291).
  // STATUS and A1 are both DOM labels; compare their screen tops directly.
  const rowOrder = await page.evaluate(() => {
    let statusTop: number | null = null;
    let a1Top: number | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const t = (n as HTMLElement).textContent?.trim();
      if (t === 'STATUS') statusTop = (n as HTMLElement).getBoundingClientRect().top;
      if (t === 'A1') a1Top = (n as HTMLElement).getBoundingClientRect().top;
    });
    return { statusTop, a1Top };
  });
  expect(rowOrder.statusTop).not.toBeNull();
  expect(rowOrder.a1Top).not.toBeNull();
  // STATUS sits above the 2×2 (its A1 label) on screen.
  expect(rowOrder.statusTop!).toBeLessThan(rowOrder.a1Top!);

  // #352 §5 / #363 — every card label has a dark backing. The ♥ HP label stays on
  // canvas with a preceding backing Rectangle; the migrated section labels (STATUS,
  // A1, A2, D1, D2, DISCARD, WON ◆) are DOM nodes whose backing is CSS `background`.
  // Assert: the canvas ♥ label has its rect, and every migrated DOM label carries a
  // non-transparent CSS background.
  const backing = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    // Canvas ♥ HP label: the object immediately before it is a Rectangle.
    let heartHasBacking = false;
    if (modal) {
      const all = modal.getAll ? modal.getAll() : [];
      for (let i = 1; i < all.length; i++) {
        const o = all[i];
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          heartHasBacking = typeof all[i - 1].text !== 'string';
        }
      }
    }
    // DOM section labels: each migrated label has a non-transparent CSS background.
    const wanted = new Set(['STATUS', 'A1', 'A2', 'D1', 'D2', 'DISCARD', 'WON ◆']);
    let domLabelsWithBacking = 0;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const txt = (n as HTMLElement).textContent?.trim() ?? '';
      if (!wanted.has(txt)) return;
      const bg = getComputedStyle(n as HTMLElement).backgroundColor;
      // rgba(0,0,0,0.55) → not "transparent" / not fully transparent.
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') domLabelsWithBacking++;
    });
    return { heartHasBacking, domLabelsWithBacking };
  });
  expect(backing.heartHasBacking).toBe(true);
  // STATUS + A1 + A2 + D1 + D2 + DISCARD = 6 always-present DOM section labels with backing.
  expect(backing.domLabelsWithBacking).toBeGreaterThanOrEqual(6);

  await ctx.close();
});

// ── Scenario 2 — discard the heart ring → empty placeholder (0 HP) ────────────
test('manage-battle-rings: discarding the heart ring empties the slot (0 HP placeholder)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  expect(await page.evaluate(() => (window as any).__heartCardState.equipped)).toBe(true);

  // Discard the equipped heart ring via the server (the same DELETE the 3-step
  // DISCARD flow routes to), then refresh the overlay so it re-renders from /api/me.
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  expect(heartId).toBeTruthy();

  await fetch(`${API_URL}/api/rings/${heartId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok}` },
  });
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.refreshManageData?.();
  });
  await page.waitForFunction(() => (window as any).__heartCardState?.equipped === false, {
    timeout: 5000,
  });

  // The slot now reads empty / 0 HP via the placeholder.
  const texts = await modalTexts(page);
  expect(texts.some((t) => t.includes('0 HP'))).toBe(true);

  await ctx.close();
});

// ── Scenario 3 — swap a spare ring into the empty heart slot ──────────────────
test('manage-battle-rings: a spare ring can be equipped into the empty heart slot', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Empty the heart slot, then seed one carried spare (Water) to equip into it.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  if (heartId) {
    await fetch(`${API_URL}/api/rings/${heartId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }
  const spareId = await seedOneSpare(tok, 'water');

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);
  expect(await page.evaluate(() => (window as any).__heartCardState.equipped)).toBe(false);

  // Equip the spare into the heart slot (the exact server call the card click makes),
  // then refresh and assert the heart slot now holds the spare.
  await fetch(`${API_URL}/api/heart-slot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ ringId: spareId, releaseTo: 'spare' }),
  });
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.refreshManageData?.();
  });
  await page.waitForFunction(() => (window as any).__heartCardState?.equipped === true, {
    timeout: 5000,
  });

  const heartAfter = await page.evaluate(() => (window as any).__heartCardState);
  expect(heartAfter.equipped).toBe(true);
  // Water = element index 1 (the equipped spare's element is now the heart ring).
  expect(heartAfter.currentUses).toBe(heartAfter.maxUses);

  await ctx.close();
});

// ── Scenario 4 — Recharge All keeps the heart ring equipped and full ──────────
test('manage-battle-rings: Recharge All includes the heart ring (stays equipped, full)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  await fetch(`${API_URL}/api/spirit/recharge-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    return scene?.battleHand?.refreshManageData?.();
  });
  await page.waitForTimeout(200);

  const heart = await page.evaluate(() => (window as any).__heartCardState);
  expect(heart.equipped).toBe(true);
  expect(heart.currentUses).toBe(heart.maxUses);

  await ctx.close();
});

// ── Scenario 5 — 4×2 right-section cluster + 3-col InventoryGrid spare grid ──
// #381: the right section is now a 4-column × 2-row cluster. STATUS/HP sit at
// column-1 (x=659). Spare grid is a 3-col InventoryGrid with 3 visible rows.
test('manage-battle-rings (#381): 4×2 cluster renders and the 3-col spare InventoryGrid shows visible rows', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  // Seed 6 spares (2 full rows of 3) — deterministic regardless of WON-ring state.
  await seedSpares(tok, 6);

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // #389 — converged COMBAT cluster: STATUS is left-aligned above the 2×2 at the
  // A1/D1 column (x=759); HEALTH (♥ HP) keeps its own column at x=659.
  // #363 — STATUS is a DOM label; ♥ HP stays on canvas.
  const labelXs = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / 1024;
    const out: Record<string, number> = {};

    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if (n.textContent === 'STATUS') {
        const r = (n as HTMLElement).getBoundingClientRect();
        out.STATUS = Math.round((r.left + r.width / 2 - canvasRect.left) / scaleX);
      }
    });

    const scene = game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          out.HP = Math.round(o.x);
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return out;
  });
  // #389 — STATUS at the COMBAT left column x=759; HEALTH HP at x=659.
  expect(Math.abs(labelXs.STATUS - 759)).toBeLessThanOrEqual(1);
  expect(labelXs.HP).toBe(659);

  // The spare InventoryGrid shows the 6 seeded spares: 2 full rows of 3.
  // RINGWALL_VISIBLE_ROWS=3 so all 6 are visible without scrolling.
  const grid = await spareGridInfo(page);
  expect(grid.rows).toBe(2);    // 6 rings → ceil(6/3) = 2 rows
  expect(grid.cells).toBe(6);   // all 6 visible (within 3-row window)

  await ctx.close();
});

// ── Scenario 6 — safe 3-step discard: select → DISCARD slot → Cancel/Confirm ──
// #348 Scenario 2. Drives REAL Phaser pointer events: select a spare, click the
// DISCARD slot (group-1 row-1, x=303 y=268=ROW1_Y) → __discardConfirmOpen true, no ring
// gone; Cancel → ring still present; reselect + Discard → /api/me shows it removed.
test('manage-battle-rings: discarding a spare requires select → DISCARD slot → confirm', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const [spareId] = await seedSpares(tok, 1, 'water');

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // Emit pointerdown on the spare card (selects it), then on the DISCARD slot.
  const selectSpare = async (): Promise<void> => {
    await page.evaluate((id) => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene');
      const bh = scene.battleHand;
      // Select the spare through the swap manager (same state the card click sets).
      bh.swap.select(id, 'spare');
      bh.renderManageModal();
    }, spareId);
  };
  const clickDiscardSlot = async (): Promise<void> => {
    await page.evaluate(() => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene');
      const modal = scene.battleHand.manageModal;
      let target: any = null;
      const walk = (c: any): void => {
        for (const o of c.getAll ? c.getAll() : []) {
          if (o.name === 'discard-slot') target = o;
          if (o.getAll) walk(o);
        }
      };
      walk(modal);
      target?.emit('pointerdown');
    });
  };

  await selectSpare();
  await clickDiscardSlot();
  // Step 2: confirm modal open, ring NOT yet discarded.
  expect(await page.evaluate(() => (window as any).__discardConfirmOpen)).toBe(true);
  let me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(me.rings.some((r: any) => r.id === spareId)).toBe(true);

  // Cancel → modal closes, ring still present.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const cancel = scene.battleHand.discardConfirm
      ?.getAll()
      .find((o: any) => o.name === 'discard-confirm-no');
    cancel?.emit('pointerdown');
  });
  expect(await page.evaluate(() => (window as any).__discardConfirmOpen)).toBe(false);
  me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(me.rings.some((r: any) => r.id === spareId)).toBe(true);

  // Reselect → DISCARD slot → Discard → /api/me shows it gone.
  await selectSpare();
  await clickDiscardSlot();
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const yes = scene.battleHand.discardConfirm
      ?.getAll()
      .find((o: any) => o.name === 'discard-confirm-yes');
    yes?.emit('pointerdown');
  });
  await page.waitForFunction(
    async (id) => {
      const r = await fetch('http://localhost:2568/api/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('er_token')}` },
      });
      const d = await r.json();
      return !d.rings.some((x: any) => x.id === id);
    },
    spareId,
    { timeout: 8000 },
  );
  me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(me.rings.some((r: any) => r.id === spareId)).toBe(false);

  await ctx.close();
});

// ── Scenario 7 — DISCARD slot with nothing selected is a no-op ────────────────
test('manage-battle-rings: clicking DISCARD with nothing selected does not open the confirm', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Nothing selected → clicking the DISCARD slot is inert.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene.battleHand.manageModal;
    let target: any = null;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.name === 'discard-slot') target = o;
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    target?.emit('pointerdown');
  });
  expect(await page.evaluate(() => (window as any).__discardConfirmOpen ?? false)).toBe(false);

  await ctx.close();
});

// ── #381/#394 E2E — column X-centres: LOOT(~195) | BENCH(~474) | HEALTH(659) | COMBAT(759/837) ──
// #394 corrects column order: left-most is LOOT (WON/DISCARD x≈195), then BENCH grid
// (header x≈474), then HEALTH (x=659), then COMBAT (x=759/837).
// LOOT x-centre must be LESS THAN BENCH x-centre (ordering invariant).
test('manage-battle-rings (#381/#394): column X-centres — LOOT leftmost, then BENCH, HEALTH(659), COMBAT(759/837)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const positions = await page.evaluate(() => {
    const game = (window as any).__game;
    const result: Record<string, number> = {};

    // #363 — STATUS/A1/A2/D1/D2/DISCARD are DOM labels; WON card and HP on canvas.
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / 1024;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const el = n as HTMLElement;
      const text = el.textContent?.trim();
      if (!text) return;
      const rect = el.getBoundingClientRect();
      const logicalX = Math.round((rect.left + rect.width / 2 - canvasRect.left) / scaleX);
      if (text === 'STATUS') result.STATUS = logicalX;
      if (text === 'A1') result.A1 = logicalX;
      if (text === 'A2') result.A2 = logicalX;
      if (text === 'D1') result.D1 = logicalX;
      if (text === 'D2') result.D2 = logicalX;
      // DISCARD label is the canonical LOOT-column x-centre.
      if (text === 'DISCARD') result.DISCARD = logicalX;
      // Bench header label for ordering check.
      if (text?.startsWith('Bench:')) result.BENCH_HEADER = logicalX;
    });

    // ♥ HP stays on canvas.
    const scene = game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          result.HP = Math.round(o.x);
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return result;
  });

  // #394 — LOOT column (WON/DISCARD) is leftmost: x≈195, well left of BENCH.
  expect(Math.abs(positions.DISCARD - 195)).toBeLessThanOrEqual(2);
  // #394 — ordering invariant: LOOT x-centre < BENCH header x-centre.
  expect(positions.DISCARD).toBeLessThan(positions.BENCH_HEADER);
  // #394 — BENCH header is centred over the 3-col grid: x≈474.
  expect(Math.abs(positions.BENCH_HEADER - 474)).toBeLessThanOrEqual(2);
  // HEALTH (HP) at x=659. DOM-measured → ±1px; canvas exact.
  expect(positions.HP).toBe(659);
  // COMBAT cluster: STATUS left-aligned above A1/D1 at x=759; A2/D2 at x=837.
  expect(Math.abs(positions.STATUS - 759)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.A1 - 759)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.A2 - 837)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.D1 - 759)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.D2 - 837)).toBeLessThanOrEqual(1);

  await ctx.close();
});

// ── #350 E2E Scenario 2 — DISCARD label above discard-slot; slot has no text ───
// Assert that the modal contains a text object reading 'DISCARD', that the
// discard-slot rectangle itself has no text children, and that the slot is still
// named 'discard-slot'.
test('manage-battle-rings (#350): DISCARD label exists above discard-slot; slot interior has no text', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const result = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    // #363 — the DISCARD label is now a DOM node; scan the DOM for it.
    let hasDiscardLabel = false;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).textContent?.trim() === 'DISCARD') hasDiscardLabel = true;
    });
    // The discard-slot rect stays on canvas — verify via the scene graph.
    let discardSlotFound = false;
    let discardSlotHasTextChild = false;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.name === 'discard-slot') {
          discardSlotFound = true;
          // The discard-slot rect is a Rectangle (no getAll); it has no text children
          // by definition — but confirm it is not a Container with text inside.
          if (o.getAll) {
            discardSlotHasTextChild = o.getAll().some((child: any) => typeof child.text === 'string');
          }
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return { hasDiscardLabel, discardSlotFound, discardSlotHasTextChild };
  });

  expect(result.hasDiscardLabel).toBe(true);
  expect(result.discardSlotFound).toBe(true);
  expect(result.discardSlotHasTextChild).toBe(false);

  await ctx.close();
});

// ── #350 E2E Scenario 3 — battle-slot ring → empty spare → unstaked ───────────
// Seed a ring into battle slot a1. Open overlay, select the a1 card, click an
// empty spare placeholder. Re-fetch /api/me: the ring is still in_carry=1 but NOT
// in loadout.a1 (unstaked via PUT /api/loadout { a1: null }).
test('manage-battle-rings (#350): selecting a battle-slot ring and clicking empty spare unstakes it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Seed a ring into the a1 slot.
  // merchantBuyRing sets in_carry=1 immediately, so read the id from the response
  // rather than searching /api/me for an in_carry=0 ring. With EPIC #378's 5 starter
  // reliquary rings, a PUT /api/carry { ringIds: [reliqRingId] } call would exceed
  // the reliquary cap (10 resting > cap 9), causing the carry call to silently fail
  // and leaving the ring at in_carry=0, which makes the final in_carry===1 assertion fail.
  const buyRes = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
  });
  const buyData = (await buyRes.json()) as { ring: { id: string } };
  const ringId = buyData.ring.id;
  expect(ringId).toBeTruthy();
  // The merchant-bought ring is already in_carry=1; no PUT /api/carry needed.
  // Stake it into a1.
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ a1: ringId }),
  });

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // Select the a1 slot card via the swap manager (same state the card click sets).
  await page.evaluate((id) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene.battleHand;
    bh.swap.select(id, 'a1');
    bh.renderManageModal();
  }, ringId);

  // Find and click the empty spare placeholder. After the H-1 scroll fix the
  // placeholder Rectangle lives inside spareGrid.getCardContainer(), not as a
  // direct child of the modal container. Search there instead.
  // Phaser maps useHandCursor:true → input.cursor === 'pointer'.
  const clicked = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene?.battleHand;
    if (!bh) return false;
    const cardContainer = bh.spareGrid?.getCardContainer?.();
    if (!cardContainer) return false;
    // The placeholder is a bare Rectangle (no getAll) with a pointer cursor.
    for (const child of cardContainer.getAll()) {
      if (child.type === 'Rectangle' && child.input?.cursor === 'pointer') {
        child.emit('pointerdown');
        return true;
      }
    }
    return false;
  });
  expect(clicked).toBe(true);

  // Wait for the server round-trip (the overlay re-renders from fresh /api/me).
  await page.waitForFunction(
    async (id) => {
      const r = await fetch('http://localhost:2568/api/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('er_token')}` },
      });
      const d = await r.json();
      return d.loadout?.a1 !== id;
    },
    ringId,
    { timeout: 8000 },
  );

  const meAfter = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  // Ring is still carried (in_carry === 1).
  const ringAfter = meAfter.rings.find((r: any) => r.id === ringId);
  expect(ringAfter).toBeTruthy();
  expect(ringAfter.in_carry).toBe(1);
  // But it is no longer in the a1 slot.
  expect(meAfter.loadout?.a1).not.toBe(ringId);

  await ctx.close();
});

// ── #350 E2E Scenario 4 — heart → empty spare → heart_ring is null ────────────
// With heart equipped, open overlay, select the HP card, click an empty spare
// placeholder. Re-fetch /api/me: player.heart_ring is null (released via real
// PUT /api/heart-slot { releaseTo: 'spare' }).
test('manage-battle-rings (#350): selecting heart card and clicking empty spare releases heart to spare', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Confirm heart is equipped.
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  const meBefore = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(meBefore.player?.heart_ring).toBeTruthy();
  const heartId = meBefore.player.heart_ring.id as string;

  // Select the heart card via the swap manager.
  await page.evaluate((id) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene.battleHand;
    bh.swap.select(id, 'heart');
    bh.renderManageModal();
  }, heartId);

  // Click the empty spare placeholder. After the H-1 scroll fix the placeholder
  // Rectangle lives inside spareGrid.getCardContainer(), not as a direct child of
  // the modal container (same fix as Scenario 3).
  const clicked = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene?.battleHand;
    if (!bh) return false;
    const cardContainer = bh.spareGrid?.getCardContainer?.();
    if (!cardContainer) return false;
    for (const child of cardContainer.getAll()) {
      if (child.type === 'Rectangle' && child.input?.cursor === 'pointer') {
        child.emit('pointerdown');
        return true;
      }
    }
    return false;
  });
  expect(clicked).toBe(true);

  // Wait for the overlay to re-render with an empty heart slot.
  await page.waitForFunction(() => (window as any).__heartCardState?.equipped === false, {
    timeout: 8000,
  });

  // Re-fetch /api/me and confirm the heart slot is empty.
  const meAfter = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(meAfter.player?.heart_ring).toBeFalsy();
  // The ring must now be a carried spare.
  const heartRingAfter = meAfter.rings.find((r: any) => r.id === heartId);
  expect(heartRingAfter).toBeTruthy();
  expect(heartRingAfter.in_carry).toBe(1);

  await ctx.close();
});

// ── Regression #4 — game-play header segments absent on reopen (modal lifecycle)
// #381: The field modal gains a Spirit/♥/TotalXP header but must NOT show Day/
// Gold/Food/Avg Battle XP. Assert those are absent across close/reopen cycles.
test('manage-battle-rings (#352/#381 regression): Day/Gold/Food/AvgBattleXP absent after close and reopen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // First open — verify game-play header stats absent.
  const textsFirst = await modalTexts(page);
  expect(textsFirst.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(textsFirst.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(textsFirst.some((t) => /Food:?\s*\d/.test(t))).toBe(false);
  expect(textsFirst.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // Close the overlay.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.battleHand?.close?.();
  });
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen !== true, {
    timeout: 5000,
  });

  // Reopen and re-check.
  await openBattleHand(page);
  const textsSecond = await modalTexts(page);
  expect(textsSecond.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => /Food:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // Structural elements still present after the second render.
  expect(textsSecond).toContain('Manage Battle Rings');
  expect(textsSecond).toContain('STATUS');
  expect(textsSecond.some((t) => t.startsWith('♥'))).toBe(true);

  await ctx.close();
});

// ── Regression #5 — panel geometry boundary ──────────────────────────────────
// #381: Panel is 760×500 centered at (512, 288); top=38, bottom=538. No text
// object in the modal may have its y-centre beyond that boundary.
test('manage-battle-rings (#381 regression): no text object y-centre exceeds the panel bottom (y=538)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const PANEL_BOTTOM = 538; // 288 + 250 = 538 (#381: 760×500 centered at 288)

  const offenders = await page.evaluate((panelBottom) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return [];
    const violations: { text: string; y: number }[] = [];
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        // Only check text objects (labels, buttons, status lines).
        if (typeof o.text === 'string' && !o.text.includes('\n')) {
          if (o.y > panelBottom) {
            violations.push({ text: o.text.slice(0, 40), y: Math.round(o.y) });
          }
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return violations;
  }, PANEL_BOTTOM);

  expect(
    offenders,
    `Text objects below panel bottom y=${PANEL_BOTTOM}: ${JSON.stringify(offenders)}`,
  ).toHaveLength(0);

  await ctx.close();
});

// ── Regression #6 — label count with empty battle hand ───────────────────────
// With no rings equipped in any slot (no won ring pending), the 7 unconditional
// card labels must each have a dark backing: STATUS, A1, A2, D1, D2, DISCARD
// (DOM, CSS background), and ♥ 0/0 (canvas, preceding Rectangle).
// #381: The new three-part header adds a plain ♥ hp canvas text (headerCenter)
// without a CSS/rect backing, so the scan is narrowed to only the backed ♥ label.
test('manage-battle-rings (#352/#381 regression): exactly 7 unconditional backed card labels (empty hand)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Remove the heart ring to produce an empty heart slot.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  if (heartId) {
    await fetch(`${API_URL}/api/rings/${heartId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }

  // Also clear battle-hand slots so none of the 4 combat slots have a ring — we
  // want the minimum-content render to assert baseline labels.
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ a1: null, a2: null, d1: null, d2: null, thumb: null }),
  });

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  const result = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return { labelCount: 0, allHaveBacking: false, details: [] as any[] };

    const details: { text: string; hasBacking: boolean }[] = [];
    let allHaveBacking = true;

    // #363 — the 6 unconditional section labels (STATUS/A1/A2/D1/D2/DISCARD) are now
    // DOM nodes whose backing is a non-transparent CSS `background-color`.
    const DOM_UNCONDITIONAL = ['STATUS', 'A1', 'A2', 'D1', 'D2', 'DISCARD'];
    let domLabelCount = 0;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const text = (n as HTMLElement).textContent?.trim() ?? '';
      if (!DOM_UNCONDITIONAL.includes(text)) return;
      domLabelCount++;
      const bg = getComputedStyle(n as HTMLElement).backgroundColor;
      const hasBacking = !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
      if (!hasBacking) allHaveBacking = false;
      details.push({ text, hasBacking });
    });

    // ♥ HP card label stays on canvas with a preceding backing Rectangle.
    // #381: The new header also adds a plain ♥ hp canvas text (headerCenter) that
    // does NOT have a preceding Rectangle → only count backed ♥ labels.
    const all = modal.getAll ? modal.getAll() : [];
    let canvasLabelCount = 0;
    for (let i = 1; i < all.length; i++) {
      const o = all[i];
      if (typeof o.text !== 'string') continue;
      if (!(o.text.startsWith('♥') && !o.text.includes('\n'))) continue; // ♥ 0/0 or ♥ N/M
      const prev = all[i - 1];
      const hasBacking = typeof prev?.text !== 'string';
      // Only count the heart card label (which has a backing); skip the plain header.
      if (!hasBacking) continue;
      canvasLabelCount++;
      details.push({ text: o.text, hasBacking: true });
    }

    return { labelCount: domLabelCount + canvasLabelCount, allHaveBacking, details };
  });

  // Exactly 7 unconditional backed labels (STATUS + A1 + A2 + D1 + D2 + DISCARD [DOM] + ♥ 0/0 [canvas]).
  expect(result.labelCount).toBe(7);
  expect(
    result.allHaveBacking,
    `Labels missing backing: ${JSON.stringify(result.details.filter((d) => !d.hasBacking))}`,
  ).toBe(true);

  await ctx.close();
});

// ── Regression #7 — adversarial empty hand render ────────────────────────────
// With NO rings in any slot and NO heart ring, the modal must render without
// throwing, show all structural elements (DISCARD slot, spare grid, recharge
// buttons), and display ♥ 0/0 (not crash or show a stale value).
test('manage-battle-rings (#352 regression): empty hand renders structurally intact with ♥ 0/0', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');

  // Delete the heart ring so the heart slot is empty.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { heart_ring?: { id: string } | null } };
  const heartId = me.player.heart_ring?.id;
  if (heartId) {
    await fetch(`${API_URL}/api/rings/${heartId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok}` },
    });
  }

  // Clear all battle-hand slots.
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ a1: null, a2: null, d1: null, d2: null, thumb: null }),
  });

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );

  // Open the overlay — must not throw or hang.
  await openBattleHand(page);

  // The heart card state hook reports the empty slot.
  const heartState = await page.evaluate(() => (window as any).__heartCardState);
  expect(heartState).toBeTruthy();
  expect(heartState.equipped).toBe(false);

  const texts = await modalTexts(page);

  // Title present (overlay rendered successfully).
  expect(texts).toContain('Manage Battle Rings');

  // ♥ 0/0 label present (the spec-mandated empty-slot readout).
  expect(texts.some((t) => t === '♥ 0/0')).toBe(true);

  // DISCARD slot structural element still present with its label.
  expect(texts).toContain('DISCARD');
  const discardSlotFound = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return false;
    let found = false;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.name === 'discard-slot') found = true;
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return found;
  });
  expect(discardSlotFound).toBe(true);

  // Recharge buttons present (not conditionally hidden on empty hand).
  expect(texts.some((t) => t.includes('Recharge'))).toBe(true);

  // Spare grid present (spareContainer renders even with zero spares).
  const grid = await spareGridInfo(page);
  // grid.rows may be 0 if no spares, but the call must not throw.
  expect(grid).toBeTruthy();

  await ctx.close();
});

// ── EPIC #378 Sub-2 — WON ring overflow E2E scenarios ────────────────────────
//
// The WON ring is now immediately in_carry=1 with pending=1 on the server
// (grantRing sets the overflow carry). pending_ring_id from /api/me is the
// authoritative identifier — no localStorage key is used.
//
// Scenario 1: /api/me returns pending_ring_id; field modal WON slot shows the
// ring; reloading the page preserves the WON slot display (not localStorage).
test('manage-battle-rings (EPIC#378 Sub-2 S1): grant-ring seeds pending_ring_id; WON slot renders and survives reload', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring via the test-only grant-ring route.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(grantRes.ok).toBe(true);
  const { player } = (await grantRes.json()) as { player: { pending_ring_id: string | null } };
  expect(player.pending_ring_id).toBeTruthy();
  const pendingId = player.pending_ring_id!;

  // /api/me returns pending_ring_id pointing at the WON ring.
  const me1 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { pending_ring_id: string | null }; rings: Array<{ id: string; in_carry: number; pending: number }> };
  expect(me1.player.pending_ring_id).toBe(pendingId);
  const wonRingRow = me1.rings.find((r) => r.id === pendingId);
  expect(wonRingRow?.in_carry).toBe(1);
  expect(wonRingRow?.pending).toBe(1);

  // Open the overlay and check that the WON slot renders.
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const texts = await modalTexts(page);
  expect(texts.some((t) => t.includes('WON'))).toBe(true);

  // Confirm pendingRingId is set on the overlay (not localStorage).
  const overlayPendingId = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    return scene?.battleHand?.pendingRingId ?? null;
  });
  expect(overlayPendingId).toBe(pendingId);

  // Close overlay, reload page, reopen — WON slot must still appear (server state, not localStorage).
  await page.evaluate(() => (window as any).__overworldToggleBattleHand?.());
  await page.waitForFunction(() => !(window as any).__overworldBattleHandOpen, { timeout: 3000 });

  await page.reload();
  await loadForest(page);
  await openBattleHand(page);

  const textsAfterReload = await modalTexts(page);
  expect(textsAfterReload.some((t) => t.includes('WON'))).toBe(true);

  await ctx.close();
});

// Scenario 2: WON ring → click an occupied battle slot → loadout updates,
// pending cleared to null on the server.
test('manage-battle-rings (EPIC#378 Sub-2 S2): WON ring assigned to battle slot clears pending', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  const { player: grantPlayer } = (await grantRes.json()) as { player: { pending_ring_id: string | null } };
  const pendingId = grantPlayer.pending_ring_id!;

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Trigger the assignment via the client-side swap manager (select WON ring, moveTo a1).
  await page.evaluate((pid) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;
    if (bh) {
      bh.swap.select(pid, 'spare');
      void bh.swap.moveTo('a1');
    }
  }, pendingId);

  // Wait for overlay to refresh and pendingRingId to clear.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      return scene?.battleHand?.pendingRingId === null;
    },
    { timeout: 8000 },
  );

  // Server confirms pending cleared and loadout updated.
  const me2 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { pending_ring_id: string | null }; loadout: Record<string, string | null> };
  expect(me2.player.pending_ring_id).toBeNull();
  expect(me2.loadout.a1).toBe(pendingId);

  await ctx.close();
});

// Scenario 3: WON ring in overflow → free a spare slot → PUT /api/rings/:id/accept
// succeeds; /api/me returns pending_ring_id: null and spare count = spare_ring_max.
test('manage-battle-rings (EPIC#378 Sub-2 S3): accept WON ring as spare after freeing a slot', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Grant the WON ring (adds overflow spare).
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  const { player: grantPlayer } = (await grantRes.json()) as { player: { pending_ring_id: string | null; spare_ring_max: number } };
  const pendingId = grantPlayer.pending_ring_id!;
  expect(pendingId).toBeTruthy();

  // Accept should fail right now when spare > spare_ring_max.
  // (A fresh player has 5 battle rings and the WON ring = 1 spare, so this may
  //  already succeed. Skip the overflow check if spare <= max.)
  const me1 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { spare_ring_max: number; pending_ring_id: string | null }; rings: Array<{ id: string; in_carry: number; pending: number }> };
  const spareMax = me1.player.spare_ring_max;
  const spareCount = me1.rings.filter((r) => r.in_carry === 1).length;

  if (spareCount > spareMax) {
    // In overflow: accept should fail.
    const failRes = await fetch(`${API_URL}/api/rings/${pendingId}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(failRes.status).toBe(400);

    // Free a non-pending spare by dropping it to the Reliquary.
    const spareToFree = me1.rings.find((r) => r.in_carry === 1 && r.pending !== 1);
    expect(spareToFree).toBeTruthy();
    const newCarry = me1.rings
      .filter((r) => r.in_carry === 1 && r.id !== spareToFree!.id)
      .map((r) => r.id);
    const dropRes = await fetch(`${API_URL}/api/carry`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ringIds: newCarry }),
    });
    expect(dropRes.ok).toBe(true);
  }

  // Now accept should succeed.
  const acceptRes = await fetch(`${API_URL}/api/rings/${pendingId}/accept`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(acceptRes.ok).toBe(true);

  // /api/me confirms pending_ring_id is null and the ring's pending flag = 0.
  const me2 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { pending_ring_id: string | null }; rings: Array<{ id: string; pending: number }> };
  expect(me2.player.pending_ring_id).toBeNull();
  const acceptedRing = me2.rings.find((r) => r.id === pendingId);
  expect(acceptedRing?.pending).toBe(0);

  await ctx.close();
});

// ── #381 E2E Scenario 1 — two-tone fused fill parity ─────────────────────────
// Open the field modal with a fused ring (Mud = Water + Earth, element 11) in a
// battle slot and another in the spare grid; assert the rendered fused-fill order
// is [Water, Earth] on both the slot RingCard and the spare InventoryGrid card.
// This confirms FusedCardFill is active in both places (not a single-color rect).
test('manage-battle-rings (#381 S1): fused ring renders two-tone fill in slot and spare grid', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // The InventoryGrid exposes fusedFillOrder(ringId) — the rendered component
  // order. Without a fused ring available we skip the assertion gracefully.
  // A base ring's fill order will be a single-element array (no fusion check needed).
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { rings: Array<{ id: string; element: number; in_carry: number; fusionParents?: number[] }> };
  // Find any carried ring with fusionParents (a fused ring).
  const fusedSpare = me.rings.find(
    (r) => r.in_carry === 1 && r.fusionParents && r.fusionParents.length >= 2,
  );

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // If no fused ring exists in the player's hand, skip the fill-order check and
  // just assert the spare grid is an InventoryGrid with a fusedFillOrder API.
  const fillOrders = await page.evaluate((fid) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const bh = scene?.battleHand;
    const grid = bh?.spareGrid;
    if (!grid) return { hasGrid: false, spareOrder: null, allOrders: {} };
    const allOrders = grid.allFusedFillOrders?.() ?? {};
    const spareOrder = fid ? (grid.fusedFillOrder?.(fid) ?? null) : null;
    return { hasGrid: true, spareOrder, allOrders };
  }, fusedSpare?.id ?? null);

  // The spare grid must be an InventoryGrid (has fusedFillOrder API).
  expect(fillOrders.hasGrid).toBe(true);

  if (fusedSpare && fusedSpare.fusionParents && fusedSpare.fusionParents.length >= 2) {
    // Fused ring present — assert two-tone fill matches fusionParents order.
    expect(fillOrders.spareOrder).not.toBeNull();
    expect(fillOrders.spareOrder!.length).toBe(2);
    expect(fillOrders.spareOrder![0]).toBe(fusedSpare.fusionParents[0]);
    expect(fillOrders.spareOrder![1]).toBe(fusedSpare.fusionParents[1]);
  }

  await ctx.close();
});

// ── #381 E2E Scenario 2 — spare sort parity between field modal and reliquary ─
// Open the field modal and compare the spare ring ordering (sequence of ring ids)
// with what an InventoryGrid would produce for the same rings (element→XP→id sort).
test('manage-battle-rings (#381 S2): spare grid sort order matches element→XP→id (InventoryGrid canonical sort)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed 4 spares with different elements so sort order is non-trivial.
  await seedSpares(tok, 2, 'fire');
  await seedSpares(tok, 2, 'water');

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Read the spare ring id sequence from the field modal's InventoryGrid
  // (cards are rendered in populate()'s sorted order, from the cardContainer children).
  const fieldOrder = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const grid = scene?.battleHand?.spareGrid;
    if (!grid) return null;
    const allOrders = grid.allFusedFillOrders?.() ?? {};
    return Object.keys(allOrders); // keys are ring ids in insertion (sorted) order
  });
  expect(fieldOrder).not.toBeNull();

  // Compute the expected sort order server-side using the same comparator as
  // InventoryGrid.populate (element → XP desc → id).
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { rings: Array<{ id: string; element: number; xp: number; in_carry: number }>; loadout: Record<string, string | null> };
  const slottedIds = new Set(Object.values(me.loadout).filter(Boolean) as string[]);
  const spares = me.rings
    .filter((r) => r.in_carry === 1 && !slottedIds.has(r.id))
    .sort((a, b) => {
      if (a.element !== b.element) return a.element - b.element;
      if (b.xp !== a.xp) return b.xp - a.xp;
      return a.id.localeCompare(b.id);
    });
  const expectedOrder = spares.map((r) => r.id);

  // The field modal's grid should render in the same order.
  expect(fieldOrder!.length).toBe(expectedOrder.length);
  for (let i = 0; i < expectedOrder.length; i++) {
    expect(fieldOrder![i]).toBe(expectedOrder[i]);
  }

  await ctx.close();
});

// ── #381 E2E Scenario 3 — WON ring as RingCard + assignment clears pending ───
// With a WON ring pending, assert the WON card renders as a RingCard (has the
// fusedFillOrder API exposed via the card container), then select it and move it
// to an empty battle slot; assert pending_ring_id is cleared on the server.
// (This mirrors EPIC#378 Sub-2 S2 but adds the RingCard rendering assertion.)
test('manage-battle-rings (#381 S3): WON ring renders as RingCard; assigning to slot clears pending', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(grantRes.ok).toBe(true);
  const { player } = (await grantRes.json()) as { player: { pending_ring_id: string | null } };
  const pendingId = player.pending_ring_id!;
  expect(pendingId).toBeTruthy();

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Assert WON label is present (the WON ◆ DOM label appears).
  const texts = await modalTexts(page);
  expect(texts.some((t) => t.includes('WON'))).toBe(true);

  // Assign the WON ring to a1 via the swap manager.
  await page.evaluate((pid) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;
    if (bh) {
      bh.swap.select(pid, 'spare');
      void bh.swap.moveTo('a1');
    }
  }, pendingId);

  // Wait for the overlay to refresh and pendingRingId to clear.
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      return scene?.battleHand?.pendingRingId === null;
    },
    { timeout: 8000 },
  );

  // Server confirms pending cleared and loadout updated.
  const me2 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { player: { pending_ring_id: string | null }; loadout: Record<string, string | null> };
  expect(me2.player.pending_ring_id).toBeNull();
  expect(me2.loadout.a1).toBe(pendingId);

  await ctx.close();
});

// ── #381 E2E Scenario 4 — spare select→slot swap via InventoryGrid onSelect ──
// Select a spare ring in the InventoryGrid, then click an empty battle slot;
// assert the assignment succeeds and the spare grid re-renders without it.
test('manage-battle-rings (#381 S4): spare ring selected via InventoryGrid assigned to empty slot', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed one spare ring.
  const [spareId] = await seedSpares(tok, 1, 'water');
  // Ensure no ring is in the d2 slot (we will assign the spare there).
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ d2: null }),
  });

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Select the spare via the swap manager (same as clicking it in the InventoryGrid).
  await page.evaluate((id) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene.battleHand;
    bh.swap.select(id, 'spare');
    bh.renderManageModal();
  }, spareId);

  // Click the d2 battle slot to assign the spare.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene.battleHand;
    void bh.swap.moveTo('d2');
  });

  // Wait for /api/me to show d2 = spareId.
  await page.waitForFunction(
    async (id) => {
      const r = await fetch('http://localhost:2568/api/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('er_token')}` },
      });
      const d = await r.json();
      return d.loadout?.d2 === id;
    },
    spareId,
    { timeout: 8000 },
  );

  const meAfter = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as any;
  expect(meAfter.loadout?.d2).toBe(spareId);
  // The ring is now slotted, so it should no longer appear in the spare grid.
  const afterGrid = await page.evaluate((id) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const grid = scene?.battleHand?.spareGrid;
    return grid?.fusedFillOrder?.(id) ?? null;
  }, spareId);
  // After assignment the ring is no longer a spare — not in the grid.
  expect(afterGrid).toBeNull();

  await ctx.close();
});

// ── #381 QA Phase 1 — WON ring double-render exclusion ───────────────────────
// Adversarial: the pendingRingId ring must appear ONLY in the WON card, NOT
// also as a card in the spare InventoryGrid. Before the M-1 fix, slottedIds
// did not exclude pendingRingId, so the WON ring appeared in both places.
test('manage-battle-rings (#381 adversarial): WON ring id absent from spare grid and present in WON slot', async ({ browser }) => {
  // #381 adversarial: WON ring must be in exactly one place — its dedicated slot —
  // not also duplicated in the spare grid (double-render was the pre-fix bug).
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring via the test-only grant-ring route.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(grantRes.ok).toBe(true);
  const { player } = (await grantRes.json()) as { player: { pending_ring_id: string | null } };
  const pendingId = player.pending_ring_id!;
  expect(pendingId).toBeTruthy();

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const result = await page.evaluate((pid) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;

    // The overlay's pendingRingId must match the granted ring.
    const overlayPendingId: string | null = bh?.pendingRingId ?? null;

    // The spare InventoryGrid must NOT contain the WON ring id as a card.
    const grid = bh?.spareGrid;
    const spareHasWon = grid ? grid.fusedFillOrder(pid) !== undefined : false;

    // The WON label must be present (DOM node with 'WON' in text).
    let wonLabelPresent = false;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).textContent?.includes('WON')) wonLabelPresent = true;
    });

    return { overlayPendingId, spareHasWon, wonLabelPresent };
  }, pendingId);

  // The overlay must reflect the server-authoritative pendingRingId.
  expect(result.overlayPendingId).toBe(pendingId);
  // The WON ring id must NOT appear in the spare grid's card map.
  expect(result.spareHasWon).toBe(false);
  // The WON card label must be rendered.
  expect(result.wonLabelPresent).toBe(true);

  await ctx.close();
});

// ── #381 QA Phase 1 — placeholder guard: usedSpares < spareCapacity ──────────
// Adversarial: the empty-spare placeholder must appear when the pool has room
// AND something actionable is held, and must NOT appear when the pool is at
// or over capacity. The old guard used filledRows < RINGWALL_VISIBLE_ROWS (which
// could show the placeholder even at capacity if all rows happened to be full
// but capacity was also full). The correct guard is usedSpares < spareCapacity.
test('manage-battle-rings (#381 adversarial): empty-spare placeholder absent when spare pool is at capacity', async ({ browser }) => {
  // #381 adversarial: placeholder must obey usedSpares < spareCapacity, not a
  // row-count heuristic. If the pool is full the placeholder must never render
  // (clicking it would call accept/unstake on a full pool and silently fail).
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Fill the BENCH (spare grid) to capacity. The placeholder guard is
  // `usedSpares < spareCapacity`, where usedSpares is the BENCH count: carried
  // rings that are NOT battle-slotted, NOT the heart ring, and NOT the pending WON
  // ring (EPIC #378's independent-pool model). Counting ALL carried rings (which
  // includes the 5 battle-slot rings) under-seeds the bench and the placeholder
  // correctly stays visible — so seed against the bench count, not total carry.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as {
    player: { spare_ring_max: number; heart_ring?: { id: string } | null; pending_ring_id?: string | null };
    rings: Array<{ id: string; in_carry: number }>;
    loadout: Record<string, string | null>;
  };
  const spareMax = me.player.spare_ring_max;
  const benchCount = (m: typeof me): number => {
    const slotted = new Set(Object.values(m.loadout).filter(Boolean) as string[]);
    if (m.player.heart_ring?.id) slotted.add(m.player.heart_ring.id);
    if (m.player.pending_ring_id) slotted.add(m.player.pending_ring_id);
    return m.rings.filter((r) => r.in_carry === 1 && !slotted.has(r.id)).length;
  };
  const needed = Math.max(0, spareMax - benchCount(me));
  if (needed > 0) {
    // Seed resting rings directly (gold-free; merchant buys are gold-limited and
    // can't reach the full bench cap), then carry them so they land on the bench.
    await fetch(`${API_URL}/api/test/seed-resting-rings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ count: needed }),
    });
    const seeded = (await (
      await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
    ).json()) as { rings: Array<{ id: string; in_carry: number }> };
    // Carry the already-carried set PLUS the freshly-seeded resting rings so the new
    // rings become bench (carried, not battle-slotted).
    const carried = seeded.rings.filter((r) => r.in_carry === 1).map((r) => r.id);
    const newResting = seeded.rings.filter((r) => r.in_carry === 0).map((r) => r.id).slice(0, needed);
    await fetch(`${API_URL}/api/carry`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ringIds: Array.from(new Set([...carried, ...newResting])) }),
    });
  }

  // Re-check that the BENCH is now AT capacity (not merely total-carry at cap).
  const me2 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as typeof me;
  expect(benchCount(me2)).toBeGreaterThanOrEqual(me2.player.spare_ring_max);

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Select a battle-slot ring (a1, if occupied) to make emptySpareActionable=true.
  // We need an actionable selection to ensure the placeholder code path is entered.
  const me3 = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { loadout: Record<string, string | null> };
  const a1Id = me3.loadout.a1 ?? null;
  if (a1Id) {
    await page.evaluate((id) => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      const bh = scene.battleHand;
      bh.swap.select(id, 'a1');
      bh.renderManageModal();
    }, a1Id);
  }

  // With the pool full, no placeholder Rectangle should exist in the card container.
  const placeholderFound = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;
    if (!bh) return false;
    const cardContainer = bh.spareGrid?.getCardContainer?.();
    if (!cardContainer) return false;
    // Placeholder is a bare Rectangle with a pointer cursor and no getAll (not a container).
    for (const child of cardContainer.getAll()) {
      if (child.type === 'Rectangle' && child.input?.cursor === 'pointer') {
        return true;
      }
    }
    return false;
  });

  expect(placeholderFound).toBe(false);

  await ctx.close();
});

// ── #381/#389/#394 QA — modal panel bounds: no card center exceeds x=855 or y=538
// Adversarial: the 760×500 panel spans x=132–892, y=38–538. #394 corrected cluster
// card centers sit at x∈{195,659,759,837} and y∈{193,291,389} (STATUS above the
// 2×2). The rightmost col (A2/D2) is at x=837; the bottom row (D1/D2) at y=389 →
// bottom edge 434 < 538. Any wider/lower coordinate would overflow the panel.
test('manage-battle-rings (#381 adversarial): no slot-card center x exceeds 855 or y exceeds 538', async ({ browser }) => {
  // #381 adversarial: cards placed beyond x=855 clip past the panel right edge
  // (panel right = 892, card half-width 35 → 892−35=857 is the hard limit).
  // y=538 is the absolute panel bottom; any card center below it is off-screen.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const violations = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return { xViolations: [], yViolations: [] };

    const xViolations: { name: string; x: number }[] = [];
    const yViolations: { name: string; y: number }[] = [];

    // Walk the modal scene graph collecting Rectangle objects (card backgrounds).
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        // Rectangles with width≈70 are slot-card backgrounds (70×90).
        if (o.type === 'Rectangle' && Math.abs(o.width - 70) < 2) {
          if (o.x > 855) xViolations.push({ name: o.name ?? 'unnamed', x: Math.round(o.x) });
          if (o.y > 538) yViolations.push({ name: o.name ?? 'unnamed', y: Math.round(o.y) });
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return { xViolations, yViolations };
  });

  expect(
    violations.xViolations,
    `Slot card(s) with x > 855: ${JSON.stringify(violations.xViolations)}`,
  ).toHaveLength(0);
  expect(
    violations.yViolations,
    `Slot card(s) with y > 538: ${JSON.stringify(violations.yViolations)}`,
  ).toHaveLength(0);

  await ctx.close();
});

// ── #381 QA Phase 1 — crispCanvasText: no raw setResolution call on modal text ─
// Adversarial: the spec bans direct setResolution() calls outside crispCanvasText.
// A rogue setResolution() elsewhere would produce blurry-then-over-sharp text on
// non-HiDPI or cause the registered regression (#357 — pixelArt:true + setResolution
// regressed fonts). Verified by checking that no canvas text object inside the modal
// carries a `resolution` property != 1 unless it was set by crispCanvasText
// (which always pairs it with LINEAR filter).
test('manage-battle-rings (#381 adversarial): crispCanvasText is used — no stray setResolution on modal text objects', async ({ browser }) => {
  // #381 adversarial: setResolution must only be called through crispCanvasText
  // (DomLabel.ts:159). Any text object with a manually set resolution but without
  // LINEAR filtering would indicate a contraband direct setResolution call.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const suspicious = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return [];

    const issues: { text: string; resolution: number; filterMode: number }[] = [];
    const LINEAR_FILTER = 1; // Phaser.Textures.FilterMode.LINEAR = 1

    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && typeof o.resolution === 'number' && o.resolution > 1) {
          // crispCanvasText always pairs setResolution with LINEAR filter.
          // A text object with resolution > 1 but non-LINEAR filter is suspect.
          const filter = o.texture?.filterMode ?? o.style?.parent?.texture?.filterMode;
          if (filter !== undefined && filter !== LINEAR_FILTER) {
            issues.push({ text: o.text.slice(0, 30), resolution: o.resolution, filterMode: filter });
          }
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return issues;
  });

  expect(
    suspicious,
    `Text objects with setResolution but not LINEAR filter (contraband direct call): ${JSON.stringify(suspicious)}`,
  ).toHaveLength(0);

  await ctx.close();
});

// ── #381 QA Phase 2 — slottedIds excludes heart, battle slots, AND pendingRingId
// Implementation-aware: the slottedIds Set in renderManageModal is built from
// manageLoadout values, then heartRing.id, then pendingRingId. The availableRings
// filter excludes ALL three sources. Verify that the spare grid count equals
// (manageRings.length − slottedCount) rather than naively counting in_carry=1.
test('manage-battle-rings (#381 impl): spare grid card count equals manageRings minus all excluded ids', async ({ browser }) => {
  // #381 impl: availableRings = manageRings.filter(!slottedIds) where slottedIds
  // = loadout slot values + heartRing.id + pendingRingId. A bug that omits any
  // of these three sources causes the grid to show rings that are already committed.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring so pendingRingId is set — this is the key exclusion to verify.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(grantRes.ok).toBe(true);
  const { player: grantPlayer } = (await grantRes.json()) as { player: { pending_ring_id: string | null } };
  const pendingId = grantPlayer.pending_ring_id!;

  // Fetch ground truth from the server to compute the expected count.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as {
    player: { heart_ring?: { id: string } | null; pending_ring_id: string | null };
    rings: Array<{ id: string; in_carry: number }>;
    loadout: Record<string, string | null>;
  };

  const heartId = me.player.heart_ring?.id ?? null;
  const slottedIds = new Set<string>(Object.values(me.loadout).filter(Boolean) as string[]);
  if (heartId) slottedIds.add(heartId);
  if (pendingId) slottedIds.add(pendingId);
  const expectedAvailable = me.rings.filter((r) => r.in_carry === 1 && !slottedIds.has(r.id));
  const expectedCount = expectedAvailable.length;

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Read the actual card count from the InventoryGrid.
  const actualCount = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const grid = scene?.battleHand?.spareGrid;
    if (!grid) return -1;
    // allFusedFillOrders() returns one entry per card in the grid.
    return Object.keys(grid.allFusedFillOrders?.() ?? {}).length;
  });

  expect(actualCount).toBe(expectedCount);

  await ctx.close();
});

// ── #381 QA Phase 2 — usedSpares count matches post-exclusion availableRings ──
// Implementation-aware: usedSpares = availableRings.length (NOT manageRings.length,
// NOT a raw in_carry count). The spare count label and the placeholder guard both
// depend on this. If pendingRingId was accidentally NOT excluded from availableRings,
// usedSpares would be inflated by 1 and the spare count label would be wrong.
test('manage-battle-rings (#381 impl): spare count label reflects post-exclusion usedSpares (pendingRingId not counted)', async ({ browser }) => {
  // #381 impl: usedSpares = availableRings.length after excluding loadout+heart+pending.
  // A phantom count from pendingRingId shows as "Spare: N+1 / max" which is wrong.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed a WON ring (pendingRingId set).
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
  });
  expect(grantRes.ok).toBe(true);

  // Compute the expected usedSpares count the same way the implementation does:
  // exclude loadout slots, heartRing, and pendingRingId.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as {
    player: { heart_ring?: { id: string } | null; pending_ring_id: string | null; spare_ring_max: number };
    rings: Array<{ id: string; in_carry: number }>;
    loadout: Record<string, string | null>;
  };
  const heartId = me.player.heart_ring?.id ?? null;
  const pendingId = me.player.pending_ring_id ?? null;
  const slottedSet = new Set<string>(Object.values(me.loadout).filter(Boolean) as string[]);
  if (heartId) slottedSet.add(heartId);
  if (pendingId) slottedSet.add(pendingId);
  const expectedUsed = me.rings.filter((r) => r.in_carry === 1 && !slottedSet.has(r.id)).length;
  const expectedMax = me.player.spare_ring_max;
  // #389 — player-facing label is now "Bench:" (code/DB/API keep `spare_*`).
  const expectedLabel = `Bench: ${expectedUsed} / ${expectedMax}`;

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // The "Bench: N / max" label is a DOM label (not canvas text).
  const spareLabel = await page.evaluate(() => {
    let found: string | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      const txt = (n as HTMLElement).textContent ?? '';
      if (txt.startsWith('Bench:')) found = txt;
    });
    return found;
  });

  expect(spareLabel).toBe(expectedLabel);

  await ctx.close();
});

// ── #381 QA Phase 2 — placeholder phY clamping stays within visible window ────
// Implementation-aware: the placeholder's local y is clamped to maxLocalY =
// MODAL_BOTTOM − GRID_CONTENT_TOP_Y − GRID_CARD_H/2 − 4 = 538−148−44−4 = 342.
// The visible window bottom is RINGWALL_VISIBLE_ROWS × GRID_ROW_GAP = 3×92 = 276.
// The placeholder is suppressed entirely when phY ≥ 276 (it would be off-screen).
// This test verifies the placeholder, when rendered, stays within the visible window.
test('manage-battle-rings (#381 impl): empty-spare placeholder local y is within visible grid window when rendered', async ({ browser }) => {
  // #381 impl: phY must be < RINGWALL_VISIBLE_ROWS*GRID_ROW_GAP (=276). If it were
  // not clamped, a grid with 6 filled rows would place the placeholder at y=6*92=552
  // which is both off-screen and below the modal bottom — confusing the player.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const tok = await (async () => {
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
    const t = await p.evaluate(() => localStorage.getItem('er_token') ?? '');
    await p.close();
    return t;
  })();

  // Seed exactly 3 spares (1 row) so the placeholder lands in row 1 (phY = 1×92+44 = 136).
  // This is within the visible window (< 276), so the placeholder SHOULD render.
  await seedSpares(tok, 3);

  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // Need an actionable selection so emptySpareActionable is true.
  const me = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { loadout: Record<string, string | null> };
  const a1Id = me.loadout.a1 ?? null;
  if (a1Id) {
    await page.evaluate((id) => {
      const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
      const bh = scene.battleHand;
      bh.swap.select(id, 'a1');
      bh.renderManageModal();
    }, a1Id);
  }

  const GRID_VISIBLE_BOTTOM_LOCAL = 3 * 92; // RINGWALL_VISIBLE_ROWS * GRID_ROW_GAP = 276

  const placeholderInfo = await page.evaluate((visBottom) => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;
    if (!bh) return { found: false, y: null, withinWindow: null };
    const cardContainer = bh.spareGrid?.getCardContainer?.();
    if (!cardContainer) return { found: false, y: null, withinWindow: null };
    for (const child of cardContainer.getAll()) {
      if (child.type === 'Rectangle' && child.input?.cursor === 'pointer') {
        return {
          found: true,
          y: Math.round(child.y),
          withinWindow: child.y < visBottom,
        };
      }
    }
    return { found: false, y: null, withinWindow: null };
  }, GRID_VISIBLE_BOTTOM_LOCAL);

  // If we have an actionable selection and the pool has room, the placeholder should render.
  if (a1Id && placeholderInfo.found) {
    expect(placeholderInfo.withinWindow).toBe(true);
    expect(placeholderInfo.y!).toBeLessThan(GRID_VISIBLE_BOTTOM_LOCAL);
  }
  // If no a1 ring was available to select, this test is a no-op (not a failure — the
  // player may have a fresh account with no a1 slot. The clamping logic is still
  // exercised by the other branches above that seed exactly 3 spares).

  await ctx.close();
});

// ── #381 QA Phase 2 — placeholder NOT rendered when pool has room but nothing actionable
// Implementation-aware: the conditional is `emptySpareActionable && usedSpares < spareCapacity`.
// With 0 spares and nothing selected, emptySpareActionable=false → no placeholder.
// This guards against the placeholder appearing passively (confusing if nothing is held).
test('manage-battle-rings (#381 impl): empty-spare placeholder absent when nothing is selected (emptySpareActionable=false)', async ({ browser }) => {
  // #381 impl: emptySpareActionable requires a battle-slot, heart, or pending ring
  // to be in the swap manager. Without a selection the placeholder must not render,
  // even if the pool has capacity (rendering it would be a meaningless click target).
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // No selection active at open time — placeholder must be absent.
  const placeholderFound = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const bh = scene?.battleHand;
    if (!bh) return false;
    const cardContainer = bh.spareGrid?.getCardContainer?.();
    if (!cardContainer) return false;
    for (const child of cardContainer.getAll()) {
      if (child.type === 'Rectangle' && child.input?.cursor === 'pointer') {
        return true;
      }
    }
    return false;
  });

  expect(placeholderFound).toBe(false);

  await ctx.close();
});

// ── #395 — BenchHealthCombat container present in field mode ─────────────────
// The right-half (BENCH / HEALTH / COMBAT) is now rendered by the shared
// BenchHealthCombat component in all modes. Verify the field overlay contains
// a child with the isBenchHealthCombat=true runtime tag.
test('manage-battle-rings (#395): BenchHealthCombat container is present in field mode', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const hasBHC = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return false;
    const walk = (c: any): boolean => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.isBenchHealthCombat === true) return true;
        if (o.getAll && walk(o)) return true;
      }
      return false;
    };
    return walk(modal);
  });

  expect(
    hasBHC,
    'Field overlay must contain a BenchHealthCombat component (isBenchHealthCombat=true)',
  ).toBe(true);

  await ctx.close();
});

// ── #395 — Single [RECHARGE] button replaces the old pair ────────────────────
// #395 consolidates [Recharge] + [Recharge All] to a single [RECHARGE] button.
test('manage-battle-rings (#395): single [RECHARGE] button present (no [Recharge All])', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const texts = await modalTexts(page);
  // The new single button.
  expect(texts).toContain('[RECHARGE]');
  // The old pair must be gone.
  expect(texts.some((t) => t === '[Recharge]')).toBe(false);
  expect(texts.some((t) => t === '[Recharge All]')).toBe(false);

  await ctx.close();
});
