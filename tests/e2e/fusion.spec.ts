import { test, expect } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// Element indices (mirror shared/types ElementEnum).
const FIRE = 0;
const WATER = 1;
const STEAM = 5;
// Fusion requires both parents to reach at least Tier 1 (server/src/game/Tiers.ts:
// tierForXp — T1 begins at 500 XP). A parent seeded to exactly 500 XP is the
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

// ── Scenario 2: Below-Tier-1 parent is rejected ───────────────────────────────
// fire is left at Tier 0 (50 XP) while water reaches Tier 1 (500 XP). Mismatched
// tiers are rejected first (PlayerRepo.fuseRings validates tier-equality before
// the ≥ Tier 1 floor), so the server returns "Rings must be the same tier".
test('fusion: a below-Tier-1 parent → 400 tier mismatch', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, 50); // Tier 0 — below the fusable floor
  await setRingXP(token, water.id, TIER1_XP);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/same tier/i);
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

  // Open the fusion modal and confirm the Fire+Water recipe is ready.
  await page.waitForFunction(
    () => typeof (window as any).__campOpenFusion === 'function',
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__campOpenFusion());
  await page.waitForFunction(
    () => {
      const fs = (window as any).__fusionState;
      if (!fs) return false;
      const steam = fs.recipes.find(
        (r: any) => r.parents[0] === 0 && r.parents[1] === 1,
      );
      return steam?.ready === true;
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
