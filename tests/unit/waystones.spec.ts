import fs from 'fs';
import path from 'path';
import { describe, test, it, expect } from 'vitest';
import { WAYSTONES, getWaystone, canTeleport } from '../../shared/waystones';
import { FOREST_SCREENS } from '../../shared/world/forest';
import { SWAMP_SCREENS } from '../../shared/world/swamp';

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
// canTeleport — pure teleport-gate predicate (§10.8 spirit gate, #87 Part B)
// ---------------------------------------------------------------------------

describe('canTeleport — current spirit vs. waystone spiritCost', () => {
  test('forest_entry (spiritCost 0) is always teleportable, even at 0 spirit', () => {
    expect(canTeleport(0, 'forest_entry')).toBe(true);
  });

  test('below the spirit cost → false', () => {
    expect(canTeleport(2, 'forest_glade')).toBe(false); // needs 3
    expect(canTeleport(5, 'forest_depths')).toBe(false); // needs 6
  });

  test('exactly at the cost → true (inclusive boundary)', () => {
    expect(canTeleport(3, 'forest_glade')).toBe(true);
    expect(canTeleport(6, 'forest_depths')).toBe(true);
  });

  test('above the cost → true', () => {
    expect(canTeleport(50, 'forest_glade')).toBe(true);
    expect(canTeleport(50, 'forest_depths')).toBe(true);
  });

  test('unknown id → false regardless of spirit', () => {
    expect(canTeleport(0, 'nope')).toBe(false);
    expect(canTeleport(99999, 'nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spiritCost — every catalog entry carries a non-negative cost (#87 Part B)
// ---------------------------------------------------------------------------

describe('waystone spiritCost', () => {
  test('every entry has a non-negative spiritCost; the home Anchorage is free', () => {
    for (const w of WAYSTONES) {
      expect(typeof w.spiritCost).toBe('number');
      expect(w.spiritCost).toBeGreaterThanOrEqual(0);
    }
    expect(getWaystone('forest_entry')?.spiritCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Drift test — catalog ids must equal the COMBINED catalog-backed object ids
// across every biome map
// ---------------------------------------------------------------------------
// Catalog-backed locations carry a `waystoneId` property on a map. They come in
// two flavours: `anchorage` objects (home base / teleport destinations) and
// `waystone` objects (discovery standing-stones). As of 8E the Forest's catalog
// objects are placed across the per-screen maps generated into
// client/public/assets/maps/forest/ (one .json per FOREST_SCREENS entry); the
// Swamp ships its catalog objects in swamp.json. The union of all `waystoneId`s
// across every Forest screen + the Swamp map must equal the catalog id-set (no map
// ships a waystone the catalog lacks, and no catalog entry is unplaced).
// `biome_exit` objects carry a `target` (scene key) — NOT a `waystoneId` — so they
// are excluded.

interface MapObject {
  name?: string;
  properties?: Array<{ name: string; value: unknown }>;
}

const MAPS_DIR = path.resolve(__dirname, '../../client/public/assets/maps');

function loadObjectLayerAt(absMapPath: string): MapObject[] {
  const map = JSON.parse(fs.readFileSync(absMapPath, 'utf8')) as {
    layers: Array<{ name: string; type: string; objects?: MapObject[] }>;
  };
  const objectLayer = map.layers.find((l) => l.type === 'objectgroup');
  expect(objectLayer, `${absMapPath} has an objectgroup layer`).toBeDefined();
  return objectLayer?.objects ?? [];
}

/** Every biome map file: the Forest per-screen maps + the Swamp map. */
function biomeMapPaths(): string[] {
  const forestDir = path.join(MAPS_DIR, 'forest');
  const forestMaps = fs
    .readdirSync(forestDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(forestDir, f));
  return [...forestMaps, path.join(MAPS_DIR, 'swamp', 'swamp_entry.json')];
}

/** Collect every `waystoneId` from the anchorage/waystone objects across all maps. */
function collectMapWaystoneIds(): Set<string> {
  const ids = new Set<string>();
  for (const mapPath of biomeMapPaths()) {
    for (const obj of loadObjectLayerAt(mapPath)) {
      if (obj.name !== 'anchorage' && obj.name !== 'waystone') continue;
      const prop = (obj.properties ?? []).find((p) => p.name === 'waystoneId');
      expect(typeof prop?.value, `${mapPath} ${obj.name} has a string waystoneId`).toBe('string');
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

  test('combined catalog spans 12 waystones (7 Forest + 5 Swamp)', () => {
    // 7 Forest (incl. the 2 hidden alcove ids) + 5 Swamp. Guards against silent
    // catalog regressions; bump deliberately when a biome is added.
    expect(WAYSTONES.length).toBeGreaterThanOrEqual(12);
    expect(collectMapWaystoneIds().size).toBe(WAYSTONES.length);
  });

  test('the Swamp map ships its biome-exit back to the Forest with a target', () => {
    const swampExit = loadObjectLayerAt(path.join(MAPS_DIR, 'swamp', 'swamp_entry.json')).find(
      (o) => o.name === 'biome_exit',
    );
    expect(swampExit).toBeDefined();
    const prop = (swampExit!.properties ?? []).find((p) => p.name === 'target');
    expect(prop?.value).toBe('ForestScene');
  });
});

// ---------------------------------------------------------------------------
// FOREST_SCREENS drift — the 8E Forest screen manifest must be internally
// consistent (reciprocal exits) and reference only real catalog waystone ids.
// ---------------------------------------------------------------------------

const OPPOSITE: Record<string, string> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

describe('FOREST_SCREENS drift', () => {
  it('all exits are reciprocal', () => {
    for (const screen of FOREST_SCREENS) {
      for (const [dir, neighborId] of Object.entries(screen.exits)) {
        const neighbor = FOREST_SCREENS.find((s) => s.id === neighborId);
        expect(neighbor, `${screen.id}.${dir} → ${neighborId} has no matching ScreenDef`).toBeTruthy();
        const oppositeDir = OPPOSITE[dir];
        expect(
          (neighbor!.exits as Record<string, string>)[oppositeDir],
          `${neighborId}.${oppositeDir} should point back to ${screen.id}`,
        ).toBe(screen.id);
      }
    }
  });

  it('all anchorage/waystone ids exist in WAYSTONES catalog', () => {
    const waystoneIds = new Set(WAYSTONES.map((w) => w.id));
    for (const screen of FOREST_SCREENS) {
      if (screen.anchorage) {
        expect(
          waystoneIds.has(screen.anchorage),
          `${screen.id}.anchorage '${screen.anchorage}' not in catalog`,
        ).toBe(true);
      }
      if (screen.waystone) {
        expect(
          waystoneIds.has(screen.waystone),
          `${screen.id}.waystone '${screen.waystone}' not in catalog`,
        ).toBe(true);
      }
    }
  });
});
