// Map-integrity Vitest suite for the generated 16px Forest + Swamp screens
// (EPIC #149 / #160). Validates the static map JSON the generators emit:
//   - format: 16px tiles, the 4 named layers, the 6-tileset firstgid contract,
//   - collision: every water/cliff autotile id (0–47) carries collides:true,
//   - traversal: BFS from the spawn object reaches at least one cell on every
//     declared exit edge (walkable = ground GID not colliding AND behind GID === 0),
//   - object walkability: spawn / anchorage / waystone objects sit on walkable tiles.
//
// Run via `npm run test:unit` (which runs `cd server && vitest run ../tests/unit`).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { FOREST_SCREENS } from '../../shared/world/forest';
import { SWAMP_SCREENS } from '../../shared/world/swamp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = path.resolve(__dirname, '../../client/public/assets/maps');

interface TiledTile {
  id: number;
  properties?: Array<{ name: string; value: unknown }>;
}
interface TiledTileset {
  firstgid: number;
  name: string;
  tilecount: number;
  tiles?: TiledTile[];
}
interface TiledObject {
  name: string;
  x: number;
  y: number;
}
interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
}
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

function loadMap(biome: string, file: string): TiledMap {
  return JSON.parse(fs.readFileSync(path.join(MAPS_DIR, biome, file), 'utf8')) as TiledMap;
}

function layerData(map: TiledMap, name: string): number[] {
  return map.layers.find((l) => l.name === name && l.type === 'tilelayer')?.data ?? [];
}

function objectsLayer(map: TiledMap): TiledObject[] {
  return map.layers.find((l) => l.type === 'objectgroup')?.objects ?? [];
}

/** GIDs that carry collides:true, read from the tileset tile-property definitions. */
function collidingGids(map: TiledMap): Set<number> {
  const gids = new Set<number>();
  for (const ts of map.tilesets) {
    for (const tile of ts.tiles ?? []) {
      const collides = tile.properties?.find((p) => p.name === 'collides' && p.value === true);
      if (collides) gids.add(ts.firstgid + tile.id);
    }
  }
  return gids;
}

/** 4-neighbour BFS over a boolean walkable grid; returns the set of "col,row" keys. */
function bfsReach(
  walkable: boolean[][],
  cols: number,
  rows: number,
  startCol: number,
  startRow: number,
): Set<string> {
  const key = (c: number, r: number): string => `${c},${r}`;
  const visited = new Set<string>();
  if (!walkable[startRow]?.[startCol]) return visited;
  const queue: Array<[number, number]> = [[startCol, startRow]];
  visited.add(key(startCol, startRow));
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const k = key(nc, nr);
      if (!visited.has(k) && walkable[nr][nc]) {
        visited.add(k);
        queue.push([nc, nr]);
      }
    }
  }
  return visited;
}

/** Build the walkable grid: ground GID not colliding AND behind GID === 0 (empty). */
function walkableGrid(map: TiledMap): boolean[][] {
  const { width: W, height: H } = map;
  const ground = layerData(map, 'ground');
  const behind = layerData(map, 'behind');
  const colliding = collidingGids(map);
  const at = (tx: number, ty: number): number => ty * W + tx;
  return Array.from({ length: H }, (_, row) =>
    Array.from({ length: W }, (_, col) => {
      const g = ground[at(col, row)];
      const b = behind[at(col, row)];
      return !colliding.has(g) && b === 0;
    }),
  );
}

// Screens the developer authors by hand in Tiled (mirrors HAND_AUTHORED_SCREENS in
// gen-forest-screens.mjs). These keep the legacy autotile 6-tileset firstgid
// contract; the generator never overwrites them. The remaining non-hub screens are
// emitted by the generator with the curated-palette contract.
const HAND_AUTHORED = new Set([
  'forest_boss_clearing', 'forest_briar_pass', 'forest_crossroads',
  'forest_deepwood', 'forest_east_path', 'forest_glade',
  'forest_hidden_alcove', 'forest_hollow', 'forest_mossy_fen',
  'forest_north_road', 'forest_ridge', 'forest_snow_gate',
  'forest_south_path', 'forest_swamp_gate',
]);

const NON_HUB = FOREST_SCREENS.filter((s) => s.id !== 'forest_anchorage');
const GENERATED = NON_HUB.filter((s) => !HAND_AUTHORED.has(s.id));
const HAND_AUTHORED_SCREENS = NON_HUB.filter((s) => HAND_AUTHORED.has(s.id));

// firstgid contracts: the curated-palette generated maps vs the legacy autotile
// maps still used by the hand-authored screens.
const GENERATED_FIRSTGIDS = [1, 49, 169, 224, 480, 736];
const LEGACY_FIRSTGIDS = [1, 49, 97, 145, 193, 313];

describe('generated map format', () => {
  for (const screen of GENERATED) {
    it(`${screen.id}: 16px tile size, 4 named layers, 6 tilesets with the curated firstgid contract`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      expect(map.tilewidth).toBe(16);
      expect(map.tileheight).toBe(16);
      expect(map.layers.map((l) => l.name)).toEqual(
        expect.arrayContaining(['ground', 'behind', 'in-front', 'objects']),
      );
      expect(map.tilesets).toHaveLength(6);
      expect(map.tilesets.map((t) => t.firstgid)).toEqual(GENERATED_FIRSTGIDS);
    });
  }
});

describe('hand-authored map format', () => {
  for (const screen of HAND_AUTHORED_SCREENS) {
    it(`${screen.id}: 16px tile size, 4 named layers, legacy firstgid contract`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      expect(map.tilewidth).toBe(16);
      expect(map.tileheight).toBe(16);
      expect(map.layers.map((l) => l.name)).toEqual(
        expect.arrayContaining(['ground', 'behind', 'in-front', 'objects']),
      );
      expect(map.tilesets.map((t) => t.firstgid)).toEqual(LEGACY_FIRSTGIDS);
    });
  }
});

