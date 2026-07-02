import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { campToEncounter, waitForEncounter } from './helpers';

// #514 — force-scaled multi-heart loss + OQ-4 whole-exchange Heartwood absorb,
// exercised end-to-end through the real client against a vsAI duel.
//
// Determinism levers (all existing E2E hooks — no new plumbing):
//   • POST /api/test/set-ring-xp boosts the human's a1/a2 XP so force(xp)=3
//     (ceil-rounded Contract A). The tier column is not recomputed, but the
//     resolver reads force(ring.xp), so atkForce=3 the moment the room seats.
//   • __testSetState (E2E_TEST_ROUTES) zeroes the AI's d1/d2 uses so it can never
//     catch — every human attack resolves as an uncontested NO_BLOCK hit.
//   • #517 — the AI defender's hpForce is now the WIRED, indexing-normalized
//     value (forceFromTier1(effectiveTier1Indexed(biome, personality, playerXp)),
//     no longer the #514 interim 1), but it STILL evaluates to 1 for the exact
//     setup below: only a1/a2 are boosted (to ATTACK_XP=3000), so the player's
//     battle-hand weighted average (getBattleHandAvgXp — thumb 0.35 + atkAvg 0.15
//     + defAvg 0.15 + heart 0.35, with thumb/def/heart all still 0) is 450, and
//     AGGRESSIVE's 0.8 multiplier scales that to npcXp=360 — below the T1=500
//     threshold, so tierForXp=0 and effTier1=max(floorTier('forest')=1, 0+1)=1
//     → aiHpForce=forceFromTier1(1)=1. This is a genuine coincidence of THIS
//     scenario's XP setup (see encounter-vs-ai.spec.ts for a scenario where the
//     AI's normalized hpForce is > 1 and demonstrably mitigates), not evidence
//     the wiring is a no-op. NO_BLOCK loss below is therefore still exactly
//     max(1, ceilDiv(atkForce, 1)) = atkForce = 3 — a true multi-heart event.
//   • aiHeartwoodCharges flows through the client's `...aiOverrides` spread into
//     the room options, so the generic AI seat gets exactly one absorb charge.

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// force(3000) = forceFromTier1(tierForXp(3000)+1) = forceFromTier1(4) = 3.
const ATTACK_XP = 3000;

interface MintResult {
  token: string;
  playerId: string;
}

/** Provision a fresh E2E player and return its token (no bcrypt). */
async function mintToken(): Promise<MintResult> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return (await res.json()) as MintResult;
}

/** GET /api/me → the player's rings + loadout (slot → ringId). */
async function getLoadout(token: string): Promise<Record<string, string | null>> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`/api/me failed (${res.status})`);
  const { loadout } = (await res.json()) as { loadout: Record<string, string | null> };
  return loadout;
}

/** Set a ring's XP to an absolute value via the test-only route. */
async function setRingXP(token: string, ringId: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId, xp }),
  });
  if (!res.ok) throw new Error(`set-ring-xp failed (${res.status})`);
}

/**
 * Mint a player, boost both attack rings to force 3, seed the token into a fresh
 * context, walk Camp → Encounter, and launch a vsAI duel with the given
 * personality + AI overrides. Returns the live BattleScene page.
 */
async function startBoostedDuel(
  ctx: BrowserContext,
  personality: string,
  overrides: Record<string, number>,
): Promise<Page> {
  const { token } = await mintToken();
  const loadout = await getLoadout(token);
  for (const slot of ['a1', 'a2'] as const) {
    if (loadout[slot]) await setRingXP(token, loadout[slot] as string, ATTACK_XP);
  }
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);

  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(
    ({ p, o }) => (window as any).__encounterSelectWithOverrides(p, o),
    { p: personality, o: overrides },
  );
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  await page.waitForFunction(
    () => (window as any).__scene?.constructor.name === 'BattleScene',
    { timeout: 5000 },
  );
  return page;
}

/** Zero the AI's defence rings so every human attack lands as NO_BLOCK. */
async function disableAiDefence(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as any).__room.send('__testSetState', { target: 'opponent', uses: { d1: 0, d2: 0 } }),
  );
}

/** Set the local player's hearts high so the AI's counter-attacks never KO it. */
async function armorHuman(page: Page, hearts = 99): Promise<void> {
  await page.evaluate(
    (h) => (window as any).__room.send('__testSetState', { target: 'self', hearts: h }),
    hearts,
  );
}

/** Wait until it is the human's ATTACK_SELECT turn. */
async function waitHumanTurn(page: Page, timeout = 20000): Promise<void> {
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return room?.state?.phase === 'ATTACK_SELECT' && room?.state?.currentAttackerId === room?.sessionId;
    },
    { timeout },
  );
}

/**
 * Fire one attack from the given slot and resolve to the resulting boss-defender
 * exchangeResult (defenderId === 'AI'). Returns that exchange payload.
 */
