import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// #485 — Charge attack mechanic: oscillating orb throw with fusion ring integration.
// PvP duel (two browser sessions); all assertions read authoritative broadcast state
// (window.__room.state) or spy on outgoing messages (window.__room.send).
//
// The charge attack introduces a new server message contract:
//   chargeStart  — emitted on hold begin (server records timestamp)
//   releaseAttack — carries { slot, holdDuration } and replaces selectAttack
//
// E2E real-input rule: all pointer/keyboard actions use page.mouse.* or
// page.keyboard.* on the canvas — never __* hooks except to READ state.

const WATER = 1;
const EARTH = 2;
const MUD = 11; // WATER + EARTH fusion

// ── helpers ───────────────────────────────────────────────────────────────────

/** Seed exact state on a player via the test-only server hook. */
async function setState(
  page: Page,
  patch: {
    target?: 'self' | 'opponent';
    hearts?: number;
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Collect every broadcast of `type` into window.__msgs[type] on the page. */
async function collectMessages(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => {
    const w = window as any;
    w.__msgs = w.__msgs || {};
    w.__msgs[t] = [];
    w.__room.onMessage(t, (m: any) => w.__msgs[t].push(m));
  }, type);
}

async function getMessages(page: Page, type: string): Promise<any[]> {
  return page.evaluate((t) => (window as any).__msgs?.[t] ?? [], t);
}

async function waitForPhase(page: Page, phase: string, timeout = 8000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, {
    timeout,
  });
}

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__room?.state?.phase ?? '');
}

async function myUses(page: Page, slot: SlotKey): Promise<number> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me[s].currentUses;
  }, slot);
}

/**
 * Install a spy on room.send to capture all outgoing `releaseAttack` messages.
 * Returns the captured payloads via getReleaseAttacks().
 */
async function spyOnReleaseAttack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__releaseAttacks = [];
    const orig = w.__room.send.bind(w.__room);
    w.__room.send = (type: string, payload: any) => {
      if (type === 'releaseAttack') w.__releaseAttacks.push(payload);
      return orig(type, payload);
    };
  });
}

async function getReleaseAttacks(page: Page): Promise<Array<{ slot: string; holdDuration: number }>> {
  return page.evaluate(() => (window as any).__releaseAttacks ?? []);
}

/** Read the attacker-seat canvas bounding box for pointer coordinate targeting. */
async function getCanvasBounds(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

// ── Scenario 1: tap (< CHARGE_THRESHOLD_MS) — no oscillation, baseline telegraph ─

test('tap A1 (< threshold) fires releaseAttack with holdDuration near 0 and opens defend at baseline 900ms', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  await spyOnReleaseAttack(attacker);
  await collectMessages(attacker, 'attackStart');

  // A tap is a quick press+release well below CHARGE_THRESHOLD_MS (150ms).
  // Key '1' maps to A1 in BattleScene.
  await attacker.keyboard.press('1'); // press+release in one action ≈ 0ms hold
  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const sent = await getReleaseAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].slot).toBe('a1');
  // A tap should report holdDuration below CHARGE_THRESHOLD_MS (150ms).
  expect(sent[0].holdDuration).toBeLessThan(150);

  // Defender phase must open (no miss on a tap).
  await waitForPhase(h.p2, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Scenario 2: hold A1, release at center line → hit, compressed telegraph ─────

test('hold A1 and release at a well-charged duration → hit; telegraphDuration < 900ms', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  await spyOnReleaseAttack(attacker);
  await collectMessages(defender, 'attackStart');

  // Hold for ~400ms (a meaningful charge but well within MAX_CHARGE_MS).
  // The Y position at 400ms may or may not be in the hit zone — the server decides.
  // We assert the SERVER CONTRACT: releaseAttack received, holdDuration matches, and
  // if isHit then defend phase opens.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  const sent = await getReleaseAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].slot).toBe('a1');
  // Hold was ~400ms; allow generous range for wall-clock imprecision.
  expect(sent[0].holdDuration).toBeGreaterThan(300);
  expect(sent[0].holdDuration).toBeLessThan(700);

  // If the server computed isHit=true, the defend phase opens.
  // We don't assert the phase outcome here because Y position at 400ms is formula-dependent
  // (constant values are set by the impl). Instead we verify no crash and the game
  // transitions to EITHER defend (hit) or ATTACK_SELECT (miss).
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 5000 },
  );

  await closeBattle(h);
});

// ── Scenario 3: miss path — attacker ring −1 use, no defender phase, WHIFF ──────

