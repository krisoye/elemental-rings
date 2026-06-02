import { test, expect, type Page } from '@playwright/test';

/**
 * #258 (EPIC #256) — BOSS_MODIFIERS difficulty bundle. Drives `battle-ai` BOSS
 * rooms via the boss-combat harness and asserts the AI seat's hearts / uses match
 * the tier modifier (stacked on the base seat), and that E2E aiHearts/aiUses
 * overrides still take precedence. Reads real `room.state.players.get('AI')`.
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
  return page.evaluate(() => (window as any).aiState());
}

test('scenario 1: major boss (Thornwood) seats 5 hearts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'RESILIENT',
    aiSeed: 1,
    npcId: 'forest_thornwood_warden',
  });
  expect(ai.hearts).toBe(5);
  await ctx.close();
});

test('scenario 2: gate boss (Bogwood) seats 4 hearts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'DEFENSIVE',
    aiSeed: 1,
    npcId: 'forest_bogwood_warden',
  });
  expect(ai.hearts).toBe(4);
  await ctx.close();
});

test('scenario 3: non-boss vsAI baseline seats 3 hearts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, { vsAI: true, personality: 'AGGRESSIVE', aiSeed: 1 });
  expect(ai.hearts).toBe(3);
  await ctx.close();
});

test('scenario 4: aiHearts override beats the modifier (AI seats 1 heart)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'RESILIENT',
    aiSeed: 1,
    npcId: 'forest_thornwood_warden',
    aiHearts: 1,
  });
  expect(ai.hearts).toBe(1);
  await ctx.close();
});

test('major boss combat rings carry +2 uses', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const ai = await aiAfterJoin(page, {
    vsAI: true,
    personality: 'RESILIENT',
    aiSeed: 1,
    npcId: 'forest_thornwood_warden',
  });
  for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
    expect(ai[key].maxUses, key).toBe(5); // unscaled default 3 + 2
  }
  await ctx.close();
});