async function attackAI(page: Page, slot: string): Promise<{ defenderHeartsLost: number }> {
  await waitHumanTurn(page);
  await page.evaluate(() => { (window as any).__lastExchangeResult = null; });
  await page.evaluate((s) => (window as any).__room.send('selectAttack', { slot: s }), slot);
  await page.waitForFunction(
    () => {
      const r = (window as any).__lastExchangeResult;
      return r !== null && r.defenderId === 'AI';
    },
    { timeout: 12000 },
  );
  return page.evaluate(() => (window as any).__lastExchangeResult);
}

/** Read the AI seat's current hearts from the authoritative room state. */
function aiHearts(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__room.state.players.get('AI').hearts);
}

/**
 * Wait until the AI seat's hearts settle to `expected` in CLIENT state. Colyseus
 * delivers the `exchangeResult` MESSAGE and the schema STATE patch on separate
 * channels, so the patch can lag the message — never read hearts once immediately
 * after the message arrives; poll the authoritative state until it reflects the
 * change (or time out, failing loudly if the decrement never lands).
 */
async function waitAiHearts(page: Page, expected: number, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    (exp) => (window as any).__room.state.players.get('AI').hearts === exp,
    expected,
    { timeout },
  );
}

// ── Scenario 1: a single uncontested exchange costs the AI MULTIPLE hearts ────
test('scenario 1: a higher-force human attack loses the AI multiple hearts in one exchange', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startBoostedDuel(ctx, 'AGGRESSIVE', { aiHearts: 30 });
  await armorHuman(page);
  await disableAiDefence(page);

  const before = await aiHearts(page);
  const exchange = await attackAI(page, 'a1');

  // atkForce=3, AI hpForce=1 (#517-wired, coincidentally still 1 for this XP
  // setup — see the file docstring), NO_BLOCK → ceilDiv(3,1)=3 hearts in ONE
  // exchange — the payload reports > 1 and the AI's hearts drop by exactly that.
  // Wait for the state patch to land (separate channel from the message) rather
  // than reading hearts the instant the exchangeResult message arrives.
  expect(exchange.defenderHeartsLost).toBeGreaterThan(1);
  await waitAiHearts(page, before - exchange.defenderHeartsLost);
  expect(await aiHearts(page)).toBe(before - exchange.defenderHeartsLost);

  await ctx.close();
});

// ── Scenario 2: a large force gap one-shot-KOs the AI in a single exchange ────
test('scenario 2: a large force gap ends the duel in one overflow exchange', async ({ browser }) => {
  const ctx = await browser.newContext();
  // aiHearts:2 < atkForce:3 → the first uncontested exchange overflows to 0 (KO).
  const page = await startBoostedDuel(ctx, 'AGGRESSIVE', { aiHearts: 2 });
  await armorHuman(page);
  await disableAiDefence(page);

  const exchange = await attackAI(page, 'a1');
  expect(exchange.defenderHeartsLost).toBeGreaterThanOrEqual(2);

  // Uncapped overflow: hearts floored at 0, duel ENDED with the human as winner,
  // all in the single exchange just fired (no clamp, no second exchange needed).
  // phase=ENDED and hearts=0 are set in the same resolveOrb tick → one atomic
  // patch, so waiting on the phase already implies hearts settled; the explicit
  // hearts wait keeps the read race-free without relying on that coupling.
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return room?.state?.phase === 'ENDED' && room?.state?.winnerId === room?.sessionId;
    },
    { timeout: 8000 },
  );
  await waitAiHearts(page, 0);
  expect(await aiHearts(page)).toBe(0);

  await ctx.close();
});

// ── Scenario 3: one Heartwood charge absorbs a whole N≥2 exchange; next lands ──
test('scenario 3: one Heartwood charge absorbs an entire multi-heart exchange, then the next lands in full', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startBoostedDuel(ctx, 'AGGRESSIVE', { aiHearts: 30, aiHeartwoodCharges: 1 });
  await armorHuman(page);
  await disableAiDefence(page);

  const startHearts = await aiHearts(page);

  // First multi-heart exchange: absorbed as ONE whole event — zero hearts lost
  // despite the payload reporting N ≥ 2, one charge spent. An absorbed exchange
  // applies NO heart patch, so reading here is inherently race-free (there is no
  // pending decrement that could lag the message); a regression that let it land
  // is still caught by the exact-value wait on the second exchange below.
  const first = await attackAI(page, 'a1');
  expect(first.defenderHeartsLost).toBeGreaterThanOrEqual(2);
  expect(await aiHearts(page)).toBe(startHearts);

  // Next multi-heart exchange: the single charge is spent, so it lands in full.
  // Wait for the hearts state patch to settle to exactly one exchange's worth of
  // loss (proving the first was absorbed whole, the second landed uncapped).
  const second = await attackAI(page, 'a2');
  expect(second.defenderHeartsLost).toBeGreaterThanOrEqual(2);
  await waitAiHearts(page, startHearts - second.defenderHeartsLost);
  expect(await aiHearts(page)).toBe(startHearts - second.defenderHeartsLost);

  await ctx.close();
});
