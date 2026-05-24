import { test, expect, Browser } from '@playwright/test';

declare global {
  interface Window {
    connectRoom: (name: string) => Promise<string>;
    sendAttack: (slot: number) => void;
    sendDefense: (slot: number, pressTime: number) => void;
    roomState: () => any;
    waitForPhase: (phase: string) => Promise<any>;
    waitForField: (field: string, value: any, timeout?: number) => Promise<any>;
  }
}

async function twoPlayers(browser: Browser) {
  const p1ctx = await browser.newContext();
  const p2ctx = await browser.newContext();
  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();
  await p1.goto('http://localhost:8080/test-harness.html');
  await p2.goto('http://localhost:8080/test-harness.html');
  const p1Id = await p1.evaluate(() => window.connectRoom('battle'));
  const p2Id = await p2.evaluate(() => window.connectRoom('battle'));
  await p1.evaluate(() => window.waitForPhase('ATTACK_SELECT'));
  return { p1, p2, p1Id, p2Id, p1ctx, p2ctx };
}

test('Scenario 4: no defense → defender loses heart', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await twoPlayers(browser);

  const state0 = await p1.evaluate(() => window.roomState());
  const attackerId = state0.currentAttackerId;
  const attackerPage = attackerId === p1Id ? p1 : p2;
  const defenderPage = attackerId === p1Id ? p2 : p1;
  const defenderId = attackerId === p1Id ? p2Id : p1Id;

  await attackerPage.evaluate(() => window.sendAttack(0));
  await defenderPage.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));

  // Don't send defense — wait for window to close (1080ms + buffer)
  await defenderPage.waitForTimeout(1200);

  const finalState = await defenderPage.evaluate(() => window.roomState());
  expect(finalState.phase).toBe('ATTACK_SELECT');
  // Defender lost a heart
  const defenderState = finalState.players[defenderId];
  expect(defenderState.hearts).toBe(2);
});

test('Scenario 5: MISTIME → defender loses heart and use', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await twoPlayers(browser);

  const state0 = await p1.evaluate(() => window.roomState());
  const attackerId = state0.currentAttackerId;
  const attackerPage = attackerId === p1Id ? p1 : p2;
  const defenderPage = attackerId === p1Id ? p2 : p1;
  const defenderId = attackerId === p1Id ? p2Id : p1Id;

  await attackerPage.evaluate(() => window.sendAttack(0));
  await defenderPage.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));

  // Send defense 600ms early (MISTIME: |offset| > 180ms)
  // pressTime is now, impactTime is now+900 → offset = -600ms
  await defenderPage.evaluate(() => window.sendDefense(1, Date.now()));

  // Wait for resolution
  await defenderPage.waitForTimeout(1200);

  const finalState = await defenderPage.evaluate(() => window.roomState());
  expect(finalState.phase).toBe('ATTACK_SELECT');
  const defenderState = finalState.players[defenderId];
  expect(defenderState.hearts).toBe(2);
  expect(defenderState.hand[1].currentUses).toBe(2); // started at 3, lost 1 on MISTIME
});

test('Scenario 6: post-impact BLOCK (+150ms) → no heart lost', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await twoPlayers(browser);

  const state0 = await p1.evaluate(() => window.roomState());
  const attackerId = state0.currentAttackerId;
  const attackerPage = attackerId === p1Id ? p1 : p2;
  const defenderPage = attackerId === p1Id ? p2 : p1;
  const defenderId = attackerId === p1Id ? p2Id : p1Id;

  // Get impact time by recording when attack is sent
  const attackSentAt = await attackerPage.evaluate(() => {
    const t = Date.now();
    window.sendAttack(0); // FIRE slot
    return t;
  });
  const impactTime = attackSentAt + 900;

  await defenderPage.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));

  // Wait until +150ms past impact, then send defense
  const waitMs = (impactTime + 150) - Date.now();
  if (waitMs > 0) await defenderPage.waitForTimeout(waitMs);

  await defenderPage.evaluate(() => {
    window.sendDefense(0, Date.now()); // FIRE vs FIRE = NEUTRAL, BLOCK timing
  });

  await defenderPage.waitForTimeout(500);

  const finalState = await defenderPage.evaluate(() => window.roomState());
  const defenderState = finalState.players[defenderId];
  expect(defenderState.hearts).toBe(3); // no heart lost on BLOCK
});
