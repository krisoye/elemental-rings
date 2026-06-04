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

/** POST /api/test/seed-resting-rings → add `count` Reliquary rings (in_carry=0). */
async function seedRestingRings(token: string, count: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`seed-resting-rings failed (${res.status}): ${await res.text()}`);
}

/** POST /api/test/grant-ring → mint a WON ring (in_carry=1, pending=1). */
async function grantWonRing(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ element: 0 }),
  });
  if (!res.ok) throw new Error(`grant-ring failed (${res.status}): ${await res.text()}`);
  return (await res.json()).player.pending_ring_id as string;
}

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

async function putCarry(token: string, ringIds: string[]): Promise<Response> {
  return fetch(`${API_URL}/api/carry`, {
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

// ── Scenario 1 (#389): converged columns, SPIRIT + BENCH counters, no LOADOUT ──
// The reliquary modal now shares the unified RingManagementOverlay structure:
// SPIRIT | BENCH | HEALTH | COMBAT columns. The old combined `loadout (N/cap)`
// badge is gone, replaced by separate SPIRIT (reliquaryCount/reliquaryCap) and
// BENCH (spareCount/spare_ring_max) counters. The live header still shows spirit.
test('reliquary (#389): opens with converged columns and SPIRIT + BENCH counters (no loadout badge)', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // #389 — the converged structure reporter announces sanctum mode + the four
  // columns + the Spirit/Bench counter values, and confirms no card has a Tier row.
  const state = await page.evaluate(() => (window as any).__ringMgmtState);
  expect(state).toBeTruthy();
  expect(state.mode).toBe('sanctum');
  expect(state.columns).toEqual(['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT']);
  expect(state.anyCardHasTierRow).toBe(false);

  // SPIRIT counter = reliquaryCount / reliquaryCap (server-authoritative).
  const reliquaryCount = me.player.reliquaryCount ??
    me.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  expect(state.counters.spirit.n).toBe(reliquaryCount);
  expect(state.counters.spirit.max).toBe(me.player.reliquaryCap);

  // BENCH counter = spareCount / spare_ring_max (pending excluded). A fresh player
  // carries the 5 battle-slot rings (all slotted) → bench 0.
  expect(state.counters.bench.max).toBe(me.player.spare_ring_max);
  const battleIds = new Set(['thumb','a1','a2','d1','d2'].map((s) => (me.loadout as any)[s]).filter(Boolean));
  const expectedBench = me.rings.filter(
    (r: any) => r.in_carry === 1 && !battleIds.has(r.id) && r.id !== me.player.pending_ring_id && !r.pending,
  ).length;
  expect(state.counters.bench.n).toBe(expectedBench);

  // The crisp counter labels are rendered (named scene texts).
  expect(await campTextByName(page, 'spirit-counter')).toBe(`${reliquaryCount}/${me.player.reliquaryCap}`);
  expect(await campTextByName(page, 'bench-counter')).toBe(`${expectedBench}/${me.player.spare_ring_max}`);

  // The removed combined badge no longer exists.
  expect(await campTextByName(page, 'loadout-badge')).toBeNull();

  // The middle column header reads BENCH (not the old SPARES).
  const benchLabel = await campTextByName(page, 'spare-label');
  expect(benchLabel).toContain('BENCH');
  expect(benchLabel).not.toContain('SPARES');

  // The live header still surfaces the authoritative spirit reading.
  const headerLeft = await campTextByName(page, 'reliquary-header-left');
  expect(headerLeft).toContain(`Spirit: ${me.player.spirit_current} / ${me.player.spirit_max}`);
  await ctx.close();
});

// ── Scenario 2: Reliquary → Loadout (Spare): carry rises, aggregate_xp drops ──
// #171: effective cap is 5+spare. A fresh player starts with 5 carried rings (at
// cap). We free one slot first so the Reliquary→Spare move stays within the cap.
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

  // Free one carry slot: carry only 4 of the 5 battle-slot rings so there is room.
  const carried = me.rings.filter((r: any) => r.in_carry === 1).map((r: any) => r.id);
  await putCarry(token, carried.slice(0, 4));

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 4,
    { timeout: 8000 },
  );
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
  // The header re-renders from the new authoritative state (left segment = spirit).
  const headerLeft = await campTextByName(page, 'reliquary-header-left');
  expect(headerLeft).toContain(`Spirit: ${after.player.spirit_current} / ${after.player.spirit_max}`);
  await ctx.close();
});

