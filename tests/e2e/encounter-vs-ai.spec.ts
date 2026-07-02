import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  setupBattle,
  waitForEncounter,
  campToEncounter,
  seedAuthToken,
  closeBattle,
  driveAiDuel,
} from './helpers';
import { returnFromBattle } from './helpers/returnFromBattle';

// Port 8090 avoids colliding with the production Vite dev server on 8080.
const URL = 'http://localhost:8090';
// Phase 4+5 auth + encounter-preview API runs on the test Colyseus port.
const API_URL = 'http://localhost:2568';

interface BattleSummary {
  won: boolean;
  goldGained: number;
  xpGained: number;
  aggregateXp: number;
}

interface PreviewEntry {
  element: number;
  aiSeed: number;
  stakeTier: number;
  stakeXp: number;
  totalXp: number;
}

/**
 * Seed auth on the context, navigate through CampScene to EncounterScene, and
 * select a vsAI personality. Returns the live page.
 */
async function startAIDuel(ctx: BrowserContext, personality: string): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate((p) => (window as any).__encounterSelect(p), personality);
  return page;
}

/** Wait until the active scene is the named scene. */
async function waitForScene(page: Page, name: string, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (n) => (window as any).__scene?.constructor.name === n,
    name,
    { timeout },
  );
}

// ── Scenario 1: Encounter → duel transition ───────────────────────────────
test('scenario 1: selecting an NPC starts a vsAI duel in BattleScene', async ({ browser }) => {
  const ctx = await browser.newContext();

  const page = await startAIDuel(ctx, 'AGGRESSIVE');

  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  await waitForScene(page, 'BattleScene', 5000);

  const size = await page.evaluate(() => (window as any).__room?.state?.players?.size);
  expect(size).toBe(2);

  await ctx.close();
});

// ── Scenario 2: AI attacks unprompted ──────────────────────────────────────
test('scenario 2: AI attacks without any human keypress', async ({ browser }) => {
  const ctx = await browser.newContext();

  const page = await startAIDuel(ctx, 'AGGRESSIVE');
  await waitForScene(page, 'BattleScene', 5000);

  // The AI is player #1 (seated on create) → opening attacker. With no human
  // input, its think-delay elapses and it throws — launching the orb and
  // opening a DEFEND_WINDOW. __orbLaunchCount increments with zero keypresses.
  await page.waitForFunction(() => (window as any).__orbLaunchCount > 0, { timeout: 4000 });

  const phase = await page.evaluate(() => (window as any).__room?.state?.phase);
  expect(['DEFEND_WINDOW', 'ATTACK_SELECT', 'ENDED']).toContain(phase);

  await ctx.close();
});

// ── Scenario 3: AI defends a human throw ────────────────────────────────────
test('scenario 3: AI responds to a human attack (defends, not idle)', async ({ browser }) => {
  const ctx = await browser.newContext();

  // DEFENSIVE reliably commits a defending ring. Wait until it is the human's
  // turn (after the AI's opening attack resolves), then throw.
  const page = await startAIDuel(ctx, 'DEFENSIVE');
  await waitForScene(page, 'BattleScene', 5000);

  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      );
    },
    { timeout: 15000 },
  );

  const aiHeartsBefore = await page.evaluate(() => {
    const room = (window as any).__room;
    return room.state.players.get('AI').hearts;
  });

  // Clear any prior result so we only react to THIS exchange.
  await page.evaluate(() => { (window as any).__lastExchangeResult = null; });
  await page.keyboard.press('1'); // FIRE

  // Wait for the exchangeResult broadcast (the server's single message per
  // exchange). defenderSlot !== '' means the AI submitted a defense slot ('d1'
  // or 'd2'); defenderHeartsLost > 0 means the AI took a hit from a no-block. Either
  // proves the AI responded to the incoming attack.
  // NOTE: defenderSlot in room.state resets to '' within the same Colyseus tick
  // — use the exchangeResult message instead, where the slot is captured at resolve time.
  await page.waitForFunction(
    () => {
      const r = (window as any).__lastExchangeResult;
      return r !== null && (r.defenderSlot !== '' || r.defenderHeartsLost > 0);
    },
    { timeout: 6000 },
  );

  await ctx.close();
});

