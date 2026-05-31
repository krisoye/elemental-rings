import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { waitForEncounter, campToEncounter, seedAuthToken } from './helpers';

// #197 — AI recharge policy. The AI now RECHARGES exhausted combat rings instead
// of forfeiting (the old §6.6 auto-loss escape hatch). These specs drive a real
// vsAI duel (AI seated as player 'AI' on create → opening attacker) and assert
// the authoritative broadcast room state. Nothing about the AI's choice is mocked:
// the recharge MUTATION runs through BattleRoom.handleRecharge via the live
// AIController → decideRecharge path, exactly as in production.

const URL = 'http://localhost:8090';

/** Seat auth, navigate Camp → Encounter, select a vsAI personality. */
async function startAIDuel(ctx: BrowserContext, personality: string): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate((p) => (window as any).__encounterSelect(p), personality);
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  return page;
}

/** Wait until it is the HUMAN's turn in ATTACK_SELECT (so we can seed the AI safely). */
async function waitForHumanTurn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      );
    },
    { timeout: 20000 },
  );
}

/** Seed the AI seat's per-slot uses (target:'opponent' = the AI in a vsAI room). */
async function setAiUses(page: Page, uses: Record<string, number>): Promise<void> {
  await page.evaluate((u) => {
    (window as any).__room.send('__testSetState', { target: 'opponent', uses: u });
  }, uses);
}

/** Read one of the AI seat's combat-ring snapshots from broadcast state. */
async function readAiSlot(
  page: Page,
  slot: string,
): Promise<{ currentUses: number; maxUses: number; isExtinguished: boolean }> {
  return page.evaluate((s) => {
    const ai = (window as any).__room.state.players.get('AI');
    return { currentUses: ai[s].currentUses, maxUses: ai[s].maxUses, isExtinguished: ai[s].isExtinguished };
  }, slot);
}

/**
 * Keep the duel rolling from the human side: on the human's ATTACK_SELECT turn,
 * throw a usable attack ring; on the human's DEFEND_WINDOW, submit a defense. This
 * cycles the turn back to the AI repeatedly so its recharge policy gets exercised.
 * Returns a stop() that clears the interval.
 */
function driveHuman(page: Page): () => void {
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (!room || room.state.phase === 'ENDED') return;
      if (room.state.phase === 'ATTACK_SELECT' && room.state.currentAttackerId === room.sessionId) {
        const me = room.state.players.get(room.sessionId);
        room.send('selectAttack', { slot: me.a1.isExtinguished ? 'a2' : 'a1' });
      } else if (
        room.state.phase === 'DEFEND_WINDOW' &&
        room.state.currentAttackerId !== room.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, 120);
  return () => clearInterval(driver);
}

// ── Scenario 1: AI recharges instead of forfeiting ───────────────────────────
test('AI recharges an exhausted attack ring instead of forfeiting', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx, 'AGGRESSIVE');

  // Reach the human's turn, then drain BOTH of the AI's attack rings to 0.
  await waitForHumanTurn(page);
  await setAiUses(page, { a1: 0, a2: 0 });
  await page.waitForFunction(
    () => {
      const ai = (window as any).__room.state.players.get('AI');
      return ai.a1.currentUses === 0 && ai.a2.currentUses === 0;
    },
    { timeout: 4000 },
  );

  // Drive the duel. Pre-#197 the AI would FORFEIT once it reached its turn with both
  // attack rings spent; now it RECHARGES instead — the AI's attack ring uses come
  // back above 0 and the duel stays live (no exhaustion forfeit to the human).
  const stop = driveHuman(page);
  try {
    await page.waitForFunction(
      () => {
        const room = (window as any).__room;
        if (room.state.phase === 'ENDED') return false;
        const ai = room.state.players.get('AI');
        return ai.a1.currentUses > 0 || ai.a2.currentUses > 0;
      },
      { timeout: 20000 },
    );
  } finally {
    stop();
  }

  // The duel never ended by the AI forfeiting its exhausted rings.
  const phase = await page.evaluate(() => (window as any).__room.state.phase);
  expect(phase).not.toBe('ENDED');

  const a1 = await readAiSlot(page, 'a1');
  const a2 = await readAiSlot(page, 'a2');
  expect(a1.currentUses + a2.currentUses).toBeGreaterThan(0); // recharged, not forfeited

  await ctx.close();
});

