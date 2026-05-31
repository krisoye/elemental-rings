import { test, expect, type Page } from '@playwright/test';

/**
 * #196 — NPC difficulty scales with the player's aggregate XP, and the encounter
 * preview surfaces each opponent's scaled effective XP so the client can render a
 * relative difficulty label.
 *
 * Scaling (server, single-source in AILoadout.ts):
 *   npcEffectiveXp = round(playerAggregateXp · PERSONALITY_MULTIPLIER[p])
 *   perRingXp      = floor(npcEffectiveXp / 5)
 *   tier           = tierForXp(perRingXp)   (T1 begins at 500 XP, GDD §4.2)
 * Multipliers: AGGRESSIVE 0.8, DEFENSIVE 1.0, STATUS_HUNTER 1.1, RESILIENT 1.3.
 *
 * These tests drive the auth + preview API directly (scenarios 1–2) and a live
 * battle-ai room (scenario 3), matching the harness pattern in
 * encounter-vs-ai.spec.ts and npc-stake-element-sync.spec.ts.
 */

// Port 8090 (client) / 2568 (test Colyseus + API) — mirrors the other specs.
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

interface PreviewEntry {
  element: number;
  aiSeed: number;
  stakeTier: number;
  stakeXp: number;
  totalXp: number;
  npcEffectiveXp: number;
}

/** Mint a fresh E2E player and return its signed token. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Seed the authenticated player's aggregate XP via the #196 test route. */
async function setAggregateXp(token: string, xp: number): Promise<number> {
  const res = await fetch(`${API_URL}/api/test/set-aggregate-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ xp }),
  });
  if (!res.ok) throw new Error(`set-aggregate-xp failed (${res.status})`);
  const { aggregateXp } = (await res.json()) as { aggregateXp: number };
  return aggregateXp;
}

/** GET /api/encounter/preview with an optional Bearer token. */
async function fetchPreview(
  token?: string,
): Promise<Record<string, number | PreviewEntry>> {
  const res = await fetch(`${API_URL}/api/encounter/preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`preview failed (${res.status})`);
  return res.json() as Promise<Record<string, number | PreviewEntry>>;
}

/**
 * Client mirror of EncounterScene.difficultyLabel — kept here so the test asserts
 * the same bucketing the UI renders (the server only supplies the raw XP values).
 */
function difficultyLabel(npcXp: number, playerXp: number): string {
  if (playerXp === 0 && npcXp === 0) return 'Fresh';
  const ratio = playerXp > 0 ? npcXp / playerXp : 1;
  if (ratio < 0.6) return 'Weaker';
  if (ratio < 0.9) return 'Easier';
  if (ratio < 1.2) return 'Matched';
  if (ratio < 1.8) return 'Stronger';
  return 'Much Stronger';
}

// ── Scenario 1: fresh player sees the floor XP ──────────────────────────────
// A new E2E player has aggregate_xp = 0 (all starter rings xp = 0). The preview
// then floors every NPC's stake at the old hardcoded PERSONALITY_THUMB_XP, so
// AGGRESSIVE still stakes ≥ 10 and its difficulty reads 'Fresh' (both 0).
test('scenario 1: a fresh player sees floor stake XP and a Fresh label', async () => {
  const token = await mintToken();
  const preview = await fetchPreview(token);

  expect(preview.playerAggregateXp).toBe(0);

  const agg = preview.AGGRESSIVE as PreviewEntry;
  expect(agg).toBeDefined();
  // Floor at the old hardcoded thumb XP (10) so a fresh opponent stays non-trivial.
  expect(agg.stakeXp).toBeGreaterThanOrEqual(10);
  // npcEffectiveXp scales off 0, so it is 0 → label is Fresh.
  expect(agg.npcEffectiveXp).toBe(0);
  expect(difficultyLabel(agg.npcEffectiveXp, 0)).toBe('Fresh');
});

// ── Scenario 2: veteran player sees scaled XP ───────────────────────────────
// Seed aggregate_xp = 2500. RESILIENT (×1.3) → npcEffectiveXp = 3250, perRing
// = 650 → tier 1; the difficulty ratio 3250/2500 = 1.3 falls in [1.2, 1.8) →
// 'Stronger'.
test('scenario 2: a veteran player sees scaled XP and a Stronger RESILIENT', async () => {
  const token = await mintToken();
  const seeded = await setAggregateXp(token, 2500);
  expect(seeded).toBe(2500);

  const preview = await fetchPreview(token);
  expect(preview.playerAggregateXp).toBe(2500);

  const res = preview.RESILIENT as PreviewEntry;
  expect(res).toBeDefined();
  expect(res.npcEffectiveXp).toBe(3250); // 2500 × 1.3
  expect(res.stakeTier).toBeGreaterThanOrEqual(1); // perRing 650 ≥ 500 → tier 1
  expect(difficultyLabel(res.npcEffectiveXp, 2500)).toBe('Stronger');

  // Unauthenticated preview is unaffected (backwards-compat): playerAggregateXp 0.
  const anon = await fetchPreview();
  expect(anon.playerAggregateXp).toBe(0);
  expect((anon.RESILIENT as PreviewEntry).npcEffectiveXp).toBe(0);
});

// ── Scenario 3: BattleRoom scales the AI loadout from the player's XP ─────────
// Connect a veteran (aggregate_xp = 3000) to a battle-ai room with only a token
// (no explicit playerAggregateXp) so the SERVER resolves the XP authoritatively.
// RESILIENT at 3000 → effective 3900, perRing 780 ≥ 500 → the seated AI's thumb
// ring is tier ≥ 1 (a fresh-player opponent would be tier 0).
test('scenario 3: battle-ai room seats a tier-scaled AI for a veteran player', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const token = await mintToken();
  await setAggregateXp(token, 3000);
  // Inject the SAME token into the context so BootScene authenticates as this
  // veteran (init scripts run before each page load).
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);

  const page: Page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  // connectToRoom is exposed on window by the client net layer (see
  // npc-stake-element-sync.spec.ts). Join with ONLY the token so the server reads
  // aggregate XP from the DB rather than a client-supplied value.
  await page.evaluate(async () => {
    const t = localStorage.getItem('er_token') ?? '';
    await (window as any).connectToRoom('battle-ai', {
      vsAI: true,
      personality: 'RESILIENT',
      token: t,
    });
  });
  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 12000 },
  );

  const aiThumbTier = await page.evaluate(
    () => (window as any).__room?.state?.players?.get('AI')?.thumb?.tier,
  );
  // 3000 × 1.3 = 3900; perRing = 780 ≥ 500 → tier ≥ 1 (a fresh opponent is tier 0).
  expect(aiThumbTier).toBeGreaterThanOrEqual(1);

  await ctx.close();
});
