import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #199 — the overworld NPC's staked (thumb) element must equal the element shown
 * by its overworld sprite colour + approach warning. The data value `npc.element`
 * is threaded from the client overworld scenes through EncounterScene into the
 * `battle-ai` room options as `thumbElement`, and the server's generateAILoadout
 * filters its per-personality template pool to a thumb-matching variant. Before
 * the fix the loadout picked any variant at random, so the duel stake element
 * frequently differed from the marker the player approached.
 *
 * Element enum (shared/types.ts): FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4.
 *
 * Template thumb coverage (server/src/game/ai/AILoadout.ts):
 *   AGGRESSIVE   → FIRE, WIND
 *   DEFENSIVE    → EARTH, WOOD
 *   STATUS_HUNTER→ FIRE, WATER, WOOD
 *   RESILIENT    → FIRE, WATER, EARTH, WIND, WOOD
 *
 * Tests use NPCs whose spawn `element` is in their personality's thumb set, so a
 * matching variant exists and the assertion holds. (Spawn rows whose element is
 * NOT in the personality's set — e.g. AGGRESSIVE forest_npc_1 staked WOOD — are a
 * separate spawn-table data concern; the loadout's defensive fallback keeps a
 * valid random pick there and this issue does not retune that data.) Every
 * assertion reads real server state — never mocks.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

// Element enum (confirmed from shared/types.ts / server/src/game/constants.ts).
const FIRE = 0;
const WIND = 3;
const WOOD = 4;

/** Sanctum door zone center (16px-grid value, mirrors npc-population.spec). */
const SANCTUM_DOOR = { x: 87, y: 152 };

/**
 * forest_anchorage NPC whose personality (RESILIENT) DOES carry a thumb=WOOD
 * variant, so the threaded element produces a matching stake. World center from
 * the published roster (read at runtime, not hard-coded geometry).
 */
const FOREST_NPC_3 = { id: 'forest_npc_3', element: WOOD, personality: 'RESILIENT' };

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

/** Enter the Forest overworld (forest_anchorage) via the Sanctum door. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', {
    timeout: 8000,
  });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

/** Look up a published overworld NPC's world center by id. */
async function npcCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const center = await page.evaluate((nid) => {
    const npc = ((window as any).__overworldNpcs ?? []).find((n: any) => n.id === nid);
    return npc ? { x: npc.x, y: npc.y } : null;
  }, id);
  if (!center) throw new Error(`npcCenter: ${id} not in published roster`);
  return center;
}

/**
 * Walk onto an NPC, wait for detection, then fire the real E-key dispatcher
 * (window.__sanctumInteract → BaseBiomeScene.handleInteract). That launches the
 * duel through EncounterScene's NPC path with thumbElement threaded into the
 * battle-ai room. Resolves once BattleState reaches ATTACK_SELECT (or ENDED).
 */
async function approachAndDuelViaEKey(
  page: Page,
  npc: { id: string },
): Promise<void> {
  const center = await npcCenter(page, npc.id);
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [center.x, center.y]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, npc.id, {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 12000 },
  );
}

/** Read the seated AI player's staked thumb element from live BattleState. */
async function aiThumbElement(page: Page): Promise<number> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    return room?.state?.players?.get('AI')?.thumb?.element;
  });
}

// ── Scenario 1: E-key approach → stake element matches the overworld element ──
test('e-key duel: AI thumb element equals the overworld NPC element', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  await approachAndDuelViaEKey(page, FOREST_NPC_3);

  expect(await aiThumbElement(page)).toBe(FOREST_NPC_3.element); // WOOD
  await ctx.close();
});

// ── Scenario 2: double-click ambush path threads the same element ─────────────
// The ambush gesture's threading is asserted at the server boundary (the level
// the existing ambush suite operates at — see blink.spec.ts). onNpcClick adds the
// identical `thumbElement: npc.element` to the same connectToRoom('battle-ai', …)
// join, so a direct join with the NPC's element + firstStrike reproduces it.
test('ambush join: thumbElement pins the AI thumb to the NPC element', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // 50 spirit ≥ AMBUSH_SPIRIT_COST
  const page = await ctx.newPage();
  await loadSanctum(page);

  await page.evaluate(
    async ([p, el]) => {
      const token = localStorage.getItem('er_token') ?? '';
      await (window as any).connectToRoom('battle-ai', {
        vsAI: true,
        personality: p,
        token,
        thumbElement: el,
        firstStrike: true,
      });
    },
    [FOREST_NPC_3.personality, FOREST_NPC_3.element] as const,
  );

  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 10000 },
  );

  expect(await aiThumbElement(page)).toBe(FOREST_NPC_3.element); // WOOD
  await ctx.close();
});

// ── Scenario 3: consistency across seeds for a two-variant personality ────────
// AGGRESSIVE has exactly two template variants (thumb=FIRE and thumb=WIND). For a
// fixed thumbElement the loadout RNG must NEVER drift to the other variant,
// regardless of aiSeed. Vary the seed across several joins (a fixed seed pins the
// loadout RNG, so distinct seeds exercise distinct draws) and assert the staked
// thumb always equals the requested element.
test('seed sweep: AGGRESSIVE thumb stays pinned to the requested element', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);

  // FIRE-staked AGGRESSIVE must never resolve to the WIND variant, and vice versa.
  for (const requested of [FIRE, WIND]) {
    for (const aiSeed of [1, 7, 42, 1000, 31337]) {
      await page.evaluate(
        async ([el, seed]) => {
          const room = (window as any).__room;
          if (room) await room.leave();
          (window as any).__room = null;
          const token = localStorage.getItem('er_token') ?? '';
          await (window as any).connectToRoom('battle-ai', {
            vsAI: true,
            personality: 'AGGRESSIVE',
            token,
            thumbElement: el,
            aiSeed: seed,
          });
        },
        [requested, aiSeed] as const,
      );

      await page.waitForFunction(
        () =>
          (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
          (window as any).__room?.state?.phase === 'ENDED',
        { timeout: 10000 },
      );

      expect(await aiThumbElement(page)).toBe(requested);
    }
  }

  await ctx.close();
});
