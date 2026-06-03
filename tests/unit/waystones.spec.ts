import fs from 'fs';
import path from 'path';
import { describe, test, it, expect } from 'vitest';
import { WAYSTONES, getWaystone, canTeleport } from '../../shared/waystones';
import { FOREST_SCREENS, type ScreenDef } from '../../shared/world/forest';
import { SWAMP_SCREENS } from '../../shared/world/swamp';
import { SNOW_SCREENS } from '../../shared/world/snow';

// ---------------------------------------------------------------------------
// getWaystone — catalog lookup
// ---------------------------------------------------------------------------

describe('getWaystone — id → definition lookup', () => {
  test('returns the matching definition for a known id', () => {
    const def = getWaystone('forest_glade');
    expect(def).toBeDefined();
    expect(def?.name).toBe('The Glade');
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

describe('canTeleport — current spirit vs. anchorage spiritCost', () => {
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

describe('anchorage spiritCost', () => {
  test('every entry has a non-negative spiritCost; the home Anchorage is free', () => {
    for (const w of WAYSTONES) {
      expect(typeof w.spiritCost).toBe('number');
      expect(w.spiritCost).toBeGreaterThanOrEqual(0);
    }
    expect(getWaystone('forest_entry')?.spiritCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Drift test — catalog ids must equal the combined anchorage ids across every
// biome map. Discovery waystones have been removed; only `anchorage` map
// objects remain in the catalog.
// ---------------------------------------------------------------------------

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

/** Every biome map file: the Forest per-screen maps + the Swamp map + the Snow map. */
function biomeMapPaths(): string[] {
  const forestDir = path.join(MAPS_DIR, 'forest');
  const forestMaps = fs
    .readdirSync(forestDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(forestDir, f));
  return [
    ...forestMaps,
    path.join(MAPS_DIR, 'swamp', 'swamp_entry.json'),
    path.join(MAPS_DIR, 'snow', 'snow_entry.json'),
  ];
}

/** Collect every `waystoneId` from anchorage objects across all maps. */
function collectMapAnchorageIds(): Set<string> {
  const ids = new Set<string>();
  for (const mapPath of biomeMapPaths()) {
    for (const obj of loadObjectLayerAt(mapPath)) {
      if (obj.name !== 'anchorage') continue;
      const prop = (obj.properties ?? []).find((p) => p.name === 'waystoneId');
      expect(typeof prop?.value, `${mapPath} anchorage has a string waystoneId`).toBe('string');
      ids.add(prop!.value as string);
    }
  }
  return ids;
}

describe('anchorage catalog ↔ map drift', () => {
  test('every catalog id appears on some biome map, and vice versa', () => {
    const mapIds = collectMapAnchorageIds();
    const catalogIds = new Set(WAYSTONES.map((w) => w.id));
    expect([...mapIds].sort()).toEqual([...catalogIds].sort());
  });

  test('catalog contains exactly 7 anchorages (4 Forest + 2 Swamp + 1 Snow)', () => {
    // 4 Forest (entry, glade, depths, hidden) + 2 Swamp + 1 Snow. Bump when a biome is added.
    expect(WAYSTONES.length).toBe(7);
    expect(collectMapAnchorageIds().size).toBe(7);
  });

  test('no waystone objects remain in any biome map', () => {
    for (const mapPath of biomeMapPaths()) {
      const waystones = loadObjectLayerAt(mapPath).filter((o) => o.name === 'waystone');
      expect(waystones, `${mapPath} should have no waystone objects`).toHaveLength(0);
    }
  });

  test('the Swamp map ships its biome-exit back to the Forest with a target', () => {
    const swampExit = loadObjectLayerAt(path.join(MAPS_DIR, 'swamp', 'swamp_entry.json')).find(
      (o) => o.name === 'biome_exit',
    );
    expect(swampExit).toBeDefined();
    const prop = (swampExit!.properties ?? []).find((p) => p.name === 'target');
    expect(prop?.value).toBe('ForestScene');
  });

  test('forest_swamp_gate biome_exit has no gate property', () => {
    const objs = loadObjectLayerAt(path.join(MAPS_DIR, 'forest', 'forest_swamp_gate.json'));
    const exit = objs.find((o) => o.name === 'biome_exit');
    expect(exit).toBeDefined();
    const gate = (exit!.properties ?? []).find((p) => p.name === 'gate');
    expect(gate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FOREST_SCREENS drift — reciprocal exits; anchorage ids in catalog; no
// waystone fields remain.
// ---------------------------------------------------------------------------

const OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
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

  it('all anchorage ids exist in the catalog', () => {
    const catalogIds = new Set(WAYSTONES.map((w) => w.id));
    for (const screen of [...FOREST_SCREENS, ...SWAMP_SCREENS, ...SNOW_SCREENS]) {
      if (screen.anchorage) {
        expect(
          catalogIds.has(screen.anchorage),
          `${screen.id}.anchorage '${screen.anchorage}' not in catalog`,
        ).toBe(true);
      }
    }
  });

  it('no screen carries a waystone field', () => {
    for (const screen of [...FOREST_SCREENS, ...SWAMP_SCREENS, ...SNOW_SCREENS]) {
      expect(
        'waystone' in screen,
        `${screen.id} should not have a waystone field`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// FOREST_SCREENS grid consistency — no coord collision, unit-step exits
// ---------------------------------------------------------------------------

const DELTA: Record<'north' | 'south' | 'east' | 'west', { dx: number; dy: number }> = {
  north: { dx: 0, dy: 1 },
  south: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

describe('FOREST_SCREENS grid consistency', () => {
  it('no two screens share the same coordinate', () => {
    const seen = new Map<string, string>(); // 'x,y' → screenId
    for (const screen of FOREST_SCREENS) {
      if (!screen.coord) continue; // exempt teleport-only (empty exits)
      const key = `${screen.coord.x},${screen.coord.y}`;
      expect(seen.has(key), `${screen.id} and ${seen.get(key)} share coord (${key})`).toBe(false);
      seen.set(key, screen.id);
    }
  });

  it('every exit points to the room at the adjacent unit cell', () => {
    const byCoord = new Map<string, ScreenDef>();
    for (const screen of FOREST_SCREENS) {
      if (screen.coord) byCoord.set(`${screen.coord.x},${screen.coord.y}`, screen);
    }
    for (const screen of FOREST_SCREENS) {
      if (!screen.coord) continue;
      for (const [dir, neighborId] of Object.entries(screen.exits)) {
        const delta = DELTA[dir as 'north' | 'south' | 'east' | 'west'];
        expect(delta, `Unknown direction '${dir}' in ${screen.id}.exits`).toBeDefined();
        const { dx, dy } = delta!;
        const expectedKey = `${screen.coord.x + dx},${screen.coord.y + dy}`;
        const actual = byCoord.get(expectedKey);
        expect(
          actual?.id,
          `${screen.id}.${dir} exits to ${neighborId} but the room at ${expectedKey} is ${actual?.id ?? 'nothing'}`,
        ).toBe(neighborId);
      }
    }
  });
});
