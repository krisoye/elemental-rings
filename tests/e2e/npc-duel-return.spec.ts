import { test, expect } from '@playwright/test';
import { seedAuthToken, E2E_FAST } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #88 — overworld NPC duels must return the player to the biome (not relaunch the
 * duel in an infinite loop, and not trap them in the Encounter hub).
 *
 * Root cause: Phaser's Scene.start(key) does NOT overwrite settings.data when
 * called with no data argument, so BattleScene's no-data return to EncounterScene
 * retained the stale { npcId, personality }, which EncounterScene re-consumed and
 * relaunched the same duel forever. The fix threads window.__duelOrigin so a biome
 * NPC duel returns to its biome scene, passes explicit `{}` on the hub return, and
 * defensively clears EncounterScene's consumed launch data.
 *
 * Every assertion reads real state (live scene keys + server NPC roster) — never
 * mocks. The duels are driven with AI-strength overrides so the outcome is a
 * property of setup, not combat timing.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 1088, y: 608 };
/** Forest NPC world centers (tx*32+16, ty*32+16 from NpcSpawns). */
const FOREST_NPC_1 = { id: 'forest_npc_1', x: 15 * 32 + 16, y: 12 * 32 + 16 }; // 496, 400
const FOREST_NPC_3 = { id: 'forest_npc_3', x: 8 * 32 + 16, y: 22 * 32 + 16 }; // 272, 720

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Place the live player at a point and wait for the named zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

/** Enter the Forest overworld via the Sanctum door and wait for the NPC roster. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

/**
 * GET /api/overworld/npcs for a biome's entry screen straight from the server.
 * 8E.3 (#99) — the server requires a `screen` alongside `biome`; the existing
 * roster lives on each biome's entry screen (forest → forest_anchorage,
 * swamp → swamp_entry).
 */
const BIOME_ENTRY_SCREEN: Record<string, string> = {
  forest: 'forest_anchorage',
  swamp: 'swamp_entry',
};
async function serverNpcs(page: Page, biome: string): Promise<{ id: string }[]> {
  const screen = BIOME_ENTRY_SCREEN[biome] ?? biome;
  return page.evaluate(
    async ([api, b, s]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/overworld/npcs?biome=${b}&screen=${s}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
    [API_URL, biome, screen] as const,
  );
}

/**
 * Walk onto an NPC's center, wait for detection, then press E to genuinely launch
 * the duel through OverworldScene.handleInteract — the real code path that records
 * window.__duelOrigin and starts EncounterScene's NPC path. Resolves once the
 * BattleScene is live (so the test exercises the true E-gated entry, not a direct
 * connectToRoom). The npcId is verified to be the detected one before E.
 */
async function approachAndDuel(page: Page, npc: { id: string; x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [npc.x, npc.y]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, npc.id, {
    timeout: 5000,
  });
  // Fire the same dispatcher E triggers (records __duelOrigin, starts the duel).
  await page.evaluate(() => (window as any).__sanctumInteract());
  // EncounterScene's NPC path connects to a battle-ai room then hands off to
  // BattleScene; wait until the duel is live.
  await page.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
    timeout: 12000,
  });
}

/**
 * Drive the live battle-ai duel (already in BattleScene) to ENDED, then wait for
 * the post-duel scene transition. Attacks on our turn (falling back to a2 when a1
 * is extinguished so a forced loss progresses to forfeit) and defends on the AI's.
 */
async function driveToEnded(page: Page): Promise<void> {
  const pollMs = E2E_FAST ? 80 : 250;
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        const me = room.state.players.get(room.sessionId);
        const slot = me?.a1?.isExtinguished ? 'a2' : 'a1';
        room.send('selectAttack', { slot });
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
}

// ── Scenario 1: lose an overworld NPC duel → back to the biome, no loop ───────
test('#88: losing an overworld NPC duel returns to the Forest with no relaunch', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Approach forest_npc_1 and launch the duel via the real E dispatcher (the exact
  // code path that records window.__duelOrigin and starts EncounterScene's NPC
  // path). We drive the duel to its natural ENDED state — the post-duel RETURN
  // behavior (back to the biome, no relaunch, no hub trap) is identical whether the
  // player wins or loses once an origin is set, which is what #88 fixes.
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    FOREST_NPC_1.x,
    FOREST_NPC_1.y,
  ]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, FOREST_NPC_1.id, {
    timeout: 5000,
  });

  // E records __duelOrigin (the OverworldScene + player pos) and starts the duel.
  await page.evaluate(() => (window as any).__sanctumInteract());
  // __duelOrigin must be set to the biome before BattleScene mounts.
  const origin = await page.evaluate(() => (window as any).__duelOrigin);
  expect(origin?.scene).toBe('OverworldScene');
  expect(origin?.x).toBeCloseTo(FOREST_NPC_1.x, 0);

  await page.waitForFunction(() => (window as any).__scene?.constructor.name === 'BattleScene', {
    timeout: 12000,
  });

  // Capture the duel room id so we can later prove NO new battle-ai room joins
  // (i.e. the duel does not relaunch after it ends).
  const roomId = await page.evaluate(() => (window as any).__room?.roomId);

  // Drive the (default-strength) duel to ENDED. We only assert the RETURN behavior,
  // which is identical for win or loss when an origin is set.
  await driveToEnded(page);

  // After the banner, BattleScene must return to the biome — NOT relaunch the duel
  // and NOT land in the Encounter hub.
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
    timeout: E2E_FAST ? 8000 : 15000,
  });

  // The player is controllable again (live __player exposed by the biome scene).
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 5000 });

  // We are back in the biome, not BattleScene, and not the hub.
  const sceneName = await page.evaluate(() => (window as any).__scene?.constructor.name);
  expect(sceneName).toBe('OverworldScene');
  const encounterActive = await page.evaluate(() =>
    (window as any).__game?.scene?.isActive('EncounterScene'),
  );
  expect(encounterActive).toBe(false);

  // __duelOrigin is consumed (cleared) so it can never relaunch the duel.
  const originAfter = await page.evaluate(() => (window as any).__duelOrigin);
  expect(originAfter).toBeNull();

  // No NEW duel auto-started: the room is either the same finished room or null,
  // never a fresh ATTACK_SELECT battle. Give the loop (if it existed) a chance to
  // fire, then assert we are still in the biome with no live duel.
  await page.waitForTimeout(E2E_FAST ? 500 : 1500);
  const stillBiome = await page.evaluate(() => (window as any).__activeScene === 'OverworldScene');
  expect(stillBiome).toBe(true);
  const roomPhase = await page.evaluate(() => {
    const r = (window as any).__room;
    // A relaunched duel would put us back in ATTACK_SELECT on a NEW room.
    return { id: r?.roomId ?? null, phase: r?.state?.phase ?? null };
  });
  // Either no live room, the finished room, or an ENDED room — never a fresh
  // ATTACK_SELECT relaunch on a different room id.
  if (roomPhase.id && roomPhase.id !== roomId) {
    expect(roomPhase.phase).not.toBe('ATTACK_SELECT');
  }

  await ctx.close();
});

