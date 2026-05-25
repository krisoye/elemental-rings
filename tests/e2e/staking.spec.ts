import { test, expect } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter, setupBattle } from './helpers';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

async function registerAndToken(): Promise<string> {
  const username = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pw' }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function putLoadout(token: string, partial: Record<string, string | null>): Promise<void> {
  await fetch(`${API_URL}/api/loadout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(partial),
  });
}

// ── #31 Scenario 1: Kindling buffs Fire rings at duel start ──────────────────
test('passive: Kindling buffs Fire rings at duel start', async ({ browser }) => {
  // Starter loadout: thumb=Fire(element=0), a1=Fire → Kindling fires: a1 gets +1 use.
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));

  // Wait for ATTACK_SELECT (seatPlayer ran, Kindling applied).
  await page.waitForFunction(
    () => (window as any).__room?.state?.phase === 'ATTACK_SELECT',
    { timeout: 10000 },
  );

  const myId = await page.evaluate(() => (window as any).__room?.sessionId);
  const [a1Uses, thumbUses] = await page.evaluate((id) => {
    const me = (window as any).__room?.state?.players?.get(id);
    return [me?.a1?.currentUses, me?.thumb?.currentUses];
  }, myId);

  // Fire thumb (3 uses) buffs Fire a1: a1→4, thumb→2.
  expect(a1Uses).toBe(4);
  expect(thumbUses).toBe(2);
  await ctx.close();
});

// ── #31 Scenario 4: Tailwind pays attack cost from thumb ─────────────────────
test('passive: Tailwind redirects attack use cost to Wind thumb', async ({ browser }) => {
  const ctx = await browser.newContext();
  const token = await registerAndToken();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);

  // Find a Wind ring and assign it to thumb.
  const { rings } = await getMe(token);
  const windRing = rings.find((r: any) => r.element === 3); // WIND=3
  expect(windRing).toBeDefined();
  await putLoadout(token, { thumb: windRing.id });

  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));

  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' &&
      (window as any).__room?.state?.currentAttackerId === (window as any).__room?.sessionId,
    { timeout: 15000 },
  );

  const myId = await page.evaluate(() => (window as any).__room?.sessionId);
  const a1UsesBefore = await page.evaluate(
    (id) => (window as any).__room?.state?.players?.get(id)?.a1?.currentUses,
    myId,
  );
  const thumbBefore = await page.evaluate(
    (id) => (window as any).__room?.state?.players?.get(id)?.thumb?.currentUses,
    myId,
  );

  // Throw a1 once (Wind thumb should pay the use cost via Tailwind).
  await page.evaluate(() => (window as any).__room?.send('selectAttack', { slot: 'a1' }));
  await page.waitForFunction(
    () => (window as any).__room?.state?.phase !== 'ATTACK_SELECT',
    { timeout: 5000 },
  );
  // Wait for next ATTACK_SELECT or ENDED so the turn fully resolves.
  await page.waitForFunction(
    () => ['ATTACK_SELECT', 'ENDED'].includes((window as any).__room?.state?.phase),
    { timeout: 8000 },
  );

  const a1UsesAfter = await page.evaluate(
    (id) => (window as any).__room?.state?.players?.get(id)?.a1?.currentUses,
    myId,
  );
  const thumbAfter = await page.evaluate(
    (id) => (window as any).__room?.state?.players?.get(id)?.thumb?.currentUses,
    myId,
  );

  // Tailwind: thumb pays instead of a1.
  expect(a1UsesAfter).toBe(a1UsesBefore); // a1 unchanged
  expect(thumbAfter).toBe(thumbBefore - 1); // thumb consumed 1
  await ctx.close();
});

// ── #31 Scenario 3: Opponent ATK and DEF totals visible in HUD state ─────────
test('passive: opponent ATK and DEF totals visible in HUD state', async ({ browser }) => {
  const { p1, p2, p1ctx, p2ctx } = await setupBattle(browser);

  const myId1 = await p1.evaluate(() => (window as any).__room?.sessionId);
  const oppId = await p1.evaluate(
    (me) =>
      Array.from((window as any).__room?.state?.players?.keys() as any).find(
        (k: string) => k !== me,
      ),
    myId1,
  );

  // Starter loadout: a1=Fire(4 with Kindling), a2=Water(3), d1=Wood(3), d2=Earth(3).
  // ATK total = a1.currentUses + a2.currentUses = 4 + 3 = 7.
  // DEF total = d1.currentUses + d2.currentUses = 3 + 3 = 6.
  const [atkTotal, defTotal] = await p1.evaluate((id) => {
    const opp = (window as any).__room?.state?.players?.get(id);
    return [
      (opp?.a1?.currentUses ?? 0) + (opp?.a2?.currentUses ?? 0),
      (opp?.d1?.currentUses ?? 0) + (opp?.d2?.currentUses ?? 0),
    ];
  }, oppId);

  expect(atkTotal).toBe(7); // 4+3 (Kindling on Fire a1)
  expect(defTotal).toBe(6); // 3+3

  await p1ctx.close();
  await p2ctx.close();
});

// ── #30 Scenario 3: Thumb element visible in room state ──────────────────────
test('staking: thumb ring element visible in room state after battle starts', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(() => (window as any).__encounterSelect('AGGRESSIVE'));

  await page.waitForFunction(
    () => (window as any).__room?.state?.phase === 'ATTACK_SELECT',
    { timeout: 10000 },
  );

  const myId = await page.evaluate(() => (window as any).__room?.sessionId);
  const thumbElement = await page.evaluate(
    (id) => (window as any).__room?.state?.players?.get(id)?.thumb?.element,
    myId,
  );
  // Starter loadout thumb = Fire = 0.
  expect(thumbElement).toBe(0); // FIRE
  await ctx.close();
});
