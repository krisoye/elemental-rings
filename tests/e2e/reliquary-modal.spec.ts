import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// #154 — Reliquary wall modal redesign. The modal that opens at the Reliquary wall
// zone in the Sanctum interior is a two-panel loadout manager with a live stats
// header. Every assertion reads REAL server state (/api/me) and live Phaser scene
// objects (window.__campState / __scene children) — no mocks. Mirrors the
// ring-storage-ux + sanctum-zones harness: register a fresh player, seed the JWT,
// walk to the RINGWALL zone, open the overlay, and drive moves via the
// programmatic __reliquaryMove / __reliquarySelect hooks (no pixel hit-testing).
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Reliquary wall zone center from client/public/assets/maps/sanctum.json. */
const RINGWALL = { x: 128, y: 56 };

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;

async function registerAndToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `rel_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
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

/** Walk to the Reliquary wall zone, open the modal, and wait for it. */
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
  // The move hooks are registered only while the modal is open.
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', {
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

function carriedCount(me: any): number {
  return me.rings.filter((r: any) => r.in_carry === 1).length;
}

// ── Scenario 1: Modal opens; header shows aggregate_xp, spirit_max, spirit ────
test('reliquary: opens at the wall and renders the live stats header', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // The header text reflects the authoritative /api/me snapshot — not a local
  // computation. Assert each value appears verbatim.
  const header = await campTextByName(page, 'reliquary-header');
  expect(header).toBeTruthy();
  expect(header).toContain(`XP: ${me.player.aggregate_xp}`);
  expect(header).toContain(`spirit: ${me.player.spirit_current} / ${me.player.spirit_max}`);

  // The LOADOUT badge shows carried / cap.
  const badge = await campTextByName(page, 'loadout-badge');
  expect(badge).toBe(`${carriedCount(me)} / ${me.player.carry_cap}`);
  await ctx.close();
});

// ── Scenario 2: Reliquary → Loadout (Spare): carry rises, aggregate_xp drops ──
test('reliquary: moving a ring into Spare drops aggregate_xp and updates spirit_max', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  // A Reliquary ring with positive XP so aggregate_xp visibly changes when carried.
  const reliquaryRing = me.rings.find(
    (r: any) => r.in_carry === 0 && !slotted.has(r.id) && r.xp > 0,
  ) ?? me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(reliquaryRing).toBeDefined();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const before = await getMe(token);
  const beforeCarried = carriedCount(before);

  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), reliquaryRing.id);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    reliquaryRing.id,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === reliquaryRing.id)?.in_carry).toBe(1);
  expect(carriedCount(after)).toBe(beforeCarried + 1);
  // aggregate_xp = SUM(xp) over Reliquary (in_carry = 0) rings, so carrying a ring
  // can only reduce it; spirit_max is server-recomputed and never rises here.
  expect(after.player.aggregate_xp).toBeLessThanOrEqual(before.player.aggregate_xp);
  expect(after.player.spirit_max).toBeLessThanOrEqual(before.player.spirit_max);
  // The header re-renders from the new authoritative state.
  const header = await campTextByName(page, 'reliquary-header');
  expect(header).toContain(`XP: ${after.player.aggregate_xp}`);
  await ctx.close();
});

// ── Scenario 3: Loadout (Spare) → Reliquary: aggregate_xp rises ───────────────
test('reliquary: moving a Spare ring back to the Reliquary raises aggregate_xp', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  // Seed a carried-but-unslotted (Spare) ring: carry the 5 battle rings plus one
  // extra Reliquary ring so it sits in Spare.
  const extra = me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(extra).toBeDefined();
  await putCarry(token, [...slotted, extra.id]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    extra.id,
    { timeout: 8000 },
  );
  await openReliquary(page);

  const before = await getMe(token);
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'reliquary'), extra.id);
  await page.waitForFunction(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    extra.id,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === extra.id)?.in_carry).toBe(0);
  expect(after.player.aggregate_xp).toBeGreaterThanOrEqual(before.player.aggregate_xp);
  expect(after.player.spirit_max).toBeGreaterThanOrEqual(before.player.spirit_max);
  await ctx.close();
});

// ── Scenario 4: Reliquary → Battle Hand slot in one action ────────────────────
test('reliquary: a Reliquary ring moves directly into a Battle Hand slot', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  const reliquaryRing = me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(reliquaryRing).toBeDefined();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Move it directly into A1 — one action: server carries it then assigns the slot.
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'a1'), reliquaryRing.id);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout.a1 === id,
    reliquaryRing.id,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.loadout.a1).toBe(reliquaryRing.id);
  expect(after.rings.find((r: any) => r.id === reliquaryRing.id)?.in_carry).toBe(1);
  await ctx.close();
});

// ── Scenario 5: Carry cap full → Reliquary cards locked, clicking is a no-op ──
test('reliquary: at carry cap, Reliquary cards are locked and clicking does nothing', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const cap = me.player.carry_cap as number;
  // Requires more rings than carry_cap to fill carry while keeping Reliquary
  // non-empty. With 10 starter rings and carry_cap=10 there is no headroom.
  // Skip until a test-only ring-mint route is available.
  test.skip(
    me.rings.length <= cap,
    `Need > ${cap} rings to fill carry while keeping Reliquary non-empty (have ${me.rings.length})`,
  );
  const allIds = me.rings.map((r: any) => r.id).slice(0, cap);
  // Leave at least one ring in the Reliquary to click: uncarry one, carry the rest.
  const reliquaryRing = me.rings.find((r: any) => r.in_carry === 0) ?? me.rings[0];
  const carriedIds = allIds.filter((id: string) => id !== reliquaryRing.id);
  // Top the carried set up to exactly the cap with other rings.
  const fill = me.rings
    .map((r: any) => r.id)
    .filter((id: string) => id !== reliquaryRing.id && !carriedIds.includes(id));
  while (carriedIds.length < cap && fill.length) carriedIds.push(fill.shift());
  await putCarry(token, carriedIds.slice(0, cap));

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (c) => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === c,
    cap,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // The lock flag is set and the badge is red at cap.
  await page.waitForFunction(() => (window as any).__reliquaryLocked === true, { timeout: 5000 });

  const beforeCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  // Attempt to select + carry a Reliquary ring — must be a no-op.
  await page.evaluate(
    (id) => (window as any).__reliquarySelect(id, 'reliquary'),
    reliquaryRing.id,
  );
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), reliquaryRing.id);
  // Give any (rejected) round-trip a beat, then assert carried count is unchanged.
  await page.waitForTimeout(500);
  const afterCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  expect(afterCarried).toBe(beforeCarried);
  expect(afterCarried).toBeLessThanOrEqual(cap);

  const after = await getMe(token);
  expect(carriedCount(after)).toBe(cap);
  await ctx.close();
});

// ── Scenario 6: ESC closes the modal ─────────────────────────────────────────
test('reliquary: Escape closes the modal', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });
  const open = await page.evaluate(() => (window as any).__sanctumOverlayOpen);
  expect(open).toBeNull();
  // The move hooks are torn down on close.
  const hook = await page.evaluate(() => typeof (window as any).__reliquaryMove);
  expect(hook).toBe('undefined');
  await ctx.close();
});

// ── Scenario 7: Within-loadout move (Spare ↔ Battle Hand) leaves aggregate_xp ─
test('reliquary: moving within the loadout does not change aggregate_xp', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  const extra = me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(extra).toBeDefined();
  // Seed it into Spare (carried, unslotted).
  await putCarry(token, [...slotted, extra.id]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    extra.id,
    { timeout: 8000 },
  );
  await openReliquary(page);

  const before = await getMe(token);
  // Assign the Spare ring into D2 — a pure loadout assignment, no carry change.
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'd2'), extra.id);
  await page.waitForFunction((id) => (window as any).__campState.loadout.d2 === id, extra.id, {
    timeout: 8000,
  });

  const after = await getMe(token);
  expect(after.loadout.d2).toBe(extra.id);
  expect(carriedCount(after)).toBe(carriedCount(before));
  expect(after.player.aggregate_xp).toBe(before.player.aggregate_xp);
  expect(after.player.spirit_max).toBe(before.player.spirit_max);
  await ctx.close();
});

// ── Scenario 8: Battle Hand → Reliquary in one action (unassign + uncarry) ────
test('reliquary: a Battle Hand ring can be sent to the Reliquary in one action', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  // A1 starts occupied by a carried battle ring.
  const a1Ring = me.loadout.a1 as string;
  expect(a1Ring).toBeTruthy();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'reliquary'), a1Ring);
  await page.waitForFunction(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    a1Ring,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  // Uncarried AND cleared from its battle slot in the single action.
  expect(after.rings.find((r: any) => r.id === a1Ring)?.in_carry).toBe(0);
  expect(BATTLE_SLOTS.every((s) => after.loadout[s] !== a1Ring)).toBe(true);
  await ctx.close();
});
