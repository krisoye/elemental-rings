import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter, enterForestScreen } from './helpers';

// #85 — Ring Storage overlay + Encounter UX fixes. Asserts on REAL server state
// and live Phaser scene objects (no mocks), mirroring the sanctum-zones harness:
// register/mint a fresh player per test, seed the JWT, walk to the ring-wall zone,
// open the overlay, and read scene children / __campState via page.evaluate.
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

const FIRE_EL = 0;
const WATER_EL = 1;

/** Zone center from client/public/assets/maps/sanctum.json. */
const RINGWALL = { x: 128, y: 56 };

async function registerAndToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `rs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function putLoadout(token: string, partial: Record<string, string | null>): Promise<void> {
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(partial),
  });
}

async function putCarry(token: string, ringIds: string[]): Promise<void> {
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds }),
  });
}

/**
 * POST /api/test/seed-resting-rings → add `count` rings directly to the SPIRIT
 * (Reliquary) pool (in_carry=0). Used to overflow the grid past 3 rows. The test
 * endpoint inserts directly, bypassing the carry-cap / reliquary-cap guards — so
 * it can fill the grid past the default reliquary cap (9) to exercise scrolling.
 */
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
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Walk to the ring-wall zone, open the RING STORAGE overlay, and wait for it. */
async function openReliquary(page: Page): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [RINGWALL.x, RINGWALL.y]);
  await page.waitForFunction(
    () => ((window as any).__sanctumZones ?? []).includes('ringwall'),
    undefined,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });
}

/** Read a scene Text object's text by name (searches nested containers). */
async function campTextByName(page: Page, name: string): Promise<string | null> {
  return page.evaluate((n) => {
    const scene = (window as any).__scene as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === n);
    return found ? (found as any).text ?? null : null;
  }, name);
}

// ── Scenario 1: WATER Thumb passive (Ring Storage) ───────────────────────────
// #241 — WATER's passive is now the all-in setup distributor "Torrent" (was
// "Wellspring"): at duel start it pours the thumb's uses onto matching Water
// rings, highest-XP first. EPIC #302 replaced the always-on passive strip with a
// hover tooltip on the STATUS card; the authoritative passive (name + full effect
// text) is published on __campState.staked_passive and surfaced by the tooltip.
test('passive-strip: WATER Thumb shows full Torrent passive (tooltip + staked_passive)', async ({ browser }) => {
  const token = await registerAndToken();
  const { rings } = await getMe(token);
  const water = rings.find((r: any) => r.element === WATER_EL);
  expect(water).toBeDefined();
  // Carry the WATER ring (it may already be a battle slot) and stake it as Thumb.
  await putLoadout(token, { thumb: water.id });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // The authoritative passive name lands in __campState.staked_passive.
  await page.waitForFunction(
    () => (window as any).__campState.staked_passive?.name === 'Torrent',
    { timeout: 5000 },
  );
  const passive = await page.evaluate(() => (window as any).__campState.staked_passive);
  expect(passive.name).toBe('Torrent');
  // The full effect text (what the STATUS-card hover tooltip renders) is present.
  expect(passive.effect).toContain('round-robin highest XP first');

  // Hovering the STATUS (Thumb) card surfaces the tooltip with the same text.
  const tooltipText = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    scene.combatCards.get('thumb').bg.emit('pointerover', { x: 800, y: 200 });
    const lbl = scene.children
      .getAll()
      .find((o: any) => o.depth === 5000 && o.visible && typeof o.text === 'string');
    return lbl ? lbl.text : null;
  });
  expect(tooltipText).toBeTruthy();
  expect(tooltipText).toContain('Torrent');
  expect(tooltipText).toContain('round-robin highest XP first');
  await ctx.close();
});

// ── Scenario 2: Reliquary converged labels + live header (#302/#347/#389) ─────
// The modal is the unified ring-management overlay: four column headers
// (SPIRIT | BENCH | HEALTH | COMBAT) topped by a three-part live stats header
// (Spirit / ♥ / Total XP). Moves are click-then-click. Assert the converged
// structure is present.
test('reliquary-redesign: converged column labels + live stats header are present', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const labels = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const all = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]));
    const byName = (n: string) => all.find((o: any) => o.name === n);
    return {
      headerLeft: (byName('reliquary-header-left') as any)?.text ?? null,
      reliquary: (byName('reliquary-label') as any)?.text ?? null,
      health: (byName('health-label') as any)?.text ?? null,
      battleHand: (byName('battle-hand-label') as any)?.text ?? null,
      spare: (byName('spare-label') as any)?.text ?? null,
      hasFuse: !!all.find((o: any) => o.type === 'Text' && o.text === '[Fuse Rings]'),
    };
  });
  // #302/#347 — left column is SPIRIT, COMBAT replaces BATTLE HAND, HEALTH present.
  expect(labels.reliquary).toContain('SPIRIT');
  expect(labels.battleHand).toBe('COMBAT');
  expect(labels.health).toBe('HEALTH');
  // #389 — the middle column is BENCH (was SPARES).
  expect(labels.spare).toContain('BENCH');
  expect(labels.hasFuse).toBe(false); // Fuse Rings moved out of this overlay
  // The live header's left segment carries the spirit reading.
  expect(labels.headerLeft).toContain('Spirit:');
  await ctx.close();
});

// ── Scenario 3: Sanctum grid scrolls when overflowed (8 sanctum rings) ───────
test('scroll: overflowing sanctum grid clips at 3 rows and scrolls by row', async ({ browser }) => {
  const token = await registerAndToken();
  // A fresh player has 5 resting (Reliquary) rings. Seed 5 more directly so the
  // SPIRIT grid holds 10 rings = 4 rows at 3-col width (overflowing the 3-row
  // window). #378's reliquary cap (9) makes uncarrying all rings to the Reliquary
  // impossible, so seed resting rings directly instead of `putCarry([])`.
  await seedRestingRings(token, 5);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(() => (window as any).__campState.atSanctum.length === 10, {
    timeout: 8000,
  });
  await openReliquary(page);

  await page.waitForFunction(() => (window as any).__campState.sanctumTotalRows === 4, {
    timeout: 5000,
  });
  let cs = await page.evaluate(() => (window as any).__campState);
  expect(cs.sanctumTotalRows).toBe(4);
  expect(cs.sanctumVisibleRows).toBe(3);
  expect(cs.sanctumScrollRow).toBe(0);

  // Scroll down one row: scrollRow→1, cardContainer local y → -ROW_GAP (-92).
  await page.evaluate(() => (window as any).__campSanctumScroll(1));
  await page.waitForFunction(() => (window as any).__campState.sanctumScrollRow === 1, {
    timeout: 5000,
  });
  const cardY = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    // The InventoryGrid is adopted into the overlay container, so search one level
    // into containers. The grid exposes getCardContainer(); find it by its row count.
    const grid = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .filter((g: any) => typeof g.getCardContainer === 'function')
      .find((g: any) => g.getTotalRows() === 4);
    return grid ? grid.getCardContainer().y : null;
  });
  expect(cardY).toBe(-92);

  // Scroll up beyond the top clamps to 0.
  await page.evaluate(() => (window as any).__campSanctumScroll(-2));
  await page.waitForFunction(() => (window as any).__campState.sanctumScrollRow === 0, {
    timeout: 5000,
  });
  cs = await page.evaluate(() => (window as any).__campState);
  expect(cs.sanctumScrollRow).toBe(0);
  await ctx.close();
});

// ── Scenario 4: Reliquary → Spare via the click-then-click move (#154) ───────
// The redesign replaces the [Add to Loadout] button with a click-then-click move:
// select a Reliquary card, then drop it into the LOADOUT column's Spare. Drive it
// through the programmatic __reliquaryMove hook (registered while the modal is
// open) and assert the server-confirmed carry state.
test('reliquary-redesign: move a Reliquary ring into Spare carries it', async ({ browser }) => {
  const token = await registerAndToken();
  const { rings, loadout } = await getMe(token);
  const slotted = new Set(Object.values(loadout).filter(Boolean) as string[]);
  const spare = rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(spare).toBeDefined();
  await putCarry(token, []);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(() => (window as any).__campState.loadout_pool.length === 0, {
    timeout: 8000,
  });
  await openReliquary(page);
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', {
    timeout: 5000,
  });

  const sanctumId = spare.id as string;
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), sanctumId);

  await page.waitForFunction(
    (id) => {
      const cs = (window as any).__campState;
      return cs.loadout_pool.some((r: any) => r.id === id);
    },
    sanctumId,
    { timeout: 8000 },
  );
  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === sanctumId)?.in_carry).toBe(1);
  await ctx.close();
});

// ── Scenario 5: Reopen resets scroll to row 0 ────────────────────────────────
test('scroll: closing (Esc) and reopening resets scroll to row 0', async ({ browser }) => {
  const token = await registerAndToken();
  // Seed 5 extra resting rings → 10 in the SPIRIT grid (4 rows). See the sibling
  // scroll test: #378's reliquary cap (9) blocks `putCarry([])` of all 10 rings.
  await seedRestingRings(token, 5);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(() => (window as any).__campState.atSanctum.length === 10, {
    timeout: 8000,
  });
  await openReliquary(page);
  await page.waitForFunction(() => (window as any).__campState.sanctumTotalRows === 4, {
    timeout: 5000,
  });

  await page.evaluate(() => (window as any).__campSanctumScroll(1));
  await page.waitForFunction(() => (window as any).__campState.sanctumScrollRow === 1, {
    timeout: 5000,
  });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });

  await openReliquary(page);
  await page.waitForFunction(() => (window as any).__campState.sanctumTotalRows === 4, {
    timeout: 5000,
  });
  const row = await page.evaluate(() => (window as any).__campState.sanctumScrollRow);
  expect(row).toBe(0);
  await ctx.close();
});

// ── Scenario 6: WATER Thumb passive in the field Manage Battle Rings overlay ──
// #87/#305 extracted the encounter manage-battle-hand UI into the standalone
// BattleHandOverlay, and EPIC #302 replaced the always-on passive strip with a
// hover tooltip on the STATUS card. This asserts the same WATER "Torrent" passive
// (name + full effect text) surfaces in the field overlay's STATUS-card tooltip.
test('manage-passive: WATER Thumb full text in the field overlay STATUS tooltip', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const water = me.rings.find((r: any) => r.element === WATER_EL);
  expect(water).toBeDefined();
  // The fresh WATER ring rests in the Reliquary (in_carry=0). The field overlay's
  // thumbPassiveText() resolves the staked Thumb from the CARRIED rings, so carry
  // the WATER ring (alongside the existing carried set) before staking it as Thumb.
  const carried = me.rings.filter((r: any) => r.in_carry === 1).map((r: any) => r.id);
  await putCarry(token, Array.from(new Set([...carried, water.id])));
  await putLoadout(token, { thumb: water.id });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await enterForestScreen(page, 'forest_anchorage');
  await page.waitForFunction(
    () => typeof (window as any).__overworldToggleBattleHand === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__overworldToggleBattleHand());
  await page.waitForFunction(() => (window as any).__overworldBattleHandOpen === true, {
    timeout: 5000,
  });
  await page.waitForFunction(() => !!(window as any).__heartCardState, { timeout: 5000 });

  // The field overlay exposes the staked-Thumb passive text via thumbPassiveText()
  // (the STATUS-card hover tooltip source). It must carry the WATER Torrent passive.
  const passiveText = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene('ForestScene') as any;
    return scene?.battleHand?.thumbPassiveText?.() ?? null;
  });
  expect(passiveText).toBeTruthy();
  expect(passiveText).toContain('Torrent');
  expect(passiveText).toContain('round-robin highest XP first');
  await ctx.close();
});

// ── Scenario 7: Encounter personality labels fit within the card width ───────
test('encounter-labels: all personality labels fit within 90px card width', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);

  const widths = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('EncounterScene') as Phaser.Scene;
    const labels = ['Aggressive', 'Defensive', 'Status-hunter', 'Resilient', 'PvP'];
    return labels.map((l) => {
      const o = scene.children
        .getAll()
        .find((g: any) => g.type === 'Text' && g.text === l);
      return o ? (o as any).width : null;
    });
  });
  for (const w of widths) {
    expect(w).not.toBeNull();
    expect(w).toBeLessThanOrEqual(90);
  }
  await ctx.close();
});

// ── Scenario 8: Stake info labels wrap within the 90px card width ────────────
test('encounter-labels: stake info wraps within 90px after preview loads', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);

  // Wait for the preview fetch to populate the stake labels.
  await page.waitForFunction(() => (window as any).__encounterPreview !== undefined, {
    timeout: 8000,
  });

  const widths = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('EncounterScene') as Phaser.Scene;
    return scene.children
      .getAll()
      .filter((g: any) => g.type === 'Text' && /^Stakes:/.test(g.text ?? ''))
      .map((g: any) => g.width);
  });
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) {
    expect(w).toBeLessThanOrEqual(90);
  }
  await ctx.close();
});