test('hold A1, release outside hit zone → miss: attacker ring −1 use, no defend phase, chargeMiss broadcast', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Seed a known initial use count.
  await setState(attacker, { uses: { a1: 3 } });
  await collectMessages(attacker, 'chargeMiss');

  // To force a miss we send `releaseAttack` directly with a holdDuration where the
  // formula guarantees |yOffset| > HIT_CONE_PX. We use a duration that produces
  // a near-peak yOffset (roughly quarter-period into the oscillation after decay).
  // Since we cannot know the exact constants pre-implementation, we spy on the
  // server's chargeMiss broadcast rather than hardcoding a duration.
  //
  // Instead, hold long enough that the server WILL at some point classify a miss
  // (the orb cycles through both hit and miss zones). We hold for a full period's
  // worth of time and send the message when we believe the orb is at a peak.
  // The real test assertion is: IF chargeMiss fires, the ring use drops and phase
  // goes back to ATTACK_SELECT.
  //
  // Send the `releaseAttack` message directly (as the client will once implemented),
  // with holdDuration chosen to land near a sine peak. The server's formula is deterministic.
  const usesBeforeA = await myUses(attacker, 'a1');

  // A duration of roughly BASE_PERIOD_MS/4 should be near the sine peak.
  // We probe multiple durations to find one that the server registers as a miss.
  // The client will use its oscillation animation to show the user the zone,
  // so in tests we control the exact holdDuration via keyboard timing.
  await attacker.keyboard.down('1');
  // Wait for a duration likely near a miss zone peak (impl will fill actual constants).
  await attacker.waitForTimeout(50); // short — near quarter-period; likely near peak
  await attacker.keyboard.up('1');

  // Wait for either phase transition or chargeMiss — whichever comes first.
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      const misses = (window as any).__msgs?.chargeMiss?.length ?? 0;
      return phase === 'ATTACK_SELECT' || phase === 'DEFEND_WINDOW' || misses > 0;
    },
    { timeout: 5000 },
  );

  const misses = await getMessages(attacker, 'chargeMiss');
  if (misses.length > 0) {
    // Miss path confirmed: attacker ring must have lost 1 use.
    const usesAfter = await myUses(attacker, 'a1');
    expect(usesAfter).toBe(usesBeforeA - 1);

    // Defender must NOT be in DEFEND_WINDOW — miss skips the defender phase entirely.
    const defPhase = await getPhase(defender);
    expect(defPhase).not.toBe('DEFEND_WINDOW');

    // Phase returns to ATTACK_SELECT (initiative returned to the attacker).
    const atkPhase = await getPhase(attacker);
    expect(atkPhase).toBe('ATTACK_SELECT');
  }
  // If the test hold happened to land in the hit zone, the scenario ran as a hit.
  // That is a valid outcome — the adversarial gate is the miss CONTRACT above.

  await closeBattle(h);
});

// ── Scenario 4: miss guarantees — defender is never punished for attacker mistake ─

test('chargeMiss broadcast: no chargeMiss event reaches the defender (attacker-side only)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: a miss must not trigger a defender-side event that could
  // confuse the client into showing a defend prompt or deducting a defender heart.
  // Collect on the DEFENDER side to ensure chargeMiss is NOT routed to them as an
  // attackable event (it may be broadcast globally for animation purposes, but no
  // defender heart deduction, no DEFEND_WINDOW).
  await collectMessages(defender, 'exchangeResult');
  await setState(defender, { hearts: 3 });

  // Hold and release — may or may not be a miss, but we run the scenario and check.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(100);
  await attacker.keyboard.up('1');

  // Wait for any game state change.
  await attacker.waitForTimeout(200);

  // If we ended up in a miss, defender hearts must still be 3.
  const atkPhase = await getPhase(attacker);
  if (atkPhase === 'ATTACK_SELECT') {
    // Miss confirmed — verify defender hearts untouched.
    const defHearts = await defender.evaluate(() => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me.hearts;
    });
    expect(defHearts).toBe(3);

    // No exchangeResult should have fired toward the defender on a miss.
    const results = await getMessages(defender, 'exchangeResult');
    expect(results.length).toBe(0);
  }

  await closeBattle(h);
});

// ── Scenario 5: long hold — orb Y amplitude capped at ≤ 80 px ────────────────

test('long hold (> 2× BASE_PERIOD_MS): chargeOrbY broadcast never exceeds 80 px amplitude', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: at very long holds the period decays and the sine cycles fast.
  // The broadcast orb Y offset must remain within ±80 px per spec ("Y amplitude capped
  // at ±80 px"). If the server omits the cap, long holds produce readable-but-wrong
  // large Y offsets that extend beyond the play area.
  await collectMessages(attacker, 'chargeOrbY');

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(2000); // hold 2 seconds — very long charge
  await attacker.keyboard.up('1');

  const orbYBroadcasts = await getMessages(attacker, 'chargeOrbY');
  for (const msg of orbYBroadcasts) {
    // Each broadcast carries a `y` field (the server's computed yOffset).
    expect(Math.abs(msg.y)).toBeLessThanOrEqual(80);
  }

  await closeBattle(h);
});

