import type { Browser, Page, BrowserContext } from '@playwright/test';

const URL = 'http://localhost:8080';

export interface BattleHandles {
  p1: Page;
  p2: Page;
  p1ctx: BrowserContext;
  p2ctx: BrowserContext;
}

/** Wait until the EncounterScene hub is active and its selection hook is ready. */
export async function waitForEncounter(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as any).__scene === null &&
      typeof (window as any).__encounterSelect === 'function',
    { timeout: 10000 },
  );
}

/**
 * Open two independent browser contexts (two distinct Colyseus sessions) and
 * drive them into a live PvP battle. After the Phase-3 routing change the page
 * lands in the EncounterScene and connects to nothing until a selection fires,
 * so each page triggers the PvP path via the deterministic `__encounterSelect`
 * hook (identical code path to clicking the PvP marker → LobbyScene →
 * connectToRoom('battle')). p1 selects first so it creates the `battle` room;
 * p2 then joins the same room. Resolves once both pages observe ATTACK_SELECT.
 */
export async function setupBattle(browser: Browser): Promise<BattleHandles> {
  const p1ctx = await browser.newContext({ hasTouch: true });
  const p2ctx = await browser.newContext({ hasTouch: true });
  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  // p1 selects PvP first (creates the room) and connects before p2 joins it.
  await p1.goto(URL);
  await waitForEncounter(p1);
  await p1.evaluate(() => (window as any).__encounterSelect('PVP'));
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await waitForEncounter(p2);
  await p2.evaluate(() => (window as any).__encounterSelect('PVP'));

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
