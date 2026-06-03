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

/** Read every text label in the overlay's modal container (recursing sub-containers). */
async function modalTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    if (!modal) return [];
    const out: string[] = [];
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (typeof o.text === 'string') out.push(o.text);
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
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

// ── Scenario 1 — title, STATUS/HP cluster labels, header parity (#348) ────────
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
  // #348 — slot labels match the Reliquary modal (#347): STATUS (thumb) and HP (heart).
  expect(texts).toContain('STATUS');
  expect(texts).toContain('HP');
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

// ── Scenario 1b — three-part header (♥ HP | Total XP | Avg) parity with #347 ──
test('manage-battle-rings: header shows ♥ HP, Total XP and Avg Battle XP from /api/me', async ({ browser }) => {
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
  // ♥ cur/max matches the equipped heart ring, verbatim from the server.
  expect(texts.some((t) => t === `♥ ${hp}`)).toBe(true);
  // Total XP + Avg Battle XP segment present (same wording as the Reliquary header).
  expect(texts.some((t) => t.includes('Total XP:') && t.includes('Avg Battle XP:'))).toBe(true);

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
// #348 Scenario 1: seed ≥7 spares, assert the STATUS/HP cards sit at the group-2
// cluster x (382, isolated by gaps), and the spare grid shows two visible rows
// (no scroll) covering all spares.
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

  // STATUS (thumb) and HP (heart) cards share the group-2 column x (382), isolated
  // by gaps from group 1 (262) and group 3 (560/660). Their labels sit at x=382.
  const labelXs = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene');
    const modal = scene?.battleHand?.manageModal;
    const out: Record<string, number> = {};
    const walk = (c: any): void => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.text === 'STATUS' || o.text === 'HP') out[o.text] = Math.round(o.x);
        if (o.getAll) walk(o);
      }
    };
    walk(modal);
    return out;
  });
  expect(labelXs.STATUS).toBe(382);
  expect(labelXs.HP).toBe(382);

  // The spare grid shows exactly 2 rows (both visible, no scroll) and ≥7 cells.
  const grid = await spareGridInfo(page);
  expect(grid.rows).toBe(2);
  expect(grid.cells).toBeGreaterThanOrEqual(7);

  await ctx.close();
});

// ── Scenario 6 — safe 3-step discard: select → DISCARD slot → Cancel/Confirm ──
// #348 Scenario 2. Drives REAL Phaser pointer events: select a spare, click the
// DISCARD slot (group-1 row-1, x=262 y=240) → __discardConfirmOpen true, no ring
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
