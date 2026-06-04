import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter, E2E_FAST } from './helpers';

/**
 * #212 — persistent end-of-battle modal. On ENDED the BattleScene shows a modal
 * that NEVER auto-dismisses; the player reviews the result + rewards and chooses
 * [Manage Battle Hand] (route + open the battle-hand overlay) or
 * [Return to Overworld] (route, overlay closed). A corner [X] collapses the modal
 * to a frozen final board with a reopen pill — the modal is the only exit.
 *
 * Every assertion reads real state (live scene keys, the modal window hooks, and
 * localStorage) — never mocks. Duels are forced via AI-strength overrides so the
 * outcome is a property of setup, not combat timing.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Forest NPC world center (tile center, from NpcSpawns) used for biome-origin duels.
 * 16px grid after the #149/#159 map migration (server routes.ts TILE_SIZE=16). */
const FOREST_NPC_1 = { id: 'forest_npc_1', x: 7 * 16 + 8, y: 6 * 16 + 8 }; // 120, 104
const SANCTUM_DOOR = { x: 87, y: 152 };

/** Drive the live BattleScene duel to ENDED, leaving the modal up (no routing). */
async function driveToEndedModal(page: Page): Promise<void> {
  const pollMs = E2E_FAST ? 80 : 250;
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        const me = room.state.players.get(room.sessionId);
        const a1Dead = !!me?.a1?.isExtinguished;
        const a2Dead = !!me?.a2?.isExtinguished;
        if (a1Dead && a2Dead) room.send('forfeit');
        else room.send('selectAttack', { slot: a1Dead ? 'a2' : 'a1' });
      } else if (
        room?.state?.phase === 'DEFEND_WINDOW' &&
        room?.state?.currentAttackerId !== room?.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, pollMs);
  try {
    await page.waitForFunction(
      () =>
        (window as any).__room?.state?.phase === 'ENDED' &&
        !!(window as any).__room?.state?.winnerId,
      { timeout: E2E_FAST ? 12000 : 30000 },
    );
  } finally {
    clearInterval(driver);
  }
  // The modal appears once the duel has ENDED and the reward summary has arrived.
  await page.waitForFunction(() => (window as any).__battleEndModalOpen === true, {
    timeout: 8000,
  });
}

/**
 * Hub-origin vsAI duel: Camp → Encounter → select a personality (no __duelOrigin),
 * then drive to ENDED with the modal up. Forced via AI-strength overrides.
 */
async function hubDuelToEndedModal(
  ctx: BrowserContext,
  opts: { aiHearts?: number; aiUses?: number } = {},
): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate(
    ({ ah, au }) =>
      (window as any).__encounterSelectWithOverrides('AGGRESSIVE', { aiHearts: ah, aiUses: au }),
    { ah: opts.aiHearts, au: opts.aiUses },
  );
  await page.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
    timeout: 12000,
  });
  await driveToEndedModal(page);
  return page;
}

/**
 * Biome-origin vsAI duel: enter the Forest via the Sanctum door, approach an NPC,
 * launch the duel through the real E dispatcher (records __duelOrigin = ForestScene),
 * then drive to ENDED with the modal up.
 */
async function biomeDuelToEndedModal(ctx: BrowserContext): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
  // Walk to the Sanctum door and enter the Forest.
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    SANCTUM_DOOR.x,
    SANCTUM_DOOR.y,
  ]);
  await page.waitForFunction(() => ((window as any).__sanctumZones ?? []).includes('door'), {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
  // Approach the NPC and launch via E (records __duelOrigin = ForestScene).
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    FOREST_NPC_1.x,
    FOREST_NPC_1.y,
  ]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, FOREST_NPC_1.id, {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__sanctumInteract());
  const origin = await page.evaluate(() => (window as any).__duelOrigin);
  expect(origin?.scene).toBe('ForestScene');
  await page.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
    timeout: 12000,
  });
  await driveToEndedModal(page);
  return page;
}

