import { test, expect, type Page } from '@playwright/test';

/**
 * #259 (EPIC #256) — boss enrage / phase-2. The major boss (Thornwood) broadcasts
 * `enraged === true` once its hearts cross to ≤ its threshold; gate/sub bosses
 * never enrage. Drives a `battle-ai` boss room via the boss-combat harness and
 * asserts on the REAL server `enraged` flag.
 *
 * The harness is a bare Colyseus client (no Phaser scene), so this spec asserts
 * the server-authoritative flag — the load-bearing behaviour. The client banner /
 * red-tint are pure presentation layered on this same flag in BattleScene.
 */
const HARNESS = 'http://localhost:8090/e2e/boss-harness.html';

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof (window as any).connectBoss === 'function', {
    timeout: 10000,
  });
}

async function joinBoss(page: Page, npcId: string, personality: string, extra: object = {}): Promise<void> {
  await page.evaluate(
    ([id, p, ex]) =>
      (window as any).connectBoss({ vsAI: true, personality: p, aiSeed: 31, npcId: id, ...(ex as object) }),
    [npcId, personality, extra] as const,
  );
  await page.evaluate(() => (window as any).onRoomReady());
}

/** Drive the human to attack a1 every turn until the AI hits `target` hearts or ENDED. */
async function driveAiToHearts(page: Page, target: number): Promise<number> {
  return page.evaluate(async (t) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const W = window as any;
    for (let i = 0; i < 80; i++) {
      const aiHearts = W.aiState()?.hearts ?? 99;
      if (aiHearts <= t) return aiHearts;
      const state = W.roomState();
      if (state.phase === 'ENDED') return aiHearts;
      if (state.phase === 'ATTACK_SELECT' && state.currentAttackerId === W.sessionId()) {
        W.sendAttack('a1');
      }
      await sleep(180);
    }
    return W.aiState()?.hearts ?? 99;
  }, target);
}

test('scenario 1: major boss enrages at ≤ threshold hearts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  // Major boss seeded at 3 hearts (threshold 2). Starts un-enraged.
  await joinBoss(page, 'forest_thornwood_warden', 'RESILIENT', { aiHearts: 3 });
  expect((await page.evaluate(() => (window as any).aiState())).enraged).toBe(false);

  const hearts = await driveAiToHearts(page, 2);
  const ended = await page.evaluate(() => (window as any).roomState().phase === 'ENDED');
  if (!ended && hearts <= 2) {
    expect((await page.evaluate(() => (window as any).aiState())).enraged).toBe(true);
  }
  await ctx.close();
});

test('scenario 3: gate boss does not enrage even at 1 heart', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await joinBoss(page, 'forest_bogwood_warden', 'DEFENSIVE', { aiHearts: 1 });
  // Drive a few turns; the gate boss (threshold 0) must never set enraged.
  await driveAiToHearts(page, 0);
  expect((await page.evaluate(() => (window as any).aiState())).enraged).toBe(false);
  await ctx.close();
});

test('a non-boss AI never carries the enraged flag', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await page.evaluate(() =>
    (window as any).connectBoss({ vsAI: true, personality: 'AGGRESSIVE', aiSeed: 1, aiHearts: 1 }),
  );
  await page.evaluate(() => (window as any).onRoomReady());
  expect((await page.evaluate(() => (window as any).aiState())).enraged).toBe(false);
  await ctx.close();
});
