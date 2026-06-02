import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// EPIC #264 / #266 — hold-cross-tap double-attack GESTURE + forfeit-chord relocation,
// driven through the REAL Phaser client. Unlike double-attack.spec.ts (which sends
// `selectDoubleAttack` directly over the socket to exercise the server), these specs
// press keys and assert the CLIENT emits the right message — the same path a player
// drives. A send-spy on window.__room.send captures outgoing selectDoubleAttack
// payloads so we can assert first/second/gapMs without server round-trips.
//
// MUD = WATER + EARTH (ElementEnum 11): a fusion thumb whose components are exactly
// {WATER, EARTH}. Seeding thumb=MUD, a1=WATER, a2=EARTH makes canDoubleAttack true.
const WATER = 1;
const EARTH = 2;
const MUD = 11;
const STEAM = 5; // FIRE+WATER — mismatched against {WATER, EARTH} A-slots → ineligible

async function setState(
  page: Page,
  patch: {
    target?: 'self' | 'opponent';
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Install a spy on room.send so the test can read outgoing selectDoubleAttack. */
async function spyOnSend(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__sentDoubleAttacks = [];
    const orig = w.__room.send.bind(w.__room);
    w.__room.send = (type: string, payload: any) => {
      if (type === 'selectDoubleAttack') w.__sentDoubleAttacks.push(payload);
      return orig(type, payload);
    };
  });
}

async function sentDoubleAttacks(page: Page): Promise<Array<{ first: string; second: string; gapMs: number }>> {
  return page.evaluate(() => (window as any).__sentDoubleAttacks ?? []);
}

/** Seed the attacker as a MUD-thumb double-attacker (eligible) and wait for the diff. */
async function seedEligible(attacker: Page): Promise<void> {
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.thumb.element === 11 && me.thumb.isFusion && me.a1.element === 1 && me.a2.element === 2;
  }, { timeout: 4000 });
}

// ── Scenario 1: hold A1, tap A2 → selectDoubleAttack{first:a1, second:a2} ─────
test('hold 1 then tap 2 on an eligible hand fires selectDoubleAttack{first:a1, second:a2} with gapMs', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await seedEligible(attacker);
  await spyOnSend(attacker);

  // Hold 1 (orb 1), wait ~250ms, tap 2 (orb 2) while 1 is still held, then release.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(250);
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__sentDoubleAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  const sent = await sentDoubleAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].first).toBe('a1');
  expect(sent[0].second).toBe('a2');
  // gapMs is the inter-keydown interval (~250ms over a local socket); allow jitter.
  expect(sent[0].gapMs).toBeGreaterThanOrEqual(150);
  expect(sent[0].gapMs).toBeLessThanOrEqual(600);

  await closeBattle(h);
});

// ── Scenario 2: reverse order → selectDoubleAttack{first:a2, second:a1} ────────
test('hold 2 then tap 1 (reverse order) fires selectDoubleAttack{first:a2, second:a1}', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await seedEligible(attacker);
  await spyOnSend(attacker);

  await attacker.keyboard.down('2');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.down('1');
  await attacker.keyboard.up('1');
  await attacker.keyboard.up('2');

  await attacker.waitForFunction(() => ((window as any).__sentDoubleAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  const sent = await sentDoubleAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].first).toBe('a2');
  expect(sent[0].second).toBe('a1');

  await closeBattle(h);
});

// ── Scenario 3: forfeit relocated to D1+D2 (3+4) ─────────────────────────────
test('pressing 3+4 within FORFEIT_CHORD_MS raises the forfeit prompt', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Ensure the attacker page is the focused/foreground page so CDP key events reach
  // its document, and the scene is live in the attacker's ATTACK_SELECT turn.
  await attacker.bringToFront();
  await attacker.waitForFunction(() => {
    const r = (window as any).__room;
    return r?.state?.phase === 'ATTACK_SELECT' && r.state.currentAttackerId === r.sessionId;
  }, { timeout: 8000 });

  // The d1+d2 chord raises the forfeit prompt only when both keydowns land within
  // FORFEIT_CHORD_MS (50ms) — tighter than Playwright's per-call keyboard latency.
  // Drive two TRUSTED keydowns (3 then 4) via CDP Input.dispatchKeyEvent with no
  // round-trip between them, so they reliably land inside the window. Trusted events
  // are required: Phaser's KeyboardPlugin ignores synthetic dispatchEvent() ones.
  const cdp = await attacker.context().newCDPSession(attacker);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: '3',
    code: 'Digit3',
    windowsVirtualKeyCode: 51,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: '4',
    code: 'Digit4',
    windowsVirtualKeyCode: 52,
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '4', code: 'Digit4', windowsVirtualKeyCode: 52 });

  await attacker.waitForFunction(() => (window as any).__forfeitPromptOpen === true, {
    timeout: 5000,
  });
  expect(await attacker.evaluate(() => (window as any).__forfeitPromptOpen === true)).toBe(true);

  await closeBattle(h);
});