// ── Scenario 1: modal persists, no auto-dismiss ──────────────────────────────
test('#212: the end-of-battle modal does not auto-dismiss after the old 2s window', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await hubDuelToEndedModal(ctx);

  // Wait well past the old 2s auto-route window.
  await page.waitForTimeout(2700);

  // Modal still open and still in BattleScene (no auto-route fired).
  expect(await page.evaluate(() => (window as any).__battleEndModalOpen)).toBe(true);
  expect(await page.evaluate(() => (window as any).__scene?.constructor.name)).toBe('BattleScene');

  await ctx.close();
});

// ── Scenario 2: Return to Overworld → biome, overlay closed ──────────────────
test('#212: [Return to Overworld] routes to the biome with the battle-hand overlay closed', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await biomeDuelToEndedModal(ctx);

  await page.evaluate(() => (window as any).__battleEndChoice('overworld'));

  // Returns to the biome scene (the recorded ForestScene origin).
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: E2E_FAST ? 8000 : 15000,
  });
  // The battle-hand overlay is NOT open on this route.
  expect(await page.evaluate(() => (window as any).__battleHandOpen)).toBeFalsy();

  await ctx.close();
});

// ── Scenario 3: Manage Battle Hand → hub, overlay open ───────────────────────
test('#212: [Manage Battle Hand] routes to the hub with the battle-hand overlay open', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await hubDuelToEndedModal(ctx);

  await page.evaluate(() => (window as any).__battleEndChoice('managehand'));

  // Hub-origin duel returns to EncounterScene.
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('EncounterScene'), {
    timeout: 8000,
  });
  // The battle-hand overlay opens on this route.
  await page.waitForFunction(() => (window as any).__battleHandOpen === true, { timeout: 8000 });

  await ctx.close();
});

// ── Scenario 4: X → frozen board → reopen ────────────────────────────────────
test('#212: [X] collapses the modal to the frozen board; reopen re-shows it', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await hubDuelToEndedModal(ctx);

  // Collapse the modal by firing the corner [X]'s pointerdown — the same path a
  // click takes. The [X] is the only '✕' glyph inside the depth-2000 modal container.
  await page.evaluate(() => {
    const scene = (window as any).__scene;
    const modal = scene.children
      .getChildren()
      .find((c: any) => c.type === 'Container' && c.depth === 2000 && c.list?.some((g: any) => g.text === '✕'));
    modal?.list?.find((g: any) => g.text === '✕')?.emit('pointerdown');
  });

  // After X: modal hidden, still in BattleScene (frozen board).
  await page.waitForFunction(() => (window as any).__battleEndModalOpen === false, { timeout: 4000 });
  expect(await page.evaluate(() => (window as any).__scene?.constructor.name)).toBe('BattleScene');

  // Reopen via the stable hook → modal shown again.
  await page.evaluate(() => (window as any).__reopenBattleEnd());
  await page.waitForFunction(() => (window as any).__battleEndModalOpen === true, { timeout: 4000 });

  await ctx.close();
});

// ── Scenario 5: won ring preserved across the route ──────────────────────────
test('#212: a won ring (er_pending_ring) survives the [Return to Overworld] route', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  // aiHearts:1 forces a protagonist WIN so the server grants a ring (wonRing fires
  // → Connection.ts sets er_pending_ring). aiUses:0 makes the AI forfeit-prone so
  // the win lands quickly.
  const page = await hubDuelToEndedModal(ctx, { aiHearts: 1, aiUses: 0 });

  // EPIC #378 — pending ring is now server-owned (rings.pending column); read
  // pending_ring_id from /api/me instead of the removed er_pending_ring key.
  // The win granted a ring before routing.
  expect(await page.evaluate(async () => {
    const token = localStorage.getItem('er_token');
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return data.player?.pending_ring_id;
  })).toBeTruthy();

  await page.evaluate(() => (window as any).__battleEndChoice('overworld'));
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('EncounterScene'), {
    timeout: 8000,
  });

  // The pending won ring is still set immediately after routing (the carry prompt
  // surfaces it on the hub; the route itself never clears it). EncounterScene may
  // resolve it on create, so read it in the same tick the scene becomes active.
  const pending = await page.evaluate(async () => {
    const token = localStorage.getItem('er_token');
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return data.player?.pending_ring_id;
  });
  expect(pending).toBeTruthy();

  await ctx.close();
});
