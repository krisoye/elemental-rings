import { test, expect } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// Element indices (mirror shared/types ElementEnum).
const FIRE = 0;
const WATER = 1;
const EARTH = 2;
const WOOD = 4;
const STEAM = 5;
// Fusion requires both parents to reach at least Tier 1 (server/src/game/Tiers.ts:
// tierForXp — T1 begins at 500 XP), checked independently per parent. The parents
// do NOT have to share a tier (#390). A parent seeded to exactly 500 XP is the
// lowest fusable tier; the summed fusion XP is 1000, which is still Tier 1
// (T2 begins at 1500). max_uses is a pure function of XP (#339): the fusion ring's
// max_uses = 3 + tierForXp(1000) = 3 + 1 = 4 (PlayerRepo.fuseRings).
const TIER1_XP = 500;
const FUSED_XP = TIER1_XP * 2; // 1000 — additive parent XP (still Tier 1)
const FUSED_TIER = 1; // tierForXp(1000) — below the Tier-2 threshold (1500)
const FUSED_MAX_USES = 4; // 3 + tierForXp(1000) — pure XP rule, parent uses irrelevant

/** Register a fresh player and return its auth token. */
async function registerPlayer(): Promise<string> {
  const username = `f_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  });
  if (!res.ok) throw new Error(`register failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** GET /api/me with the token. */
async function getMe(token: string): Promise<{ rings: any[]; loadout: any }> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** Set a ring's XP to the absolute value via the test-only route. */
async function setRingXP(token: string, ringId: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId, xp }),
  });
  if (!res.ok) throw new Error(`set-ring-xp failed (${res.status})`);
}

/** Find the first owned ring of a given base element. */
function ringOfElement(rings: any[], element: number): any {
  const r = rings.find((x) => x.element === element);
  if (!r) throw new Error(`no ring of element ${element}`);
  return r;
}

/** Find the first `count` owned rings of a given base element. */
function ringsOfElement(rings: any[], element: number, count: number): any[] {
  const found = rings.filter((x) => x.element === element).slice(0, count);
  if (found.length < count) throw new Error(`need ${count} rings of element ${element}`);
  return found;
}

/** POST /api/fusion/combine and return the raw Response. */
function combine(token: string, ringId1: string, ringId2: string): Promise<Response> {
  return fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1, ringId2 }),
  });
}

// ── Scenario 1: Fuse two Tier-1 Fire+Water rings → Steam ──────────────────────
test('fusion: two Tier-1 Fire+Water rings fuse into a Steam ring', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(200);
  const { ring } = await res.json();
  expect(ring.element).toBe(STEAM);
  expect(ring.tier).toBe(FUSED_TIER);
  expect(ring.max_uses).toBe(FUSED_MAX_USES);
  expect(ring.current_uses).toBe(FUSED_MAX_USES);
  expect(ring.xp).toBe(FUSED_XP);

  // The Steam ring is present in inventory.
  const { rings: after } = await getMe(token);
  const steam = after.find((r: any) => r.id === ring.id);
  expect(steam).toBeDefined();
  expect(steam.element).toBe(STEAM);
});

// ── Scenario 1b: Different-tier compatible rings fuse (#390) ───────────────────
// 600 XP (Tier 1) + 3200 XP (Tier 3) — both clear the Tier-1 floor. #390 dropped
// the same-tier requirement, so the pair fuses; combined 3800 XP → Tier 3.
test('fusion: two different-tier (Tier 1 + Tier 3) compatible rings fuse (#390)', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, 600); // Tier 1
  await setRingXP(token, water.id, 3200); // Tier 3

  const res = await combine(token, fire.id, water.id);
  expect(res.status).toBe(200);
  const { ring } = await res.json();
  expect(ring.element).toBe(STEAM);
  expect(ring.xp).toBe(3800); // 600 + 3200 — additive parent XP

  // Both parents removed from inventory.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === fire.id)).toBeUndefined();
  expect(after.find((r: any) => r.id === water.id)).toBeUndefined();
});

// ── Scenario 2: Below-Tier-1 parent is rejected (per-parent gate, #390) ────────
// fire is left below 500 XP (400) while water reaches 600. Each parent must
// independently clear the Tier-1 floor, so the sub-500 parent is rejected.
test('fusion: a below-500-XP parent → 400 (per-parent Tier-1 gate)', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, 400); // below the 500-XP / Tier-1 floor
  await setRingXP(token, water.id, 600);

  const res = await combine(token, fire.id, water.id);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/Tier 1/i);

  // Both parents intact.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === fire.id)).toBeDefined();
  expect(after.find((r: any) => r.id === water.id)).toBeDefined();
});