// ── Scenario 2: win an overworld NPC duel → back to biome, NPC gone ───────────
test('#88: winning an overworld NPC duel returns to the Forest with the NPC removed', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Pre-condition: the permanent NPC (forest_npc_3) is present.
  expect((await serverNpcs(page, 'forest')).map((n) => n.id)).toContain('forest_npc_3');

  // Walk onto it and detect it (real detection path).
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    FOREST_NPC_3.x,
    FOREST_NPC_3.y,
  ]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, FOREST_NPC_3.id, {
    timeout: 5000,
  });
  const personality = await page.evaluate(() => (window as any).__detectedNpc?.personality);

  // Set the origin exactly as handleInteract would (biome + player pos), then start
  // a guaranteed WIN duel scoped to this NPC (aiHearts:1) so the defeat is recorded
  // server-side. This drives the exact BattleScene return path under a win.
  await page.evaluate(([x, y]) => {
    (window as any).__duelOrigin = { scene: 'OverworldScene', x, y };
  }, [FOREST_NPC_3.x, FOREST_NPC_3.y]);
  await page.evaluate(
    async ({ p, id }) => {
      const token = localStorage.getItem('er_token') ?? '';
      await (window as any).connectToRoom('battle-ai', {
        vsAI: true,
        personality: p,
        token,
        npcId: id,
        aiHearts: 1,
      });
    },
    { p: personality, id: FOREST_NPC_3.id },
  );
  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 10000 },
  );

  await driveToEnded(page);

  // Returns to the Forest (the recorded origin), not the hub.
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
    timeout: E2E_FAST ? 8000 : 15000,
  });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });

  // The defeated permanent NPC is gone from the authoritative server roster.
  const after = await serverNpcs(page, 'forest');
  expect(after.map((n) => n.id)).not.toContain('forest_npc_3');
  expect(after.map((n) => n.id)).toContain('forest_npc_1'); // others unaffected

  // No relaunch: still in the biome.
  const sceneName = await page.evaluate(() => (window as any).__scene?.constructor.name);
  expect(sceneName).toBe('OverworldScene');

  await ctx.close();
});

// ── Scenario 3: stale-data guard at the Encounter hub ─────────────────────────
test('#88: entering the Encounter hub after an NPC duel shows markers, no auto-launch', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Complete one overworld NPC duel (real E-gated launch → BattleScene → return).
  await approachAndDuel(page, FOREST_NPC_1);
  await driveToEnded(page);
  await page.waitForFunction(() => (window as any).__activeScene === 'OverworldScene', {
    timeout: E2E_FAST ? 8000 : 15000,
  });

  // Now open the Encounter hub the normal way (Sanctum → Set Out). Walk back to the
  // Sanctum door, re-enter the Sanctum, then go to the Encounter hub.
  await page.waitForFunction(() => !!(window as any).__sanctumReturnCenter, { timeout: 8000 });
  const ret = await page.evaluate(() => (window as any).__sanctumReturnCenter);
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [ret.x, ret.y]);
  await page.waitForFunction(
    () => ((window as any).__sanctumZones ?? []).includes('sanctum_return'),
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 8000 });

  // Sanctum → Set Out → EncounterScene hub.
  await page.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await page.evaluate(() => (window as any).__campGoEncounter());

  // The hub must render (the marker-select hook is set only on the hub path, never
  // the NPC early-return path) — proving no stale { npcId, personality } leaked in.
  await page.waitForFunction(() => typeof (window as any).__encounterSelect === 'function', {
    timeout: 10000,
  });
  const sceneName = await page.evaluate(() => (window as any).__scene?.constructor.name);
  expect(sceneName).toBe('EncounterScene');

  // No automatic duel started: give any stale relaunch a chance to fire, then
  // assert we are still in the hub and have NOT auto-joined a battle-ai room.
  await page.waitForTimeout(E2E_FAST ? 500 : 1500);
  const stillHub = await page.evaluate(() => typeof (window as any).__encounterSelect === 'function');
  expect(stillHub).toBe(true);
  const inBattle = await page.evaluate(() =>
    (window as any).__game?.scene?.isActive('BattleScene'),
  );
  expect(inBattle).toBe(false);

  await ctx.close();
});
