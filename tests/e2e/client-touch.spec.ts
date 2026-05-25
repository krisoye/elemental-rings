import { test, expect } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle } from './helpers';

test('scenario 8: tapping the A1 slot sends selectAttack', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // __slotPositions is indexed thumb,a1,a2,d1,d2 — index 1 is the A1 attack slot
  // (index 0, the thumb, is passive and not pressable).
  const pos = await attacker.evaluate(() => (window as any).__slotPositions?.[1]);
  if (!pos) throw new Error('__slotPositions not set on the attacker page');

  await attacker.touchscreen.tap(pos.x, pos.y);

  await attacker.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  const slot = await attacker.evaluate(() => (window as any).__room?.state?.attackerSlot);
  expect(slot).toBe('a1');

  await closeBattle(h);
});
