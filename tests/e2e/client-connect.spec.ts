import { test, expect } from '@playwright/test';
import { setupBattle, closeBattle } from './helpers';

// After the Phase-3 routing change, the page lands in EncounterScene and
// connects to nothing until a selection fires. setupBattle drives both tabs
// through the PvP path (EncounterScene → PvP → LobbyScene → battle room).
test('scenario 1: two tabs connect via PvP and reach BattleScene', async ({ browser }) => {
  const h = await setupBattle(browser);

  await Promise.all([
    h.p1.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
      timeout: 10000,
    }),
    h.p2.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
      timeout: 10000,
    }),
  ]);

  const [phase1, phase2] = await Promise.all([
    h.p1.evaluate(() => (window as any).__room?.state?.phase),
    h.p2.evaluate(() => (window as any).__room?.state?.phase),
  ]);
  expect(phase1).toBe('ATTACK_SELECT');
  expect(phase2).toBe('ATTACK_SELECT');

  await closeBattle(h);
});