describe('water tiles collide', () => {
  // The curated generated maps drop the autotile_cliff strip — cliff collision now
  // comes from the non-empty `behind` trunk layer. Only the surviving
  // autotile_water_16 ponds carry per-tile collides:true.
  for (const screen of GENERATED) {
    it(`${screen.id}: every water GID id 0–47 carries collides:true`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      const water = map.tilesets.find((t) => t.name === 'autotile_water_16')!;
      for (let id = 0; id < 48; id++) {
        const tile = water.tiles?.find((t) => t.id === id);
        const has = tile?.properties?.some((p) => p.name === 'collides' && p.value === true);
        expect(has, `${screen.id} ${water.name} tile ${id} missing collides:true`).toBe(true);
      }
    });
  }
});

describe('hand-authored water and cliff tiles collide', () => {
  for (const screen of HAND_AUTHORED_SCREENS) {
    it(`${screen.id}: every water/cliff GID id 0–47 carries collides:true`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      const water = map.tilesets.find((t) => t.name === 'autotile_water_16')!;
      const cliff = map.tilesets.find((t) => t.name === 'autotile_cliff_16')!;
      for (const ts of [water, cliff]) {
        for (let id = 0; id < 48; id++) {
          const tile = ts.tiles?.find((t) => t.id === id);
          const has = tile?.properties?.some((p) => p.name === 'collides' && p.value === true);
          expect(has, `${screen.id} ${ts.name} tile ${id} missing collides:true`).toBe(true);
        }
      }
    });
  }
});

describe('exit-gap traversal', () => {
  for (const screen of NON_HUB) {
    it(`${screen.id}: spawn reaches every declared exit edge`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      const { width: W, height: H } = map;
      const walkable = walkableGrid(map);

      const spawn = objectsLayer(map).find((o) => o.name === 'spawn');
      expect(spawn, `${screen.id} missing spawn object`).toBeDefined();
      const spawnCol = Math.floor(spawn!.x / 16);
      const spawnRow = Math.floor(spawn!.y / 16);
      const reachable = bfsReach(walkable, W, H, spawnCol, spawnRow);

      // forest_hidden_alcove has no exits → the loop body is skipped (graceful).
      for (const dir of Object.keys(screen.exits ?? {})) {
        let found = false;
        if (dir === 'north') {
          for (let c = 0; c < W; c++) if (reachable.has(`${c},0`)) found = true;
        } else if (dir === 'south') {
          for (let c = 0; c < W; c++) if (reachable.has(`${c},${H - 1}`)) found = true;
        } else if (dir === 'west') {
          for (let r = 0; r < H; r++) if (reachable.has(`0,${r}`)) found = true;
        } else if (dir === 'east') {
          for (let r = 0; r < H; r++) if (reachable.has(`${W - 1},${r}`)) found = true;
        }
        expect(found, `${screen.id}: spawn not reachable from ${dir} exit`).toBe(true);
      }
    });
  }
});

describe('object tiles are walkable', () => {
  for (const screen of NON_HUB) {
    it(`${screen.id}: spawn/anchorage/waystone objects sit on walkable tiles`, () => {
      const map = loadMap('forest', `${screen.id}.json`);
      const walkable = walkableGrid(map);
      for (const obj of objectsLayer(map)) {
        if (!['spawn', 'anchorage', 'waystone'].includes(obj.name)) continue;
        const col = Math.floor(obj.x / 16);
        const row = Math.floor(obj.y / 16);
        expect(
          walkable[row]?.[col],
          `${screen.id}: ${obj.name} at (${col},${row}) is on a blocking tile`,
        ).toBe(true);
      }
    });
  }
});

describe('swamp map integrity', () => {
  const screen = SWAMP_SCREENS[0];

  it('format: 16px, 4 layers, 6-tileset firstgid contract', () => {
    const map = loadMap('swamp', 'swamp_entry.json');
    expect(map.tilewidth).toBe(16);
    expect(map.layers.map((l) => l.name)).toEqual(
      expect.arrayContaining(['ground', 'behind', 'in-front', 'objects']),
    );
    expect(map.tilesets.map((t) => t.firstgid)).toEqual([1, 49, 97, 145, 193, 313]);
  });

  it('water/cliff tiles collide', () => {
    const map = loadMap('swamp', 'swamp_entry.json');
    for (const name of ['autotile_water_16', 'autotile_cliff_16']) {
      const ts = map.tilesets.find((t) => t.name === name)!;
      for (let id = 0; id < 48; id++) {
        const tile = ts.tiles?.find((t) => t.id === id);
        const has = tile?.properties?.some((p) => p.name === 'collides' && p.value === true);
        expect(has, `swamp ${name} tile ${id} missing collides:true`).toBe(true);
      }
    }
  });

  it('spawn reaches the north biome-exit edge', () => {
    const map = loadMap('swamp', 'swamp_entry.json');
    const { width: W, height: H } = map;
    const walkable = walkableGrid(map);
    const spawn = objectsLayer(map).find((o) => o.name === 'spawn')!;
    const reachable = bfsReach(
      walkable,
      W,
      H,
      Math.floor(spawn.x / 16),
      Math.floor(spawn.y / 16),
    );
    expect(screen.size[0]).toBe(W); // sanity: manifest matches map
    let found = false;
    for (let c = 0; c < W; c++) if (reachable.has(`${c},0`)) found = true;
    expect(found, 'swamp spawn not reachable from the north biome-exit edge').toBe(true);
  });
});
