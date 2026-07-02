import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  attackerDefender,
  waitForExchangeResult,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  DEFEND_PARRY_WAIT_MS,
  DEFEND_LAPSE_WAIT_MS,
  type BattleHandles,
  type SlotKey,
} from './helpers';

// #516 — EPIC #511 Contract D. Rally recursion through force, exercised end-to-end
// through the real client. By construction (once #514's force-scaled `resolveBlock`
// landed), a rally counter-volley already recurses through force: `continueAfterOrb`
// (server/src/rooms/BattleRoom.ts ~L1762) swaps the former defender into the
// attacker role, firing their parry slot (d1/d2); the next `resolveOrb` call
// computes `atkForce = force(attackerRing.xp)` on that same ring automatically.
//
// Verification performed while authoring this spec (server/src/rooms/BattleRoom.ts):
//   - `resolveOrb`'s `hpForce` lookup (`this.sessionToHpForce.get(defenderId)`) is
//     keyed by the CURRENT `defenderId` argument, which `_resolveExchange` derives
//     fresh each call as `this.opponentOf(state.currentAttackerId)` — so it flips
//     to the volley's actual defender (the original attacker) automatically. No
//     stale binding: `sessionToHpForce` is set once per session at seat time
//     (L659) and never overwritten mid-duel, so the lookup is generically correct
//     for whichever role that session currently holds.
//   - `BlockResolver.resolveBlock`'s single `consumeUse(defenderRing)` (L133) fires
//     once per `resolveOrb` call, on that call's OWN defending ring — the parrying
//     ring's use was already spent when IT defended the prior exchange; becoming
//     the volley's attacker never re-touches it (no `consumeUse` on `attackerRing`
//     in the BLOCK/PARRY path). The L1774 comment ("the parry already cost 1 use —
//     no extra charge for the volley") holds true post-#514.
// No server code change was needed — this issue is test-only, per the issue's own
// framing ("likely already correct").

const API_URL = 'http://localhost:2568';
const URL = 'http://localhost:8090';
const CAUGHT = ['BLOCK', 'PARRY'];

// force(3000) = forceFromTier1(tierForXp(3000)+1) = forceFromTier1(4) = 3
// (same calibration as #514's force-heart-loss.spec.ts).
const ATTACK_XP = 3000;

async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function getLoadout(token: string): Promise<Record<string, string | null>> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`/api/me failed (${res.status})`);
  const { loadout } = (await res.json()) as { loadout: Record<string, string | null> };
  return loadout;
}

async function setRingXP(token: string, ringId: string, xp: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId, xp }),
  });
  if (!res.ok) throw new Error(`set-ring-xp failed (${res.status})`);
}

/**
 * Mint two players, boost the given loadout slots' XP for each (test-only
 * `set-ring-xp` route, BEFORE the battle seats so `force(ring.xp)` reads the
 * boosted value at seat time — same lever as #514's force-heart-loss.spec.ts),
 * then join a keyed PvP battle room and wait for ATTACK_SELECT on both.
 *
 * p1 always seats first, so per `BattleRoom.ts` L766-767 (`ids[0]` = the first-
 * seated session) p1 is deterministically the initial attacker and p2 the
 * initial defender — the same invariant `gauge-four-case.spec.ts` scenario 6
 * relies on when it pre-boosts p2's D2 ring before the room exists.
 */
async function setupBoostedBattle(
  browser: Browser,
  boosts: { p1?: Partial<Record<SlotKey, number>>; p2?: Partial<Record<SlotKey, number>> },
): Promise<BattleHandles> {
  const token1 = await mintToken();
  const token2 = await mintToken();

  for (const [token, slots] of [
    [token1, boosts.p1],
    [token2, boosts.p2],
  ] as const) {
    if (!slots) continue;
    const loadout = await getLoadout(token);
    for (const [slot, xp] of Object.entries(slots)) {
      const ringId = loadout[slot];
      if (!ringId) throw new Error(`No ${slot} ring in loadout`);
      await setRingXP(token, ringId, xp as number);
    }
  }

  const p1ctx = await browser.newContext({ hasTouch: true });
  const p2ctx = await browser.newContext({ hasTouch: true });
  await p1ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token1)})`);
  await p2ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token2)})`);

  const roomRes = await fetch(`${API_URL}/api/test/create-battle-room`, { method: 'POST' });
  const { roomId } = (await roomRes.json()) as { roomId: string };

  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  await p1.goto(URL);
  await p1.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await p1.evaluate(() => (window as any).__campGoEncounter());
  await p1.waitForFunction(() => typeof (window as any).__encounterSelectPvP === 'function', {
    timeout: 10000,
  });
  await p1.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await p2.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await p2.evaluate(() => (window as any).__campGoEncounter());
  await p2.waitForFunction(() => typeof (window as any).__encounterSelectPvP === 'function', {
    timeout: 10000,
  });
  await p2.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });

  return { p1, p2, p1ctx, p2ctx };
}

/** Read a page's own sessionId + current hearts from authoritative room state. */
async function myHearts(page: Page): Promise<number> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).hearts as number;
  });
}