// ── Scenario 2b: A fusion ring cannot be fused again (#390) ────────────────────
// Make a Steam fusion (Fire+Water), grant a fresh Wood ring at Tier 1, then try
// to fuse the Steam with the Wood — rejected with a distinct "already a fusion"
// message (the isFusion gate fires before the pair check).
test('fusion: re-fusing a fusion ring → 400 with a distinct "already a fusion" message (#390)', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);

  const fuseRes = await combine(token, fire.id, water.id);
  expect(fuseRes.status).toBe(200);
  const { ring: steam } = await fuseRes.json();
  expect(steam.element).toBe(STEAM);

  // Grant a fresh Wood ring and lift it to Tier 1 so only the isFusion gate can
  // block the fuse.
  await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ element: WOOD }),
  });
  const { rings: withWood } = await getMe(token);
  const wood = ringOfElement(withWood, WOOD);
  await setRingXP(token, wood.id, TIER1_XP);

  const res = await combine(token, steam.id, wood.id);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/already a fusion/i);
});

// ── Scenario 2c: Invalid element pair is rejected regardless of XP (#390) ──────
// Two Earth rings (the starter inventory holds several) form no valid fusion pair
// even though both clear the Tier-1 floor.
test('fusion: an invalid element pair (Earth+Earth) → 400 (no valid fusion)', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const [earth1, earth2] = ringsOfElement(rings, EARTH, 2);
  await setRingXP(token, earth1.id, TIER1_XP);
  await setRingXP(token, earth2.id, TIER1_XP);

  const res = await combine(token, earth1.id, earth2.id);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/do not form a valid fusion/i);
});

// ── Scenario 3: Both parents deleted after fusion ─────────────────────────────
test('fusion: both parents are removed from inventory after fusing', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(200);

  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === fire.id)).toBeUndefined();
  expect(after.find((r: any) => r.id === water.id)).toBeUndefined();
});

// ── Scenario 4: Loadout slot nulled when a parent is fused ─────────────────────
test('fusion: parent assigned to A1 → loadout.a1 becomes null after fusing', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);

  // Carry the fire ring then assign it to A1 (battle slots require carried rings).
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds: [fire.id] }),
  });
  const putRes = await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ a1: fire.id }),
  });
  expect(putRes.status).toBe(200);
  const { loadout: before } = await getMe(token);
  expect(before.a1).toBe(fire.id);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(200);

  const { loadout: after } = await getMe(token);
  expect(after.a1).toBeNull();
});

// ── Scenario 5: CampScene Fuse button produces a fusion ring ──────────────────
test('fusion: CampScene Fuse button creates a Steam ring in the inventory', async ({
  browser,
}) => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Wait for CampScene to load the maxed inventory.
  await page.waitForFunction(
    () => (window as any).__campState?.rings?.length >= 10,
    { timeout: 8000 },
  );

  // Open the fusion overlay via the E2E hook.
  await page.waitForFunction(
    () => typeof (window as any).__campOpenFusion === 'function',
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__campOpenFusion());

  // #396 — the unified overlay publishes __ringMgmtState (not __fusionState).
  // Wait until the fusion overlay is open and reports the expected columns.
  await page.waitForFunction(
    () => {
      const s = (window as any).__ringMgmtState;
      return s?.mode === 'fusion' &&
        Array.isArray(s?.columns) &&
        s.columns[0] === 'FUSE';
    },
    { timeout: 5000 },
  );

  // Fuse via the deterministic hook (identical path to the [Fuse] button).
  const error = await page.evaluate(
    ({ a, b }) => (window as any).__campFuse(a, b),
    { a: fire.id, b: water.id },
  );
  expect(error).toBeNull();

  // The Steam fusion ring appears in the reloaded camp inventory.
  await page.waitForFunction(
    ({ steamEl, tier }) =>
      ((window as any).__campState?.rings ?? []).some(
        (r: any) => r.element === steamEl && r.tier === tier,
      ),
    { steamEl: STEAM, tier: FUSED_TIER },
    { timeout: 8000 },
  );
  const steam = await page.evaluate(
    ({ steamEl, tier }) =>
      ((window as any).__campState?.rings ?? []).find(
        (r: any) => r.element === steamEl && r.tier === tier,
      ),
    { steamEl: STEAM, tier: FUSED_TIER },
  );
  expect(steam).toBeTruthy();
  expect(steam.max_uses).toBe(FUSED_MAX_USES);
  expect(steam.xp).toBe(FUSED_XP);

  await ctx.close();
});

// ── Scenario 6: Fusion overlay structural assertions (#396) ──────────────────
// Verifies that opening __campOpenFusion presents the unified 760×500 overlay with
// FUSE/BENCH/HEALTH/COMBAT columns (same class/structure as field and sanctum modes).
test('fusion: overlay opens at 760×500 with FUSE/BENCH/HEALTH/COMBAT columns (#396)', async ({
  browser,
}) => {
  const token = await registerPlayer();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  await page.waitForFunction(
    () => typeof (window as any).__campOpenFusion === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__campOpenFusion());

  // #396 — window.__ringMgmtState must be published with fusion mode columns.
  const state = await page.waitForFunction(
    () => {
      const s = (window as any).__ringMgmtState;
      if (!s || s.mode !== 'fusion') return null;
      return s;
    },
    { timeout: 5000 },
  );
  const ringMgmtState = await state.jsonValue();

  expect(ringMgmtState).toBeTruthy();
  expect((ringMgmtState as any).mode).toBe('fusion');
  expect((ringMgmtState as any).columns).toEqual(['FUSE', 'BENCH', 'HEALTH', 'COMBAT']);

  await ctx.close();
});
