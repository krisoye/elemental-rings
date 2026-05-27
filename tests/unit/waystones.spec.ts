import fs from 'fs';
import path from 'path';
import { describe, test, expect } from 'vitest';
import { WAYSTONES, getWaystone, canTeleport } from '../../shared/waystones';

// ---------------------------------------------------------------------------
// getWaystone — catalog lookup
// ---------------------------------------------------------------------------

describe('getWaystone — id → definition lookup', () => {
  test('returns the matching definition for a known id', () => {
    const def = getWaystone('forest_glade');
    expect(def).toBeDefined();
    expect(def?.name).toBe('Glade Waystone');
    expect(def?.xpThreshold).toBe(100);
    expect(def?.biome).toBe('forest');
  });

  test('returns undefined for an unknown id', () => {
    expect(getWaystone('nope')).toBeUndefined();
    expect(getWaystone('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// canTeleport — pure teleport-gate predicate (8B.3)
// ---------------------------------------------------------------------------

describe('canTeleport — aggregate XP vs. waystone threshold', () => {
  test('forest_entry (threshold 0) is always teleportable, even at 0 XP', () => {
    expect(canTeleport(0, 'forest_entry')).toBe(true);
  });

  test('below threshold → false', () => {
    expect(canTeleport(99, 'forest_glade')).toBe(false); // needs 100
    expect(canTeleport(299, 'forest_depths')).toBe(false); // needs 300
  });

  test('exactly at threshold → true (inclusive boundary)', () => {
    expect(canTeleport(100, 'forest_glade')).toBe(true);
    expect(canTeleport(300, 'forest_depths')).toBe(true);
  });

  test('above threshold → true', () => {
    expect(canTeleport(500, 'forest_glade')).toBe(true);
    expect(canTeleport(1000, 'forest_depths')).toBe(true);
  });

  test('unknown id → false regardless of XP', () => {
    expect(canTeleport(0, 'nope')).toBe(false);
    expect(canTeleport(99999, 'nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drift test — catalog ids must equal the COMBINED catalog-backed object ids
// across every biome map
// ---------------------------------------------------------------------------
// Catalog-backed locations carry a `waystoneId` property on the map. After the
// visual split (#79) they come in two flavours: `anchorage` objects (home base /
// teleport destinations, rendered as campfire + ground ring) and `waystone`
// objects (discovery standing-stones that reveal adjacent biomes). As of 8C.2
// (#82) the catalog spans THREE maps — the Forest overworld, the Swamp, and the
// hidden Forest alcove. The union of all `waystoneId`s across all three maps must
// equal the catalog id-set (no map ships a waystone the catalog lacks, and no
// catalog entry is unplaced). `biome_exit` / `return_exit` objects carry a
// `target` (scene key) — NOT a `waystoneId` — so they are excluded.

interface MapObject {
  name?: string;
  properties?: Array<{ name: string; value: unknown }>;
}

const BIOME_MAPS = ['overworld.json', 'swamp.json', 'forest_hidden.json'] as const;

function loadObjectLayer(mapFile: string): MapObject[] {
  const mapPath = path.resolve(__dirname, '../../client/public/assets/maps', mapFile);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
    layers: Array<{ name: string; type: string; objects?: MapObject[] }>;
  };
  const objectLayer = map.layers.find((l) => l.type === 'objectgroup');
  expect(objectLayer, `${mapFile} has an objectgroup layer`).toBeDefined();
  return objectLayer?.objects ?? [];
}

/** Collect every `waystoneId` from the anchorage/waystone objects across all maps. */
function collectMapWaystoneIds(): Set<string> {
  const ids = new Set<string>();
  for (const mapFile of BIOME_MAPS) {
    for (const obj of loadObjectLayer(mapFile)) {
      if (obj.name !== 'anchorage' && obj.name !== 'waystone') continue;
      const prop = (obj.properties ?? []).find((p) => p.name === 'waystoneId');
      expect(typeof prop?.value, `${mapFile} ${obj.name} has a string waystoneId`).toBe('string');
      ids.add(prop!.value as string);
    }
  }
  return ids;
}

describe('waystone catalog ↔ map drift', () => {
  test('every catalog id appears on some biome map (anchorage or waystone), and vice versa', () => {
    const mapIds = collectMapWaystoneIds();
    const catalogIds = new Set(WAYSTONES.map((w) => w.id));
    expect([...mapIds].sort()).toEqual([...catalogIds].sort());
  });

  test('combined catalog spans 12 waystones (5 Forest + 5 Swamp + 2 hidden Forest)', () => {
    // 5 Forest (8B), 5 Swamp + 2 hidden-Forest (8C.2). Guards against silent
    // catalog regressions; bump deliberately when a biome is added.
    expect(WAYSTONES.length).toBeGreaterThanOrEqual(12);
    expect(collectMapWaystoneIds().size).toBe(WAYSTONES.length);
  });

  test('overworld ships 3 anchorages + 2 discovery waystones; swamp ships 2 + 3; hidden 1 + 1', () => {
    const count = (mapFile: string, name: string): number =>
      loadObjectLayer(mapFile).filter((o) => o.name === name).length;
    expect(count('overworld.json', 'anchorage')).toBe(3);
    expect(count('overworld.json', 'waystone')).toBe(2);
    expect(count('swamp.json', 'anchorage')).toBe(2);
    expect(count('swamp.json', 'waystone')).toBe(3);
    expect(count('forest_hidden.json', 'anchorage')).toBe(1);
    expect(count('forest_hidden.json', 'waystone')).toBe(1);
  });

  test('Forest→Swamp and return transitions ship as biome-exit objects with a target', () => {
    // The Forest overworld exits SW to the Swamp; the Swamp exits NW back to the
    // Forest; the hidden alcove returns to the Forest. Each carries a `target`.
    const overworldExit = loadObjectLayer('overworld.json').find((o) => o.name === 'biome_exit');
    const swampExit = loadObjectLayer('swamp.json').find((o) => o.name === 'biome_exit');
    const hiddenReturn = loadObjectLayer('forest_hidden.json').find((o) => o.name === 'return_exit');
    for (const [obj, target] of [
      [overworldExit, 'SwampScene'],
      [swampExit, 'OverworldScene'],
      [hiddenReturn, 'OverworldScene'],
    ] as const) {
      expect(obj).toBeDefined();
      const prop = (obj!.properties ?? []).find((p) => p.name === 'target');
      expect(prop?.value).toBe(target);
    }
  });
});
