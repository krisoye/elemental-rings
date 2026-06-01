import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Overworld NPCs cosmetically wander around their authored spawn and keep the
 * roster's published position (`window.__overworldNpcs[i].x/y`) in sync with the
 * moving sprite, so radius-based detection, the Approach [E] prompt, and the
 * double-click ambush all track the *visible* creature rather than the static
 * spawn point. The wander is purely client-side flavour (no server round-trip), so
 * two clients may see an NPC at slightly different spots — acceptable for flavour.
 *
 * forest_anchorage (the Forest entry screen) seeds both monster NPCs (which
 * idle-bob + flip in place) and a duelist (forest_npc_2, which walks the charset
 * cycle), so the existing Sanctum→ForestScene boot path lands us on a screen with
 * both marker types. Every assertion reads real Phaser / roster state.
 */

const URL = 'http://localhost:8090';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 87, y: 152 };

interface PublishedNpc {
  id: string;
  type: 'monster' | 'duelist';
  x: number;
  y: number;
}

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Place the live player at a point and wait for the named zone to register. The
 *  zone test runs in the scene's update() loop, which can be starved under parallel
 *  worker load on a busy host — re-assert the position each poll and use a generous
 *  timeout so the zone registers once the game loop gets a tick. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.waitForFunction(
    ([zx, zy, z]) => {
      (window as any).__player?.setPosition(zx, zy);
      return ((window as any).__sanctumZones ?? []).includes(z);
    },
    [p.x, p.y, zone] as const,
    { timeout: 15000, polling: 200 },
  );
}

/** Enter the Forest overworld via the Sanctum door and wait for the NPC roster. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  // Re-confirm the hook just before firing it: under parallel load the door zone
  // can register a tick before __sanctumInteract is (re)published, so guard it.
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

const roster = (page: Page): Promise<PublishedNpc[]> =>
  page.evaluate(() => (window as any).__overworldNpcs as PublishedNpc[]);

// ── Scenario 1: NPC published positions drift over time (wander + sync) ───────
test('NPC roster positions track the wandering sprite', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  const before = await roster(page);
  expect(before.length).toBeGreaterThan(0);
  const startById = new Map(before.map((n) => [n.id, { x: n.x, y: n.y }]));

  // Within a few wander legs at least one NPC's PUBLISHED position must change.
  // The controller writes the sprite's live position back into npc.x/y every
  // frame, so this proves both that the sprite wanders AND that the roster the
  // detection logic reads tracks it.
  await expect
    .poll(
      async () => {
        const now = await roster(page);
        return now.some((n) => {
          const s = startById.get(n.id);
          if (!s) return false;
          return Math.hypot(n.x - s.x, n.y - s.y) > 1;
        });
      },
      { timeout: 6000, intervals: [250] },
    )
    .toBe(true);

  // And no NPC drifts far from its authored spawn — the wander is clamped to a
  // small radius (WANDER_RADIUS = 24 px). Allow a small slack for the in-flight
  // tween position vs. the clamped target.
  const after = await roster(page);
  for (const n of after) {
    const s = startById.get(n.id)!;
    expect(Math.hypot(n.x - s.x, n.y - s.y)).toBeLessThanOrEqual(30);
  }
  await ctx.close();
});

// ── Scenario 2: detection follows the moving creature ─────────────────────────
test('detection fires when the player stands on the wandering NPC', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  const npcs = await roster(page);
  const target = npcs[0];
  expect(target).toBeTruthy();

  // Continuously snap the player onto the target NPC's LIVE published position
  // each poll. Because the sprite wanders, a one-shot setPosition could miss; by
  // re-reading the roster (which the controller keeps in sync with the sprite) we
  // prove detection tracks the moving creature, not the static spawn.
  await expect
    .poll(
      async () => {
        return page.evaluate((id) => {
          const list = (window as any).__overworldNpcs as PublishedNpc[];
          const npc = list.find((n) => n.id === id);
          if (!npc) return null;
          (window as any).__player.setPosition(npc.x, npc.y);
          const detected = (window as any).__detectedNpc as { id: string } | null;
          return detected?.id ?? null;
        }, target.id);
      },
      { timeout: 6000, intervals: [150] },
    )
    .toBe(target.id);

  await ctx.close();
});

// ── Scenario 3: each NPC type renders the correct sprite source ───────────────
test('monsters use the per-element registry sprite; duelists use the charset', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // forest_anchorage seeds both monster NPCs (registry keys `npc-ow-*`) and a
  // duelist (forest_npc_2 → charset). Collect the live display-list sprites and
  // confirm the refactored WanderingNpc render path picks the right texture per
  // type — and that the legacy `npc-overworld` strip is gone entirely.
  const info = await page.evaluate(() => {
    const scene = (window as any).__scene;
    const list = (scene?.children?.list ?? []) as any[];
    const keys = list.map((o) => o?.texture?.key).filter(Boolean) as string[];
    return {
      keys,
      charsetCount: keys.filter((k) => k === 'charset-a1').length,
      overworldTextureExists: scene.textures.exists('npc-overworld'),
    };
  });

  // The dead 24×32 head-tops strip is neither loaded nor used.
  expect(info.overworldTextureExists).toBe(false);

  const npcs = await roster(page);
  const monsterKeys = ['npc-ow-fire', 'npc-ow-water', 'npc-ow-earth', 'npc-ow-wind', 'npc-ow-wood'];
  if (npcs.some((n) => n.type === 'monster')) {
    expect(info.keys.some((k) => monsterKeys.includes(k))).toBe(true);
  }
  const duelistCount = npcs.filter((n) => n.type === 'duelist').length;
  if (duelistCount > 0) {
    // Duelists draw from the shared RPG-Maker charset. The player is also a
    // charset sprite, so a duelist means MORE than one charset sprite is present.
    expect(info.charsetCount).toBeGreaterThanOrEqual(1 + duelistCount);
  }
  await ctx.close();
});
