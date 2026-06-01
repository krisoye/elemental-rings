import { test, expect } from '@playwright/test';
import { driveAiDuel } from './helpers';

// #40 — Carry system E2E. Asserts on REAL server state (API responses) and the
// CampScene __campState hook, never mocked values. Mirrors the harness style of
// camp.spec.ts: register a fresh user per test, seed the JWT into the context,
// drive the scene via its deterministic window hooks.
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

interface Ring {
  id: string;
  element: number;
  in_carry: number;
}

async function register(): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, password: 'pw' }),
  });
  if (!res.ok) throw new Error(`register failed (${res.status})`);
  return res.json();
}

async function me(token: string): Promise<{ player: any; rings: Ring[]; loadout: any }> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

// ── GET /api/me exposes the computed carry_cap (5 for a fresh player) ────────
// #171: /api/me now returns the XP-derived carry_cap (5 + ceil(log_2(aggregate_xp))),
// NOT the stale DB column. Fresh player has aggregate_xp=0 → cap=5.
test('carry: GET /api/me returns computed carry_cap 5 for a fresh player', async () => {
  const { token } = await register();
  const { player } = await me(token);
  expect(player.carry_cap).toBe(5);
});

// ── PUT /api/carry sets in_carry flags correctly ──────────────────────────────
test('carry: PUT /api/carry sets in_carry on exactly the named rings', async () => {
  const { token } = await register();
  const { rings } = await me(token);

  // Carry exactly three rings of our choosing.
  const target = rings.slice(0, 3).map((r) => r.id);
  const putRes = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: target }),
  });
  expect(putRes.status).toBe(200);

  const { rings: after } = await me(token);
  const carried = after.filter((r) => r.in_carry === 1).map((r) => r.id).sort();
  expect(carried).toEqual([...target].sort());
});

// ── PUT /api/carry enforces the carry cap ─────────────────────────────────────
// #171: the effective carry cap is now XP-derived: 5 + ceil(log_2(aggregate_xp)).
// A fresh player (aggregate_xp = 0) has cap = 5. Carrying exactly 5 rings is
// allowed; 6 rings is rejected.
test('carry: PUT /api/carry returns 400 when count exceeds carry_cap', async () => {
  const { token } = await register();
  const { rings } = await me(token);
  expect(rings.length).toBe(10); // 10 starter rings

  // Exactly 5 rings is at the cap for a fresh player (5 + 0 spare) → 200.
  const atCap = rings.slice(0, 5).map((r) => r.id);
  const ok = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: atCap }),
  });
  expect(ok.status).toBe(200);

  // 6 rings exceeds the cap (6 > 5) → 400.
  const overCap = rings.slice(0, 6).map((r) => r.id);
  const overflow = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: overCap }),
  });
  expect(overflow.status).toBe(400);

  // An unowned id is rejected (ownership validation).
  const bad = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: ['not-a-real-ring-id'] }),
  });
  expect(bad.status).toBe(400);
});

// ── CampScene __campState exposes the three carry pools ───────────────────────
test('carry: __campState separates atSanctum / loadout / battleHand', async ({ browser }) => {
  const { token } = await register();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  await page.waitForFunction(() => (window as any).__campState?.carry_cap !== undefined, {
    timeout: 8000,
  });
  const state = await page.evaluate(() => (window as any).__campState);

  // #171: carry_cap is now XP-derived. Fresh player has aggregate_xp=0 → cap=5.
  // /api/me now returns the computed cap, so CampScene's __campState reflects it.
  expect(state.carry_cap).toBe(5);
  expect(Array.isArray(state.atSanctum)).toBe(true);
  expect(Array.isArray(state.loadout_pool)).toBe(true);
  expect(Array.isArray(state.battleHand)).toBe(true);
  // Default: 5 battle-slot rings carried, 5 spares at Sanctum, 0 loadout-only.
  expect(state.battleHand.length).toBe(5);
  expect(state.atSanctum.length).toBe(5);
  // Pools are disjoint: an At-Sanctum ring is never carried.
  for (const r of state.atSanctum) expect(r.in_carry).toBe(0);
  for (const r of state.loadout_pool) expect(r.in_carry).toBe(1);

  await ctx.close();
});

