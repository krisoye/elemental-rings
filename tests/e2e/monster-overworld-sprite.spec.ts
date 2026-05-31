import { test, expect } from '@playwright/test';
import { seedAuthToken } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #192 — monster overworld markers must render a SINGLE creature frame, not the
 * whole 3×3 spritesheet grid.
 *
 * The per-element monster overworld PNGs (MONSTER_OW_REGISTRY) are 72×96
 * spritesheets (3 cols × 3 rows = 9 frames at 24×32). They were previously loaded
 * with load.image() + add.image(), which painted the entire sheet scaled into the
 * marker. The fix loads them as spritesheets (frameWidth 24, frameHeight 32) and
 * displays them with add.sprite(key, 0) — frame 0 only.
 *
 * forest_anchorage (the Forest entry screen) seeds monster NPCs (WOOD, key
 * `npc-ow-wood`), so the existing Sanctum→ForestScene boot path lands us on a
 * screen that renders monster markers. Every assertion reads real Phaser state.
 */

const URL = 'http://localhost:8090';

/** Sanctum door zone center (client/public/assets/maps/sanctum.json). */
const SANCTUM_DOOR = { x: 87, y: 152 };
/** NPC_OW_DISPLAY_SIZE from client/src/objects/world/NpcSpriteRegistry.ts. */
const NPC_OW_DISPLAY_SIZE = 24;
/** Texture keys MONSTER_OW_REGISTRY registers (one per element FIRE…WOOD). */
const MONSTER_OW_KEYS = ['npc-ow-fire', 'npc-ow-water', 'npc-ow-earth', 'npc-ow-wind', 'npc-ow-wood'];

interface MarkerInfo {
  textureKey: string;
  frameName: string | number;
  displayWidth: number;
  displayHeight: number;
  textureWidth: number;
  textureHeight: number;
  isSprite: boolean;
}

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
 * Collect every rendered monster marker off the live ForestScene display list,
 * keyed by texture (the monster overworld registry keys). Reads texture
 * dimensions + the GameObject's displayWidth/Height + whether it is a Sprite.
 */
async function monsterMarkers(page: Page, keys: string[]): Promise<MarkerInfo[]> {
  return page.evaluate((monsterKeys) => {
    const scene = (window as any).__scene;
    const children = scene?.children?.list ?? [];
    const out: MarkerInfo[] = [];
    for (const obj of children) {
      const key = obj?.texture?.key;
      if (!monsterKeys.includes(key)) continue;
      out.push({
        textureKey: key,
        frameName: obj.frame?.name,
        displayWidth: obj.displayWidth,
        displayHeight: obj.displayHeight,
        textureWidth: obj.texture.source[0].width,
        textureHeight: obj.texture.source[0].height,
        isSprite: obj.type === 'Sprite',
      });
    }
    return out;
  }, keys);
}

// ── Scenario 1: anchorage monster markers render a single 24×32 frame ─────────
test('monster marker renders a single sprite frame (not the 3×3 grid)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // forest_anchorage seeds monster NPCs → at least one monster marker is present.
  const published = await page.evaluate(() => (window as any).__overworldNpcs as Array<{ type: string }>);
  const monsterCount = published.filter((n) => n.type === 'monster').length;
  expect(monsterCount).toBeGreaterThan(0);

  const markers = await monsterMarkers(page, MONSTER_OW_KEYS);
  expect(markers.length).toBe(monsterCount);

  for (const m of markers) {
    // It must be a Sprite (add.sprite), so a frame index is resolvable.
    expect(m.isSprite).toBe(true);
    // The underlying texture is the full 72×96 sheet …
    expect(m.textureWidth).toBe(72);
    expect(m.textureHeight).toBe(96);
    // … but the marker shows ONE 24×32 frame scaled to NPC_OW_DISPLAY_SIZE.
    // (A plain image would scale the whole 72×96 sheet to the display size; the
    // bug fix means displayWidth/Height match NPC_OW_DISPLAY_SIZE exactly.)
    expect(m.displayWidth).toBeCloseTo(NPC_OW_DISPLAY_SIZE, 3);
    expect(m.displayHeight).toBeCloseTo(NPC_OW_DISPLAY_SIZE, 3);
    // The marker renders frame 0 — Phaser names spritesheet frames numerically.
    expect(String(m.frameName)).toBe('0');
  }
  await ctx.close();
});

// ── Scenario 2: all five element variants load as 24×32 spritesheets ──────────
test('all five monster element overworld textures load as 24×32 spritesheets', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // loadCommonAssets() registers every MONSTER_OW_REGISTRY key on preload, so each
  // element variant's texture exists and exposes a 24×32 frame 0 (proof it was
  // loaded as a spritesheet, not a single 72×96 image).
  const framesByKey = await page.evaluate((keys) => {
    const scene = (window as any).__scene;
    const result: Record<string, { exists: boolean; frame0Width: number; frame0Height: number }> = {};
    for (const key of keys) {
      const exists = scene.textures.exists(key);
      let frame0Width = -1;
      let frame0Height = -1;
      if (exists) {
        const frame = scene.textures.get(key).get(0);
        frame0Width = frame.width;
        frame0Height = frame.height;
      }
      result[key] = { exists, frame0Width, frame0Height };
    }
    return result;
  }, MONSTER_OW_KEYS);

  for (const key of MONSTER_OW_KEYS) {
    expect(framesByKey[key].exists).toBe(true);
    expect(framesByKey[key].frame0Width).toBe(24);
    expect(framesByKey[key].frame0Height).toBe(32);
  }
  await ctx.close();
});

// ── Scenario 3: clicking a monster marker still launches a duel ───────────────
test('double-clicking a monster marker still launches EncounterScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Pick a monster NPC and fire two pointerdowns on its marker within
  // DOUBLE_CLICK_MS to trigger the ambush-duel gesture (onNpcClick). The marker is
  // interactive regardless of being a Sprite vs Image, so this guards the fix.
  const launched = await page.evaluate(async (monsterKeys) => {
    const scene = (window as any).__scene;
    const npcs = (window as any).__overworldNpcs as Array<{ id: string; type: string }>;
    const monster = npcs.find((n) => n.type === 'monster');
    if (!monster) return false;
    const marker = (scene.children.list as any[]).find((o) => monsterKeys.includes(o?.texture?.key));
    if (!marker) return false;
    marker.emit('pointerdown');
    marker.emit('pointerdown');
    return true;
  }, MONSTER_OW_KEYS);
  expect(launched).toBe(true);

  await page.waitForFunction(() => (window as any).__activeScene === 'EncounterScene', {
    timeout: 8000,
  });
  await ctx.close();
});
