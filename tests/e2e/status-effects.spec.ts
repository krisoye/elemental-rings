import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  readMe,
  closeBattle,
  type SlotKey,
} from './helpers';

// GDD §7 status-effect E2E. These drive a real PvP duel (two browser sessions)
// so every assertion reads authoritative broadcast state (window.__room.state),
// never a mock. Precise gauge values are seeded via the server's test-only
// `__testSetState` message (gated by E2E_TEST_ROUTES, set in playwright.config)
// — engineering an exact gauge through timed play is impractical, but every
// EFFECT (Burning damage, Drowning surcharge, Entangled drain, gauge cleanse)
// still runs through the authoritative server resolution paths.
//
// Default loadout (BattleRoom DEFAULT_LOADOUT): thumb=FIRE, a1=FIRE, a2=WATER,
// d1=WOOD, d2=EARTH. EARTH defense (D2='4') is always a NEUTRAL catch — it
// passes the turn safely without losing a heart and cleanses no gauge, so it is
// used to hand the turn over cleanly.

// Browser-path defend-window calibration (see client-battle-flow.spec.ts): a
// ~700ms wait after the window opens lands inside the BLOCK band.
const BLOCK_SLEEP_MS = 700;
const CAUGHT = ['BLOCK', 'PARRY'];

/** Seed exact state on a player via the test-only server hook. */
async function setState(
  page: Page,
  patch: {
    target?: 'self' | 'opponent';
    hearts?: number;
    fireGauge?: number;
    waterGauge?: number;
    woodGauge?: number;
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Wait for a named phase on a page. */
async function waitForPhase(page: Page, phase: string, timeout = 6000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, { timeout });
}

/** True iff this page is the current attacker. */
async function isAttacker(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as any).__room.sessionId === (window as any).__room.state.currentAttackerId,
  );
}

/** Read a single gauge/heart/use value off the local player's broadcast state. */
async function readMyField(page: Page, key: string): Promise<number> {
  return page.evaluate((k) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me?.[k] ?? 0;
  }, key);
}

/**
 * Drive one full exchange where `attacker` throws A1 (FIRE) and `defender`
 * catches safely with D2 (EARTH, always NEUTRAL — no heart, no cleanse). Resolves
 * once both pages observe a turn boundary (ATTACK_SELECT or ENDED). Used to pass
 * the turn so the start-of-turn status tick fires for the next attacker.
 */
async function passTurnViaSafeCatch(attacker: Page, defender: Page): Promise<void> {
  await attacker.keyboard.press('1'); // A1 = FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(BLOCK_SLEEP_MS);
  await defender.keyboard.press('4'); // D2 = EARTH → NEUTRAL catch
  await waitForExchangeResult(defender);
  await attacker.waitForFunction(
    () => ['ATTACK_SELECT', 'ENDED'].includes((window as any).__room?.state?.phase),
    { timeout: 6000 },
  );
}

// ── Scenario 1: Burning deals heart damage at turn start ────────────────────
test('Burning: fireGauge>=4 costs the afflicted player a heart at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Seed Burning (fireGauge=4) on the DEFENDER — they become the attacker next
  // turn, when the start-of-turn tick fires. Keep them at 3 hearts so the only
  // heart change is the Burning tick.
  await setState(defender, { fireGauge: 4, hearts: 3 });

  // Pass the turn via a clean EARTH catch (no heart loss, no fire cleanse).
  await passTurnViaSafeCatch(attacker, defender);

  // The former defender is now the attacker; Burning fired at turn entry.
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return room.state.phase === 'ATTACK_SELECT' && me.hearts === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.hearts).toBe(2);
  expect(me.fireGauge).toBe(4); // still Burning (no cleanse occurred)
  expect(await isAttacker(defender)).toBe(true);

  await closeBattle(h);
});

// ── Scenario 2: Burning can KO at turn start (opponent wins) ────────────────
test('Burning: KOs an afflicted player at 1 heart; opponent wins', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // Defender becomes next attacker at 1 heart with Burning → KO on turn start.
  await setState(defender, { fireGauge: 4, hearts: 1 });

  await passTurnViaSafeCatch(attacker, defender);

  // The Burning tick KOs the former defender before they can act → ENDED, the
  // other player wins.
  await defender.waitForFunction(() => (window as any).__room?.state?.phase === 'ENDED', {
    timeout: 6000,
  });
  const winnerId = await defender.evaluate(() => (window as any).__room.state.winnerId);
  expect(winnerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 3: Drowning costs an extra use per attack ──────────────────────
test('Drowning: waterGauge>=4 makes an attack throw cost 2 uses', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // The current attacker is Drowning. Their A1 (FIRE) starts at 3 uses.
  await setState(attacker, { waterGauge: 4, uses: { a1: 3 } });

  const before = await readMyField(attacker, 'fireGauge'); // unused but reads real state
  expect(before).toBe(0);

  // Throw A1 — Drowning makes it cost 1 (base) + 1 (Drowning) = 2 uses.
  await attacker.keyboard.press('1');
  await waitForPhase(attacker, 'DEFEND_WINDOW');

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses === 1;
  }, { timeout: 4000 });

  const me = await readMe(attacker);
  expect(me.a1.currentUses).toBe(1); // 3 → 1 (two uses spent, not one)

  await closeBattle(h);
});