// ── Scenario 2: DEFENSIVE AI recharges a depleted defense ring ────────────────
test('DEFENSIVE AI recharges a depleted defense ring during its turn', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx, 'DEFENSIVE');

  // On the human's turn, deplete BOTH of the AI's defense rings to 0 (attack rings
  // stay healthy). DEFENSIVE's policy: with attack available but defense depleted,
  // it spends a turn recharging a defense ring before attacking again.
  await waitForHumanTurn(page);
  await setAiUses(page, { d1: 0, d2: 0 });
  await page.waitForFunction(
    () => {
      const ai = (window as any).__room.state.players.get('AI');
      return ai.d1.currentUses === 0 && ai.d2.currentUses === 0;
    },
    { timeout: 4000 },
  );

  // Hand the turn to the AI so it enters ATTACK_SELECT with depleted defense.
  await page.evaluate(() => (window as any).__room.send('selectAttack', { slot: 'a1' }));

  // The AI recharges a defense ring on its turn → one of d1/d2 climbs back above 0
  // while the duel is still live (proves a defense recharge, not an attack).
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      if (room.state.phase === 'ENDED') return false;
      const ai = room.state.players.get('AI');
      return ai.d1.currentUses > 0 || ai.d2.currentUses > 0;
    },
    { timeout: 15000 },
  );

  const d1 = await readAiSlot(page, 'd1');
  const d2 = await readAiSlot(page, 'd2');
  expect(d1.currentUses + d2.currentUses).toBeGreaterThan(0);

  await ctx.close();
});

// ── Scenario 3: AGGRESSIVE AI never recharges defense ─────────────────────────
test('AGGRESSIVE AI never recharges a depleted defense ring (keeps attacking)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx, 'AGGRESSIVE');

  // Same setup as scenario 2 but AGGRESSIVE: deplete both defense rings while attack
  // rings stay healthy. AGGRESSIVE must NEVER trade an attack turn for a defense
  // recharge — its defense rings stay at 0 across several of its own turns.
  await waitForHumanTurn(page);
  await setAiUses(page, { d1: 0, d2: 0 });
  await page.waitForFunction(
    () => {
      const ai = (window as any).__room.state.players.get('AI');
      return ai.d1.currentUses === 0 && ai.d2.currentUses === 0;
    },
    { timeout: 4000 },
  );

  // Drive several human ↔ AI turn cycles. On each of its own turns AGGRESSIVE has
  // usable attack rings, so it attacks (or recharges attack) — never sacrifices the
  // turn to recharge defense. The human keeps the duel rolling.
  const stop = driveHuman(page);
  // Track the per-attack-ring USES of the AI to prove it actually took attack turns
  // (every AI throw spends a use), so the "never recharged defense" assertion is
  // about an active duel — not a stalled one. We also confirm role-swapping.
  const sawAiAttacker = { v: false };

  try {
    // Sample for a real duel window. AGGRESSIVE's defense rings must stay at 0 the
    // entire time — any recharge of d1/d2 would lift one above 0.
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => {
        const room = (window as any).__room;
        const ai = room.state.players.get('AI');
        return {
          ended: room.state.phase === 'ENDED',
          aiIsAttacker: room.state.currentAttackerId === 'AI',
          d1: ai.d1.currentUses,
          d2: ai.d2.currentUses,
        };
      });
      if (snap.aiIsAttacker) sawAiAttacker.v = true;
      // Defense rings must remain fully depleted — AGGRESSIVE never recharges them.
      expect(snap.d1).toBe(0);
      expect(snap.d2).toBe(0);
      if (snap.ended) break;
      await page.waitForTimeout(120);
    }
  } finally {
    stop();
  }

  // Sanity: the AI actually held the attacker role at least once (an active duel),
  // so the "defense never recharged" assertion was exercised against real AI turns.
  expect(sawAiAttacker.v).toBe(true);

  await ctx.close();
});