// ── Scenario 4: duel completes and returns to CampScene ─────────────────────
test('scenario 4: duel completes and returns to EncounterScene', async ({ browser }) => {
  const ctx = await browser.newContext();

  const page = await startAIDuel(ctx, 'AGGRESSIVE');
  await waitForScene(page, 'BattleScene', 5000);

  // The human attacks on its turns (so role-swaps never stall) but never
  // defends, so the duel resolves to a KO. The AI also attacks/defends.
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        room.send('selectAttack', { slot: 'a1' });
      }
    });
  }, 300);

  try {
    await page.waitForFunction(
      () => (window as any).__room?.state?.phase === 'ENDED' && !!(window as any).__room?.state?.winnerId,
      { timeout: 30000 },
    );
  } finally {
    clearInterval(driver);
  }

  // #212 — on ENDED a persistent modal is the single exit (no auto-route).
  // Choose [Return to Overworld] to reach the post-battle EncounterScene hub.
  await returnFromBattle(page);
  await page.waitForFunction(
    () => (window as any).__game?.scene?.isActive('EncounterScene'),
    { timeout: 8000 },
  );

  await ctx.close();
});

// ── Scenario 5: PvP still works ─────────────────────────────────────────────
test('scenario 5: two tabs duel via PvP (battle room, two humans)', async ({ browser }) => {
  const h = await setupBattle(browser);

  const [size, p1Id, p2Id] = await Promise.all([
    h.p1.evaluate(() => (window as any).__room?.state?.players?.size),
    h.p1.evaluate(() => (window as any).__room?.sessionId),
    h.p2.evaluate(() => (window as any).__room?.sessionId),
  ]);
  expect(size).toBe(2);
  expect(p1Id).not.toBe(p2Id); // two distinct human sessionIds
  expect(p1Id).not.toBe('AI');
  expect(p2Id).not.toBe('AI');

  const phase = await h.p1.evaluate(() => (window as any).__room?.state?.phase);
  expect(phase).toBe('ATTACK_SELECT');

  await closeBattle(h);
});

// ── Scenario 6: no cross-contamination ──────────────────────────────────────
test('scenario 6: a PvP join never lands in the locked AI room', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();

  // Tab 1 is in a vsAI duel (room is locked).
  const tab1 = await startAIDuel(ctx1, 'AGGRESSIVE');
  await waitForScene(tab1, 'BattleScene', 5000);
  const aiRoomId = await tab1.evaluate(() => (window as any).__room?.roomId);

  // Tab 2 joins PvP directly — must get a fresh, empty PvP room, not the AI room.
  await seedAuthToken(ctx2);
  const tab2 = await ctx2.newPage();
  await tab2.goto(URL);
  await campToEncounter(tab2);
  await waitForEncounter(tab2);
  await tab2.evaluate(() => (window as any).__encounterSelect('PVP'));
  await tab2.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  const [pvpRoomId, pvpSize] = await Promise.all([
    tab2.evaluate(() => (window as any).__room?.roomId),
    tab2.evaluate(() => (window as any).__room?.state?.players?.size),
  ]);
  expect(pvpRoomId).not.toBe(aiRoomId);
  expect(pvpSize).toBe(1); // alone in a new PvP room

  await ctx1.close();
  await ctx2.close();
});

// ── #78 ② Battle summary ────────────────────────────────────────────────────

// Scenario 3 — a WON duel reports gold + XP. driveAiDuel(aiHearts:1) forces a
// guaranteed protagonist win, then returns to EncounterScene. The server sends
// `battleSummary` after the ENDED patch; Connection.ts captures it onto
// window.__lastBattleSummary (persisting across the scene change), so we read it
// once the duel has resolved.
test('scenario 3: battle summary reports gold and XP on a win', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'DEFENSIVE', aiHearts: 1 });

  // The summary is captured at the connection level, so it is present even after
  // the post-duel transition back to EncounterScene.
  await page.waitForFunction(() => (window as any).__lastBattleSummary !== null, { timeout: 8000 });
  const summary = (await page.evaluate(
    () => (window as any).__lastBattleSummary,
  )) as BattleSummary;

  expect(summary.won).toBe(true);
  expect(summary.goldGained).toBe(50); // GOLD_PER_WIN
  expect(summary.xpGained).toBeGreaterThan(0);
  // aggregate_xp counts Reliquary rings only (in_carry = 0). The seeded player's
  // starter Reliquary rings are all xp=0 and the won ring is only pending, so a
  // fresh account's aggregateXp is legitimately 0 (see PlayerRepo.getSpiritStats).
  expect(summary.aggregateXp).toBe(0);

  await ctx.close();
});