// ── Scenario 3: Loadout (Spare) → Reliquary: aggregate_xp rises ───────────────
// #171: effective cap is 5. Seed a Spare ring by carrying only 4 battle-slot rings
// plus 1 extra = 5 total, within cap.
test('reliquary: moving a Spare ring back to the Reliquary raises aggregate_xp', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  // Seed a carried-but-unslotted (Spare) ring: carry 4 battle-slot rings plus one
  // Reliquary ring so it sits in Spare (4 + 1 = 5, at cap).
  const extra = me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(extra).toBeDefined();
  const fourSlotted = Array.from(slotted).slice(0, 4);
  await putCarry(token, [...fourSlotted, extra.id]);

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
// #171: effective cap is 5. Free one slot first so carrying the Reliquary ring
// into a Battle Hand slot stays within cap.
test('reliquary: a Reliquary ring moves directly into a Battle Hand slot', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const slotted = new Set(['thumb','a1','a2','d1','d2'].map((s: string) => (me.loadout as any)[s]).filter(Boolean) as string[]);
  const reliquaryRing = me.rings.find((r: any) => r.in_carry === 0 && !slotted.has(r.id));
  expect(reliquaryRing).toBeDefined();

  // Free one slot: carry only 4 battle-slot rings so there is room for the
  // Reliquary ring to be carried into A1.
  const carried = me.rings.filter((r: any) => r.in_carry === 1).map((r: any) => r.id);
  await putCarry(token, carried.slice(0, 4));

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 4,
    { timeout: 8000 },
  );
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
  // non-empty. #171: cap = 5 for a fresh player, and there are 10 starter rings,
  // so 10 > 5 — there IS headroom. The test no longer skips for fresh players.
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

// ── Scenario 6b: the [×] close button closes the modal ───────────────────────
// Regression for the deselect-zone z-order bug: the full-modal transparent
// deselect rectangle was added on TOP of the [×] button, so a click at the
// button's location was swallowed by the deselect handler and the modal never
// closed. Reproduce the click the way the input system resolves it — the
// top-most (last-rendered) interactive child overlapping the [×] point wins —
// and assert that winner is the close button, which closes the overlay.
test('reliquary: the [×] button closes the modal', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const winner = await page.evaluate(() => {
    const scene = (window as any).__scene;
    const kids = scene.overlay.getAll();
    const closeBtn = kids.find((o: any) => o.text === '[×]');
    const px = closeBtn.x;
    const py = closeBtn.y;
    // Interactive children whose bounds contain the [×] center; the click resolves
    // to the last one (highest child index = rendered on top).
    const contenders = kids.filter((o: any) => {
      if (!o.input?.enabled) return false;
      const b = o.getBounds();
      return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
    });
    const top = contenders[contenders.length - 1];
    top.emit('pointerdown');
    return top.name || top.text;
  });

  // The [×] button — not the deselect zone — must be the click winner.
  expect(winner).toBe('[×]');
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === null, { timeout: 5000 });
  expect(await page.evaluate(() => (window as any).__sanctumOverlayOpen)).toBeNull();
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

// ── Scenario 9 (#388): full battle loadout but spare room → grid NOT locked ───
// Regression for the post-#378 lock bug: a full battle hand (5 slots) pushed the
// old aggregate `carried >= carry_cap` check toward locking even though the spare
// (Bench) pool was empty. The lock must track the spare-grid cap, so with all five
// battle slots filled and zero spares, the SPIRIT grid stays interactive and a
// Reliquary→Bench move succeeds.
test('reliquary: full battle loadout with spare room keeps the SPIRIT grid unlocked (#388)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  // Fresh player: 5 battle-slot rings carried + 5 resting Reliquary rings. All
  // battle slots are occupied; the spare pool is empty (spareCount 0 < 9).
  const slotted = new Set(
    BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[],
  );
  expect(slotted.size).toBe(5);
  const reliquaryRing = me.rings.find(
    (r: any) => r.in_carry === 0 && !slotted.has(r.id),
  );
  expect(reliquaryRing).toBeDefined();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // With a full battle hand but an empty spare pool the grid is NOT locked.
  const locked = await page.evaluate(() => (window as any).__reliquaryLocked);
  expect(locked).toBeFalsy();

  // The Reliquary→Bench (spare) move succeeds despite all battle slots being full.
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), reliquaryRing.id);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    reliquaryRing.id,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === reliquaryRing.id)?.in_carry).toBe(1);
  expect(BATTLE_SLOTS.every((s) => after.loadout[s] !== reliquaryRing.id)).toBe(true);
  await ctx.close();
});