// ── Scenario 1: the counter-volley lands force-scaled heart loss ─────────────
test('scenario 1: rally counter-volley lands force-scaled heart loss on the original attacker', async ({
  browser,
}) => {
  // Boost the DEFENDER's D1 (WOOD, default loadout) ring to force 3 — it is this
  // ring that parries, then volleys as the rally's next "attacker" ring.
  const h = await setupBoostedBattle(browser, { p2: { d1: ATTACK_XP } });
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Headroom on the original attacker (the eventual volley DEFENDER) so the
  // force-scaled loss lands cleanly without KO-ing the duel mid-assertion.
  await attacker.evaluate(() => (window as any).__room.send('__testSetState', { hearts: 20 }));

  await attacker.keyboard.press('2'); // A2 = WATER attack

  await defender.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = WOOD (force 3) beats WATER, PARRY -> STRONG -> rally

  await waitForExchangeResult(defender);
  const parry = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(parry.rallyContinues).toBe(true);
  expect(parry.relationship).toBe('STRONG');
  expect(parry.defenderHeartsLost).toBe(0); // Parry+Strong itself never costs a heart (case 4)

  // Roles swap: the former defender's D1 (now force 3) becomes the volley's
  // attacker; the original attacker is now defending. Clear the captured result
  // BEFORE the volley resolves so the next wait observes only the volley.
  await attacker.evaluate(() => {
    (window as any).__lastExchangeResult = null;
  });
  await attacker.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'DEFEND_WINDOW' &&
      (window as any).__room?.state?.rallyActive === true,
    { timeout: 5000 },
  );

  const before = await myHearts(attacker);

  // Never defend the volley -> NO_BLOCK. atkForce = force(3000) = 3, hpForce =
  // the original attacker's own cached heart-ring force (untouched Tier-0 ring
  // -> 1), so defenderHeartsLost = max(1, ceilDiv(3, 1)) = 3 -- not the flat
  // 1-heart a stale/pre-#511 formula (or a mis-bound hpForce lookup) would give.
  await attacker.waitForTimeout(DEFEND_LAPSE_WAIT_MS);

  await waitForExchangeResult(attacker);
  const volley = await attacker.evaluate(() => (window as any).__lastExchangeResult);
  const myId = await attacker.evaluate(() => (window as any).__room.sessionId);
  const oppId = await defender.evaluate(() => (window as any).__room.sessionId);

  expect(volley.timing).toBe('NO_BLOCK');
  expect(volley.attackerId).toBe(oppId); // the parrying D1 ring, now attacking
  expect(volley.defenderId).toBe(myId); // the original attacker, now defending
  expect(volley.defenderHeartsLost).toBe(3);
  expect(volley.defenderHeartsLost).toBeGreaterThan(1); // not a flat 1-heart reset

  await attacker.waitForFunction(
    (expected) => {
      const room = (window as any).__room;
      return room.state.players.get(room.sessionId).hearts === expected;
    },
    before - 3,
    { timeout: 8000 },
  );
  expect(await myHearts(attacker)).toBe(before - 3);

  await closeBattle(h);
});

// ── Scenario 2: def_force >= atk_force bleeds 0 hearts across the recursion ──
test("scenario 2: a rally volley the original attacker's ring out-forces bleeds 0 hearts (subtractive shield holds through the recursion)", async ({
  browser,
}) => {
  // Boost BOTH sides' D1 (WOOD) rings to the same force (3): p2's D1 parries and
  // then volleys as the rally attacker; p1's OWN D1 (also force 3) is what they
  // catch the volley with, so atk_force === def_force on the volley itself.
  const h = await setupBoostedBattle(browser, {
    p1: { d1: ATTACK_XP },
    p2: { d1: ATTACK_XP },
  });
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('2'); // A2 = WATER attack

  await defender.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = WOOD (force 3) beats WATER, PARRY -> STRONG -> rally

  await waitForExchangeResult(defender);
  const parry = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(parry.rallyContinues).toBe(true);

  await attacker.evaluate(() => {
    (window as any).__lastExchangeResult = null;
  });
  await attacker.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'DEFEND_WINDOW' &&
      (window as any).__room?.state?.rallyActive === true,
    { timeout: 5000 },
  );

  const before = await myHearts(attacker);

  // Catch the WOOD volley with the original attacker's OWN D1 (also force 3).
  // Same-element WOOD-vs-WOOD is a NEUTRAL catch (ElementSystem.ts resolve()
  // "same element -> NEUTRAL"), so this exercises the subtractive-shield branch:
  // defenderHeartsLost = max(0, ceilDiv(max(0, atkForce - defForce), hpForce)).
  // atkForce = defForce = 3 -> 0 hearts lost, regardless of hpForce, proving
  // def_force credits correctly on a rally volley (not only the first exchange).
  await attacker.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await attacker.keyboard.press('3'); // D1 = WOOD

  await waitForExchangeResult(attacker);
  const volley = await attacker.evaluate(() => (window as any).__lastExchangeResult);

  expect(CAUGHT).toContain(volley.timing);
  expect(volley.relationship).toBe('NEUTRAL');
  expect(volley.defenderHeartsLost).toBe(0);
  // NEUTRAL never rallies -- the recursion terminates here via the ordinary
  // Block Resolution Table outcome, with NO new loop guard involved.
  expect(volley.rallyContinues).toBe(false);

  // No heart-loss state patch is expected; let the exchange fully settle (leave
  // RESOLVE) before confirming the shielded value stuck.
  await attacker.waitForFunction(
    () => (window as any).__room?.state?.phase !== 'RESOLVE',
    { timeout: 4000 },
  );
  expect(await myHearts(attacker)).toBe(before);

  await closeBattle(h);
});