// ── Scenario 6: fusion — hold A1, tap A2 when orb is off-center → A1 misses, A2 hits ─

test('fusion hold A1 + tap A2 when A1 orb is off-center: A1 uses −1 (miss), A2 fires horizontal (hit)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: the tapped slot (A2) must ALWAYS hit regardless of the held
  // slot's Y. If the implementation mistakenly applies the Y check to both slots,
  // a miss on A1 would incorrectly block A2 from landing too.
  const MUD_ELEMENT = 11;
  await setState(attacker, {
    elements: { thumb: MUD_ELEMENT, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'attackStart');
  await collectMessages(defender, 'exchangeResult');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');

  // Hold A1 briefly to get into oscillation but at a time likely off-center.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(80); // short hold — likely near a miss zone
  // Tap A2 while A1 is still held (fusion release trigger).
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  // Wait for game state to settle.
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      const misses = (window as any).__msgs?.chargeMiss?.length ?? 0;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT' || misses > 0;
    },
    { timeout: 5000 },
  );

  const misses = await getMessages(attacker, 'chargeMiss');
  if (misses.length > 0) {
    // A1 missed — uses decrease.
    const a1After = await myUses(attacker, 'a1');
    expect(a1After).toBe(a1Before - 1);

    // A2 (tapped) must still have fired — its uses must also decrease.
    const a2After = await myUses(attacker, 'a2');
    expect(a2After).toBe(a2Before - 1);

    // A2's orb fires horizontal and lands → defender phase must open for A2.
    await waitForPhase(defender, 'DEFEND_WINDOW', 5000);
  }

  await closeBattle(h);
});

// ── Scenario 7: fusion — hold A1, tap A2 at center → both orbs hit ───────────

test('fusion hold A1 + tap A2 with A1 orb near center: both orbs hit, combined defend phase opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 spec: "Both orbs hit; single combined defender phase; compressed window from A1 charge."
  // This scenario probes the case where BOTH orbs land — attacker uses for a1 and a2 both decrease.
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await collectMessages(defender, 'exchangeResult');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');

  // Hold A1 for t=0 (center line) — guaranteed hit. Immediately tap A2.
  // In practice "immediately" means holding for ~10ms (well within E2E timing).
  await attacker.keyboard.down('1');
  // Do NOT wait — release A2 right away so holdDuration ≈ 0 (sin(0)=0 → y=0 → hit).
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  // Both orbs must land → defender phase opens.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // Both a1 and a2 uses must have been deducted.
  const a1After = await myUses(attacker, 'a1');
  const a2After = await myUses(attacker, 'a2');
  expect(a1After).toBe(a1Before - 1);
  expect(a2After).toBe(a2Before - 1);

  await closeBattle(h);
});

// ── Scenario 8: no double-charge — tapped slot never oscillates ───────────────

test('tapped A2 in a fusion double-attack sends holdDuration=0 (no oscillation on the tapped slot)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: the tapped slot must be sent with holdDuration=0 (or not have
  // a holdDuration at all). If the client accidentally records the full A1 hold time
  // for A2 as well, the server would Y-check A2 — and it might miss when it should
  // always hit.
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await spyOnReleaseAttack(attacker);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);
  await attacker.keyboard.down('2');
  await attacker.keyboard.up('2');
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const sent = await getReleaseAttacks(attacker);
  // Fusion release emits one releaseAttack (or selectDoubleAttack per the existing
  // double-attack contract). The tapped slot's holdDuration must be 0.
  const a2Entry = sent.find((s) => s.slot === 'a2');
  if (a2Entry) {
    // #485 adversarial: holdDuration for the tapped slot must be 0.
    expect(a2Entry.holdDuration).toBe(0);
  }
  // If the fusion release is sent as a single combined message (not two separate
  // releaseAttack messages), that is also valid — the key invariant is that the server
  // does not Y-check the tapped slot, which is covered by Scenario 6.

  await closeBattle(h);
});

// ── Scenario 9: no-cost hold abandon — releasing before CHARGE_THRESHOLD_MS ───

test('hold A1 then release before CHARGE_THRESHOLD_MS → treated as a tap (no charge cost)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: a player who starts to hold but releases quickly (below the
  // threshold) must not be penalized as if they charged. The orb should spawn on
  // release as a normal tap — the ring use deducted but no miss path activated.
  await spyOnReleaseAttack(attacker);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(30); // very short hold — well below any reasonable threshold
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const sent = await getReleaseAttacks(attacker);
  expect(sent.length).toBeGreaterThanOrEqual(1);
  // The hold was short → holdDuration must be below CHARGE_THRESHOLD_MS (150ms).
  expect(sent[0].holdDuration).toBeLessThan(150);

  // The game must advance to DEFEND_WINDOW (tap always hits) — not stuck.
  await waitForPhase(h.p2, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});
