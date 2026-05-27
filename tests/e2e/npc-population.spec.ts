import { test, expect } from '@playwright/test';
import { seedAuthToken, E2E_FAST } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Phase 8C.3 — NPC world population + detection (#83, GDD §10.3/§10.5).
 *
 * The server seeds a static per-biome NPC table (server/src/persistence/NpcSpawns).
 * GET /api/overworld/npcs?biome=<biome> returns the NPCs currently present for the
 * player (defeated permanent NPCs vanish forever; defeated periodic NPCs return
 * after their respawnDays). Each NPC has a stable previewed stake element. The
 * overworld scenes render the NPCs, detect the nearest within DETECTION_RADIUS,
 * and launch a duel via the existing battle-ai room (scoped by npcId so a win is
 * recorded server-side). Every assertion reads real state — never mocks.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 1088, y: 608 };
/** Forest NPC world centers (tx*32+16, ty*32+16 from NpcSpawns). */
const FOREST_NPC_1 = { id: 'forest_npc_1', x: 15 * 32 + 16, y: 12 * 32 + 16 }; // 496, 400
const FOREST_NPC_3 = { id: 'forest_npc_3', x: 8 * 32 + 16, y: 22 * 32 + 16 }; // 272, 720
/** A point far from every Forest NPC, on a walkable hub tile (8E #107: the
 * generated forest_anchorage map walls its perimeter, so tile (2,2)=(64,64) could
 * be wall — (200,200) is safely inside the grove-free hub clearing). */
const FAR_FROM_NPCS = { x: 200, y: 200 };

interface NpcEntry {
  id: string;
  personality: string;
  x: number;
  y: number;
  element: number;
}

const VALID_PERSONALITIES = ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'];

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
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
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
async function serverNpcs(page: Page, biome: string): Promise<NpcEntry[]> {
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
 * Drive a vsAI duel against the given NPC to a guaranteed human WIN, mirroring
 * helpers.driveAiDuel but routing through connectToRoom('battle-ai', …) with the
 * npcId in the room options (so a win records the defeat) plus aiHearts:1 to force
 * the win. The page must already be in ForestScene (or any scene where
 * connectToRoom is exposed). Resolves once the duel ENDS with the human winner.
 */
async function driveNpcWin(page: Page, npcId: string, personality: string): Promise<void> {
  // Connect directly to a battle-ai room scoped to this NPC, with aiHearts:1 so the
  // AI dies on the first hit → guaranteed protagonist win (the same setup-forced
  // outcome the AI-strength overrides give driveAiDuel).
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
    { p: personality, id: npcId },
  );

  await page.waitForFunction(
    () => (window as any).__room?.state?.phase === 'ATTACK_SELECT' || (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 10000 },
  );

  // Mirror helpers.driveAiDuel's driver: attack on our turn, defend on the AI's.
  // Defending keeps the human alive (the AI also attacks) while our throws chip the
  // 1-heart AI down to a guaranteed KO win.
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
        (window as any).__room?.state?.winnerId &&
        (window as any).__room?.state?.winnerId !== 'AI',
      { timeout: E2E_FAST ? 12000 : 30000 },
    );
  } finally {
    clearInterval(driver);
  }
}

// ── Scenario 1: the NPC roster endpoint ──────────────────────────────────────
test('npc: GET /api/overworld/npcs?biome=forest returns 3 well-formed NPCs', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  const npcs = await serverNpcs(page, 'forest');
  expect(npcs).toHaveLength(3);
  for (const npc of npcs) {
    expect(typeof npc.id).toBe('string');
    expect(typeof npc.x).toBe('number');
    expect(typeof npc.y).toBe('number');
    expect(typeof npc.element).toBe('number');
    expect(VALID_PERSONALITIES).toContain(npc.personality);
  }
  expect(npcs.map((n) => n.id).sort()).toEqual(['forest_npc_1', 'forest_npc_2', 'forest_npc_3']);
  await ctx.close();
});

// ── Scenario 2: the scene renders the roster at expected world coords ─────────
test('npc: ForestScene publishes 3 NPCs with forest_npc_1 at its tile center', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  const published = await page.evaluate(() => (window as any).__overworldNpcs as NpcEntry[]);
  expect(published).toHaveLength(3);

  const npc1 = published.find((n) => n.id === 'forest_npc_1');
  expect(npc1).toBeDefined();
  expect(npc1!.x).toBe(FOREST_NPC_1.x); // 496
  expect(npc1!.y).toBe(FOREST_NPC_1.y); // 400
  await ctx.close();
});

// ── Scenario 3: detection toggles with proximity ─────────────────────────────
test('npc: walking within DETECTION_RADIUS sets __detectedNpc; walking away clears it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Walk onto forest_npc_1's center → detected.
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    FOREST_NPC_1.x,
    FOREST_NPC_1.y,
  ]);
  await page.waitForFunction(
    () => (window as any).__detectedNpc?.id === 'forest_npc_1',
    { timeout: 5000 },
  );
  const detected = await page.evaluate(() => (window as any).__detectedNpc);
  expect(detected.id).toBe('forest_npc_1');
  expect(VALID_PERSONALITIES).toContain(detected.personality);

  // Walk far from every NPC → cleared (null).
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    FAR_FROM_NPCS.x,
    FAR_FROM_NPCS.y,
  ]);
  await page.waitForFunction(() => (window as any).__detectedNpc === null, { timeout: 5000 });
  await ctx.close();
});

// ── Scenario 4: beating a permanent NPC removes it from the roster ────────────
test('npc: defeating forest_npc_3 (permanent) omits it from the roster afterward', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Pre-condition: the permanent NPC is present.
  expect((await serverNpcs(page, 'forest')).map((n) => n.id)).toContain('forest_npc_3');

  // Drive a guaranteed win against it via the NPC-scoped battle-ai room.
  await driveNpcWin(page, FOREST_NPC_3.id, 'RESILIENT');

  // The permanent NPC (respawnDays = 0) is now gone for good.
  const after = await serverNpcs(page, 'forest');
  expect(after.map((n) => n.id)).not.toContain('forest_npc_3');
  expect(after.map((n) => n.id)).toContain('forest_npc_1'); // others unaffected
  await ctx.close();
});

// ── Scenario 5: a daily NPC respawns after the game-day advances ──────────────
test('npc: defeating forest_npc_1 (daily) hides it, then it returns after sleep', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Defeat the daily NPC (respawnDays = 1). Day 0 win → hidden until day ≥ 1.
  await driveNpcWin(page, FOREST_NPC_1.id, 'AGGRESSIVE');
  expect((await serverNpcs(page, 'forest')).map((n) => n.id)).not.toContain('forest_npc_1');

  // Advance the game day (POST /api/camp/sleep spends food + bumps game_day).
  const sleepStatus = await page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token');
    const res = await fetch(`${api}/api/camp/sleep`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  }, [API_URL] as const);
  expect(sleepStatus).toBe(200);

  // After 1 game-day elapses (game_day − defeated_day = 1 ≥ respawnDays), it's back.
  const after = await serverNpcs(page, 'forest');
  expect(after.map((n) => n.id)).toContain('forest_npc_1');
  await ctx.close();
});
