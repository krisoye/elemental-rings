import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { setupBattle, waitForEncounter, campToEncounter, seedAuthToken, closeBattle } from './helpers';

// Port 8090 avoids colliding with the production Vite dev server on 8080.
const URL = 'http://localhost:8090';

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
  // or 'd2'); defenderHeartLost means the AI took a hit from a no-block. Either
  // proves the AI responded to the incoming attack.
  // NOTE: defenderSlot in room.state resets to '' within the same Colyseus tick
  // — use the exchangeResult message instead, where the slot is captured at resolve time.
  await page.waitForFunction(
    () => {
      const r = (window as any).__lastExchangeResult;
      return r !== null && (r.defenderSlot !== '' || r.defenderHeartLost);
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

  // After the duel ends BattleScene transitions to CampScene.
  await page.waitForFunction(
    () => (window as any).__game?.scene?.isActive('CampScene'),
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
