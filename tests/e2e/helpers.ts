import type { Browser, Page, BrowserContext } from '@playwright/test';

const URL = 'http://localhost:8080';

export interface BattleHandles {
  p1: Page;
  p2: Page;
  p1ctx: BrowserContext;
  p2ctx: BrowserContext;
}

/**
 * Open two independent browser contexts (two distinct Colyseus sessions) and
 * drive them into a live battle. p1 connects first and creates the room; p2
 * joins it. Resolves once both pages observe the ATTACK_SELECT phase (both
 * duelists joined and the server has started the battle).
 */
export async function setupBattle(browser: Browser): Promise<BattleHandles> {
  const p1ctx = await browser.newContext({ hasTouch: true });
  const p2ctx = await browser.newContext({ hasTouch: true });
  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  await p1.goto(URL);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });

  return { p1, p2, p1ctx, p2ctx };
}

/** Determine which page is the current attacker / defender from server state. */
export async function attackerDefender(
  p1: Page,
  p2: Page,
): Promise<{ attacker: Page; defender: Page }> {
  const p1IsAttacker = await p1.evaluate(
    () => (window as any).__room?.sessionId === (window as any).__room?.state?.currentAttackerId,
  );
  return p1IsAttacker ? { attacker: p1, defender: p2 } : { attacker: p2, defender: p1 };
}

/** Wait until the page records a non-null exchange result. */
export async function waitForExchangeResult(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(() => (window as any).__lastExchangeResult !== null, { timeout });
}

/**
 * Wait until the local player's hearts equal the expected value. The
 * `exchangeResult` message and the BattleState heart/use diffs are delivered
 * separately, so tests must wait for the diff to apply before asserting on
 * state — not just for the message.
 */
export async function waitForMyHearts(page: Page, hearts: number, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (h) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return me?.hearts === h;
    },
    hearts,
    { timeout },
  );
}

/** Wait until a specific ring's remaining uses equal the expected value. */
export async function waitForMyRingUses(
  page: Page,
  slot: number,
  uses: number,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    ({ s, u }) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return me?.hand?.[s]?.currentUses === u;
    },
    { s: slot, u: uses },
    { timeout },
  );
}

/** Wait until a named gauge on the local player reaches the expected value. */
export async function waitForMyGauge(
  page: Page,
  key: string,
  value: number,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    ({ k, v }) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return (me?.[k] ?? 0) === v;
    },
    { k: key, v: value },
    { timeout },
  );
}

/** Read the local player's current PlayerState as a plain JS snapshot. */
export async function readMe(page: Page): Promise<any> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    const me = room?.state?.players?.get(room.sessionId);
    if (!me) return null;
    return {
      hearts: me.hearts,
      fireGauge: me.fireGauge ?? 0,
      waterGauge: me.waterGauge ?? 0,
      earthGauge: me.earthGauge ?? 0,
      windGauge: me.windGauge ?? 0,
      woodGauge: me.woodGauge ?? 0,
      hand: Array.from({ length: me.hand.length }, (_, i) => ({
        element: me.hand[i].element,
        currentUses: me.hand[i].currentUses,
        isExtinguished: me.hand[i].isExtinguished,
      })),
    };
  });
}

export async function closeBattle(handles: BattleHandles): Promise<void> {
  await handles.p1ctx.close();
  await handles.p2ctx.close();
}
