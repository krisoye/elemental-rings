import { test, expect, type Page } from '@playwright/test';

/**
 * #244 — NPC difficulty scales with the player's CARRIED battle-hand XP (a
 * weighted average), not the Reliquary aggregate. The encounter preview surfaces
 * each opponent's scaled effective XP so the client can render a relative
 * difficulty label, and the joined BattleRoom seats an AI whose thumb stake XP
 * matches the preview.
 *
 * Scaling (server, single-source: PlayerRepo.getBattleHandAvgXp + AILoadout.ts):
 *   battleHandAvgXp = thumb.xp·0.5 + ((a1.xp + a2.xp)/2)·0.25 + ((d1.xp + d2.xp)/2)·0.25
 *   npcEffectiveXp  = round(battleHandAvgXp · PERSONALITY_MULTIPLIER[p])
 *   thumbXp         = max(PERSONALITY_THUMB_XP[p], npcEffectiveXp)   (the floor)
 *   tier            = tierForXp(npcEffectiveXp)   (T1 begins at 500 XP, GDD §4.2)
 * The thumb carries 50% of the weight; the attack pair and defense pair share the
 * remaining 50% (25% each) — NOT an equal-thirds average (the old #196 /5 divisor
 * is gone; the weighting was corrected to 50/25/25 in ce87070).
 *
 * DEFENSIVE (used by every scenario below):
 *   PERSONALITY_MULTIPLIER[DEFENSIVE] = 1.0
 *   PERSONALITY_THUMB_XP[DEFENSIVE]   = 20   (the floor)
 * So with mult 1.0, expected stakeXp = max(20, round(battleHandAvgXp)).
 *
 * These tests drive the auth + preview API directly (scenarios 1–4) and a live
 * battle-ai room (scenario 5), matching the harness pattern in
 * encounter-vs-ai.spec.ts and npc-stake-element-sync.spec.ts.
 */

// Port 8090 (client) / 2568 (test Colyseus + API) — mirrors the other specs.
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// DEFENSIVE personality constants (verified in server/src/game/ai/AILoadout.ts).
const DEFENSIVE_MULT = 1.0;
const DEFENSIVE_FLOOR = 20;

/**
 * The server's battle-hand weighted average (PlayerRepo.getBattleHandAvgXp):
 * thumb is weighted 50%; the attack pair and defense pair each contribute 25%
 * (split evenly within each pair). Mirrors the production formula so the spec
 * stays in lockstep with the server instead of hardcoding per-scenario arithmetic.
 */
function battleHandAvg(xps: {
  thumb: number;
  a1: number;
  a2: number;
  d1: number;
  d2: number;
}): number {
  const atkAvg = (xps.a1 + xps.a2) / 2;
  const defAvg = (xps.d1 + xps.d2) / 2;
  return xps.thumb * 0.5 + atkAvg * 0.25 + defAvg * 0.25;
}

/** Expected scaled stake XP for DEFENSIVE given a battle-hand weighted average. */
function expectedDefensiveStake(battleHandAvgXp: number): number {
  return Math.max(DEFENSIVE_FLOOR, Math.round(battleHandAvgXp * DEFENSIVE_MULT));
}

interface PreviewEntry {
  element: number;
  aiSeed: number;
  stakeTier: number;
  stakeXp: number;
  totalXp: number;
  npcEffectiveXp: number;
}

interface MeResponse {
  rings: Array<{ id: string; xp: number; in_carry: number }>;
  loadout: { thumb: string | null; a1: string | null; a2: string | null; d1: string | null; d2: string | null } | null;
}

/** Mint a fresh E2E player and return its signed token. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** GET /api/me for the authenticated player (carried rings + loadout slots). */
async function fetchMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`/api/me failed (${res.status})`);
  return res.json() as Promise<MeResponse>;
}

/** Set a single carried ring's XP to an absolute value via the test route. */
async function setRingXp(token: string, ringId: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId, xp }),
  });
  if (!res.ok) throw new Error(`set-ring-xp failed (${res.status})`);
}

