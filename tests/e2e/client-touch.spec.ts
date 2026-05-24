import { test, expect } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle } from './helpers';

test('scenario 8: tapping slot 0 sends selectAttack', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  const pos = await attacker.evaluate(() => (window as any).__slotPositions?.[0]);
  if (!pos) throw new Error('__slotPositions not set on the attacker page');

  await attacker.touchscreen.tap(pos.x, pos.y);

  await attacker.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  const slot = await attacker.evaluate(() => (window as any).__room?.state?.attackerSelectedSlot);
  expect(slot).toBe(0);

  await closeBattle(h);
});