// ── Scenario 10 (#388): spare pool full → SPIRIT grid locked, pickup rejected ──
// Seed the spare pool to spare_ring_max (9): 5 battle-slot rings + 9 spares = 14
// carried (at carry_cap). spareCount 9 >= 9 → locked. SPIRIT cards dim and a fresh
// Reliquary pick-up is rejected with the server cap message (no carry change).
test('reliquary: a full spare pool locks the SPIRIT grid and rejects a fresh pickup (#388)', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Add enough resting rings to fill the spare pool to 9 while leaving Reliquary
  // rings to click. Fresh: 5 battle + 5 resting (10). +9 resting → 19 owned.
  await seedRestingRings(token, 9);
  const me = await getMe(token);
  const spareMax = me.player.spare_ring_max as number;
  expect(spareMax).toBe(9);

  const slotted = BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[];
  expect(slotted.length).toBe(5);
  // Carry the 5 battle-slot rings + 9 spares (unslotted) = 14 carried, at cap.
  const resting = me.rings.filter((r: any) => r.in_carry === 0).map((r: any) => r.id);
  const nineSpares = resting.slice(0, 9);
  expect(nineSpares.length).toBe(9);
  // A Reliquary ring left behind to attempt picking up while locked.
  const remainingReliquary = resting[9];
  expect(remainingReliquary).toBeDefined();
  const carryRes = await putCarry(token, [...slotted, ...nineSpares]);
  expect(carryRes.status).toBe(200);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 14,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // spareCount (9) >= spare_ring_max (9) → the grid is locked.
  await page.waitForFunction(() => (window as any).__reliquaryLocked === true, { timeout: 5000 });

  // The locked Reliquary cards are dimmed (alpha < 1).
  const cardAlpha = await page.evaluate((id) => {
    const grid = (window as any).__scene.sanctumGrid;
    return grid?.getCardBg?.(id)?.alpha ?? null;
  }, remainingReliquary);
  expect(cardAlpha).not.toBeNull();
  expect(cardAlpha as number).toBeLessThan(1);

  // A fresh Reliquary pick-up is a no-op: select + move is rejected (cap).
  const beforeCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  await page.evaluate(
    (id) => (window as any).__reliquarySelect(id, 'reliquary'),
    remainingReliquary,
  );
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), remainingReliquary);
  await page.waitForTimeout(500);
  const afterCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  expect(afterCarried).toBe(beforeCarried);

  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === remainingReliquary)?.in_carry).toBe(0);
  await ctx.close();
});

// ── Scenario 11 (#388): pending WON ring is excluded from the spare lock count ─
// A WON ring arrives in_carry=1, pending=1 (one allowed overflow). With a non-full
// bench it must NOT count toward spareCount, so the SPIRIT grid stays unlocked and
// a Reliquary→Bench move still succeeds.
test('reliquary: a pending WON ring does not lock the SPIRIT grid (#388)', async ({ browser }) => {
  const token = await registerAndToken();
  // Mint a pending WON ring (in_carry=1, pending=1). Fresh player now has 5 battle
  // rings + 5 resting + 1 pending overflow. Spares (excluding pending) = 0 << 9.
  const pendingId = await grantWonRing(token);
  const me = await getMe(token);
  expect(me.player.pending_ring_id).toBe(pendingId);

  const slotted = new Set(
    BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[],
  );
  const reliquaryRing = me.rings.find(
    (r: any) => r.in_carry === 0 && !slotted.has(r.id) && r.id !== pendingId,
  );
  expect(reliquaryRing).toBeDefined();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // The pending ring is excluded from spareCount → the grid is NOT locked.
  const locked = await page.evaluate(() => (window as any).__reliquaryLocked);
  expect(locked).toBeFalsy();

  // A Reliquary→Bench move still succeeds with the pending ring present.
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), reliquaryRing.id);
  await page.waitForFunction(
    (id) => (window as any).__campState.loadout_pool.some((r: any) => r.id === id),
    reliquaryRing.id,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.rings.find((r: any) => r.id === reliquaryRing.id)?.in_carry).toBe(1);
  await ctx.close();
});
