import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { waitForEncounter, campToEncounter, seedAuthToken } from './helpers';

// #211 — spirit gauge in the battle HUD + recharge feedback. These specs drive a
// REAL vsAI duel (the human is seated with their token loadout, so their rings
// recharge against the same DB player whose spirit /api/test/set-spirit seeds).
// Every assertion reads authoritative broadcast state (window.__room.state), the
// scene's published HUD view (window.__hudView), or the per-client recharge
// result (window.__lastRechargeResult) — never pixels. The recharge MUTATION runs
// through BattleRoom.handleRecharge via the live `recharge` message, exactly as a
// double-tap gesture would send it.

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Seat auth, navigate Camp → Encounter, select a vsAI personality. Returns the page. */
async function startAIDuel(ctx: BrowserContext, personality = 'AGGRESSIVE'): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate((p) => (window as any).__encounterSelect(p), personality);
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  // Wait until the BattleScene has mounted and published its first HUD view.
  await page.waitForFunction(() => (window as any).__hudView !== undefined, { timeout: 8000 });
  return page;
}

/** Wait until it is the HUMAN's turn in ATTACK_SELECT (so a recharge is accepted). */
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

/** The auth token minted into this page's localStorage by seedAuthToken. */
async function tokenOf(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('er_token') as string);
}

/** Set the authenticated player's spirit_current to an exact value (test route). */
async function setSpirit(token: string, spirit: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spirit }),
  });
  if (!res.ok) throw new Error(`/api/test/set-spirit failed (${res.status})`);
}

/** Seed the HUMAN seat's per-slot currentUses (self-target __testSetState). */
async function setMyUses(page: Page, uses: Record<string, number>): Promise<void> {
  await page.evaluate((u) => (window as any).__room.send('__testSetState', { uses: u }), uses);
}

/** Read one of the HUMAN seat's combat-ring snapshots from broadcast state. */
async function readMySlot(
  page: Page,
  slot: string,
): Promise<{ currentUses: number; maxUses: number }> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return { currentUses: me[s].currentUses, maxUses: me[s].maxUses };
  }, slot);
}

/** Read the HUMAN seat's broadcast spirit (current / max). */
async function readMySpirit(page: Page): Promise<{ current: number; max: number }> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return { current: me.spiritCurrent, max: me.spiritMax };
  });
}

// ── Scenario 1: spirit readout reflects the DB ───────────────────────────────
test('spirit readout reflects DB-seeded balance after join', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx);
  const token = await tokenOf(page);

  // Set spirit to 30, then re-enter a fresh duel so onJoin re-reads the DB.
  await setSpirit(token, 30);
  await page.evaluate(() => (window as any).__room?.leave());
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  // Broadcast state carries the seeded balance; the HUD view renders '30/<max>'.
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return me?.spiritCurrent === 30 && me?.spiritMax > 0;
    },
    { timeout: 8000 },
  );
  const spirit = await readMySpirit(page);
  expect(spirit.current).toBe(30);
  expect(spirit.max).toBeGreaterThan(0);

  await page.waitForFunction(
    (max) => (window as any).__hudView?.spirit === `30/${max}`,
    spirit.max,
    { timeout: 8000 },
  );
  await ctx.close();
});

// ── Scenario 2: recharge decrements spirit and restores uses ─────────────────
test('recharge decrements spirit and restores ring uses; HUD updates', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx);
  const token = await tokenOf(page);

  await setSpirit(token, 5);
  await waitForHumanTurn(page);

  // Deplete a1 to 1 use (cost = maxUses − 1) so a recharge has uses to restore.
  await setMyUses(page, { a1: 1 });
  await page.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });
  const before = await readMySlot(page, 'a1');
  const beforeSpirit = await readMySpirit(page);
  expect(beforeSpirit.current).toBe(5);

  // Recharge a1 (same message a double-tap of the a1 key sends).
  await page.evaluate(() => (window as any).__room.send('recharge', { slot: 'a1' }));

  // a1 is restored toward max and spirit drops by the uses restored (1 spirit each).
  await page.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses > 1;
  }, { timeout: 5000 });
  const after = await readMySlot(page, 'a1');
  const afterSpirit = await readMySpirit(page);
  const restored = after.currentUses - before.currentUses;
  expect(restored).toBeGreaterThan(0);
  expect(afterSpirit.current).toBe(beforeSpirit.current - restored);

  // The HUD readout reflects the post-spend balance.
  await page.waitForFunction(
    (s) => (window as any).__hudView?.spirit === s,
    `${afterSpirit.current}/${afterSpirit.max}`,
    { timeout: 5000 },
  );
  await ctx.close();
});

// ── Scenario 3: insufficient spirit → feedback, nothing restored, turn consumed ─
test('recharge with zero spirit flashes feedback, restores nothing, consumes turn', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx);
  const token = await tokenOf(page);

  await setSpirit(token, 0);
  await waitForHumanTurn(page);

  // Deplete a1 to 0 so cost > 0 but spirit can't cover any of it.
  await setMyUses(page, { a1: 0 });
  await page.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 0;
  }, { timeout: 4000 });
  const before = await readMySlot(page, 'a1');

  await page.evaluate(() => (window as any).__room.send('recharge', { slot: 'a1' }));

  // rechargeResult: nothing restored, but the ring WAS missing uses (requested > 0).
  await page.waitForFunction(
    () => {
      const r = (window as any).__lastRechargeResult;
      return r && r.slot === 'a1' && r.restored === 0 && r.requested > 0;
    },
    { timeout: 5000 },
  );
  const result = await page.evaluate(() => (window as any).__lastRechargeResult);
  expect(result.restored).toBe(0);
  expect(result.spiritCurrent).toBe(0);

  // Ring unchanged (still 0), but the turn was consumed → no longer the human's
  // ATTACK_SELECT turn (the §6.3 rule: recharge always consumes the turn).
  const after = await readMySlot(page, 'a1');
  expect(after.currentUses).toBe(before.currentUses);
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return !(
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === room.sessionId
      );
    },
    { timeout: 5000 },
  );
  await ctx.close();
});

// ── Scenario 4: partial recharge → caps at affordable, flashes partial feedback ─
test('partial recharge caps uses at affordable and reports the shortfall', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx);
  const token = await tokenOf(page);

  await setSpirit(token, 1);
  await waitForHumanTurn(page);

  // Deplete a1 so it is missing 3 uses (cost = 3) but spirit (1) covers only 1.
  await setMyUses(page, { a1: 0 });
  await page.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses === 0 && me.a1.maxUses >= 3;
  }, { timeout: 4000 });
  const before = await readMySlot(page, 'a1');
  const cost = before.maxUses - before.currentUses;
  expect(cost).toBeGreaterThanOrEqual(3);

  await page.evaluate(() => (window as any).__room.send('recharge', { slot: 'a1' }));

  // rechargeResult: restored exactly 1 (affordable), requested = cost; spirit → 0.
  await page.waitForFunction(
    () => {
      const r = (window as any).__lastRechargeResult;
      return r && r.slot === 'a1' && r.restored === 1;
    },
    { timeout: 5000 },
  );
  const result = await page.evaluate(() => (window as any).__lastRechargeResult);
  expect(result.restored).toBe(1);
  expect(result.requested).toBe(cost);
  expect(result.spiritCurrent).toBe(0);

  // Ring capped at affordable (+1 use); broadcast spirit drained to 0.
  await page.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses === 1 && me.spiritCurrent === 0;
  }, { timeout: 5000 });
  await ctx.close();
});
