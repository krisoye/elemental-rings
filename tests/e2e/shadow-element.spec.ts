import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  readMe,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  DEFEND_LAPSE_WAIT_MS,
  type SlotKey,
} from './helpers';

// #133 — Shadow element core (GDD §3.5). Shadow beats Wood, loses to Fire, and is
// neutral vs Water/Earth/Wind/Shadow. Real PvP duel; element overrides are seeded
// via __testSetState.elements (Shadow = 15). The matchup resolution runs through
// the authoritative ElementSystem/BlockResolver path.

const FIRE = 0;
const WATER = 1;
const WOOD = 4;
const SHADOW = 15;

async function setState(
  page: Page,
  patch: { hearts?: number; uses?: Partial<Record<SlotKey, number>>; elements?: Partial<Record<SlotKey, number>> },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

async function waitForDefend(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__room.state.phase === 'DEFEND_WINDOW', {
    timeout: 5000,
  });
}

const CAUGHT = ['BLOCK', 'PARRY'];

// ── Scenario 1: Shadow beats Wood ────────────────────────────────────────────
test('Shadow attack vs Wood defense resolves WEAK (heart lost) — Shadow beats Wood', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws SHADOW (A1=SHADOW); defender catches with WOOD (D1=WOOD).
  // Shadow beats Wood → the Wood defense is WEAK → a heart is lost despite the catch.
  await setState(attacker, { elements: { a1: SHADOW } });
  await setState(defender, { elements: { d1: WOOD }, hearts: 3 });

  await attacker.keyboard.press('1'); // SHADOW
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = WOOD

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('WEAK');
  expect(result.defenderHeartLost).toBe(true);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).hearts === 2;
  }, { timeout: 4000 });
  const me = await readMe(defender);
  expect(me.hearts).toBe(2);

  await closeBattle(h);
});

// ── Scenario 2: Fire dispels a Shadow defense ────────────────────────────────
test('Fire attack vs Shadow defense resolves WEAK (heart lost) — Fire dispels Shadow', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws FIRE; defender catches with SHADOW (D1=SHADOW). Fire dispels
  // Shadow → the Shadow defense is WEAK → a heart is lost.
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, { elements: { d1: SHADOW }, hearts: 3 });

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = SHADOW

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('WEAK');
  expect(result.defenderHeartLost).toBe(true);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).hearts === 2;
  }, { timeout: 4000 });

  await closeBattle(h);
});

// ── Scenario 3: Shadow neutral vs Water ──────────────────────────────────────
test('Shadow attack vs Water defense resolves NEUTRAL (safe, no heart)', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws SHADOW; defender catches with WATER (D1=WATER). Shadow vs Water
  // is NEUTRAL → a safe catch, no heart lost, no rally.
  await setState(attacker, { elements: { a1: SHADOW } });
  await setState(defender, { elements: { d1: WATER }, hearts: 3 });

  await attacker.keyboard.press('1'); // SHADOW
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = WATER

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('NEUTRAL');
  expect(result.defenderHeartLost).toBe(false);

  const me = await readMe(defender);
  expect(me.hearts).toBe(3); // safe — no heart lost

  await closeBattle(h);
});

// ── Scenario 4: Shadow telegraph renders ─────────────────────────────────────
test('Shadow telegraph: a Shadow attack launches the orb with the Shadow element', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await defender.evaluate(() => { (window as any).__orbLaunchCount = 0; });
  await setState(attacker, { elements: { a1: SHADOW } });

  await attacker.keyboard.press('1'); // SHADOW attack → telegraph orb crosses the screen
  await waitForDefend(defender);

  // The orb launched on the defender's screen (the incoming telegraph).
  await defender.waitForFunction(() => ((window as any).__orbLaunchCount ?? 0) >= 1, {
    timeout: 4000,
  });

  // The attacker's broadcast ring element is SHADOW, which is what the telegraph
  // colors the orb from (ELEMENT_COLORS[15], the dark-purple Shadow swatch).
  const attackerElement = await defender.evaluate(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.state.currentAttackerId).a1.element;
  });
  expect(attackerElement).toBe(SHADOW);

  // Let the window lapse so the exchange resolves cleanly before teardown.
  await defender.waitForTimeout(DEFEND_LAPSE_WAIT_MS);

  await closeBattle(h);
});
