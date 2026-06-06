import { test, expect } from '@playwright/test';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// Element indices (mirror shared/types ElementEnum).
const FIRE = 0;
const WATER = 1;
const EARTH = 2;
const STEAM = 5; // Fire+Water fusion element
// Merge requires both parents to reach at least Tier 1 (≥ 500 XP). Two parents
// at exactly 500 XP each yields 1000 XP combined — still Tier 1 (T2 starts at
// 1500). max_uses = 3 + tierForXp(1000) = 3 + 1 = 4.
const TIER1_XP = 500;
const MERGED_XP = TIER1_XP * 2; // 1000 — additive
const MERGED_TIER = 1;          // tierForXp(1000) = 1
const MERGED_MAX_USES = 4;      // 3 + 1

// A shrine id used for happy-path tests. The merge API validates shrine unlock
// server-side; we seed the unlock via the test-only /api/test/unlock-shrine route.
const TEST_SHRINE_ID = 'forest_thornado_shrine';
// An id that is never unlocked (used for the sealed-shrine rejection test).
const SEALED_SHRINE_ID = 'nonexistent_sealed_shrine';

/** Register a fresh player and return its auth token. */
async function registerPlayer(): Promise<string> {
  const username = `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

/** Unlock a shrine for the player via the test-only route. */
async function unlockShrine(token: string, shrineId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/unlock-shrine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ shrineId }),
  });
  if (!res.ok) throw new Error(`unlock-shrine failed (${res.status})`);
}

/** POST /api/rings/merge and return the raw Response. */
function mergeRings(
  token: string,
  ringId1: string,
  ringId2: string,
  shrineId: string,
): Promise<Response> {
  return fetch(`${API_URL}/api/rings/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1, ringId2, shrineId }),
  });
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

// ── Scenario 1: Happy-path merge ──────────────────────────────────────────────
// Seed two Earth rings each at Tier 1 (500 XP); the starter inventory includes
// two Earth rings (starter_elements seedings: FIRE, WATER, EARTH, WIND, EARTH).
// Merge them at an unsealed shrine. Assert the merged ring has the correct XP,
// tier, max_uses, element and that both parents are absent afterward.
test('merge: two Tier-1 Earth rings merge into a single Earth ring', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  // Starter inventory includes two EARTH rings.
  const [earth1, earth2] = ringsOfElement(rings, EARTH, 2);
  await setRingXP(token, earth1.id, TIER1_XP);
  await setRingXP(token, earth2.id, TIER1_XP);
  await unlockShrine(token, TEST_SHRINE_ID);

  const res = await mergeRings(token, earth1.id, earth2.id, TEST_SHRINE_ID);
  expect(res.status).toBe(200);
  const { ring } = await res.json();
  expect(ring.element).toBe(EARTH);
  expect(ring.xp).toBe(MERGED_XP);
  expect(ring.tier).toBe(MERGED_TIER);
  expect(ring.max_uses).toBe(MERGED_MAX_USES);
  expect(ring.current_uses).toBe(MERGED_MAX_USES);

  // Both parents deleted.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === earth1.id)).toBeUndefined();
  expect(after.find((r: any) => r.id === earth2.id)).toBeUndefined();
  // Merged ring present.
  expect(after.find((r: any) => r.id === ring.id)).toBeDefined();
});

// ── Scenario 2: Different-element merge is rejected ────────────────────────────
test('merge: different-element rings → 400', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire = ringOfElement(rings, FIRE);
  const water = ringOfElement(rings, WATER);
  await setRingXP(token, fire.id, TIER1_XP);
  await setRingXP(token, water.id, TIER1_XP);
  await unlockShrine(token, TEST_SHRINE_ID);

  const res = await mergeRings(token, fire.id, water.id, TEST_SHRINE_ID);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/same element/i);

  // Both rings intact.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === fire.id)).toBeDefined();
  expect(after.find((r: any) => r.id === water.id)).toBeDefined();
});

