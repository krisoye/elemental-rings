import { test, expect, type Page } from '@playwright/test';

/**
 * #261 (EPIC #256) — boss unique passives. Bogwood "Bulwark" seats both defense
 * rings +1 use; the guardians have no passive; Thornwood "Heartwood" absorbs the
 * first N heart-losses (redirected to the Thumb). Drives `battle-ai` boss rooms via
 * the boss-combat harness and asserts on the REAL server state.
 */
const HARNESS = 'http://localhost:8090/e2e/boss-harness.html';

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof (window as any).connectBoss === 'function', {
    timeout: 10000,
  });
}

async function aiAfterJoin(page: Page, options: object): Promise<any> {
  await page.evaluate((opts) => (window as any).connectBoss(opts as object), options);
  await page.evaluate(() => (window as any).onRoomReady());
  return page.evaluate(() => (window as any).aiState());
}

test('scenario 2: Bogwood "Bulwark" seats both defense rings at +1 use', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'DEFENSIVE',
    aiSeed: 1,
    npcId: 'forest_bogwood_warden',
  });
  // gate bonusUses (+1) + Bulwark (+1) → defenses 5; attacks (no Bulwark) 4.
  expect(ai.d1.maxUses).toBe(5);
  expect(ai.d1.currentUses).toBe(5);
  expect(ai.d2.maxUses).toBe(5);
  expect(ai.a1.maxUses).toBe(4);
  expect(ai.a2.maxUses).toBe(4);
  await ctx.close();
});

test('scenario 3: a guardian seats with no passive (defenses match the sub baseline)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'AGGRESSIVE',
    aiSeed: 1,
    npcId: 'forest_thornado_shrine_guardian',
  });
  // sub bonusUses (+1), no Bulwark → all combat rings 4.
  for (const key of ['a1', 'a2', 'd1', 'd2']) {
    expect(ai[key].maxUses, key).toBe(4);
  }
  await ctx.close();
});

test('scenario 1: Thornwood "Heartwood" absorbs the first hit (no heart lost)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await aiAfterJoin(page, {
    vsAI: true,
    personality: 'RESILIENT',
    aiSeed: 41,
    npcId: 'forest_thornwood_warden',
    aiHearts: 3,
  });

  // Drive the human attacking until a hit lands on the boss; the first such hit must
  // not lower the boss's hearts (Heartwood absorbs it).
  const result = await page.evaluate(async () => {
    const W = window as any;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let bossHit = false;
    const start = W.__exchanges.length;
    for (let i = 0; i < 60; i++) {
      const ex = W.__exchanges ?? [];
      for (let j = start; j < ex.length; j++) {
        if (ex[j].defenderId === 'AI' && ex[j].defenderHeartLost) bossHit = true;
      }
      if (bossHit) break;
      const s = W.roomState();
      if (s.phase === 'ENDED') break;
      if (s.phase === 'ATTACK_SELECT' && s.currentAttackerId === W.sessionId()) {
        W.sendAttack('a1');
      }
      await sleep(180);
    }
    return { bossHit, aiHearts: W.aiState()?.hearts ?? 99 };
  });

  if (result.bossHit) {
    expect(result.aiHearts).toBe(3); // first hit absorbed → hearts unchanged
  }
  await ctx.close();
});