// Scenario 4 — a LOST duel reports zero gold. driveAiDuel(aiHearts:99) makes the
// AI unkillable; the protagonist exhausts both attack rings and forfeits (§6.6),
// so winner = AI and the human summary shows won=false, goldGained=0.
test('scenario 4: battle summary reports zero gold on a loss', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'AGGRESSIVE', aiHearts: 99 });

  await page.waitForFunction(() => (window as any).__lastBattleSummary !== null, { timeout: 8000 });
  const summary = (await page.evaluate(
    () => (window as any).__lastBattleSummary,
  )) as BattleSummary;

  expect(summary.won).toBe(false);
  expect(summary.goldGained).toBe(0);

  await ctx.close();
});

// ── #78 ③ Encounter preview opponent stats ──────────────────────────────────

// Scenario 5 — the preview endpoint returns stakeTier/stakeXp/totalXp for every
// AI personality. AGGRESSIVE stakes a Tier 1 ring worth PERSONALITY_THUMB_XP=10,
// which is also its total XP (only the thumb carries XP).
test('scenario 5: encounter preview endpoint returns stakeTier/stakeXp/totalXp', async ({
  request,
}) => {
  const res = await request.get(`${API_URL}/api/encounter/preview`);
  expect(res.ok()).toBe(true);
  const preview = (await res.json()) as Record<string, PreviewEntry>;

  const personalities = ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'];
  for (const p of personalities) {
    expect(preview[p]).toBeDefined();
    expect(typeof preview[p].stakeTier).toBe('number');
    expect(typeof preview[p].stakeXp).toBe('number');
    expect(typeof preview[p].totalXp).toBe('number');
  }

  expect(preview.AGGRESSIVE.stakeXp).toBe(10);
  expect(preview.AGGRESSIVE.stakeTier).toBe(1);
  // Only the thumb carries XP, so total equals the thumb XP.
  expect(preview.AGGRESSIVE.totalXp).toBe(10);

  // The preview is AI-only — no PVP marker is previewed server-side.
  expect(preview.PVP).toBeUndefined();
});

// Scenario 6 — EncounterScene publishes __encounterPreview with the AI opponent
// stats (no PVP key). AGGRESSIVE's total XP is 10 (its Tier 1 thumb stake).
test('scenario 6: EncounterScene populates __encounterPreview', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);

  await page.waitForFunction(() => (window as any).__encounterPreview != null, { timeout: 8000 });
  const preview = (await page.evaluate(
    () => (window as any).__encounterPreview,
  )) as Record<string, { element: number; stakeTier: number; stakeXp: number; totalXp: number }>;

  const keys = Object.keys(preview);
  expect(keys).toHaveLength(4); // exactly the 4 AI personalities
  expect(keys).toEqual(
    expect.arrayContaining(['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT']),
  );
  expect(keys).not.toContain('PVP');

  expect(preview.AGGRESSIVE.totalXp).toBe(10);
  expect(preview.AGGRESSIVE.stakeTier).toBe(1);

  await ctx.close();
});

// ── #517 (EPIC #511 Contract E) — AI hp_force wiring + indexing normalization ──
//
// Determinism levers (same pattern as tests/e2e/force-heart-loss.spec.ts):
//   • POST /api/test/mint-token provisions a fresh player without bcrypt.
//   • POST /api/test/set-ring-xp boosts the human's a1 XP to ATTACK_XP=14000,
//     so force(14000) = forceFromTier1(tierForXp(14000)+1) = forceFromTier1(8)
//     = 5 (a fixed atkForce shared by both scenarios below).
//   • __testSetState (E2E_TEST_ROUTES) zeroes the AI's d1/d2 uses so every human
//     attack lands as an uncontested NO_BLOCK — isolates hpForce as the only
//     variable in play.
//   • __encounterSelectWithOverrides's aiOverrides argument is spread verbatim
//     into the room-join options client-side (EncounterScene.startAIDuel:
//     `...aiOverrides`), so passing `playerBattleHandAvgXp` and/or `npcId` here
//     — fields outside its declared `{aiHearts?, aiUses?}` TS shape — still
//     flows through to the real BattleRoomOptions at runtime, exactly like the
//     established `aiHeartwoodCharges` precedent in force-heart-loss.spec.ts.

