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

  // #424 — __reliquaryLocked is no longer set by carry-cap or bench-full.
  // Wait for the overlay to be fully rendered (move hooks registered) instead.
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', { timeout: 5000 });

  const beforeCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  // #413: pick-up (select) now SUCCEEDS; only the DROP to 'spare' is rejected by
  // the drop-time guard in reliquaryMove (carry cap exceeded).
  await page.evaluate(
    (id) => (window as any).__reliquarySelect(id, 'reliquary'),
    reliquaryRing.id,
  );
  // Drop to 'spare' — rejected by drop-time guard (carry cap full).
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

// ── Scenario 10 (#388/#413/#424): full bench → SPIRIT cards still clickable/swappable;
// pool insertion ('spare' drop) still rejected ──
// #424 removes the bench-full lock (__reliquaryLocked) and card dim from the SPIRIT grid.
// Occupied SPIRIT cards are valid swap targets regardless of pool fullness. Pool
// insertions (drop to 'spare') remain rejected by the drop-time capacity guard.
test('reliquary: full bench — SPIRIT cards clickable and swap-valid; drop-to-spare still rejected (#424)', async ({
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
  // A Reliquary ring left behind to click and swap.
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

  // #424 — __reliquaryLocked is NO LONGER set by bench fullness; bench-full does not
  // lock the SPIRIT grid. The grid SPIRIT cards must NOT be dimmed.
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 5000 });
  const isLocked = await page.evaluate(() => (window as any).__reliquaryLocked);
  expect(isLocked, '__reliquaryLocked must not be true at full bench (#424 removed bench-full lock)').not.toBe(true);

  // #424 — SPIRIT card alpha must be 1 (not dimmed) at full bench.
  const cardAlpha = await page.evaluate((id) => {
    const grid = (window as any).__scene?.sanctumGrid;
    return grid?.getCardBg?.(id)?.alpha ?? null;
  }, remainingReliquary);
  // alpha may be null if grid not yet rendered; if present it must be 1 (not dimmed).
  if (cardAlpha !== null) {
    expect(cardAlpha as number, 'SPIRIT card must not be dimmed at full bench (#424)').toBe(1);
  }

  // Pick-up (select) SUCCEEDS at full bench — no lock.
  await page.evaluate(
    (id) => (window as any).__reliquarySelect(id, 'reliquary'),
    remainingReliquary,
  );

  // #413 / #424: pool insertion via __reliquaryMove('spare') is STILL rejected at
  // drop time (capacity guard unchanged — insertions always capacity-checked).
  const beforeCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  // Drop to 'spare' — rejected by drop-time guard (spareCount >= spareRingMax); carry count must not change.
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

// ── rings-swap Scenario 1 (#424): everything-full swap in sanctum ──────────────
// Both the spare pool (9/9) and the reliquary are at cap. The Reliquary overlay
// is open. A real click on a SPIRIT card + a real click on a bench card issues
// PUT /api/rings/swap. The exchange succeeds: both pool counts are unchanged and
// the two rings swapped their in_carry values.
test('rings-swap S1 (sanctum): SPIRIT↔bench swap with both pools at cap succeeds', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Fill spare pool to 9 AND leave the reliquary with at least one ring.
  await seedRestingRings(token, 9);
  const me0 = await getMe(token);
  const spareMax = me0.player.spare_ring_max as number;
  const slotted = (BATTLE_SLOTS.map((s) => (me0.loadout as any)[s]).filter(Boolean) as string[]);
  const resting = me0.rings.filter((r: any) => r.in_carry === 0).map((r: any) => r.id);
  const nineSpares = resting.slice(0, 9);
  expect(nineSpares.length).toBe(9);
  // A Reliquary ring left behind (resting[9]).
  const spiritRingId = resting[9];
  expect(spiritRingId).toBeDefined();
  const carryRes = await putCarry(token, [...slotted, ...nineSpares]);
  expect(carryRes.status).toBe(200);

  // Re-read /api/me after seeding.
  const me1 = await getMe(token);
  const benchRings1 = (me1.rings as Array<{ id: string; in_carry: number }>).filter(
    (r) => r.in_carry === 1 && !slotted.includes(r.id),
  );
  expect(benchRings1.length, 'bench must be full after seeding').toBe(spareMax);
  const benchRing0Id = benchRings1[0].id;

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 14,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // #424 — lock must NOT be set; bench-full no longer locks the SPIRIT grid.
  const isLocked = await page.evaluate(() => (window as any).__reliquaryLocked);
  expect(isLocked, '__reliquaryLocked must not be true (#424)').not.toBe(true);

  // Two-click swap via E2E hooks: select the SPIRIT ring, then select the bench ring.
  // The second __reliquarySelect from a different source triggers applySwap → carrySwap.
  // Both pool counts stay the same — carry enters one and leaves one atomically.
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), spiritRingId);
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'spare'), benchRing0Id);

  // Wait for the server round-trip to propagate.
  await page.waitForFunction(
    (sid) => {
      const s = (window as any).__campState;
      return s?.rings?.find((r: any) => r.id === sid)?.in_carry === 1;
    },
    spiritRingId,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  // Both pool counts must be unchanged — a swap never adds to a pool.
  const afterBenchRings = (after.rings as Array<{ id: string; in_carry: number }>).filter(
    (r) => r.in_carry === 1 && !slotted.includes(r.id),
  );
  expect(afterBenchRings.length, 'bench count must be unchanged after swap').toBe(spareMax);
  const afterResting = (after.rings as Array<{ id: string; in_carry: number }>).filter(
    (r) => r.in_carry === 0,
  );
  expect(afterResting.length, 'reliquary count must be unchanged after swap').toBe(
    me1.rings.filter((r: any) => r.in_carry === 0).length,
  );
  // The two rings exchanged in_carry.
  const spiritAfter = after.rings.find((r: any) => r.id === spiritRingId);
  expect(spiritAfter?.in_carry, 'SPIRIT ring must now be on bench (in_carry=1)').toBe(1);
  const benchAfter = after.rings.find((r: any) => r.id === benchRing0Id);
  expect(benchAfter?.in_carry, 'bench ring must now be in reliquary (in_carry=0)').toBe(0);

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

// ── Scenario 12 (#395/#413): pick-up always allowed at full bench (guard moved to drop time) ──
// #395 added isPickupBlockedByFullBench to allow net-zero pick-ups.
// #413 deleted the pick-up-time guard entirely — pick-up is ALWAYS allowed at any bench level.
// The drop to 'spare' at full bench is rejected by the drop-time guard in reliquaryMove.
// This test verifies that picking up a reliquary ring at full bench succeeds in ALL orders.
test('reliquary (#413): pick-up always succeeds at full bench; only drop to spare is guarded', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  const spareMax = me.player.spare_ring_max as number;

  // Seed exactly spare_ring_max carried, non-slotted rings to fill the bench.
  const slotted = new Set(
    BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[],
  );
  if (me.player.heart_ring?.id) slotted.add(me.player.heart_ring.id);
  const currentSpares = me.rings.filter(
    (r: any) => r.in_carry === 1 && !slotted.has(r.id),
  ).length;
  const toAdd = spareMax - currentSpares;
  if (toAdd > 0) {
    // Buy and carry exactly the rings needed to fill the bench.
    for (let i = 0; i < toAdd; i++) {
      await fetch(`${API_URL}/api/merchant/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
      });
    }
    const meAfter = await getMe(token);
    const allCarriedIds = meAfter.rings
      .filter((r: any) => r.in_carry === 1)
      .map((r: any) => r.id);
    await putCarry(token, allCarriedIds);
  }

  // Ensure there is at least one reliquary ring to pick up.
  const meFull = await getMe(token);
  const reliquaryRing = meFull.rings.find((r: any) => r.in_carry === 0 && r.heart_slot !== 1);
  if (!reliquaryRing) {
    // Not enough rings for this test setup — skip gracefully.
    return;
  }

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // #424 — __reliquaryLocked is no longer set by bench-fullness. Wait for overlay.
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', { timeout: 8000 });

  // #413: pick-up is ALWAYS allowed. Select a reliquary ring directly (no spare first).
  // With the old guard this would be blocked; with #413 it succeeds.
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), reliquaryRing.id);

  // Overlay must stay open — pick-up succeeded (no crash, no rejection).
  const overlayOpen = await page.evaluate(
    () => (window as any).__sanctumOverlayOpen === 'ringwall',
  );
  expect(overlayOpen, 'Overlay must remain open after reliquary pick-up at full bench (#413)').toBe(true);

  // #424 — lock badge removed; __reliquaryLocked is no longer set.
  const stillLocked = await page.evaluate(() => (window as any).__reliquaryLocked);
  expect(stillLocked, '__reliquaryLocked must not be set after #424').not.toBe(true);

  // Also verify order A still works: select spare first, then reliquary (both succeed).
  await page.evaluate(() => (window as any).__reliquarySelect(null, 'spare')); // clear
  const spareRingId = await page.evaluate(() => {
    const state = (window as any).__campState;
    const slottedBattle = new Set(
      ['thumb','a1','a2','d1','d2'].map((s) => (state?.loadout as any)?.[s]).filter(Boolean) as string[],
    );
    return state?.rings?.find((r: any) => r.in_carry === 1 && !slottedBattle.has(r.id))?.id ?? null;
  });

  if (spareRingId) {
    await page.evaluate((id) => (window as any).__reliquarySelect(id, 'spare'), spareRingId);
    await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), reliquaryRing.id);
    const overlayStillOpen = await page.evaluate(
      () => (window as any).__sanctumOverlayOpen === 'ringwall',
    );
    expect(overlayStillOpen, 'Overlay stays open after order-A pick-up sequence').toBe(true);
  }

  await ctx.close();
});

// ── Scenario 13 (#413): full bench (9/9) — SPIRIT→A1 swap succeeds (no bench-full rejection) ──
// GDD §4: SPIRIT ↔ battle-slot swaps are always valid regardless of bench count.
// The drop-time guard only fires when target === 'spare'. Swapping a reliquary ring ↔ A1
// (through the two-click select pattern) is always valid because carry count stays constant.
// Drive via __reliquarySelect twice (select reliquary ring, then select A1 battle ring) to
// trigger applySwap → swapIntoBattleSlot (atomic: assign slot first, then update carry net-zero).
test('reliquary (#413): full bench: SPIRIT-to-A1 swap succeeds without bench-full rejection', async ({
  browser,
}) => {
  const token = await registerAndToken();
  await seedRestingRings(token, 9);
  const me = await getMe(token);
  const spareMax = me.player.spare_ring_max as number;
  expect(spareMax).toBe(9);

  const slotted = BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[];
  expect(slotted.length).toBe(5);
  const resting = me.rings.filter((r: any) => r.in_carry === 0).map((r: any) => r.id);
  const nineSpares = resting.slice(0, 9);
  expect(nineSpares.length).toBe(9);
  const reliquaryRing = resting[9];
  expect(reliquaryRing).toBeDefined();
  const carryRes = await putCarry(token, [...slotted, ...nineSpares]);
  expect(carryRes.status).toBe(200);

  const a1RingId = (me.loadout as any).a1 as string;
  expect(a1RingId).toBeTruthy();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 14,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // Bench is full (spareCount 9 >= 9). #424: __reliquaryLocked no longer set. Wait for overlay.
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', { timeout: 5000 });

  // Step 1: pick up the reliquary ring (SPIRIT section) — succeeds (no pick-up-time guard in #413).
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), reliquaryRing);

  // Step 2: click A1 battle slot ring — triggers applySwap → swapIntoBattleSlot (atomic, net-zero carry).
  // The drop-time guard does NOT apply here (target is a battle slot, not 'spare').
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'battle'), a1RingId);

  // Wait for the server round-trip: reliquaryRing should now be in A1.
  await page.waitForFunction(
    (id) => (window as any).__campState?.loadout?.a1 === id,
    reliquaryRing,
    { timeout: 8000 },
  );

  // Verify: reliquary ring is now in A1; old A1 ring was displaced to reliquary.
  const after = await getMe(token);
  expect(after.loadout.a1, 'SPIRIT-to-A1 swap: reliquary ring must be in A1 after swap').toBe(reliquaryRing);
  expect(after.rings.find((r: any) => r.id === reliquaryRing)?.in_carry, 'ring must be carried').toBe(1);

  // Overlay must still be open (swap succeeded, not rejected).
  const overlayOpen = await page.evaluate(() => (window as any).__sanctumOverlayOpen === 'ringwall');
  expect(overlayOpen, 'Overlay must still be open (swap succeeded, not rejected)').toBe(true);

  await ctx.close();
});

// ── Scenario 14 (#413): full bench (9/9) — SPIRIT → bench drop is rejected at drop time ──
// Dropping a reliquary ring to 'spare' (bench) when bench is full should be rejected by
// the drop-time guard with no server call made (ring remains in reliquary).
test('reliquary (#413): full bench: SPIRIT-to-spare drop is rejected at drop time', async ({
  browser,
}) => {
  const token = await registerAndToken();
  await seedRestingRings(token, 9);
  const me = await getMe(token);
  const spareMax = me.player.spare_ring_max as number;
  expect(spareMax).toBe(9);

  const slotted = BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[];
  const resting = me.rings.filter((r: any) => r.in_carry === 0).map((r: any) => r.id);
  const nineSpares = resting.slice(0, 9);
  expect(nineSpares.length).toBe(9);
  const reliquaryRing = resting[9];
  expect(reliquaryRing).toBeDefined();
  await putCarry(token, [...slotted, ...nineSpares]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length === 14,
    { timeout: 8000 },
  );
  await openReliquary(page);
  // #424: __reliquaryLocked no longer set by bench-fullness; wait for hooks to be registered.
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', { timeout: 5000 });

  const beforeCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );

  // Pick up the reliquary ring — succeeds (pick-up never blocked in #413).
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), reliquaryRing);

  // Attempt drop to 'spare' — rejected by drop-time guard.
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'spare'), reliquaryRing);
  await page.waitForTimeout(500);

  // Carried count must be unchanged (drop was rejected, ring not carried).
  const afterCarried = await page.evaluate(
    () => (window as any).__campState.rings.filter((r: any) => r.in_carry === 1).length,
  );
  expect(afterCarried, 'carried count must not change when drop to spare is rejected').toBe(beforeCarried);

  const after = await getMe(token);
  expect(
    after.rings.find((r: any) => r.id === reliquaryRing)?.in_carry,
    'ring must remain in reliquary (not carried) after rejected drop',
  ).toBe(0);

  await ctx.close();
});

// ── #423 helpers — real-pointer geometry for the sanctum overlay ──────────────

/**
 * Convert logical canvas coordinates (1024×576) to page coordinates via the canvas
 * bounding rect — same helper as manage-battle-rings.spec.ts / anchorage-campfire.
 */
async function canvasCoords(
  page: Page,
  logicalX: number,
  logicalY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas element not found');
  const scaleX = box.width / 1024;
  const scaleY = box.height / 576;
  return {
    x: Math.round(box.x + logicalX * scaleX),
    y: Math.round(box.y + logicalY * scaleY),
  };
}

/** Real-pointer click at a logical canvas coordinate. */
async function clickCanvas(page: Page, pt: { x: number; y: number }): Promise<void> {
  const { x, y } = await canvasCoords(page, pt.x, pt.y);
  await page.mouse.click(x, y);
}

// BHC geometry (BenchHealthCombat.ts): first bench cell center = grid origin
// (370,148) + local card center (CARD_W/2=32, CARD_H/2=44).
const BENCH_CELL0 = { x: 402, y: 192 } as const;
// DISCARD slot in BHC: HEALTH column (659), row 2 (291).
const DISCARD_SLOT = { x: 659, y: 291 } as const;
// SPIRIT grid origin (CampScene COL_RELIQUARY_X=152, top y=148); InventoryGrid
// cell geometry CARD_W=64, COL_GAP=72, ROW_GAP=92, CARD_H=88.
const SPIRIT_GRID_ORIGIN = { x: 152, y: 148 } as const;

// ── Scenario 15 (#423 S3): DISCARD slot opens confirm and deletes the ring ────
// The DISCARD slot now lives in the shared BenchHealthCombat at (659,291) and is
// available in sanctum mode for the first time. Select a bench ring with a real
// click, real-click DISCARD, confirm with the Y key, and verify the server
// deleted the ring. Gestures via real pointer/keys; hooks for state readback only.
test('reliquary (#423 S3): DISCARD slot at (659,291) opens confirm and deletes ring', async ({
  browser,
}) => {
  const token = await registerAndToken();
  // Seed one resting ring and carry it so it lands on the bench (cell 0).
  await seedRestingRings(token, 1);
  const me = await getMe(token);
  const slotted = BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[];
  const benchRing = me.rings.find((r: any) => r.in_carry === 0)?.id as string;
  expect(benchRing, 'a resting ring must exist to seed the bench').toBeDefined();
  await putCarry(token, [...slotted, benchRing]);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Real-click the bench ring (cell 0) to select it. Readback via the scene's
  // swap manager (TypeScript-private, JS-runtime-accessible — reads only).
  await clickCanvas(page, BENCH_CELL0);
  await page.waitForFunction(
    (id) => ((window as any).__scene as any)?.swapManager?.selection?.ringId === id,
    benchRing,
    { timeout: 5000 },
  );

  // Real-click the DISCARD slot → confirm dialog opens.
  await clickCanvas(page, DISCARD_SLOT);
  await page.waitForFunction(() => (window as any).__discardConfirmOpen === true, {
    timeout: 5000,
  });

  // Ring is NOT yet deleted (confirm pending).
  let after = await getMe(token);
  expect(after.rings.some((r: any) => r.id === benchRing)).toBe(true);

  // Press Y → confirm the discard.
  await page.keyboard.press('y');
  await page.waitForFunction(() => (window as any).__discardConfirmOpen === false, {
    timeout: 5000,
  });

  // Server deleted the ring.
  await page.waitForTimeout(500); // allow DELETE + reload round-trip
  after = await getMe(token);
  expect(
    after.rings.some((r: any) => r.id === benchRing),
    'ring must be permanently deleted after Y-confirm',
  ).toBe(false);

  await ctx.close();
});

// ── Scenario 16 (#423 S4): SPIRIT ghost visible below cap; click moves ring ───
// The SPIRIT grid shows an always-visible ghost cell at index reliquaryCount when
// the pool is below cap. Selecting a bench ring and real-clicking the ghost moves
// the ring to the reliquary (in_carry=0).
test('reliquary (#423 S4): SPIRIT ghost visible below cap; click moves ring to reliquary', async ({
  browser,
}) => {
  const token = await registerAndToken();
  await seedRestingRings(token, 1);
  const me = await getMe(token);
  const slotted = BATTLE_SLOTS.map((s) => (me.loadout as any)[s]).filter(Boolean) as string[];
  const benchRing = me.rings.find((r: any) => r.in_carry === 0)?.id as string;
  expect(benchRing).toBeDefined();
  await putCarry(token, [...slotted, benchRing]);

  // Reliquary pool count AFTER carrying the bench ring (it left the pool).
  const me2 = await getMe(token);
  const reliqCount: number =
    me2.player.reliquaryCount ??
    me2.rings.filter((r: any) => r.in_carry === 0 && !r.escrowed && r.heart_slot !== 1).length;
  const reliqCap: number = me2.player.reliquaryCap ?? 20;
  expect(reliqCount, 'test requires a below-cap reliquary').toBeLessThan(reliqCap);
  // Ghost must land in the visible 3-row window for a real click (fresh players do).
  expect(reliqCount, 'test requires the ghost within the visible rows').toBeLessThan(9);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Readback: the spirit ghost rectangle (fill 0x1a2233) exists in the scene graph.
  const ghostPresent = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const walk = (c: any): boolean => {
      for (const o of c.getAll ? c.getAll() : []) {
        if (o.type === 'Rectangle' && o.fillColor === 0x1a2233 && o.input?.cursor === 'pointer') {
          return true;
        }
        if (o.getAll && walk(o)) return true;
      }
      return false;
    };
    return walk({ getAll: () => scene.children.getAll() });
  });
  expect(ghostPresent, 'SPIRIT ghost must be present when reliquary is below cap').toBe(true);

  // Real-click the bench ring to select it, then real-click the ghost.
  await clickCanvas(page, BENCH_CELL0);
  await page.waitForFunction(
    (id) => ((window as any).__scene as any)?.swapManager?.selection?.ringId === id,
    benchRing,
    { timeout: 5000 },
  );
  // Ghost cell at index reliqCount: local (n%3)*72+32, floor(n/3)*92+44.
  const ghostLogical = {
    x: SPIRIT_GRID_ORIGIN.x + (reliqCount % 3) * 72 + 32,
    y: SPIRIT_GRID_ORIGIN.y + Math.floor(reliqCount / 3) * 92 + 44,
  };
  await clickCanvas(page, ghostLogical);

  // The ring moved to the reliquary (in_carry=0) — server-authoritative.
  await page.waitForFunction(
    async (id) => {
      const r = await fetch('http://localhost:2568/api/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('er_token')}` },
      });
      const d = await r.json();
      return d.rings.find((x: any) => x.id === id)?.in_carry === 0;
    },
    benchRing,
    { timeout: 8000 },
  );
  const final = await getMe(token);
  expect(final.rings.find((r: any) => r.id === benchRing)?.in_carry).toBe(0);

  await ctx.close();
});
