import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter } from './helpers';

// #85 — Ring Storage overlay + Encounter UX fixes. Asserts on REAL server state
// and live Phaser scene objects (no mocks), mirroring the sanctum-zones harness:
// register/mint a fresh player per test, seed the JWT, walk to the ring-wall zone,
// open the overlay, and read scene children / __campState via page.evaluate.
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

const FIRE_EL = 0;
const WATER_EL = 1;

/** Zone center from client/public/assets/maps/sanctum.json. */
const RINGWALL = { x: 160, y: 608 };

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

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Walk to the ring-wall zone, open the RING STORAGE overlay, and wait for it. */
async function openRingStorage(page: Page): Promise<void> {
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

/**
 * Read an EncounterScene Text object's text by name. EncounterScene does not set
 * window.__scene (only the spatial scenes do), so resolve it via the game's
 * SceneManager by key and search its display list (incl. nested containers).
 */
async function encounterTextByName(page: Page, name: string): Promise<string | null> {
  return page.evaluate((n) => {
    const scene = (window as any).__game.scene.getScene('EncounterScene') as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === n);
    return found ? (found as any).text ?? null : null;
  }, name);
}

// ── Scenario 1: Full passive text WATER Thumb (Ring Storage) ─────────────────
test('passive-strip: WATER Thumb shows full effect text (Thumb pays)', async ({ browser }) => {
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
  await openRingStorage(page);

  await page.waitForFunction(
    () => (window as any).__campState.staked_passive?.name === 'Wellspring',
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => {
      const scene = (window as any).__scene as Phaser.Scene;
      const strip = scene.children
        .getAll()
        .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
        .find((o: any) => o.name === 'staked-passive-strip');
      return !!strip && /\(Thumb pays\)/.test((strip as any).text ?? '');
    },
    { timeout: 5000 },
  );
  const stripText = await campTextByName(page, 'staked-passive-strip');
  expect(stripText).toContain('Wellspring');
  expect(stripText).toContain('(Thumb pays)');
  await ctx.close();
});

// ── Scenario 2: Reliquary redesign (#154) — two-panel labels + live header ────
// After #154 the modal is a two-panel loadout manager (RELIQUARY left, LOADOUT
// right with BATTLE HAND over SPARE) topped by a live stats header. The old
// [Add to Loadout]/[Leave at Sanctum] action buttons are gone — moves are
// click-then-click. Assert the new structure is present.
test('reliquary-redesign: two-panel labels + live stats header are present', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openRingStorage(page);

  const labels = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const all = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]));
    const byName = (n: string) => all.find((o: any) => o.name === n);
    return {
      header: (byName('reliquary-header') as any)?.text ?? null,
      reliquary: (byName('reliquary-label') as any)?.text ?? null,
      loadout: (byName('loadout-label') as any)?.text ?? null,
      battleHand: (byName('battle-hand-label') as any)?.text ?? null,
      spare: (byName('spare-label') as any)?.text ?? null,
      hasFuse: !!all.find((o: any) => o.type === 'Text' && o.text === '[Fuse Rings]'),
    };
  });
  expect(labels.reliquary).toBe('RELIQUARY');
  expect(labels.loadout).toBe('LOADOUT');
  expect(labels.battleHand).toBe('BATTLE HAND');
  expect(labels.spare).toBe('SPARE');
  expect(labels.hasFuse).toBe(true);
  expect(labels.header).toContain('aggregate_xp:');
  expect(labels.header).toContain('spirit_max:');
  expect(labels.header).toContain('spirit:');
  await ctx.close();
});

// ── Scenario 3: Sanctum grid scrolls when overflowed (8 sanctum rings) ───────
test('scroll: overflowing sanctum grid clips at 3 rows and scrolls by row', async ({ browser }) => {
  const token = await registerAndToken();
  const { rings } = await getMe(token);
  // 10 starter rings; carry only 2 so 8 remain At Sanctum (4 grid rows).
  await putCarry(token, rings.slice(0, 2).map((r: any) => r.id));

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(() => (window as any).__campState.atSanctum.length === 8, {
    timeout: 8000,
  });
  await openRingStorage(page);

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
  await openRingStorage(page);
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
  const { rings } = await getMe(token);
  await putCarry(token, rings.slice(0, 2).map((r: any) => r.id)); // 8 at sanctum

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(() => (window as any).__campState.atSanctum.length === 8, {
    timeout: 8000,
  });
  await openRingStorage(page);
  await page.waitForFunction(() => (window as any).__campState.sanctumTotalRows === 4, {
    timeout: 5000,
  });

  await page.evaluate(() => (window as any).__campSanctumScroll(1));
  await page.waitForFunction(() => (window as any).__campState.sanctumScrollRow === 1, {
    timeout: 5000,
  });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });

  await openRingStorage(page);
  await page.waitForFunction(() => (window as any).__campState.sanctumTotalRows === 4, {
    timeout: 5000,
  });
  const row = await page.evaluate(() => (window as any).__campState.sanctumScrollRow);
  expect(row).toBe(0);
  await ctx.close();
});

// ── Scenario 6: Full passive text in Manage Battle Hand + clear of carried rings
test('manage-passive: WATER Thumb full text above the carried-rings label', async ({ browser }) => {
  const token = await registerAndToken();
  const { rings } = await getMe(token);
  const water = rings.find((r: any) => r.element === WATER_EL);
  expect(water).toBeDefined();
  await putLoadout(token, { thumb: water.id });

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);

  await page.evaluate(() => (window as any).__encounterManageBattleHand());
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game.scene.getScene('EncounterScene') as Phaser.Scene;
      return !!scene.children
        .getAll()
        .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
        .find((o: any) => o.name === 'manage-staked-passive');
    },
    { timeout: 8000 },
  );

  const stripText = await encounterTextByName(page, 'manage-staked-passive');
  expect(stripText).toContain('Wellspring');
  expect(stripText).toContain('(Thumb pays)');

  // The passive strip bottom must sit above the Carried-rings label top (no overlap).
  const bounds = await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('EncounterScene') as Phaser.Scene;
    const all = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]));
    const strip = all.find((o: any) => o.name === 'manage-staked-passive');
    const carried = all.find(
      (o: any) => o.type === 'Text' && /Carried rings/.test((o as any).text ?? ''),
    );
    const sb = (strip as any).getBounds();
    const cb = (carried as any).getBounds();
    return { stripBottom: sb.bottom, carriedTop: cb.top };
  });
  expect(bounds.stripBottom).toBeLessThanOrEqual(bounds.carriedTop);
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
