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
  return { p1, p2, p1Id, p2Id };
}

test('Scenario 2: FIRE+WATER PARRY → rally active, roles swapped', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await twoPlayers(browser);

  const state0 = await p1.evaluate(() => window.roomState());
  const attackerId = state0.currentAttackerId;
  const attackerPage = attackerId === p1Id ? p1 : p2;
  const defenderPage = attackerId === p1Id ? p2 : p1;

  // Attacker sends FIRE (slot 0)
  const attackSentAt = await attackerPage.evaluate(() => {
    const t = Date.now();
    window.sendAttack(0); // FIRE
    return t;
  });
  const impactTime = attackSentAt + 900;

  await defenderPage.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));

  // Wait until impact time, then send defense with WATER (slot 1) at exactly impact (+30ms)
  const waitMs = (impactTime + 30) - Date.now();
  if (waitMs > 0) await defenderPage.waitForTimeout(waitMs);
  // pressTime = impactTime + 30ms → PARRY (|30| <= 70)
  await defenderPage.evaluate((pt) => window.sendDefense(1, pt), impactTime + 30);

  // Wait for resolve
  await defenderPage.waitForTimeout(200);

  const state = await p1.evaluate(() => window.roomState());
  // Rally: WATER parries FIRE → STRONG relationship from defender's view
  expect(state.rallyActive).toBe(true);
  expect(state.volleyedElement).toBe(1); // WATER
  expect(state.phase).toBe('DEFEND_WINDOW'); // immediate DEFEND_WINDOW for rally
  // Roles swapped: former defender is now attacker
  expect(state.currentAttackerId).not.toBe(attackerId);
});

test('Scenario 3: FIRE+FIRE PARRY → no rally', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await twoPlayers(browser);

  const state0 = await p1.evaluate(() => window.roomState());
  const attackerId = state0.currentAttackerId;
  const attackerPage = attackerId === p1Id ? p1 : p2;
  const defenderPage = attackerId === p1Id ? p2 : p1;

  const attackSentAt = await attackerPage.evaluate(() => {
    const t = Date.now();
    window.sendAttack(0); // FIRE
    return t;
  });
  const impactTime = attackSentAt + 900;

  await defenderPage.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));

  const waitMs = (impactTime - 30) - Date.now();
  if (waitMs > 0) await defenderPage.waitForTimeout(waitMs);
  // FIRE vs FIRE = NEUTRAL, PARRY timing → no rally
  await defenderPage.evaluate((pt) => window.sendDefense(0, pt), impactTime - 30);

  await defenderPage.waitForTimeout(300);

  const state = await p1.evaluate(() => window.roomState());
  expect(state.rallyActive).toBe(false);
  expect(state.phase).toBe('ATTACK_SELECT');
  // No heart lost
  const ids = Object.keys(state.players);
  for (const id of ids) {
    expect(state.players[id].hearts).toBe(3);
  }
});
