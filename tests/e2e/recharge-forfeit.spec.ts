import { test, expect, type Page, type Browser } from '@playwright/test';
import { campToEncounter, waitForEncounter } from './helpers';

// #124 — Recharge + Forfeit turn actions, and the removal of auto-forfeit. These
// drive a TOKEN-backed PvP duel (both contexts authenticated, so the server
// persists spirit/gold/rings) and assert authoritative broadcast room state +
// DB reads via /api/me. The recharge/forfeit MUTATIONS run through the real
// Colyseus message handlers; nothing is mocked.

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Mint a fresh token-backed player via the test route. */
async function mintToken(): Promise<{ token: string; playerId: string }> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return res.json();
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function setGold(token: string, gold: number): Promise<void> {
  await fetch(`${API_URL}/api/test/set-gold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ gold }),
  });
}

async function setSpirit(token: string, spirit: number): Promise<void> {
  await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spirit }),
  });
}

async function createRoomId(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/create-battle-room`, { method: 'POST' });
  return (await res.json()).roomId;
}

interface Duel {
  p1: Page;
  p2: Page;
  t1: string;
  t2: string;
  close: () => Promise<void>;
}

/**
 * Build a TWO-context token-backed PvP duel (mirrors helpers.setupBattle but with
 * tokens the test controls, so spirit/gold/ring persistence can be seeded + read
 * via /api/me). Both pages reach ATTACK_SELECT before returning.
 */
async function tokenDuel(browser: Browser): Promise<Duel> {
  const { token: t1 } = await mintToken();
  const { token: t2 } = await mintToken();
  const c1 = await browser.newContext({ hasTouch: true });
  const c2 = await browser.newContext({ hasTouch: true });
  await c1.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(t1)})`);
  await c2.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(t2)})`);
  const p1 = await c1.newPage();
  const p2 = await c2.newPage();

  const roomId = await createRoomId();
  await p1.goto(URL);
  await campToEncounter(p1);
  await waitForEncounter(p1);
  await p1.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await campToEncounter(p2);
  await waitForEncounter(p2);
  await p2.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });

  return { p1, p2, t1, t2, close: async () => { await c1.close(); await c2.close(); } };
}

/** Which page is the current attacker, and the matching token. */
async function attackerOf(d: Duel): Promise<{ page: Page; token: string; otherPage: Page }> {
  const p1IsAttacker = await d.p1.evaluate(
    () => (window as any).__room.sessionId === (window as any).__room.state.currentAttackerId,
  );
  return p1IsAttacker
    ? { page: d.p1, token: d.t1, otherPage: d.p2 }
    : { page: d.p2, token: d.t2, otherPage: d.p1 };
}

async function setState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

async function readSlot(page: Page, slot: string): Promise<{ currentUses: number; maxUses: number }> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return { currentUses: me[s].currentUses, maxUses: me[s].maxUses };
  }, slot);
}

// ── Scenario 1: no more auto-forfeit ─────────────────────────────────────────
test('No auto-forfeit: an attacker with both attack rings extinguished is not defeated', async ({
  browser,
}) => {
  const d = await tokenDuel(browser);
  const atk = await attackerOf(d);

  // Extinguish both attack rings on the current attacker. Pre-#124 this would
  // auto-forfeit; now the duel stays live in ATTACK_SELECT.
  await setState(atk.page, { uses: { a1: 0, a2: 0 } });
  await atk.page.waitForTimeout(200);

  const phase = await atk.page.evaluate(() => (window as any).__room.state.phase);
  const winnerId = await atk.page.evaluate(() => (window as any).__room.state.winnerId);
  expect(phase).toBe('ATTACK_SELECT');
  expect(winnerId).toBeFalsy();

  await d.close();
});

