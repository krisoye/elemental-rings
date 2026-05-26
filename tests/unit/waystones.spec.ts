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
// Drift test — catalog ids must equal the map's waystone object ids
// ---------------------------------------------------------------------------

describe('waystone catalog ↔ map drift', () => {
  test('every map waystone object id matches a catalog id, and vice versa', () => {
    const mapPath = path.resolve(
      __dirname,
      '../../client/public/assets/maps/overworld.json',
    );
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
      layers: Array<{
        name: string;
        type: string;
        objects?: Array<{ name?: string; properties?: Array<{ name: string; value: unknown }> }>;
      }>;
    };

    const objectLayer = map.layers.find((l) => l.type === 'objectgroup');
    expect(objectLayer).toBeDefined();

    const mapIds = new Set<string>();
    for (const obj of objectLayer?.objects ?? []) {
      if (obj.name !== 'waystone') continue;
      const prop = (obj.properties ?? []).find((p) => p.name === 'waystoneId');
      expect(typeof prop?.value).toBe('string');
      mapIds.add(prop!.value as string);
    }

    const catalogIds = new Set(WAYSTONES.map((w) => w.id));
    expect([...mapIds].sort()).toEqual([...catalogIds].sort());
  });
});