// force(14000) = forceFromTier1(tierForXp(14000)+1) = forceFromTier1(8) = 5.
const FORCE5_ATTACK_XP = 14000;

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
 * Mint a player, boost a1 to force 5, seed the token into a fresh context, walk
 * Camp → Encounter, and launch a vsAI duel with the given personality + AI
 * overrides (forwarded verbatim into BattleRoomOptions — see file docstring).
 * Returns the live BattleScene page.
 */
async function startForceWiringDuel(
  ctx: BrowserContext,
  personality: string,
  overrides: Record<string, unknown>,
): Promise<Page> {
  const { token } = await mintToken();
  const loadout = await getLoadout(token);
  if (loadout.a1) await setRingXP(token, loadout.a1 as string, FORCE5_ATTACK_XP);
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

// ── Scenario 7: normalized hp_force mitigates a force-5 hit; a mid-tier AI
//    survives longer than it would have under the old hpForce=1 interim ──────
test('scenario 7: a normalized AI hp_force mitigates a force-5 human attack more than the pre-#517 interim would have', async ({ browser }) => {
  // Duel 1 — "interim-equivalent" baseline: playerBattleHandAvgXp=0 in the
  // default 'forest' biome → effTier1 = max(floorTier('forest')=1,
  // tierForXp(0)+1=1) = 1 → aiHpForce = forceFromTier1(1) = 1 (identical to the
  // pre-#517 interim's hardcoded 1).
  const ctx1 = await browser.newContext();
  const page1 = await startForceWiringDuel(ctx1, 'DEFENSIVE', {
    aiHearts: 99,
    playerBattleHandAvgXp: 0,
  });
  await armorHuman(page1);
  await disableAiDefence(page1);
  const exchange1 = await attackAI(page1, 'a1');
  expect(exchange1.defenderHeartsLost).toBe(5); // max(1, ceilDiv(5, 1)) = 5
  await ctx1.close();

  // Duel 2 — normalized (#517): playerBattleHandAvgXp=2000 with DEFENSIVE
  // (multiplier 1.0) → npcXp=2000 → tierForXp(2000)=2 (0-indexed) → effTier1 =
  // max(floorTier('forest')=1, 2+1=3) = 3 → aiHpForce = forceFromTier1(3) = 2 —
  // the exact acceptance-criteria worked example (see AILoadoutScaling.test.ts).
  const ctx2 = await browser.newContext();
  const page2 = await startForceWiringDuel(ctx2, 'DEFENSIVE', {
    aiHearts: 99,
    playerBattleHandAvgXp: 2000,
  });
  await armorHuman(page2);
  await disableAiDefence(page2);
  const exchange2 = await attackAI(page2, 'a1');
  expect(exchange2.defenderHeartsLost).toBe(3); // max(1, ceilDiv(5, 2)) = 3
  await ctx2.close();

  // The SAME force-5 attack costs the AI strictly fewer hearts once the real
  // hp_force is wired (3 < 5) — a mid-tier boss now survives longer per
  // exchange than the unmitigated pre-#517 interim did.
  expect(exchange2.defenderHeartsLost).toBeLessThan(exchange1.defenderHeartsLost);
});

// ── Scenario 8: floor-dominated and XP-dominated NPCs land on the same
//    hp_force — proving the indexing normalization removed the off-by-one ────
test('scenario 8: two NPCs on the same effective tier via different dominant branches (floorTier vs tierForXp) take identical force-5 damage', async ({ browser }) => {
  // Duel A — floor-dominated: snow_npc_1 (biome 'snow', AGGRESSIVE, a roamer —
  // no boss modifiers) with playerBattleHandAvgXp=0. npcXp=0 → tierForXp(0)=0
  // → effTier1 = max(floorTier('snow')=2, 0+1=1) = 2 (the BIOME FLOOR wins) →
  // aiHpForce = forceFromTier1(2) = 2.
  const ctxA = await browser.newContext();
  const pageA = await startForceWiringDuel(ctxA, 'AGGRESSIVE', {
    npcId: 'snow_npc_1',
    aiHearts: 99,
    playerBattleHandAvgXp: 0,
  });
  await armorHuman(pageA);
  await disableAiDefence(pageA);
  const exchangeA = await attackAI(pageA, 'a1');
  await ctxA.close();

  // Duel B — XP-dominated: same npcId/biome, but playerBattleHandAvgXp=2500
  // with AGGRESSIVE (multiplier 0.8) → npcXp=round(2500×0.8)=2000 →
  // tierForXp(2000)=2 → effTier1 = max(floorTier('snow')=2, 2+1=3) = 3 (the
  // TIERFORXP BRANCH wins, exceeding the floor) → aiHpForce =
  // forceFromTier1(3) = 2 — the SAME hp_force as duel A, reached via the
  // OTHER operand of the max().
  const ctxB = await browser.newContext();
  const pageB = await startForceWiringDuel(ctxB, 'AGGRESSIVE', {
    npcId: 'snow_npc_1',
    aiHearts: 99,
    playerBattleHandAvgXp: 2500,
  });
  await armorHuman(pageB);
  await disableAiDefence(pageB);
  const exchangeB = await attackAI(pageB, 'a1');
  await ctxB.close();

  // Both duels resolve the SAME force-5 attack to max(1, ceilDiv(5, 2)) = 3
  // hearts — floor-dominated and XP-dominated NPCs at the same normalized
  // effective tier are indistinguishable to the mitigation formula.
  expect(exchangeA.defenderHeartsLost).toBe(3);
  expect(exchangeB.defenderHeartsLost).toBe(3);
  expect(exchangeA.defenderHeartsLost).toBe(exchangeB.defenderHeartsLost);
});

// ── #532 QA Phase 1 — driveAiDuel(aiHearts:1) "guaranteed win" is personality-
//    dependent, not universal. Root cause: the aiHearts:1 handicap only pays
//    off if the AI's single heart is actually struck, which requires the AI to
//    let at least one hit through. AGGRESSIVE (noBlockProb=0) always commits an
//    optimal-timed, near-optimal-element block, so its 1 heart can survive an
//    entire duel while the human's own attack rings run dry and it forfeits
//    (§6.6). DEFENSIVE (noBlockProb=0.3) reliably leaks a hit, so aiHearts:1 is
//    a real guarantee there. These tests lock in that asymmetry independently
//    of scenario 3/4's own assertions, so a future edit can't silently regress
//    back to "aiHearts:1 always wins" (or quietly drop the DEFENSIVE fix).

// #532 adversarial positive control: prove the DEFENSIVE + aiHearts:1 premise
// scenario 3 now relies on actually holds at the room-state level (winnerId is
// the human's own sessionId, not 'AI'; the AI's heart is fully KOd to 0) —
// independent of the battleSummary-level assertions scenario 3 makes.
test('#532 adversarial: DEFENSIVE + aiHearts:1 is a true positive control (winnerId is the human, AI heart hits 0)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'DEFENSIVE', aiHearts: 1 });

  const { winnerId, mySessionId, aiHearts } = await page.evaluate(() => {
    const room = (window as any).__room;
    return {
      winnerId: room?.state?.winnerId,
      mySessionId: room?.sessionId,
      aiHearts: room?.state?.players?.get('AI')?.hearts,
    };
  });

  expect(winnerId).toBe(mySessionId); // the human won — not a forfeit to 'AI'
  expect(aiHearts).toBe(0); // KOd outright, not surviving at its 1-heart handicap

  await ctx.close();
});

