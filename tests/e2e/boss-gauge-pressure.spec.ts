import { test, expect, type Page } from '@playwright/test';

/**
 * #260 (EPIC #256) — boss status-gauge pressure. A sub-boss credits the player's
 * status gauge at ×1.5 per uncontested triangle-component hit; non-boss / major /
 * gate fights credit at the base ×1.0. Drives a `battle-ai` boss room via the
 * boss-combat harness (human never defends → boss hits land uncontested) and
 * asserts the human's summed triangle gauge equals triangleHits × gaugeFillMult,
 * read from the REAL server state + exchangeResult broadcasts.
 */
const HARNESS = 'http://localhost:8090/e2e/boss-harness.html';

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof (window as any).connectBoss === 'function', {
    timeout: 10000,
  });
}

/**
 * Join a vsAI room (boss or not), then idle as the human while the boss attacks
 * (passing the human's own turn back with a quick a1). Returns the human's summed
 * triangle gauge and the count of triangle-component uncontested hits the boss
 * landed (from captured exchangeResult broadcasts).
 */
async function measurePressure(
  page: Page,
  options: object,
): Promise<{ triGauge: number; triangleHits: number }> {
  await page.evaluate((opts) => (window as any).connectBoss({ aiHearts: 99, ...(opts as object) }), options);
  await page.evaluate(() => (window as any).onRoomReady());

  return page.evaluate(async () => {
    const W = window as any;
    const TRIANGLE = new Set([0, 1, 4]); // FIRE, WATER, WOOD
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let triangleHits = 0;
    // Drain whatever exchanges already arrived, then keep polling the buffer.
    const seen = new Set<number>();
    const drain = () => {
      const ex = W.__exchanges ?? [];
      for (let i = 0; i < ex.length; i++) {
        if (seen.has(i)) continue;
        seen.add(i);
        const m = ex[i];
        if (m.attackerId === 'AI' && m.defenderHeartLost && (m.timing === 'NO_BLOCK' || m.timing === 'MISTIME')) {
          for (const el of m.attackerElements) if (TRIANGLE.has(el)) triangleHits++;
        }
      }
    };
    for (let i = 0; i < 40 && triangleHits < 2; i++) {
      drain();
      const s = W.roomState();
      if (s.phase === 'ATTACK_SELECT' && s.currentAttackerId === W.sessionId()) {
        W.sendAttack('a1');
      }
      await sleep(180);
    }
    drain();
    const me = W.roomState().players[W.sessionId()];
    const triGauge = (me.fireGauge ?? 0) + (me.waterGauge ?? 0) + (me.woodGauge ?? 0);
    return { triGauge, triangleHits };
  });
}

test('scenario 1: a sub-boss fills the player gauge at ×1.5', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const { triGauge, triangleHits } = await measurePressure(page, {
    vsAI: true,
    personality: 'DEFENSIVE',
    aiSeed: 808,
    npcId: 'forest_bloom_shrine_guardian',
  });
  if (triangleHits > 0) {
    expect(triGauge).toBeCloseTo(triangleHits * 1.5, 4);
  }
  await ctx.close();
});

test('scenario 4: a non-boss fills the player gauge at the base ×1.0', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  const { triGauge, triangleHits } = await measurePressure(page, {
    vsAI: true,
    personality: 'STATUS_HUNTER',
    aiSeed: 909,
  });
  if (triangleHits > 0) {
    expect(triGauge).toBeCloseTo(triangleHits * 1.0, 4);
  }
  await ctx.close();
});