// ── Scenario 2: recharge at full spirit restores the ring fully ──────────────
test('Recharge full: a1 0→max, spirit deducted by the deficit, turn advances', async ({
  browser,
}) => {
  const d = await tokenDuel(browser);
  const atk = await attackerOf(d);

  // Drop a1 to 0 uses. (Mint-token players start with full spirit ≥ the deficit.)
  await setState(atk.page, { uses: { a1: 0 } });
  const { maxUses } = await readSlot(atk.page, 'a1');
  const before = await getMe(atk.token);
  const spiritBefore = before.player.spirit_current;
  const deficit = maxUses; // 0 → max

  await atk.page.evaluate(() => (window as any).__room.send('recharge', { slot: 'a1' }));

  // Ring restored to max on the broadcast state.
  await atk.page.waitForFunction(
    (m) => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me.a1.currentUses === m;
    },
    maxUses,
    { timeout: 5000 },
  );

  const after = await readSlot(atk.page, 'a1');
  expect(after.currentUses).toBe(maxUses);

  // Turn advanced to the opponent.
  const attackerNow = await atk.page.evaluate(() => (window as any).__room.state.currentAttackerId);
  const myId = await atk.page.evaluate(() => (window as any).__room.sessionId);
  expect(attackerNow).not.toBe(myId);

  // Spirit deducted by exactly the deficit (DB-backed).
  const me = await getMe(atk.token);
  expect(me.player.spirit_current).toBe(spiritBefore - deficit);

  await d.close();
});

// ── Scenario 3: recharge with insufficient spirit → partial restore ──────────
test('Recharge partial: spirit 1 restores only 1 use, spirit → 0, turn advances', async ({
  browser,
}) => {
  const d = await tokenDuel(browser);
  const atk = await attackerOf(d);

  // Seed exactly 1 spirit and a fully-spent a1 (deficit = maxUses ≥ 2). The
  // affordable restore is min(deficit, 1) = 1 use; spirit drops to 0.
  await setSpirit(atk.token, 1);
  await setState(atk.page, { uses: { a1: 0 } });
  const { maxUses } = await readSlot(atk.page, 'a1');
  expect(maxUses).toBeGreaterThanOrEqual(2); // so a full recharge would need > 1 spirit

  await atk.page.evaluate(() => (window as any).__room.send('recharge', { slot: 'a1' }));

  await atk.page.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses === 1; // only the 1 affordable use restored
  }, { timeout: 5000 });

  const after = await readSlot(atk.page, 'a1');
  expect(after.currentUses).toBe(1); // partial restore (paid for 1)

  // Turn still consumed → opponent attacks next.
  const advanced = await atk.page.evaluate(() => {
    const room = (window as any).__room;
    return room.state.phase === 'ATTACK_SELECT' &&
      room.state.currentAttackerId !== room.sessionId;
  });
  expect(advanced).toBe(true);

  const me = await getMe(atk.token);
  expect(me.player.spirit_current).toBe(0); // spirit spent to 0

  await d.close();
});

// ── Scenario 4: forfeit transfers the staked ring + deducts 25 gold ──────────
test('Forfeit: forfeiter loses the duel, loses the staked thumb ring, and 25 gold', async ({
  browser,
}) => {
  const d = await tokenDuel(browser);
  const atk = await attackerOf(d);

  await setGold(atk.token, 50);
  const before = await getMe(atk.token);
  const thumbRingId = before.loadout.thumb;
  expect(thumbRingId).toBeTruthy();

  const myId = await atk.page.evaluate(() => (window as any).__room.sessionId);
  await atk.page.evaluate(() => (window as any).__room.send('forfeit'));

  await atk.page.waitForFunction(
    (id) =>
      (window as any).__room.state.phase === 'ENDED' &&
      (window as any).__room.state.winnerId &&
      (window as any).__room.state.winnerId !== id,
    myId,
    { timeout: 6000 },
  );

  const me = await getMe(atk.token);
  expect(me.player.gold).toBe(25); // 50 − 25 penalty
  // The staked thumb ring is no longer owned by the forfeiter (transferred away).
  const stillOwns = me.rings.some((r: any) => r.id === thumbRingId);
  expect(stillOwns).toBe(false);

  await d.close();
});

// ── Scenario 5: forfeit gold penalty floors at 0 ─────────────────────────────
test('Forfeit gold floor: forfeiting with 10 gold ends at 0, not −15', async ({ browser }) => {
  const d = await tokenDuel(browser);
  const atk = await attackerOf(d);

  await setGold(atk.token, 10);
  const myId = await atk.page.evaluate(() => (window as any).__room.sessionId);
  await atk.page.evaluate(() => (window as any).__room.send('forfeit'));

  await atk.page.waitForFunction(
    (id) =>
      (window as any).__room.state.phase === 'ENDED' &&
      (window as any).__room.state.winnerId &&
      (window as any).__room.state.winnerId !== id,
    myId,
    { timeout: 6000 },
  );

  const me = await getMe(atk.token);
  expect(me.player.gold).toBe(0); // floored — never negative

  await d.close();
});