// #532 adversarial Layer-2 guard: aggregateXp = SUM(xp) WHERE in_carry = 0
// (Reliquary rings only — PlayerRepo.getSpiritStats). A fresh seeded account's
// starter Reliquary rings are all xp=0 and the ring just won is only `pending`
// (in_carry=1), so aggregateXp is legitimately 0 even on a clean win. Locks
// this in via an independent DEFENSIVE win so a future "fix" can't silently
// reintroduce `toBeGreaterThan(0)` — which only ever accidentally passed
// before #532 because scenario 3's `won` assertion failed first (AGGRESSIVE
// forfeited) and short-circuited the test before reaching aggregateXp.
test('#532 adversarial: aggregateXp stays 0 after a clean win because only Reliquary (in_carry=0) rings accrue XP', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'DEFENSIVE', aiHearts: 1 });

  await page.waitForFunction(() => (window as any).__lastBattleSummary !== null, { timeout: 8000 });
  const summary = (await page.evaluate(
    () => (window as any).__lastBattleSummary,
  )) as BattleSummary;

  expect(summary.won).toBe(true);
  expect(summary.xpGained).toBeGreaterThan(0); // the real per-duel signal lives here
  expect(summary.aggregateXp).toBe(0); // Reliquary-only; 0 is CORRECT for a fresh account, not a bug
  // #532 regression guard — do NOT "fix" the line above back to
  // `toBeGreaterThan(0)`: that reads account-lifetime Reliquary spirit, not
  // this duel's outcome, and is 0 by design until a ring is retired.

  await ctx.close();
});