// ── Scenario 4: A1+A2 (1+2 / Z+C) no longer forfeits ─────────────────────────
test('pressing the A1+A2 chord no longer raises the forfeit prompt', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Eligible hand: 1+2 attempts a combo (no forfeit). Default ineligible hand: 1+2
  // arms single attacks (no forfeit). Either way the forfeit prompt must NOT open.
  await seedEligible(attacker);
  await spyOnSend(attacker);

  await attacker.keyboard.down('1');
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  await attacker.waitForTimeout(300);
  expect(await attacker.evaluate(() => (window as any).__forfeitPromptOpen === true)).toBe(false);
  // On the eligible hand the chord fired a combo, NOT a forfeit.
  const sent = await sentDoubleAttacks(attacker);
  expect(sent.length).toBe(1);

  await closeBattle(h);
});

// ── Scenario 5: ineligible hand sends no combo ───────────────────────────────
test('ineligible hand (STEAM thumb, mismatched A-slots): hold-tap sends no selectDoubleAttack', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // STEAM = FIRE+WATER, but A1=WATER A2=EARTH → component set mismatch → ineligible.
  await setState(attacker, {
    elements: { thumb: STEAM, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).thumb.element === 5;
  }, { timeout: 4000 });
  await spyOnSend(attacker);

  // Confirm the cue is OFF (mirror says ineligible) before the gesture — so even a
  // held cross-tap must not send a combo.
  expect(await attacker.evaluate(() => (window as any).__comboEligible)).toBe(false);

  // Hold 1, tap 2 — the same gesture that fires a combo on an eligible hand.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  // Core acceptance: an ineligible hand sends NO selectDoubleAttack — the client
  // does not waste a round-trip the server would only drop. (The single-attack /
  // recharge behaviour of the same keys is covered by recharge-input.spec.ts.)
  await attacker.waitForTimeout(500);
  expect((await sentDoubleAttacks(attacker)).length).toBe(0);

  await closeBattle(h);
});

// ── Scenario 6: eligibility cue shown exactly when canDoubleAttack ────────────
test('A1/A2 show the combo eligibility cue when eligible and hide it when not', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Eligible → cue on.
  await seedEligible(attacker);
  await attacker.waitForFunction(() => (window as any).__comboEligible === true, { timeout: 4000 });
  expect(await attacker.evaluate(() => (window as any).__comboEligible)).toBe(true);

  // Break eligibility (A2 → WOOD, no longer a MUD component) → cue off.
  await setState(attacker, { elements: { a2: 4 } });
  await attacker.waitForFunction(() => (window as any).__comboEligible === false, { timeout: 4000 });
  expect(await attacker.evaluate(() => (window as any).__comboEligible)).toBe(false);

  await closeBattle(h);
});

// ── Scenario 7: touch parity — hold A1 card, tap A2 card → combo ──────────────
// True two-finger multitouch via CDP Input.dispatchTouchEvent: finger 1 holds the
// A1 card while finger 2 taps the A2 card (a single mouse pointer cannot express
// "hold one card while tapping another"). The held finger stays on A1, so no
// pointerout fires on it.
test('touch: holding the A1 card and tapping the A2 card fires selectDoubleAttack', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await seedEligible(attacker);
  await spyOnSend(attacker);

  // __slotPositions is indexed [thumb, a1, a2, d1, d2] in viewport coordinates.
  const pos = await attacker.evaluate(() => (window as any).__slotPositions);
  const a1 = pos[1];
  const a2 = pos[2];

  const cdp = await attacker.context().newCDPSession(attacker);
  // Finger 1: touch down on A1 (and hold).
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: a1.x, y: a1.y, id: 1 }],
  });
  await attacker.waitForTimeout(220);
  // Finger 2: touch down on A2 while finger 1 is still down (both points present).
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: a1.x, y: a1.y, id: 1 },
      { x: a2.x, y: a2.y, id: 2 },
    ],
  });
  // Lift finger 2, then finger 1.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: a2.x, y: a2.y, id: 2 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: a1.x, y: a1.y, id: 1 }],
  });

  await attacker.waitForFunction(() => ((window as any).__sentDoubleAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  const sent = await sentDoubleAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].first).toBe('a1');
  expect(sent[0].second).toBe('a2');

  await closeBattle(h);
});