/** Grant the player a single high-XP Reliquary (in_carry = 0) ring. */
async function grantReliquaryXp(token: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-aggregate-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ xp }),
  });
  if (!res.ok) throw new Error(`set-aggregate-xp failed (${res.status})`);
}

/**
 * Seed the player's CARRIED battle hand to exact per-slot XP. A fresh player's
 * default loadout already assigns thumb/a1/a2/d1/d2 to carried starter rings
 * (xp=0); this reads that mapping from /api/me and sets each slot ring's XP.
 */
async function seedBattleHand(
  token: string,
  xps: { thumb: number; a1: number; a2: number; d1: number; d2: number },
): Promise<void> {
  const me = await fetchMe(token);
  if (!me.loadout) throw new Error('seedBattleHand: player has no loadout');
  const slots: Array<keyof typeof xps> = ['thumb', 'a1', 'a2', 'd1', 'd2'];
  for (const slot of slots) {
    const ringId = me.loadout[slot];
    if (!ringId) throw new Error(`seedBattleHand: loadout slot ${slot} is empty`);
    await setRingXp(token, ringId, xps[slot]);
  }
}

/** GET /api/encounter/preview with an optional Bearer token. */
async function fetchPreview(token?: string): Promise<Record<string, number | PreviewEntry>> {
  const res = await fetch(`${API_URL}/api/encounter/preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`preview failed (${res.status})`);
  return res.json() as Promise<Record<string, number | PreviewEntry>>;
}

// ── Scenario 1: weak hand → floor ───────────────────────────────────────────
// A fresh player carries five starter rings at xp=0 → battleHandAvgXp = 0 → the
// preview floors DEFENSIVE at PERSONALITY_THUMB_XP (20).
test('scenario 1: an all-zero carried hand floors DEFENSIVE at 20', async () => {
  const token = await mintToken();
  const preview = await fetchPreview(token);

  // battleHandAvgXp = (0 + 0/2 + 0/2)/3 = 0 → unscaled → floor.
  expect(preview.playerBattleHandAvgXp).toBe(0);

  const def = preview.DEFENSIVE as PreviewEntry;
  expect(def).toBeDefined();
  expect(def.npcEffectiveXp).toBe(0); // round(0 × 1.0)
  expect(def.stakeXp).toBe(DEFENSIVE_FLOOR); // max(20, 0) = 20
});

// ── Scenario 2: strong hand → scaled ─────────────────────────────────────────
// thumb=400, a1=200, a2=200, d1=100, d2=100 (50/25/25 weighting)
//   battleHandAvgXp = 400·0.5 + ((200+200)/2)·0.25 + ((100+100)/2)·0.25
//                   = 200 + 50 + 25 = 275
//   npcEffectiveXp  = round(275 × 1.0) = 275
//   stakeXp         = max(20, 275) = 275
test('scenario 2: a strong carried hand scales DEFENSIVE to 275', async () => {
  const token = await mintToken();
  const hand = { thumb: 400, a1: 200, a2: 200, d1: 100, d2: 100 };
  await seedBattleHand(token, hand);

  const preview = await fetchPreview(token);
  const battleHandAvgXp = battleHandAvg(hand); // 275
  expect(preview.playerBattleHandAvgXp).toBeCloseTo(battleHandAvgXp, 5);

  const expected = expectedDefensiveStake(battleHandAvgXp); // max(20, round(275)) = 275
  expect(expected).toBe(275);

  const def = preview.DEFENSIVE as PreviewEntry;
  expect(def).toBeDefined();
  expect(def.npcEffectiveXp).toBe(275);
  expect(def.stakeXp).toBe(275);
});

// ── Scenario 3: high Reliquary, weak carry → floor (Reliquary ignored) ───────
// Grant a 10000-XP Reliquary ring (in_carry = 0) and carry rings at xp=10.
//   battleHandAvgXp = 10·0.5 + 10·0.25 + 10·0.25 = 10  (uniform hand → unchanged)
//   npcEffectiveXp  = round(10 × 1.0) = 10
//   stakeXp         = max(20, 10) = 20   ← floor, Reliquary plays no part
test('scenario 3: a big Reliquary with a weak carry still floors DEFENSIVE at 20', async () => {
  const token = await mintToken();
  await grantReliquaryXp(token, 10000); // Reliquary aggregate — must be ignored
  const hand = { thumb: 10, a1: 10, a2: 10, d1: 10, d2: 10 };
  await seedBattleHand(token, hand);

  const preview = await fetchPreview(token);
  const battleHandAvgXp = battleHandAvg(hand); // 10
  expect(preview.playerBattleHandAvgXp).toBeCloseTo(battleHandAvgXp, 5);

  const expected = expectedDefensiveStake(battleHandAvgXp); // max(20, round(10)) = 20
  expect(expected).toBe(DEFENSIVE_FLOOR);

  const def = preview.DEFENSIVE as PreviewEntry;
  expect(def).toBeDefined();
  expect(def.npcEffectiveXp).toBe(10);
  expect(def.stakeXp).toBe(DEFENSIVE_FLOOR);
});

// ── Scenario 4: thumb-heavy hand ─────────────────────────────────────────────
// thumb=800, a1=50, a2=50, d1=50, d2=50 (50/25/25 weighting)
//   battleHandAvgXp = 800·0.5 + ((50+50)/2)·0.25 + ((50+50)/2)·0.25
//                   = 400 + 12.5 + 12.5 = 425
//   npcEffectiveXp  = round(425 × 1.0) = 425
//   stakeXp         = max(20, 425) = 425
test('scenario 4: a thumb-heavy carried hand scales DEFENSIVE to 425', async () => {
  const token = await mintToken();
  const hand = { thumb: 800, a1: 50, a2: 50, d1: 50, d2: 50 };
  await seedBattleHand(token, hand);

  const preview = await fetchPreview(token);
  const battleHandAvgXp = battleHandAvg(hand); // 425
  expect(preview.playerBattleHandAvgXp).toBeCloseTo(battleHandAvgXp, 5);

  const expected = expectedDefensiveStake(battleHandAvgXp); // max(20, round(425)) = 425
  expect(expected).toBe(425);

  const def = preview.DEFENSIVE as PreviewEntry;
  expect(def).toBeDefined();
  expect(def.npcEffectiveXp).toBe(425);
  expect(def.stakeXp).toBe(425);
});

// ── Scenario 5: preview matches the BattleRoom ───────────────────────────────
// Same setup as scenario 2 (stakeXp 275). Join a battle-ai room with ONLY the
// token (no explicit playerBattleHandAvgXp) so the SERVER resolves the value from
// the DB, then read room.state.players['AI'].thumb.xp — it must equal 275.
test('scenario 5: the joined battle-ai AI thumb XP matches the preview stake (275)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const token = await mintToken();
  const hand = { thumb: 400, a1: 200, a2: 200, d1: 100, d2: 100 };
  await seedBattleHand(token, hand);

  const battleHandAvgXp = battleHandAvg(hand); // 275
  const expected = expectedDefensiveStake(battleHandAvgXp); // 275
  expect(expected).toBe(275);

  // Inject the SAME token so BootScene authenticates as this player.
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);

  const page: Page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  // Join with ONLY the token so the server reads the battle-hand XP from the DB.
  await page.evaluate(async () => {
    const t = localStorage.getItem('er_token') ?? '';
    await (window as any).connectToRoom('battle-ai', {
      vsAI: true,
      personality: 'DEFENSIVE',
      token: t,
    });
  });
  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 12000 },
  );

  const aiThumbXp = await page.evaluate(
    () => (window as any).__room?.state?.players?.get('AI')?.thumb?.xp,
  );
  expect(aiThumbXp).toBe(expected); // 233 — preview stake == seated AI thumb XP

  await ctx.close();
});
