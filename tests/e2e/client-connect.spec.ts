import { test, expect } from '@playwright/test';

const URL = 'http://localhost:8080';

test('scenario 1: two tabs connect and reach BattleScene', async ({ browser }) => {
  const p1ctx = await browser.newContext();
  const p2ctx = await browser.newContext();
  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  await p1.goto(URL);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  await p2.goto(URL);

  await Promise.all([
    p1.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
      timeout: 10000,
    }),
    p2.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
      timeout: 10000,
    }),
  ]);

  const [phase1, phase2] = await Promise.all([
    p1.evaluate(() => (window as any).__room?.state?.phase),
    p2.evaluate(() => (window as any).__room?.state?.phase),
  ]);
  expect(phase1).toBe('ATTACK_SELECT');
  expect(phase2).toBe('ATTACK_SELECT');

  await p1ctx.close();
  await p2ctx.close();
});