// ── Scenario 4: Entangled drains the highest-use battle ring at turn start ──
test('Entangled: woodGauge>=4 drains the highest-use battle ring at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender becomes attacker next turn. Give a clear highest-use ring: a2=5,
  // everything else lower, so Entangled must drain a2 (5 → 4).
  await setState(defender, {
    woodGauge: 4,
    uses: { a1: 2, a2: 5, d1: 2, d2: 3 },
  });

  await passTurnViaSafeCatch(attacker, defender);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return room.state.phase === 'ATTACK_SELECT' && me.a2.currentUses === 4;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.a2.currentUses).toBe(4); // highest-use ring drained by 1
  expect(me.a1.currentUses).toBe(2); // others untouched
  expect(me.d2.currentUses).toBe(3);

  await closeBattle(h);
});

// ── Scenario 5: Water catch cleanses one fire-gauge counter ─────────────────
test('Cleanse: catching FIRE with a WATER ring decrements fireGauge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Give the defender a WATER defense ring (D2) and seed fireGauge=5 on them.
  await setState(defender, { fireGauge: 5, elements: { d2: 1 /* WATER */ } });

  // Attacker throws FIRE (A1); defender catches with WATER (D2). The catch is a
  // STRONG/PARRY-or-BLOCK against FIRE and cleanses one fireGauge counter.
  await attacker.keyboard.press('1');
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(BLOCK_SLEEP_MS);
  await defender.keyboard.press('4'); // D2 = WATER (overridden)

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing); // a genuine catch occurred

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 4;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(4); // 5 → 4 (one counter cleansed)

  await closeBattle(h);
});

// ── Scenario 6: a cleanse below the threshold lifts Burning next turn ────────
test('Cleanse below threshold lifts Burning: fireGauge 4→3 ends the status', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender at fireGauge=4 (Burning) with a WATER defense ring (D2). Record
  // their hearts so we can prove Burning did NOT tick after the cleanse.
  await setState(defender, { fireGauge: 4, hearts: 3, elements: { d2: 1 /* WATER */ } });

  // Defender catches the incoming FIRE with WATER → fireGauge 4 → 3 (below
  // threshold). WATER beats FIRE (STRONG), so a parry would start a rally; the
  // cleanse fires on either BLOCK or PARRY, so we only assert the gauge drop.
  await attacker.keyboard.press('1');
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(BLOCK_SLEEP_MS);
  await defender.keyboard.press('4'); // D2 = WATER

  await waitForExchangeResult(defender);
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 3;
  }, { timeout: 4000 });

  // Drive the duel forward (handling a possible rally) until the cleansed player
  // is the attacker at a turn start. Burning is now inactive (gauge 3 < 4), so
  // the turn-start tick must NOT remove a heart.
  const driver = setInterval(() => {
    void Promise.all([
      h.p1.evaluate(() => {
        const room = (window as any).__room;
        if (
          room?.state?.phase === 'DEFEND_WINDOW' &&
          room.state.currentAttackerId !== room.sessionId
        ) {
          room.send('submitDefense', { slot: 'd2' }); // EARTH/WATER — caught, ends rally on BLOCK
        }
      }),
      h.p2.evaluate(() => {
        const room = (window as any).__room;
        if (
          room?.state?.phase === 'DEFEND_WINDOW' &&
          room.state.currentAttackerId !== room.sessionId
        ) {
          room.send('submitDefense', { slot: 'd2' });
        }
      }),
    ]);
  }, 120);

  try {
    await defender.waitForFunction(
      () =>
        (window as any).__room?.state?.phase === 'ATTACK_SELECT' &&
        (window as any).__room.sessionId === (window as any).__room.state.currentAttackerId,
      { timeout: 12000 },
    );
  } finally {
    clearInterval(driver);
  }

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(3); // cleansed below threshold
  expect(me.hearts).toBe(3); // Burning did NOT fire — status was lifted

  void attacker;
  await closeBattle(h);
});
