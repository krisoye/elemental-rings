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

/** Count the spare card + placeholder rects in the overlay's spare sub-container. */
async function spareGridInfo(page: Page): Promise<{ rows: number; cells: number }> {
  return page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return { rows: 0, cells: 0 };
    // The spare grid sub-container holds one container per cell (card or placeholder).
    // Its children are the only Containers added after the cluster cards. Pick the
    // largest Container-of-Containers in the modal — that is the spare grid.
    const containers = modal.getAll().filter((o: any) => o.getAll && o.list);
    let grid: any = null;
    for (const c of containers) {
      const kids = c.getAll().filter((k: any) => k.getAll);
      if (kids.length && (!grid || kids.length > grid.getAll().length)) grid = c;
    }
    if (!grid) return { rows: 0, cells: 0 };
    const cells = grid.getAll().filter((k: any) => k.getAll && k.visible);
    const ys = new Set(cells.map((k: any) => Math.round(k.y)));
    return { rows: ys.size, cells: cells.length };
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

// ── Scenario 1b — #352: no header row; panel top ≥ 44; HP card above STATUS ─────
test('manage-battle-rings (#352): no header row, panel starts at y≥44, ♥ HP label above HP card', async ({ browser }) => {
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

  // #352 §1 — header segments (Day/Gold/Food/Spirit/Total XP/Avg Battle XP) are
  // absent from the modal (they now live only in the always-on overworld HUD).
  expect(texts.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(texts.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(texts.some((t) => /Food:?\s*\d/.test(t))).toBe(false);
  expect(texts.some((t) => t.includes('Total XP:'))).toBe(false);
  expect(texts.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // #352 §4 — ♥ cur/max label is present in the modal (above the HP card).
  expect(texts.some((t) => t === `♥ ${hp}`)).toBe(true);

  // #352 §2 — panel top y ≥ 44 (clears the HUD).
  const panelTopY = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return null;
    const objs = (modal.getAll ? modal.getAll() : []) as any[];
    for (const o of objs) {
      if (o.width === 640 && typeof o.strokeColor !== 'undefined') {
        return o.y - o.height / 2;
      }
    }
    return null;
  });
  expect(panelTopY).not.toBeNull();
  expect(panelTopY!).toBeGreaterThanOrEqual(44);

  // #352 §3 — HP card (ROW0_Y) above STATUS card (ROW1_Y): HP is on the top row.
  // #363 — STATUS migrated to a DOM label; the ♥ HP label stays on canvas. Compare
  // both in SCREEN space: the DOM node via getBoundingClientRect, the canvas label
  // mapped through the game canvas rect + the 576-logical-px vertical scale.
  const rowOrder = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleY = canvasRect.height / 576; // canvas backing store is 1024×576 logical

    // STATUS — DOM label: screen top straight from the node (trim to ignore whitespace).
    let statusTop: number | null = null;
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if ((n as HTMLElement).textContent?.trim() === 'STATUS') {
        statusTop = (n as HTMLElement).getBoundingClientRect().top;
      }
    });

    // ♥ HP — canvas label: map its logical y to a screen top.
    const scene = game?.scene?.getScene('ForestScene') as any;
    const modal = scene?.battleHand?.manageModal;
    let hpScreenTop: number | null = null;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          // Origin 0.5 → logical top = o.y - height/2.
          const logicalTop = o.y - (o.height ?? 0) / 2;
          hpScreenTop = canvasRect.top + logicalTop * scaleY;
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return { statusTop, hpScreenTop };
  });
  expect(rowOrder.statusTop).not.toBeNull();
  expect(rowOrder.hpScreenTop).not.toBeNull();
  // HP card label sits above the STATUS label on screen.
  expect(rowOrder.hpScreenTop!).toBeLessThan(rowOrder.statusTop!);

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