// ── Add to Loadout moves a Sanctum ring into carry (when cap allows) ─────────
// #171: effective carry cap is now 5 + ceil(log_2(aggregate_xp)). A fresh player
// starts with 5 battle-slot rings carried (= cap). We free one slot first, then
// add a Sanctum ring to confirm the carry flow works within the new cap model.
test('carry: __campAddToLoadout carries a Sanctum ring', async ({ browser }) => {
  const { token } = await register();
  const { rings } = await me(token);

  // Free one carry slot: put only 4 of the 5 currently-carried battle rings back.
  const currentlyCarried = rings.filter((r) => r.in_carry === 1).map((r) => r.id);
  const reducedCarry = currentlyCarried.slice(0, 4);
  const freeSlot = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: reducedCarry }),
  });
  expect(freeSlot.status).toBe(200);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);
  // Wait for both the hook AND the async /api/me data: __campAddToLoadout is set
  // synchronously in CampScene.create() but __campState is populated only after
  // the fetch resolves. Mint-token is now instant (no bcrypt), so __campAddToLoadout
  // can be defined before the fetch completes. Waiting for atSanctum to be a
  // non-empty array guarantees both are ready.
  await page.waitForFunction(
    () => {
      const cs = (window as any).__campState;
      return typeof (window as any).__campAddToLoadout === 'function' &&
             Array.isArray(cs?.atSanctum) && cs.atSanctum.length > 0;
    },
    undefined,
    { timeout: 12000 },
  );

  // Pick a Sanctum (uncarried) ring and carry it — there is now one free slot.
  const sanctumId = await page.evaluate(
    () => (window as any).__campState.atSanctum[0].id as string,
  );
  await page.evaluate((id) => (window as any).__campAddToLoadout(id), sanctumId);

  await page.waitForFunction(
    (id) =>
      (window as any).__campState.rings.find((r: any) => r.id === id)?.in_carry === 1,
    sanctumId,
    { timeout: 5000 },
  );

  const { rings: after } = await me(token);
  expect(after.find((r) => r.id === sanctumId)?.in_carry).toBe(1);
  await ctx.close();
});

// ── Post-battle won-ring modal: room case (Add) ──────────────────────────────
// The prompt now fires in EncounterScene (the post-battle destination), so we
// seed a pending ring and navigate into EncounterScene to exercise it.
// #171: effective cap is now 5. We free one carry slot first to create room for
// the pending ring, then confirm the Add path works.
test('carry: won-ring modal Add carries the pending ring (room case)', async ({ browser }) => {
  const { token } = await register();
  // Reduce carry to 4 rings to make room for the pending ring (cap=5, 4 < 5).
  const { rings } = await me(token);
  const carried = rings.filter((r) => r.in_carry === 1).map((r) => r.id);
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: carried.slice(0, 4) }),
  });
  const { rings: updated } = await me(token);
  const pending = updated.find((r) => r.in_carry === 0)!; // a spare to simulate "won"

  const ctx = await browser.newContext();
  await ctx.addInitScript(
    `localStorage.setItem('er_token', ${JSON.stringify(token)});` +
      `localStorage.setItem('er_pending_ring', ${JSON.stringify(pending.id)});`,
  );
  const page = await ctx.newPage();
  await page.goto(URL);

  // Move from CampScene into EncounterScene, where the won-ring prompt fires.
  await page.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await page.evaluate(() => (window as any).__campGoEncounter());

  // Modal opens (pendingWonRing populated) and the hook is available.
  await page.waitForFunction(
    () => (window as any).__encounterState?.pendingWonRing?.ringId !== undefined,
    { timeout: 8000 },
  );
  const pend = await page.evaluate(() => (window as any).__encounterState.pendingWonRing);
  expect(pend.ringId).toBe(pending.id);

  await page.evaluate(() => (window as any).__encounterResolveWonRing('carry'));

  // er_pending_ring cleared after resolution.
  await page.waitForFunction(() => localStorage.getItem('er_pending_ring') === null, {
    timeout: 5000,
  });
  // The won ring is now carried (verify against real server state).
  const after = await me(token);
  expect(after.rings.find((r) => r.id === pending.id)?.in_carry).toBe(1);
  await ctx.close();
});

