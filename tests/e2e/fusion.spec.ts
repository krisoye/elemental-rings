import { test, expect } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// Element indices (mirror shared/types ElementEnum).
const FIRE = 0;
const WATER = 1;
const STEAM = 5;
const TIER1_XP_CAP = 100;

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

// ── Scenario 1: Fuse two maxed Fire+Water rings → Steam ───────────────────────
test('fusion: maxed Fire+Water fuse into a Steam Tier 2 ring', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP_CAP);
  await setRingXP(token, water.id, TIER1_XP_CAP);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(200);
  const { ring } = await res.json();
  expect(ring.element).toBe(STEAM);
  expect(ring.tier).toBe(2);
  expect(ring.max_uses).toBe(5);
  expect(ring.current_uses).toBe(5);
  expect(ring.xp).toBe(TIER1_XP_CAP * 2);

  // The Steam ring is present in inventory.
  const { rings: after } = await getMe(token);
  const steam = after.find((r: any) => r.id === ring.id);
  expect(steam).toBeDefined();
  expect(steam.element).toBe(STEAM);
});

// ── Scenario 2: Un-capped parent is rejected ──────────────────────────────────
test('fusion: un-capped parent → 400 has-not-reached-XP-cap', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, 50); // below cap
  await setRingXP(token, water.id, TIER1_XP_CAP);

  const res = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire.id, ringId2: water.id }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/has not reached XP cap/i);
});

// ── Scenario 3: Both parents deleted after fusion ─────────────────────────────
test('fusion: both parents are removed from inventory after fusing', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP_CAP);
  await setRingXP(token, water.id, TIER1_XP_CAP);

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
  await setRingXP(token, fire.id, TIER1_XP_CAP);
  await setRingXP(token, water.id, TIER1_XP_CAP);

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
  await setRingXP(token, fire.id, TIER1_XP_CAP);
  await setRingXP(token, water.id, TIER1_XP_CAP);

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

  // The Steam Tier 2 ring appears in the reloaded camp inventory.
  await page.waitForFunction(
    (steamEl) =>
      ((window as any).__campState?.rings ?? []).some(
        (r: any) => r.element === steamEl && r.tier === 2,
      ),
    STEAM,
    { timeout: 8000 },
  );
  const steam = await page.evaluate(
    (steamEl) =>
      ((window as any).__campState?.rings ?? []).find(
        (r: any) => r.element === steamEl && r.tier === 2,
      ),
    STEAM,
  );
  expect(steam).toBeTruthy();
  expect(steam.max_uses).toBe(5);
  expect(steam.xp).toBe(TIER1_XP_CAP * 2);

  await ctx.close();
});
