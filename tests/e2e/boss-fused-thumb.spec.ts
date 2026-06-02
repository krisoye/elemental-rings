import { test, expect, type Page } from '@playwright/test';

/**
 * #257 (EPIC #256) — bosses stake their thematic FUSION on the thumb. Drives a
 * `battle-ai` BOSS room directly via the boss-combat harness (boss-harness.html →
 * E2E server 2568) and asserts on the REAL `room.state.players.get('AI')`. No
 * mocks — every assertion reads authoritative Colyseus state.
 *
 * Element enum (shared/types.ts): MUD=11, THORNADO=12, BLOOM=13; WOOD=4, WIND=3.
 */
const HARNESS = 'http://localhost:8090/e2e/boss-harness.html';

const MUD = 11;
const THORNADO = 12;
const BLOOM = 13;
const WOOD = 4;
const WIND = 3;

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof (window as any).connectBoss === 'function', {
    timeout: 10000,
  });
}

async function joinBoss(page: Page, npcId: string, personality: string, extra: object = {}): Promise<void> {
  await page.evaluate(
    ([id, p, ex]) =>
      (window as any).connectBoss({ vsAI: true, personality: p, aiSeed: 12345, npcId: id, ...(ex as object) }),
    [npcId, personality, extra] as const,
  );
  await page.evaluate(() => (window as any).onRoomReady());
}

test('scenario 1: Bogwood Warden stakes MUD on the thumb (isFusion)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await joinBoss(page, 'forest_bogwood_warden', 'DEFENSIVE');

  const ai = await page.evaluate(() => (window as any).aiState());
  expect(ai.thumb.element).toBe(MUD);
  expect(ai.thumb.isFusion).toBe(true);
  expect(ai.thumb.fusionParents.length).toBe(2);

  await ctx.close();
});

test('scenario 1b: every boss seats its themed fusion', async ({ browser }) => {
  const cases: Array<[string, string, number]> = [
    ['forest_thornwood_warden', 'RESILIENT', THORNADO],
    ['forest_thornado_shrine_guardian', 'AGGRESSIVE', THORNADO],
    ['forest_bloom_shrine_guardian', 'DEFENSIVE', BLOOM],
  ];
  for (const [npcId, personality, thumb] of cases) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openHarness(page);
    await joinBoss(page, npcId, personality);
    const ai = await page.evaluate(() => (window as any).aiState());
    expect(ai.thumb.element, npcId).toBe(thumb);
    expect(ai.thumb.isFusion, npcId).toBe(true);
    await ctx.close();
  }
});

test('scenario 2: fusion telegraph carries both component elements', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  // Thornado Guardian (AGGRESSIVE) attacks first. The fused thumb's parents are the
  // two telegraph colours; assert the staked fusion decomposes into 2 components.
  await joinBoss(page, 'forest_thornado_shrine_guardian', 'AGGRESSIVE');
  const ai = await page.evaluate(() => (window as any).aiState());
  expect(ai.thumb.fusionParents.length).toBe(2);
  expect(ai.thumb.fusionParents).toEqual([WOOD, WIND]);
  await ctx.close();
});

test('scenario 4: a non-boss vsAI duel still seats a base thumb', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  // No npcId → hub-marker-style vsAI duel → base thumb, generic grant intact.
  await page.evaluate(() =>
    (window as any).connectBoss({ vsAI: true, personality: 'AGGRESSIVE', aiSeed: 7 }),
  );
  await page.evaluate(() => (window as any).onRoomReady());
  const ai = await page.evaluate(() => (window as any).aiState());
  expect(ai.thumb.isFusion).toBe(false);
  await ctx.close();
});