// ── Post-battle won ring with FULL carry → Manage Battle Hand discard flow ────
//
// End-to-end via a REAL forced win: a 1-heart AI with extinguished rings
// (aiHearts:1, aiUses:0) forfeits its first attack turn (§6.6) → guaranteed
// protagonist win → a genuine granted 11th ring stored in er_pending_ring.
//
// #171: effective carry cap is now 5. A fresh player already has 5 rings carried
// (the battle slots), so carry is AT the cap immediately after winning. The
// redesigned full-carry flow has no swap modal: when carry is at the cap the
// won-ring prompt routes straight to Manage Battle Hand, which shows the pending
// ring. Discarding a carried ring frees a slot and auto-carries the pending ring
// (tryAutoCarryPending). Asserts: the discarded ring is gone (deleted), the won
// ring is now carried, carry holds at the cap, and er_pending_ring is cleared.
test('carry: full-carry win → discard in Manage Battle Hand auto-carries the won ring', async ({
  browser,
}) => {
  const { token } = await register();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Forced WIN → a real granted 11th ring. driveAiDuel lands in EncounterScene.
  const wonRingId = await driveAiDuel(page, { personality: 'AGGRESSIVE', aiHearts: 1, aiUses: 0 });
  expect(wonRingId).not.toBeNull();

  // With cap=5 and 5 rings already carried, the fresh player is AT the cap.
  // The win prompt should route DIRECTLY to Manage Battle Hand (full-carry case),
  // not the room-case modal. The won ring stays uncarried as a pending ring.
  const { rings } = await me(token);
  expect(rings.length).toBe(11); // 10 starters + 1 won

  // Confirm the won ring is uncarried (it was granted but carry is full).
  // The client placed it in er_pending_ring. Re-arm it to be certain.
  const currentlyCarried = rings.filter((r) => r.in_carry === 1);
  expect(currentlyCarried.length).toBe(5); // exactly at cap

  const discardId = currentlyCarried[0].id; // one carried ring to discard

  // Re-arm the won ring as pending, reload, and enter EncounterScene. Because
  // carry is full (5/5), checkPendingWonRing routes to Manage Battle Hand
  // rather than the room-case modal.
  await page.evaluate((id) => localStorage.setItem('er_pending_ring', id), wonRingId!);
  await page.reload();
  await page.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await page.evaluate(() => (window as any).__campGoEncounter());
  // Manage Battle Hand renders the pending won ring (no swap modal).
  await page.waitForFunction(
    () => (window as any).__encounterState?.pendingWonRing?.ringId !== undefined,
    { timeout: 8000 },
  );
  // Compute typeof IN the browser — page.evaluate cannot serialize a function
  // back to Node (it returns undefined), so checking typeof here is mandatory.
  expect(await page.evaluate(() => typeof (window as any).__encounterDiscardRing)).toBe('function');
  // Confirm the FULL case before the discard (real server state).
  expect((await me(token)).rings.filter((r) => r.in_carry === 1).length).toBe(5);

  // Discard a carried ring → frees a slot → tryAutoCarryPending carries the won
  // ring and clears er_pending_ring.
  await page.evaluate((id) => (window as any).__encounterDiscardRing(id), discardId);
  await page.waitForFunction(() => localStorage.getItem('er_pending_ring') === null, {
    timeout: 8000,
  });

  const { rings: final } = await me(token);
  // Won ring is now carried.
  expect(final.find((r) => r.id === wonRingId)?.in_carry).toBe(1);
  // Discarded ring is permanently gone (deleted, not returned to the Sanctum).
  expect(final.find((r) => r.id === discardId)).toBeUndefined();
  // Carry holds at the cap; total drops by the one discarded ring (11 → 10).
  expect(final.filter((r) => r.in_carry === 1).length).toBe(5);
  expect(final.length).toBe(10);
  await ctx.close();
}, 90000);
