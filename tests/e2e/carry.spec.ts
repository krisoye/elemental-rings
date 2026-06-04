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

// ── GET /api/me exposes the computed carry_cap (14, flat for all players) ────
// EPIC #279: /api/me returns the flat carry_cap = CORE_SLOTS(5) + SPARE_SLOTS(9)
// = 14, NOT the stale DB column and no longer XP-derived.
test('carry: GET /api/me returns computed carry_cap 14 for a fresh player', async () => {
  const { token } = await register();
  const { player } = await me(token);
  expect(player.carry_cap).toBe(14);
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

// ── PUT /api/carry enforces the flat carry cap of 14 ─────────────────────────
// EPIC #279: carry_cap = 14 for every player. A fresh player owns 10 starter
// rings; we seed 5 more into the Reliquary (15 owned total) so the cap boundary
// is reachable. Carrying exactly 14 is allowed; 15 is rejected.
test('carry: PUT /api/carry returns 400 when count exceeds carry_cap (14)', async () => {
  const { token } = await register();
  // Seed 5 extra resting rings → 15 owned, enough to exceed the cap of 14.
  const seed = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count: 5 }),
  });
  expect(seed.status).toBe(200);
  const { rings } = await me(token);
  expect(rings.length).toBe(15); // 10 starters + 5 seeded

  // Exactly 14 rings is at the cap → 200.
  const atCap = rings.slice(0, 14).map((r) => r.id);
  const ok = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: atCap }),
  });
  expect(ok.status).toBe(200);

  // 15 rings exceeds the cap (15 > 14) → 400.
  const overCap = rings.slice(0, 15).map((r) => r.id);
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

  // EPIC #279: carry_cap is a flat 14 for every player. /api/me returns the
  // computed cap, so CampScene's __campState reflects it.
  expect(state.carry_cap).toBe(14);
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
// EPIC #279: carry cap is a flat 14. A fresh player starts with 5 battle-slot
// rings carried (well under cap). We free one slot first, then add a Sanctum ring
// to confirm the carry flow works.
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
// EPIC #279: cap is a flat 14, and a fresh player carries 5 (under cap), so the
// won-ring prompt uses the room-case modal. We confirm the Add path works.
test('carry: won-ring modal Add carries the pending ring (room case)', async ({ browser }) => {
  const { token } = await register();
  // A fresh player carries 5 rings (under the cap of 14), so there is room
  // for the pending ring without reducing carry first. The server grants a ring
  // via POST /api/test/grant-ring below (pending=1, in_carry=1).

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // EPIC #378 — seed the pending WON ring via the API server (Node.js context so
  // the absolute API_URL is used, not the relative URL that hits the Vite client).
  // POST /api/test/grant-ring mints a ring with in_carry=1, pending=1 and returns
  // the player block with pending_ring_id set.
  const grantRes = await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ element: 0 }),
  });
  const grantData = await grantRes.json();
  const grantedPendingId = grantData.player?.pending_ring_id as string;
  expect(grantedPendingId).toBeTruthy();

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
  expect(pend.ringId).toBe(grantedPendingId);

  await page.evaluate(() => (window as any).__encounterResolveWonRing('carry'));

  // EPIC #378 — resolveWonRing clears window.__encounterState.pendingWonRing to null
  // after the PUT /api/rings/:id/accept call succeeds. This is the browser-side
  // signal that server resolution is complete; avoids a relative-URL fetch that
  // would hit the Vite dev server (port 8090) instead of the API (port 2568).
  await page.waitForFunction(
    () => (window as any).__encounterState?.pendingWonRing === null,
    { timeout: 5000 },
  );
  // The won ring is now carried (verify against real server state).
  const after = await me(token);
  expect(after.rings.find((r) => r.id === grantedPendingId)?.in_carry).toBe(1);
  await ctx.close();
});