// #532 adversarial: run AGGRESSIVE + aiHearts:1 to its NATURAL (RNG-driven)
// conclusion and assert the terminal AI-heart state is explicit about WHICH
// path occurred, rather than a flaky pass/fail on `won`. Per the issue's
// probe (3 runs), this is majority-loss (~2/3 forfeit) with an occasional win
// when AGGRESSIVE's ~5% element-mistake / mistiming slip lets a hit through.
// Both outcomes are legitimate; what must NEVER happen is a partial heart
// state (e.g. some accidental heart bleed while still not KOd) — that would
// mean the handicap and the terminal winner disagreed, a genuine bug. This
// test tolerates the coin flip but locks in the {KO=0} XOR {survives=1}
// invariant, making the personality-dependence explicit either way.
test('#532 adversarial: AGGRESSIVE + aiHearts:1 resolves to exactly KO (win, heart=0) XOR fully-intact survival (forfeit-loss, heart=1) — never a partial heart', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'AGGRESSIVE', aiHearts: 1 });

  const { winnerId, mySessionId, aiHearts } = await page.evaluate(() => {
    const room = (window as any).__room;
    return {
      winnerId: room?.state?.winnerId,
      mySessionId: room?.sessionId,
      aiHearts: room?.state?.players?.get('AI')?.hearts,
    };
  });

  if (winnerId === mySessionId) {
    // The rare element-mistake/mistiming slip let a hit through — genuine KO.
    expect(aiHearts).toBe(0);
  } else {
    // AGGRESSIVE blocked every attack; the AI's handicap heart never fell and
    // the human forfeited on attack-ring exhaustion instead (§6.6).
    expect(winnerId).toBe('AI');
    expect(aiHearts).toBe(1); // survived fully intact — proves this is a forfeit, not a KO
  }

  await ctx.close();
});

// #532 adversarial root-cause isolation: strip AGGRESSIVE's ability to block
// at all (reusing the #517 disableAiDefence/armorHuman/startForceWiringDuel
// helpers already in this file) and show the aiHearts:1 guarantee returns
// even under the AGGRESSIVE label. This proves the causal variable is
// noBlockProb (whether the AI ever lets a hit through), not "AGGRESSIVE" as a
// special-cased identity — guarding against a future "fix" that special-cases
// personality strings instead of respecting noBlockProb.
test('#532 adversarial: with AI defense forcibly disabled, AGGRESSIVE + aiHearts:1 also wins — isolates noBlockProb (not personality identity) as the cause', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startForceWiringDuel(ctx, 'AGGRESSIVE', { aiHearts: 1 });
  await armorHuman(page);
  await disableAiDefence(page);

  const exchange = await attackAI(page, 'a1');
  expect(exchange.defenderHeartsLost).toBeGreaterThanOrEqual(1); // any landed hit KOs a 1-heart AI

  await page.waitForFunction(() => (window as any).__room?.state?.phase === 'ENDED', {
    timeout: 8000,
  });
  const { winnerId, mySessionId, aiHearts } = await page.evaluate(() => {
    const room = (window as any).__room;
    return {
      winnerId: room?.state?.winnerId,
      mySessionId: room?.sessionId,
      aiHearts: room?.state?.players?.get('AI')?.hearts,
    };
  });
  expect(winnerId).toBe(mySessionId); // human wins even under the AGGRESSIVE label
  expect(aiHearts).toBe(0);

  await ctx.close();
});

// ── #532 QA Phase 2 — implementation-aware tests targeting private paths now
//    visible in the reviewed code: the poll-driver's `a1Dead && a2Dead` forfeit
//    branch in driveAiDuel (helpers.ts), and seatPlayer's `overrides?.uses` /
//    `overrides?.hearts` handling in BattleRoom.ts (the aiHearts/aiUses
//    override plumbing __encounterSelectWithOverrides forwards verbatim).

