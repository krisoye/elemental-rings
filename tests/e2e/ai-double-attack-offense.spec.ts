import { test, expect, type Page } from '@playwright/test';

/**
 * #268 (EPIC #264) — AI double-attack OFFENSE E2E. Drives `battle-ai` BOSS rooms
 * directly via the boss-combat harness (boss-harness.html → E2E server 2568) and
 * asserts on REAL broadcasts (window.__doubleStarts) + authoritative state
 * (room.state.players.get('AI')). No mocks — the AI is a virtual player driven by
 * the server handlers; we only read what it actually broadcast.
 *
 * The three issue scenarios:
 *  1. Eligible boss (Bogwood = MUD, A-slots WATER/EARTH) double-attacks on its turn.
 *  2. A boss whose A-slots are forced ineligible never combos (single attack only).
 *  3. A non-boss (base-thumb) vsAI duel never issues a doubleAttackStart.
 *
 * Element enum (shared/types.ts): WATER=1, EARTH=2, WIND=3, WOOD=4, FIRE=0; MUD=11.
 */
const HARNESS = 'http://localhost:8090/e2e/boss-harness.html';

const FIRE = 0;
const WATER = 1;
const EARTH = 2;
const MUD = 11;

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => typeof (window as any).connectBoss === 'function', {
    timeout: 10000,
  });
}

async function joinBoss(page: Page, npcId: string, personality: string, extra: object = {}): Promise<void> {
  await page.evaluate(
    ([id, p, ex]) =>
      (window as any).connectBoss({ vsAI: true, personality: p, aiSeed: 12345, npcId: id, ...(ex as object) }),
    [npcId, personality, extra] as const,
  );
  await page.evaluate(() => (window as any).onRoomReady());
}

/** Poll the page for a predicate over the live room, or fail after `timeout`. */
async function waitForRoom(page: Page, pred: string, timeout = 12000): Promise<void> {
  await page.waitForFunction(
    (p) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('room', `return (${p});`);
      return fn((window as any).roomState ? (window as any).roomState() : null);
    },
    pred,
    { timeout },
  );
}

test('scenario 1: eligible boss (MUD) initiates a double attack — two orbs fire', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await joinBoss(page, 'forest_bogwood_warden', 'DEFENSIVE');

  // The MUD boss attacks first; A2=EARTH is uncounterable → the combo is favorable.
  // Extinguish the human's defense rings so there is unambiguously no parry threat.
  await page.evaluate(() =>
    (window as any).setSelfState({ uses: { d1: 0, d2: 0 } }),
  );

  // Confirm the boss staked the MUD fusion before its turn (eligible hand).
  const aiBefore = await page.evaluate(() => (window as any).aiState());
  expect(aiBefore.thumb.element).toBe(MUD);
  expect(aiBefore.thumb.isFusion).toBe(true);

  // Wait for the AI to commit its combo (a doubleAttackStart broadcast). The two
  // orbs flying IS the double attack — use counts are asserted in the integration
  // test (under E2E_FAST the combo resolves too fast to read a stable post-commit
  // snapshot here, so we assert on the authoritative broadcast instead).
  await page.waitForFunction(() => (window as any).__doubleStarts.length > 0, { timeout: 12000 });
  const starts = await page.evaluate(() => (window as any).__doubleStarts);
  expect(starts.length).toBeGreaterThanOrEqual(1);
  // Both attack slots fire — the two components of MUD.
  expect(new Set([starts[0].first, starts[0].second])).toEqual(new Set(['a1', 'a2']));
  expect(starts[0].secondElements.length).toBe(1); // base-ring orb (single element)

  await ctx.close();
});

test('scenario 2: a boss with forced-ineligible A-slots never combos (single attack only)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  await joinBoss(page, 'forest_bogwood_warden', 'AGGRESSIVE');

  // Keep the MUD fused thumb but break the A-slot composition (a1=FIRE, a2=WATER ≠
  // componentsOf(MUD)={WATER,EARTH}) → canDoubleAttack is false → no combo.
  await page.evaluate(
    ([fire, water]) =>
      (window as any).setOpponentState({ elements: { a1: fire, a2: water }, uses: { a1: 3, a2: 3 } }),
    [FIRE, WATER] as const,
  );

  // Drive the AI through its first attack: it must reach a DEFEND_WINDOW via a
  // SINGLE attack, never a double. Wait for the window, then assert no combo fired.
  await waitForRoom(page, "room && room.phase === 'DEFEND_WINDOW'");
  const starts = await page.evaluate(() => (window as any).__doubleStarts);
  expect(starts.length).toBe(0);

  await ctx.close();
});

test('scenario 3: a non-boss (base-thumb) vsAI duel never issues a double attack', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await openHarness(page);
  // No npcId → base-thumb AI → canDoubleAttack always false.
  await page.evaluate(() =>
    (window as any).connectBoss({ vsAI: true, personality: 'AGGRESSIVE', aiSeed: 7 }),
  );
  await page.evaluate(() => (window as any).onRoomReady());

  const ai = await page.evaluate(() => (window as any).aiState());
  expect(ai.thumb.isFusion).toBe(false);

  // Drive many turns: single-attack on the human's turn, let the AI act on its
  // turns. The base-thumb AI must NEVER emit a doubleAttackStart.
  await page.evaluate(async () => {
    const w = window as any;
    for (let i = 0; i < 40; i++) {
      const s = w.roomState();
      if (s.phase === 'ENDED') break;
      if (s.phase === 'ATTACK_SELECT' && s.currentAttackerId === w.sessionId()) {
        w.sendAttack('a1');
      } else if (s.phase === 'DEFEND_WINDOW' && s.currentAttackerId !== w.sessionId()) {
        w.sendDefense('d1');
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  });

  const starts = await page.evaluate(() => (window as any).__doubleStarts);
  expect(starts.length).toBe(0);

  await ctx.close();
});
