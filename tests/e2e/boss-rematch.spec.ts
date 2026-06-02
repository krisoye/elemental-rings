import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { campToEncounter, waitForEncounter } from './helpers';

// #262 — boss rematch (TRAINING-screen replayability, practice). After a boss is
// defeated it can be re-fought from the TRAINING hub via a "Rematch" row. The
// rematch is pure practice: NO npcId → no won-ring prompt, no gold penalty, no
// change to npc_defeats (the boss stays permanently beaten yet endlessly
// re-fightable). The duel stakes the boss's real fused thumb.

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

const MUD = 11;

/** Mint a fresh player; seed its token into the context and return the token. */
async function seedPlayer(ctx: BrowserContext): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  return token;
}

/** Record a defeat of `npcId` for the token's player (test-only route). */
async function seedDefeat(token: string, npcId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/seed-npc-defeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ npcId }),
  });
  if (!res.ok) throw new Error(`seed-npc-defeat failed (${res.status})`);
}

async function getMe(token: string): Promise<{ rings: any[] }> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function getBosses(token: string): Promise<any[]> {
  const res = await fetch(`${API_URL}/api/encounter/bosses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()).bosses;
}

/** Navigate a seeded context into the TRAINING (Encounter) hub. */
async function goToEncounter(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  return page;
}

// ── Scenario 1: no bosses → no rematch row ───────────────────────────────────
test('scenario 1: a fresh player sees no rematch cards', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedPlayer(ctx);
  const page = await goToEncounter(ctx);

  // __encounterBosses is published (possibly after a microtask) and stays empty.
  await page.waitForFunction(() => Array.isArray((window as any).__encounterBosses), {
    timeout: 8000,
  });
  const bosses = await page.evaluate(() => (window as any).__encounterBosses);
  expect(bosses).toEqual([]);

  await ctx.close();
});

// ── Scenario 2: a defeated boss appears in the rematch row ────────────────────
test('scenario 2: defeating Bogwood Warden surfaces one rematch card', async ({ browser }) => {
  const ctx = await browser.newContext();
  const token = await seedPlayer(ctx);
  await seedDefeat(token, 'forest_bogwood_warden');

  const page = await goToEncounter(ctx);
  await page.waitForFunction(
    () => ((window as any).__encounterBosses?.length ?? 0) === 1,
    { timeout: 8000 },
  );
  const bosses = await page.evaluate(() => (window as any).__encounterBosses);
  expect(bosses).toHaveLength(1);
  expect(bosses[0].id).toBe('forest_bogwood_warden');
  expect(bosses[0].name).toBe('Bogwood Warden');
  expect(bosses[0].element).toBe(MUD); // stakes the real MUD fused thumb

  await ctx.close();
});

// ── Scenario 3: selecting a rematch launches a battle-ai duel with the MUD thumb
test('scenario 3: rematch launches a battle-ai room; AI thumb is the boss fusion (MUD)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const token = await seedPlayer(ctx);
  await seedDefeat(token, 'forest_bogwood_warden');

  const page = await goToEncounter(ctx);
  await page.waitForFunction(
    () => ((window as any).__encounterBosses?.length ?? 0) === 1,
    { timeout: 8000 },
  );

  // Launch via the E2E hook (identical path to a rematch-card click).
  await page.evaluate(() => (window as any).__encounterRematchBoss('forest_bogwood_warden'));

  // A battle-ai room opens with two seats; the AI opponent's staked thumb is MUD.
  await page.waitForFunction(() => (window as any).__room?.state?.players?.size === 2, {
    timeout: 10000,
  });
  const aiThumbElement = await page.evaluate(() => {
    const room = (window as any).__room;
    const myId = room.sessionId;
    for (const [id, ps] of room.state.players) {
      if (id !== myId) return ps.thumb?.element;
    }
    return undefined;
  });
  expect(aiThumbElement).toBe(MUD);

  await ctx.close();
});

// ── Scenario 4: a finished rematch grants no reward and changes no defeat state
test('scenario 4: after a rematch the boss is still beaten + re-fightable, no won-ring, rings unchanged', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const token = await seedPlayer(ctx);
  await seedDefeat(token, 'forest_bogwood_warden');

  // Snapshot rings before the rematch.
  const before = await getMe(token);
  const beforeIds = new Set(before.rings.map((r) => r.id));

  const page = await goToEncounter(ctx);
  await page.waitForFunction(
    () => ((window as any).__encounterBosses?.length ?? 0) === 1,
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__encounterRematchBoss('forest_bogwood_warden'));
  await page.waitForFunction(() => (window as any).__room?.state?.players?.size === 2, {
    timeout: 10000,
  });

  // Drive the duel to completion (win or lose — neither grants a reward in a
  // no-npcId practice fight). Fire attacks / defenses whenever it is our turn.
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (!room?.state) return;
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === room.sessionId
      ) {
        const me = room.state.players.get(room.sessionId);
        const a1Dead = !!me?.a1?.isExtinguished;
        const a2Dead = !!me?.a2?.isExtinguished;
        if (a1Dead && a2Dead) room.send('forfeit');
        else room.send('selectAttack', { slot: a1Dead ? 'a2' : 'a1' });
      } else if (
        room.state.phase === 'DEFEND_WINDOW' &&
        room.state.currentAttackerId !== room.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, 80);
  try {
    await page.waitForFunction(
      () => (window as any).__room?.state?.phase === 'ENDED',
      { timeout: 45000 },
    );
  } finally {
    clearInterval(driver);
  }

  // No won-ring prompt was raised (practice grants nothing).
  const pendingWonRing = await page.evaluate(
    () => (window as any).__encounterState?.pendingWonRing ?? null,
  );
  // The encounter scene may have already shut down on transition; if its state is
  // gone, that is equally "no pending prompt". Either way it must not be set.
  expect(pendingWonRing).toBeNull();

  // /api/me rings are unchanged — no new ring, none removed (no stake transfer).
  const after = await getMe(token);
  const afterIds = new Set(after.rings.map((r) => r.id));
  expect(afterIds.size).toBe(beforeIds.size);
  for (const id of beforeIds) expect(afterIds.has(id)).toBe(true);

  // The boss is STILL beaten AND still re-fightable (defeat state unchanged).
  const bosses = await getBosses(token);
  expect(bosses.some((b) => b.id === 'forest_bogwood_warden')).toBe(true);

  await ctx.close();
});