// ── Scenario 3: Sub-Tier-1 parent is rejected ─────────────────────────────────
test('merge: sub-Tier-1 parent (< 500 XP) → 400', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  // Use the two starter EARTH rings so we don't need to grant extra rings.
  const [earth1, earth2] = ringsOfElement(rings, EARTH, 2);
  await setRingXP(token, earth1.id, 400); // below Tier 1
  await setRingXP(token, earth2.id, TIER1_XP);
  await unlockShrine(token, TEST_SHRINE_ID);

  const res = await mergeRings(token, earth1.id, earth2.id, TEST_SHRINE_ID);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/Tier 1/i);

  // Both rings intact.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === earth1.id)).toBeDefined();
  expect(after.find((r: any) => r.id === earth2.id)).toBeDefined();
});

// ── Scenario 4: Sealed shrine → 400 ──────────────────────────────────────────
// Use a shrine id that has never been unlocked. The server checks isShrineUnlocked
// before running mergeRings, so the rings remain untouched.
test('merge: sealed shrine → 400', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const [earth1, earth2] = ringsOfElement(rings, EARTH, 2);
  await setRingXP(token, earth1.id, TIER1_XP);
  await setRingXP(token, earth2.id, TIER1_XP);
  // Do NOT unlock the shrine.

  const res = await mergeRings(token, earth1.id, earth2.id, SEALED_SHRINE_ID);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/sealed/i);

  // Both rings intact.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === earth1.id)).toBeDefined();
  expect(after.find((r: any) => r.id === earth2.id)).toBeDefined();
});

// ── Scenario 5: Shrine interactable shows both [E] FUSE and [M] MERGE prompts ──
// Navigate to the Bloom shrine screen (always-open altar). Verify the shrine loads
// (unlocked = true via __shrineState hook) and that the scene wired a merge shrine
// (activeMergeShrineId is non-null), confirming both [E] FUSE and [M] MERGE are
// available. The blink prompt is Phaser canvas-text (not a DOM element), so we
// verify the wiring via state hooks per the Playwright Input Rules.
test('merge: shrine interactable is wired with both FUSE ([E]) and MERGE ([M])', async ({
  browser,
}) => {
  const token = await registerPlayer();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Wait for scene to initialize.
  await page.waitForFunction(
    () => typeof (window as any).__scene !== 'undefined' && (window as any).__scene !== null,
    { timeout: 10000 },
  );

  // Navigate to the Bloom shrine screen (always-open — no ring key required).
  await page.evaluate(() => {
    const scene = (window as any).__scene;
    if (!scene?.scene) return;
    scene.scene.start('ForestScene', { screenId: 'forest_bloom_hollow' });
  });

  // Wait for the always-open shrine to load (__shrineState.unlocked = true).
  await page.waitForFunction(
    () => (window as any).__shrineState?.unlocked === true,
    { timeout: 8000 },
  );

  // Verify the shrine loaded the correct id.
  const shrineState = await page.evaluate(() => (window as any).__shrineState);
  expect(shrineState.id).toBe('forest_bloom_hollow');
  expect(shrineState.unlocked).toBe(true);

  // Verify that the scene wired a merge shrine (activeMergeShrineId is set on the
  // scene — read via __scene.activeMergeShrineId). This confirms the [M] MERGE
  // keybinding is active.
  const activeMergeShrineId = await page.evaluate(
    () => (window as any).__scene?.activeMergeShrineId,
  );
  expect(activeMergeShrineId).toBe('forest_bloom_hollow');

  await ctx.close();
});

// ── Scenario 6: MERGE overlay structural assertions ────────────────────────────
// Open the merge overlay programmatically via the E2E hook; assert mode='merge'
// and columns[0]='MERGE'.
test('merge: overlay mode and column header are correct', async ({
  browser,
}) => {
  const token = await registerPlayer();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Wait for CampScene to initialize (scene and token loaded).
  await page.waitForFunction(
    () => typeof (window as any).__scene !== 'undefined' && (window as any).__scene !== null,
    { timeout: 8000 },
  );

  // Navigate to the Bloom shrine screen so the M key dispatches to merge.
  await page.evaluate(() => {
    const scene = (window as any).__scene;
    if (!scene?.scene) return;
    scene.scene.start('ForestScene', { screenId: 'forest_bloom_hollow' });
  });

  // Wait for shrine to load.
  await page.waitForFunction(
    () => (window as any).__shrineState?.unlocked === true,
    { timeout: 8000 },
  );

  // Press M to open the merge overlay (real key input per Playwright Input Rules).
  await page.keyboard.press('m');

  // Wait for __ringMgmtState to reflect the merge overlay.
  await page.waitForFunction(
    () => {
      const s = (window as any).__ringMgmtState;
      return s?.mode === 'merge' && Array.isArray(s?.columns) && s.columns[0] === 'MERGE';
    },
    { timeout: 6000 },
  );

  const s = await page.evaluate(() => (window as any).__ringMgmtState);
  expect(s.mode).toBe('merge');
  expect(s.columns[0]).toBe('MERGE');
  expect(s.columns).toEqual(['MERGE', 'BENCH', 'HEALTH', 'COMBAT']);

  await ctx.close();
});

