import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

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

async function setupPlayers(browser: Browser): Promise<{
  p1: Page; p2: Page; p1ctx: BrowserContext; p2ctx: BrowserContext;
  p1Id: string; p2Id: string;
}> {
  const p1ctx = await browser.newContext();
  const p2ctx = await browser.newContext();
  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  await p1.goto('http://localhost:8080/test-harness.html');
  await p2.goto('http://localhost:8080/test-harness.html');

  const p1Id = await p1.evaluate(() => window.connectRoom('battle'));
  const p2Id = await p2.evaluate(() => window.connectRoom('battle'));

  // Wait for both to be in ATTACK_SELECT
  await p1.evaluate(() => window.waitForPhase('ATTACK_SELECT'));

  return { p1, p2, p1ctx, p2ctx, p1Id, p2Id };
}

test('Scenario 1: full battle to completion — no-block 3 times', async ({ browser }) => {
  const { p1, p2, p1Id, p2Id } = await setupPlayers(browser);

  for (let i = 0; i < 3; i++) {
    // Current attacker sends an attack on slot 0
    const state = await p1.evaluate(() => window.roomState());
    const attackerPage = state.currentAttackerId === p1Id ? p1 : p2;

    await attackerPage.evaluate(() => window.sendAttack(0));
    // Wait for DEFEND_WINDOW then let it time out (no defense sent)
    await p1.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));
    // Wait for resolution — should go back to ATTACK_SELECT or ENDED
    await p1.evaluate(() => new Promise<void>(res => {
      const poll = () => {
        const s = window.roomState();
        if (s.phase === 'ATTACK_SELECT' || s.phase === 'ENDED') { res(); return; }
        setTimeout(poll, 100);
      };
      poll();
    }));
  }

  const finalState = await p1.evaluate(() => window.roomState());
  expect(finalState.phase).toBe('ENDED');
  expect(finalState.winnerId).toBeTruthy();
});