// #532 adversarial (implementation-aware): driveAiDuel's poll-driver only sends
// 'forfeit' once BOTH a1Dead AND a2Dead are true (helpers.ts ~L353). Scenario 4
// and the Phase-1 XOR test only assert the duel eventually reaches ENDED; this
// test locks in the numeric postcondition the branch guard implies — BOTH
// attack rings extinguished (not just one, which would mean the a2-fallback
// branch never engaged or forfeit fired early) — and that the unkillable AI's
// hearts are untouched, proving the loss is a forfeit, not a stray KO.
test('#532 adversarial: driveAiDuel forfeit branch only fires once BOTH a1 and a2 are extinguished, and the unkillable AI is untouched', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  await driveAiDuel(page, { personality: 'AGGRESSIVE', aiHearts: 99 });

  const { winnerId, mySessionId, a1, a2, aiHearts } = await page.evaluate(() => {
    const room = (window as any).__room;
    const me = room?.state?.players?.get(room?.sessionId);
    return {
      winnerId: room?.state?.winnerId,
      mySessionId: room?.sessionId,
      a1: { currentUses: me?.a1?.currentUses, isExtinguished: me?.a1?.isExtinguished },
      a2: { currentUses: me?.a2?.currentUses, isExtinguished: me?.a2?.isExtinguished },
      aiHearts: room?.state?.players?.get('AI')?.hearts,
    };
  });

  expect(winnerId).toBe('AI');
  expect(winnerId).not.toBe(mySessionId); // human forfeited, did not lose to a KO
  expect(a1.isExtinguished).toBe(true);
  expect(a2.isExtinguished).toBe(true); // proves the a2-fallback branch actually engaged
  expect(a1.currentUses).toBe(0);
  expect(a2.currentUses).toBe(0);
  expect(aiHearts).toBe(99); // unkillable — the human never landed a scratch

  await ctx.close();
});

// #532 adversarial (implementation-aware): seatPlayer's `overrides?.uses`
// (BattleRoom.ts ~L586) applies uniformly to EVERY combat slot key, not just
// the defense pair a caller reaching for "aiUses" to weaken defense-only might
// expect. This is a private path neither scenario 3/4 nor driveAiDuel's
// docstring exercises. Checked at seat time (no duel driven) so a genuinely
// unattack-capable AI can't hang the test.
test('#532 adversarial: aiUses:0 zeroes ALL of the AIs combat rings at seat time (attack AND defense), not just defense', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() =>
    (window as any).__encounterSelectWithOverrides('DEFENSIVE', { aiUses: 0 }),
  );
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  await page.waitForFunction(
    () => (window as any).__scene?.constructor.name === 'BattleScene',
    { timeout: 5000 },
  );

  const ai = await page.evaluate(() => {
    const room = (window as any).__room;
    const opp = room.state.players.get('AI');
    const slot = (k: string) => ({
      currentUses: opp[k].currentUses,
      isExtinguished: opp[k].isExtinguished,
    });
    return { a1: slot('a1'), a2: slot('a2'), d1: slot('d1'), d2: slot('d2') };
  });

  for (const [name, s] of Object.entries(ai)) {
    expect(s.currentUses, `${name}.currentUses`).toBe(0);
    expect(s.isExtinguished, `${name}.isExtinguished`).toBe(true);
  }

  await ctx.close();
});

// #532 adversarial (implementation-aware) boundary case: aiHearts:0 is a
// falsy-but-defined value. Both `options.aiHearts ?? bossHearts`
// (BattleRoom.ts ~L390) and `overrides?.hearts ?? STARTING_HEARTS`
// (seatPlayer ~L574) use `??`, not `||` — so 0 must be honored as a literal
// zero-heart seat, not silently replaced by the STARTING_HEARTS default the
// way `||` would coerce it. Guards against a future refactor swapping `??`
// for `||` (a one-character regression that `aiHearts:1`-only coverage would
// never catch, since 1 is truthy either way).
test('#532 adversarial: aiHearts:0 is honored via ?? — not coerced up to the STARTING_HEARTS default', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() =>
    (window as any).__encounterSelectWithOverrides('DEFENSIVE', { aiHearts: 0 }),
  );
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  const aiHearts = await page.evaluate(
    () => (window as any).__room?.state?.players?.get('AI')?.hearts,
  );
  expect(aiHearts).toBe(0);

  await ctx.close();
});