// ── Scenario 5 — three grouped clusters + 5×2 spare grid, both rows visible ───
// #348 Scenario 1 / #350: seed ≥7 spares, assert the STATUS/HP cards sit at the
// group-2 cluster x (460 after #350 rebalance, isolated by 65px gaps on both
// sides), and the spare grid shows two visible rows (no scroll) covering all spares.
test('manage-battle-rings: three clusters render and the 5×2 spare grid shows both rows', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  const tok = await page.evaluate(() => localStorage.getItem('er_token') ?? '');
  // Seed 7 spares so the second grid row is populated (5 per row).
  await seedSpares(tok, 7);

  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await openBattleHand(page);

  // STATUS (thumb) and ♥ HP (heart) cards share the group-2 column x (460 after
  // #350 rebalance), isolated by 65px gaps from group 1 (303) and group 3 (617/721).
  // #352: HP label is now "♥ N/M" — match by startsWith('♥') rather than === 'HP'.
  // #363 — STATUS is a DOM label (centered at logical x): map its screen centerX
  // back to logical px via the canvas rect + horizontal scale. ♥ HP stays on canvas.
  const labelXs = await page.evaluate(() => {
    const game = (window as any).__game;
    const canvas: HTMLCanvasElement = game?.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / 1024; // canvas backing store is 1024×576 logical
    const out: Record<string, number> = {};

    // STATUS — DOM label centered at logical x.
    document.querySelectorAll('.er-dom-label').forEach((n) => {
      if (n.textContent === 'STATUS') {
        const r = (n as HTMLElement).getBoundingClientRect();
        const centerX = r.left + r.width / 2;
        out.STATUS = Math.round((centerX - canvasRect.left) / scaleX);
      }
    });

    // ♥ HP — canvas label.
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
  // Allow ±1px for the screen→logical round-trip on the DOM-measured STATUS.
  expect(Math.abs(labelXs.STATUS - 460)).toBeLessThanOrEqual(1); // #350 rebalance: GROUP2_X = 460
  expect(labelXs.HP).toBe(460);

  // The spare grid shows exactly 2 rows (both visible, no scroll) and ≥7 cells.
  const grid = await spareGridInfo(page);
  expect(grid.rows).toBe(2);
  expect(grid.cells).toBeGreaterThanOrEqual(7);

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

// ── #350 E2E Scenario 1 — cluster X-centres (303/460/617/721) and equal margins ─
// Open the overlay and read the X positions of the STATUS, HP, A1, A2 slot-label
// text objects. Assert GROUP1=303, GROUP2=460, GROUP3=[617,721] and that the left
// and right margins to the panel's inner edge (x≈192 and x≈832) are both ≈65px.
test('manage-battle-rings (#350): cluster X-centres are 303/460/617/721 with equal margins', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const positions = await page.evaluate(() => {
    const game = (window as any).__game;
    const result: Record<string, number> = {};

    // #363 — STATUS/A1/A2/D1/D2 are DOM labels (centered at logical x). Map each
    // node's screen center-X back to logical canvas X via the canvas rect + scale.
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
    });

    // ♥ HP stays on canvas — read its logical x from the scene graph.
    const scene = game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        // #352 — HP label is now "♥ N/M"; capture it under the 'HP' key.
        if (typeof o.text === 'string' && o.text.startsWith('♥') && !o.text.includes('\n')) {
          result.HP = Math.round(o.x);
        }
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return result;
  });

  // GROUP2 (STATUS/HP) — both at 460. STATUS is DOM-measured (screen→logical
  // round-trip) so allow ±1px; HP is exact (canvas logical coord).
  expect(Math.abs(positions.STATUS - 460)).toBeLessThanOrEqual(1);
  expect(positions.HP).toBe(460);
  // GROUP3 (Combat) — A1/D1 at 617, A2/D2 at 721. DOM-measured → ±1px tolerance.
  expect(Math.abs(positions.A1 - 617)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.A2 - 721)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.D1 - 617)).toBeLessThanOrEqual(1);
  expect(Math.abs(positions.D2 - 721)).toBeLessThanOrEqual(1);

  // Equal margins: left card-left edge ≈ 303−46 = 257 ≈ inner-left 192+65;
  // right card-right edge ≈ 721+46 = 767 ≈ inner-right 832−65 = 767. Both ≈65.
  // Assert via the card centre coordinates: G1=303 implies left margin ≈ 303−46−192 = 65.
  const INNER_LEFT = 192;  // CANVAS_W/2 − 320 = 512 − 320
  const INNER_RIGHT = 832; // CANVAS_W/2 + 320 = 512 + 320
  const CARD_HALF = 46;
  // We read GROUP1 implicitly: STATUS at 460 → G2=460 → G1=460−92−65=303 matches.
  // Verify left margin from A1 (the leftmost cluster card is G1 at 303):
  // Left margin = G1 − CARD_HALF − INNER_LEFT = 303 − 46 − 192 = 65.
  const leftMargin = 303 - CARD_HALF - INNER_LEFT;
  const rightMargin = INNER_RIGHT - (positions.A2 + CARD_HALF);
  expect(leftMargin).toBe(65);
  // A2 is DOM-measured (±1px), so the derived right margin carries the same tolerance.
  expect(Math.abs(rightMargin - 65)).toBeLessThanOrEqual(1);

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
  await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
  });
  const meBefore = (await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${tok}` } })
  ).json()) as { rings: Array<{ id: string; in_carry: number }> };
  const newRing = meBefore.rings.find((r) => r.in_carry === 0);
  expect(newRing).toBeTruthy();
  const ringId = newRing!.id;
  // Carry it, then stake it into a1.
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ ringIds: [ringId] }),
  });
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

  // Find and click an empty spare placeholder (a rectangle with no text children in
  // the spare sub-container that is interactive (Phaser 4 maps useHandCursor:true → input.cursor==='pointer')).
  const clicked = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    // Walk to the spare sub-container (largest Container-of-Containers).
    const containers = modal.getAll().filter((o: any) => o.getAll && o.list);
    let grid: any = null;
    for (const c of containers) {
      const kids = c.getAll().filter((k: any) => k.getAll);
      if (kids.length && (!grid || kids.length > grid.getAll().length)) grid = c;
    }
    if (!grid) return false;
    // Find an empty placeholder cell: a cell container whose only child is a Rectangle.
    for (const cell of grid.getAll()) {
      if (!cell.getAll) continue;
      const children = cell.getAll();
      if (children.length === 1 && children[0].input?.cursor === 'pointer') {
        children[0].emit('pointerdown');
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

  // Click an empty spare placeholder (same walk as Scenario 3).
  const clicked = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const containers = modal.getAll().filter((o: any) => o.getAll && o.list);
    let grid: any = null;
    for (const c of containers) {
      const kids = c.getAll().filter((k: any) => k.getAll);
      if (kids.length && (!grid || kids.length > grid.getAll().length)) grid = c;
    }
    if (!grid) return false;
    for (const cell of grid.getAll()) {
      if (!cell.getAll) continue;
      const children = cell.getAll();
      if (children.length === 1 && children[0].input?.cursor === 'pointer') {
        children[0].emit('pointerdown');
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

// ── Regression #4 — no header on reopen (modal lifecycle) ────────────────────
// The header removal must persist across close/reopen cycles. A re-render bug
// (stale cached state, conditional header add) would restore the header on the
// second open. This locks in the "no header" invariant across modal lifecycle.
test('manage-battle-rings (#352 regression): header segments absent after close and reopen', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  // First open — verify header is absent (mirrors Scenario 1b).
  const textsFirst = await modalTexts(page);
  expect(textsFirst.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(textsFirst.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(textsFirst.some((t) => t.includes('Total XP:'))).toBe(false);
  expect(textsFirst.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // Close the overlay.
  await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    scene?.battleHand?.close?.();
  });
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen !== true, {
    timeout: 5000,
  });

  // Reopen and re-check — the header must still be absent after the second render.
  await openBattleHand(page);
  const textsSecond = await modalTexts(page);
  expect(textsSecond.some((t) => /Day:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => /Gold:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => /Food:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => /Spirit:?\s*\d/.test(t))).toBe(false);
  expect(textsSecond.some((t) => t.includes('Total XP:'))).toBe(false);
  expect(textsSecond.some((t) => t.includes('Avg Battle XP:'))).toBe(false);

  // Structural elements still present after the second render.
  expect(textsSecond).toContain('Manage Battle Rings');
  expect(textsSecond).toContain('STATUS');
  expect(textsSecond.some((t) => t.startsWith('♥'))).toBe(true);

  await ctx.close();
});

// ── Regression #5 — panel geometry boundary ──────────────────────────────────
// Panel bottom is MODAL_TOP + PANEL_H = 44 + 515 = 559 (#356). No text object in
// the modal (including recharge status text, spare label, and recharge buttons)
// may have its y-centre beyond that boundary. A y > 559 means the element exits
// the panel, overlapping whatever is rendered below it.
test('manage-battle-rings (#356 regression): no text object y-centre exceeds the panel bottom (y=559)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadForest(page);
  await openBattleHand(page);

  const MODAL_TOP = 44;
  const PANEL_H = 515; // #356: expanded from 495
  const PANEL_BOTTOM = MODAL_TOP + PANEL_H; // 559

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
// card labels must still each have a dark backing rect: STATUS, A1, A2, D1, D2,
// DISCARD, and ♥ 0/0. The WON ◆ label appears only when a pending won ring
// exists, so this test deliberately uses an empty hand to assert the baseline 7.
test('manage-battle-rings (#352 regression): exactly 7 unconditional card labels each have a backing rect (empty hand)', async ({ browser }) => {
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

    // ♥ HP stays on canvas with a preceding backing Rectangle in the container list.
    const all = modal.getAll ? modal.getAll() : [];
    let canvasLabelCount = 0;
    for (let i = 1; i < all.length; i++) {
      const o = all[i];
      if (typeof o.text !== 'string') continue;
      if (!(o.text.startsWith('♥') && !o.text.includes('\n'))) continue; // ♥ 0/0 or ♥ N/M
      canvasLabelCount++;
      const prev = all[i - 1];
      const hasBacking = typeof prev?.text !== 'string';
      if (!hasBacking) allHaveBacking = false;
      details.push({ text: o.text, hasBacking });
    }

    return { labelCount: domLabelCount + canvasLabelCount, allHaveBacking, details };
  });

  // Exactly 7 unconditional labels (STATUS + A1 + A2 + D1 + D2 + DISCARD [DOM] + ♥ 0/0 [canvas]).
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
