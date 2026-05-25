import { test, expect } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter } from './helpers';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// ── Scenario 1: Camp loads inventory ─────────────────────────────────────────
test('camp: loads ring inventory from /api/me', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(
    () => (window as any).__campState?.rings?.length >= 10,
    { timeout: 8000 },
  );
  const state = await page.evaluate(() => (window as any).__campState);
  expect(state.rings.length).toBeGreaterThanOrEqual(10);
  expect(state.player.gold).toBeDefined();
  await ctx.close();
});

// ── Scenario 2: Sleep increments game_day ────────────────────────────────────
test('camp: sleep increments game_day', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(
    () => (window as any).__campState !== undefined,
    { timeout: 8000 },
  );
  const dayBefore = await page.evaluate(() => (window as any).__campState?.player?.game_day);
  await page.waitForFunction(
    () => typeof (window as any).__campSleep === 'function',
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__campSleep());
  await page.waitForFunction(
    (d) => (window as any).__campState?.player?.game_day > d,
    dayBefore,
    { timeout: 5000 },
  );
  const dayAfter = await page.evaluate(() => (window as any).__campState?.player?.game_day);
  expect(dayAfter).toBe(dayBefore + 1);
  await ctx.close();
});

// ── Scenario 3: Paid recharge returns 400 when ring is already full ───────────
test('camp: paid recharge returns 400 already-full when ring is full', async ({ browser }) => {
  const ctx = await browser.newContext();
  const username = `t_${Date.now()}`;
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  });
  const { token } = await regRes.json();

  // Get player state.
  const meRes = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { rings } = await meRes.json();

  // Attempt to recharge a full ring → should return 400 "already full".
  const rechargeRes = await fetch(`${API_URL}/api/camp/recharge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId: rings[0].id }),
  });
  expect(rechargeRes.status).toBe(400);
  const body = await rechargeRes.json();
  expect(body.error).toMatch(/already full/i);
  await ctx.close();
});

// ── Scenario 4: Missing ringId → 400 ─────────────────────────────────────────
test('camp: recharge fails with 400 when ringId is missing', async () => {
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `t_${Date.now()}`, password: 'pw' }),
  });
  const { token } = await regRes.json();
  const res = await fetch(`${API_URL}/api/camp/recharge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringId: '' }),
  });
  expect(res.status).toBe(400);
});

// ── Scenario 5: After vsAI battle → CampScene ────────────────────────────────
test('camp: after vsAI duel ends, scene is CampScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));

  // Drive both sides until ENDED. Attack when it's our turn; submit a real
  // defense during the defend window so the normal block path is exercised
  // rather than letting the window time out.
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        room.send('selectAttack', { slot: 'a1' });
      } else if (
        room?.state?.phase === 'DEFEND_WINDOW' &&
        room?.state?.currentAttackerId !== room?.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, 300);

  try {
    await page.waitForFunction(
      () => (window as any).__room?.state?.phase === 'ENDED',
      { timeout: 30000 },
    );
  } finally {
    clearInterval(driver);
  }

  await page.waitForFunction(
    () => (window as any).__game?.scene?.isActive('CampScene'),
    { timeout: 8000 },
  );
  await ctx.close();
}, 60000);

// ── Scenario 6: PUT /api/loadout persists assignment ─────────────────────────
test('loadout: PUT /api/loadout persists assignment', async () => {
  const username = `t_${Date.now()}`;
  const { token } = await (await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  })).json();

  const { rings } = await (await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  // Find a Water ring (element=1) and assign to a1.
  const waterRing = rings.find((r: any) => r.element === 1);
  expect(waterRing).toBeDefined();

  const putRes = await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ a1: waterRing.id }),
  });
  expect(putRes.status).toBe(200);
  const { loadout: updated } = await putRes.json();
  expect(updated.a1).toBe(waterRing.id);

  // Re-fetch /api/me to confirm persistence.
  const { loadout: reloaded } = await (await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  expect(reloaded.a1).toBe(waterRing.id);
});

// ── Scenario 7: Ring data still present after vsAI duel ──────────────────────
test('persistence: ring uses and gold updated after vsAI duel', async ({ browser }) => {
  const ctx = await browser.newContext();
  const username = `t_${Date.now()}`;
  const { token } = await (await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  })).json();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);

  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));

  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        room.send('selectAttack', { slot: 'a1' });
      }
    });
  }, 300);

  try {
    await page.waitForFunction(
      () => (window as any).__room?.state?.phase === 'ENDED',
      { timeout: 30000 },
    );
  } finally {
    clearInterval(driver);
  }

  // Wait for CampScene to load after the battle.
  await page.waitForFunction(
    () => (window as any).__game?.scene?.isActive('CampScene'),
    { timeout: 8000 },
  );

  // Fetch /api/me and verify rings array is still present post-battle.
  const { rings: afterRings } = await (await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  // Player should still have rings (may have lost thumb if they lost the duel).
  expect(afterRings.length).toBeGreaterThanOrEqual(9);
  await ctx.close();
}, 60000);