// ── Post-battle won ring with FULL carry → Manage Battle Hand discard flow ────
//
// End-to-end via a REAL forced win: a 1-heart AI with extinguished rings
// (aiHearts:1, aiUses:0) forfeits its first attack turn (§6.6) → guaranteed
// protagonist win → a genuine granted ring stored in er_pending_ring.
//
// EPIC #279: carry cap is now a flat 14. To reach the full-carry routing (the
// won-ring prompt goes straight to Manage Battle Hand, not the room-case modal),
// the player must be carrying exactly 14 rings. We seed 4 extra rings (10 + 4 =
// 14 owned), carry all 14, then win → the granted ring becomes pending. Discarding
// a carried ring frees a slot and auto-carries the pending ring
// (tryAutoCarryPending). Asserts: the discarded ring is gone (deleted), the won
// ring is now carried, carry holds at the cap (14), and er_pending_ring is cleared.
test('carry: full-carry win → discard in Manage Battle Hand auto-carries the won ring', async ({
  browser,
}) => {
  const { token } = await register();
  // Seed 4 extra rings → 14 owned, then carry all 14 (at the cap).
  const seed = await fetch(`${API_URL}/api/test/seed-resting-rings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count: 4 }),
  });
  expect(seed.status).toBe(200);
  const seeded = await me(token);
  expect(seeded.rings.length).toBe(14); // 10 starters + 4 seeded
  const allFourteen = seeded.rings.map((r) => r.id);
  const carryAll = await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: allFourteen }),
  });
  expect(carryAll.status).toBe(200);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Forced WIN → a real granted 15th ring. driveAiDuel lands in EncounterScene.
  const wonRingId = await driveAiDuel(page, { personality: 'AGGRESSIVE', aiHearts: 1, aiUses: 0 });
  expect(wonRingId).not.toBeNull();

  // With cap=14 and 14 rings already carried, the player is AT the cap.
  // The win prompt should route DIRECTLY to Manage Battle Hand (full-carry case),
  // not the room-case modal. The won ring stays uncarried as a pending ring.
  const { rings } = await me(token);
  expect(rings.length).toBe(15); // 14 owned + 1 won

  const currentlyCarried = rings.filter((r) => r.in_carry === 1);
  expect(currentlyCarried.length).toBe(14); // exactly at cap

  const discardId = currentlyCarried[0].id; // one carried ring to discard

  // EPIC #378 — pending state is owned by the server (rings.pending column).
  // The duel win already set rings.pending=1 on wonRingId. No localStorage re-arm
  // is needed: after reload the client reads /api/me which returns pending_ring_id.
  // Because carry is full (14/14), checkPendingWonRing routes to Manage Battle Hand
  // rather than the room-case modal.
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
  // back to Node (it returns undefined), so checking typeof here is mandatory. The
  // programmatic hook is retained as a direct test affordance (#348).
  expect(await page.evaluate(() => typeof (window as any).__encounterDiscardRing)).toBe('function');
  // Confirm the FULL case before the discard (real server state).
  expect((await me(token)).rings.filter((r) => r.in_carry === 1).length).toBe(14);

  // #348 — drive the new safe 3-step discard UI (replaces the one-click ×): select
  // the carried ring → click the DISCARD slot (group-1 row-1, x=262 y=240) → confirm
  // [Discard]. Freeing a slot triggers tryAutoCarryPending, which carries the won
  // ring and clears er_pending_ring.
  await page.waitForFunction(
    () => (window as any).__game?.scene?.getScene('EncounterScene')?.battleHand?.isOpen?.() === true,
    { timeout: 8000 },
  );
  // Step 1 — select the carried ring (source 'spare' routes to discardCarriedRing).
  await page.evaluate((id) => {
    const bh = (window as any).__game.scene.getScene('EncounterScene').battleHand;
    bh.swap.select(id, 'spare');
    bh.renderManageModal();
  }, discardId);
  // Step 2 — click the DISCARD slot → confirm modal opens, nothing deleted yet.
  await page.evaluate(() => {
    const modal = (window as any).__game.scene.getScene('EncounterScene').battleHand.manageModal;
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
  expect(await page.evaluate(() => (window as any).__discardConfirmOpen)).toBe(true);
  // Step 3 — confirm [Discard].
  await page.evaluate(() => {
    const bh = (window as any).__game.scene.getScene('EncounterScene').battleHand;
    const yes = bh.discardConfirm?.getAll().find((o: any) => o.name === 'discard-confirm-yes');
    yes?.emit('pointerdown');
  });
  // EPIC #378 — wait for the server to clear pending_ring_id after auto-carry. The
  // discardCarriedRing path does not expose a browser-side window hook for this state
  // transition, so we poll the API from Node.js context (avoids the relative-URL
  // issue where fetch('/api/me') in a waitForFunction hits Vite at port 8090).
  await expect.poll(async () => {
    const { player } = await me(token);
    return player?.pending_ring_id;
  }, { timeout: 8000 }).toBeNull();

  const { rings: final } = await me(token);
  // Won ring is now carried (auto-carried by tryAutoCarryPending when the discard
  // freed a slot).
  expect(final.find((r) => r.id === wonRingId)?.in_carry).toBe(1);
  // Discarded ring is permanently gone (deleted, not returned to the Sanctum).
  expect(final.find((r) => r.id === discardId)).toBeUndefined();
  // Carry holds at the cap; total drops by the one discarded ring (15 → 14).
  expect(final.filter((r) => r.in_carry === 1).length).toBe(14);
  expect(final.length).toBe(14);
  await ctx.close();
}, 90000);