// ── Scenario 7: Steam + Steam merge → parent_dominant set correctly ────────────
// Fuse two Fire+Water pairs to obtain two Steam rings; set different XP on each;
// merge them; assert the merged ring element is Steam and parent_dominant equals
// the element of the higher-XP parent (or −1 on tie).
test('merge: Steam+Steam merge → element=Steam, parent_dominant=higher-XP parent', async () => {
  const token = await registerPlayer();
  const { rings } = await getMe(token);
  const fire1 = ringOfElement(rings, FIRE);
  const water1 = ringOfElement(rings, WATER);
  await setRingXP(token, fire1.id, TIER1_XP);
  await setRingXP(token, water1.id, TIER1_XP);

  // Fuse Fire+Water → Steam (ring A).
  const fuseA = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire1.id, ringId2: water1.id }),
  });
  expect(fuseA.status).toBe(200);
  const { ring: steamA } = await fuseA.json();
  expect(steamA.element).toBe(STEAM);

  // Grant two more base rings and fuse into a second Steam ring (ring B).
  await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ element: FIRE }),
  });
  await fetch(`${API_URL}/api/test/grant-ring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ element: WATER }),
  });
  const { rings: rings2 } = await getMe(token);
  // Find the granted (pending) Fire and Water rings — they have xp=0.
  const fire2 = rings2.find((r: any) => r.element === FIRE && r.xp === 0);
  const water2 = rings2.find((r: any) => r.element === WATER && r.xp === 0);
  if (!fire2 || !water2) throw new Error('granted rings not found');
  await setRingXP(token, fire2.id, TIER1_XP);
  await setRingXP(token, water2.id, TIER1_XP);

  const fuseB = await fetch(`${API_URL}/api/fusion/combine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId1: fire2.id, ringId2: water2.id }),
  });
  expect(fuseB.status).toBe(200);
  const { ring: steamB } = await fuseB.json();
  expect(steamB.element).toBe(STEAM);

  // Lower steamA's XP so the two parents differ (steamB stays at its fused XP
  // of 500+500=1000) — exercises the higher-XP-parent dominance rule with no tie.
  const STEAM_A_XP = 800;
  await setRingXP(token, steamA.id, STEAM_A_XP);

  await unlockShrine(token, TEST_SHRINE_ID);

  // Re-fetch both Steam rings at merge time so the additive XP assertion uses
  // the actual server-side values, not JSON captured from the earlier fusion
  // responses (resilient to any future XP mutation between fuse and merge).
  const { rings: preMerge } = await getMe(token);
  const steamAState = preMerge.find((r: any) => r.id === steamA.id);
  const steamBState = preMerge.find((r: any) => r.id === steamB.id);
  if (!steamAState || !steamBState) throw new Error('Steam parents missing before merge');
  expect(steamAState.xp).not.toBe(steamBState.xp); // no tie — dominance rule applies

  const res = await mergeRings(token, steamA.id, steamB.id, TEST_SHRINE_ID);
  expect(res.status).toBe(200);
  const { ring } = await res.json();

  expect(ring.element).toBe(STEAM);
  expect(ring.xp).toBe(steamAState.xp + steamBState.xp);
  // parent_dominant = element of the higher-XP parent. Both parents are Steam,
  // so it resolves to STEAM (5) — and never -1, since the XPs differ.
  expect(ring.parent_dominant).toBe(STEAM);

  // Both Steam parents deleted.
  const { rings: after } = await getMe(token);
  expect(after.find((r: any) => r.id === steamA.id)).toBeUndefined();
  expect(after.find((r: any) => r.id === steamB.id)).toBeUndefined();
});
