// Deterministic generator for the Phase 8E Forest region screens (GDD §10.17).
//
// Reads the Forest screen manifest (FOREST_SCREENS, mirrored inline below from
// shared/world/forest.ts — a Node .mjs cannot import the TS module) and writes one
// Tiled 1.10 JSON map per screen to client/public/assets/maps/forest/<id>.json.
// Pure, reproducible output: re-running produces no spurious diff (the only
// randomness, grove placement on open screens, is seeded by a hash of the screen
// id). Uses the shared forest tileset + a Tiled 1.10 ground/objects layer structure.
//
// Tile GIDs into the shared forest tileset (firstgid = 1, forest.png is 128×32 = 4
// tiles wide): GID 1 = void (never placed), GID 2 = floor (walkable), GID 3 =
// wall/tree (collides: true), GID 4 = accent/dirt path (walkable).
//
// Every screen — including the hub `forest_anchorage` — is generated here and loaded
// by ForestScene uniformly (the legacy overworld.json exception was removed in #107).
// Each screen with cardinal exits gets a 4-tile-wide OPEN GAP carved into its
// perimeter wall at each exit's edge midpoint, so walking into that edge triggers the
// BaseBiomeScene edge transition to the neighbouring screen. The hub is the `safe`
// screen and is kept grove-free so the seeded NPC roster never lands inside a tree.
//
// Run from the client/ directory:  node scripts/gen-forest-screens.mjs
// (or `npm run gen:forest-screens`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 32;

const GID_FLOOR = 2;
const GID_WALL = 3;
const GID_ACCENT = 4;

// ── Inlined copy of shared/world/forest.ts FOREST_SCREENS (kept in sync; a Vitest
// drift test guards the TS manifest's reciprocity + catalog parity). ────────────
const FOREST_SCREENS = [
  {
    id: 'forest_anchorage',
    size: [40, 30],
    exits: { north: 'forest_north_road', east: 'forest_east_path', south: 'forest_south_path', west: 'forest_mossy_fen' },
    safe: true,
    anchorage: 'forest_entry',
  },
  { id: 'forest_north_road', size: [16, 32], exits: { south: 'forest_anchorage', north: 'forest_snow_gate' }, danger: 1 },
  { id: 'forest_snow_gate', size: [32, 20], exits: { south: 'forest_north_road' }, danger: 2, waystone: 'forest_north_stone' },
  { id: 'forest_mossy_fen', size: [32, 22], exits: { east: 'forest_anchorage' }, danger: 1 },
  { id: 'forest_east_path', size: [24, 12], exits: { west: 'forest_anchorage', east: 'forest_glade' }, danger: 1 },
  { id: 'forest_glade', size: [36, 28], exits: { west: 'forest_east_path', north: 'forest_crossroads' }, danger: 1, anchorage: 'forest_glade' },
  { id: 'forest_crossroads', size: [28, 22], exits: { south: 'forest_glade', east: 'forest_briar_pass', north: 'forest_ridge' }, danger: 1 },
  { id: 'forest_south_path', size: [16, 28], exits: { north: 'forest_anchorage', south: 'forest_hollow' }, danger: 1 },
  { id: 'forest_hollow', size: [36, 24], exits: { north: 'forest_south_path', west: 'forest_swamp_gate' }, danger: 2 },
  {
    id: 'forest_swamp_gate',
    size: [28, 18],
    exits: { east: 'forest_hollow' },
    danger: 2,
    waystone: 'forest_sw_stone',
    biomeExit: { dir: 'south', target: 'SwampScene', gate: 'forest_sw_stone' },
  },
  { id: 'forest_briar_pass', size: [40, 16], exits: { west: 'forest_crossroads', south: 'forest_boss_clearing' }, danger: 2 },
  { id: 'forest_ridge', size: [32, 22], exits: { south: 'forest_crossroads', east: 'forest_deepwood' }, danger: 2 },
  { id: 'forest_deepwood', size: [40, 30], exits: { west: 'forest_ridge', east: 'forest_boss_clearing' }, danger: 3, anchorage: 'forest_depths' },
  { id: 'forest_boss_clearing', size: [28, 22], exits: { north: 'forest_briar_pass', west: 'forest_deepwood' }, danger: 3 },
  {
    id: 'forest_hidden_alcove',
    size: [24, 18],
    exits: {},
    danger: 1,
    anchorage: 'forest_hidden_anchor',
    waystone: 'forest_hidden_glade',
  },
];

/** A short axis (< this many tiles) marks a corridor screen (tree-walled sides). */
const CORRIDOR_THRESHOLD = 20;
/** Half-width (tiles) of the clear gap opened in a corridor wall at an exit. */
const GAP_HALF = 2;

/** Deterministic 32-bit hash of a string (FNV-1a) → a stable per-screen seed. */
function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tiny seeded LCG PRNG → reproducible grove placement. */
function makeRng(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Draw a Bresenham line from (x0,y0) to (x1,y1), painting GID_ACCENT (dirt path)
 * with a 1-tile cross brush so the path reads ~3 tiles wide.
 */
function bresenhamPath(data, w, h, x0, y0, x1, y1) {
  const at = (tx, ty) => ty * w + tx;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const px = x + ox;
      const py = y + oy;
      if (px > 0 && py > 0 && px < w - 1 && py < h - 1) {
        data[at(px, py)] = GID_ACCENT;
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Clamp a tile index to the interior span [1, dim-2] (never a corner tile). */
function clampTile(t, dim) {
  return Math.max(1, Math.min(dim - 2, t));
}

/** Tile midpoint of a screen edge in the given direction. */
function edgeMidpoint(dir, w, h) {
  switch (dir) {
    case 'north':
      return { tx: (w / 2) | 0, ty: 1 };
    case 'south':
      return { tx: (w / 2) | 0, ty: h - 2 };
    case 'west':
      return { tx: 1, ty: (h / 2) | 0 };
    case 'east':
      return { tx: w - 2, ty: (h / 2) | 0 };
    default:
      return { tx: (w / 2) | 0, ty: (h / 2) | 0 };
  }
}

/** Build the flat ground-layer GID array (row-major, top-down) for one screen. */
function buildGround(screen) {
  const [w, h] = screen.size;
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(GID_FLOOR);

  // 1. Perimeter walls.
  for (let x = 0; x < w; x++) {
    data[at(x, 0)] = GID_WALL;
    data[at(x, h - 1)] = GID_WALL;
  }
  for (let y = 0; y < h; y++) {
    data[at(0, y)] = GID_WALL;
    data[at(w - 1, y)] = GID_WALL;
  }

  const dirs = Object.keys(screen.exits);
  const isCorridor = Math.min(w, h) < CORRIDOR_THRESHOLD;

  if (isCorridor) {
    // Corridor: tree walls flank the long axis, leaving a 4-tile path in the center.
    if (w < h) {
      // Short axis on x → tree walls on x=1..3 and x=w-4..w-2.
      for (let y = 1; y < h - 1; y++) {
        for (const tx of [1, 2, 3, w - 4, w - 3, w - 2]) {
          if (tx > 0 && tx < w - 1) data[at(tx, y)] = GID_WALL;
        }
      }
    } else {
      // Short axis on y → tree walls on y=1..3 and y=h-4..h-2.
      for (let x = 1; x < w - 1; x++) {
        for (const ty of [1, 2, 3, h - 4, h - 3, h - 2]) {
          if (ty > 0 && ty < h - 1) data[at(x, ty)] = GID_FLOOR; // ensure base
        }
        for (const ty of [1, 2, 3, h - 4, h - 3, h - 2]) {
          if (ty > 0 && ty < h - 1) data[at(x, ty)] = GID_WALL;
        }
      }
    }
    // Clear a gap in the corridor walls at each exit so the path is reachable.
    for (const dir of dirs) {
      const m = edgeMidpoint(dir, w, h);
      for (let d = -GAP_HALF; d <= GAP_HALF; d++) {
        if (dir === 'north' || dir === 'south') {
          // Open a vertical channel near the exit's x, clearing the flanking walls.
          for (let y = 1; y < h - 1; y++) {
            const tx = m.tx + d;
            if (tx > 0 && tx < w - 1) data[at(tx, y)] = GID_FLOOR;
          }
        } else {
          for (let x = 1; x < w - 1; x++) {
            const ty = m.ty + d;
            if (ty > 0 && ty < h - 1) data[at(x, ty)] = GID_FLOOR;
          }
        }
      }
    }
  } else if (!screen.safe) {
    // Open screen: scatter 3–5 deterministic grove circles (radius 2–3). The hub
    // (`safe`) screen is left grove-free so the seeded NPC roster — placed by tile
    // index, not by map object — never spawns inside a tree.
    const rng = makeRng(hashSeed(screen.id));
    const groveCount = 3 + Math.floor(rng() * 3); // 3..5
    for (let i = 0; i < groveCount; i++) {
      const r = 2 + Math.floor(rng() * 2); // 2..3
      const cx = 2 + Math.floor(rng() * (w - 4));
      const cy = 2 + Math.floor(rng() * (h - 4));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1) continue;
          data[at(tx, ty)] = GID_WALL;
        }
      }
    }
  }

  // Perimeter gaps: carve a 4-tile-wide (2*GAP_HALF) OPEN FLOOR span out of the
  // perimeter wall at each exit's edge midpoint, so the player can walk into that
  // edge and trigger the BaseBiomeScene edge transition. Without this the perimeter
  // is solid and the manifest exits are unreachable on foot (the #107 hub bug).
  for (const dir of dirs) {
    const m = edgeMidpoint(dir, w, h);
    for (let d = -GAP_HALF + 1; d <= GAP_HALF; d++) {
      if (dir === 'north') data[at(clampTile(m.tx + d, w), 0)] = GID_FLOOR;
      else if (dir === 'south') data[at(clampTile(m.tx + d, w), h - 1)] = GID_FLOOR;
      else if (dir === 'west') data[at(0, clampTile(m.ty + d, h))] = GID_FLOOR;
      else if (dir === 'east') data[at(w - 1, clampTile(m.ty + d, h))] = GID_FLOOR;
    }
  }

  // Dirt paths connecting every exit's edge midpoint to the screen center, so all
  // exits are joined by a walkable path (carved through any groves/corridor walls).
  const cx = (w / 2) | 0;
  const cy = (h / 2) | 0;
  for (const dir of dirs) {
    const m = edgeMidpoint(dir, w, h);
    bresenhamPath(data, w, h, m.tx, m.ty, cx, cy);
  }
  // The biome_exit edge also gets a path so it is reachable on foot.
  if (screen.biomeExit) {
    const m = edgeMidpoint(screen.biomeExit.dir, w, h);
    bresenhamPath(data, w, h, m.tx, m.ty, cx, cy);
  }

  // Anchorage clearing: a 5×5 floor area at center + a small accent campfire ring.
  if (screen.anchorage) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1) continue;
        data[at(tx, ty)] = GID_FLOOR;
      }
    }
    // Accent ring (4 cardinals around the center) — a campfire ring highlight.
    for (const [ox, oy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const tx = cx + ox;
      const ty = cy + oy;
      if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) data[at(tx, ty)] = GID_ACCENT;
    }
  }

  return data;
}

/** Build the `objects` layer for one screen. */
function buildObjects(screen) {
  const [w, h] = screen.size;
  const mapW = w * TILE;
  const mapH = h * TILE;
  const cx = ((w / 2) | 0) * TILE + TILE / 2;
  const cy = ((h / 2) | 0) * TILE + TILE / 2;
  const objects = [];
  let nextId = 1;

  // Spawn point: at one of the exit edge midpoints (prefer south, else first exit).
  const exitDirs = Object.keys(screen.exits);
  const spawnDir = exitDirs.includes('south') ? 'south' : exitDirs[0];
  if (spawnDir) {
    const m = edgeMidpoint(spawnDir, w, h);
    objects.push({
      id: nextId++,
      name: 'spawn',
      x: m.tx * TILE + TILE / 2,
      y: m.ty * TILE + TILE / 2,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
    });
  } else {
    // No exits (the hidden alcove) — spawn at center.
    objects.push({
      id: nextId++,
      name: 'spawn',
      x: cx,
      y: cy,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
    });
  }

  // Anchorage object at the clearing center (+ sanctum_return on the hub).
  if (screen.anchorage) {
    objects.push({
      id: nextId++,
      name: 'anchorage',
      x: cx - TILE / 2,
      y: cy - TILE / 2,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: screen.anchorage }],
    });
    if (screen.id === 'forest_anchorage') {
      objects.push({
        id: nextId++,
        name: 'sanctum_return',
        x: cx - TILE,
        y: cy - TILE,
        width: TILE * 2,
        height: TILE * 2,
        rotation: 0,
        visible: true,
        point: false,
      });
    }
  }

  // Discovery waystone at (mapW*0.6, mapH*0.4).
  if (screen.waystone) {
    objects.push({
      id: nextId++,
      name: 'waystone',
      x: mapW * 0.6 - TILE / 2,
      y: mapH * 0.4 - TILE / 2,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: screen.waystone }],
    });
  }

  // Biome-exit at its edge midpoint. Carries `target` (destination scene key) and,
  // when gated, `gate` (the attunement waystoneId that unlocks it).
  if (screen.biomeExit) {
    const m = edgeMidpoint(screen.biomeExit.dir, w, h);
    const props = [{ name: 'target', type: 'string', value: screen.biomeExit.target }];
    if (screen.biomeExit.gate) {
      props.push({ name: 'gate', type: 'string', value: screen.biomeExit.gate });
    }
    objects.push({
      id: nextId++,
      name: 'biome_exit',
      x: m.tx * TILE,
      y: m.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: props,
    });
  }

  return objects;
}

function buildMap(screen) {
  const [w, h] = screen.size;
  return {
    compressionlevel: -1,
    width: w,
    height: h,
    tilewidth: TILE,
    tileheight: TILE,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    nextlayerid: 3,
    nextobjectid: 99,
    tilesets: [
      {
        firstgid: 1,
        name: 'forest',
        image: '../../tiles/forest.png',
        imagewidth: 128,
        imageheight: 32,
        tilewidth: 32,
        tileheight: 32,
        tilecount: 4,
        columns: 4,
        margin: 0,
        spacing: 0,
        tiles: [{ id: 2, properties: [{ name: 'collides', type: 'bool', value: true }] }],
      },
    ],
    layers: [
      {
        id: 1,
        name: 'ground',
        type: 'tilelayer',
        x: 0,
        y: 0,
        width: w,
        height: h,
        opacity: 1,
        visible: true,
        data: buildGround(screen),
      },
      {
        id: 2,
        name: 'objects',
        type: 'objectgroup',
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        draworder: 'topdown',
        objects: buildObjects(screen),
      },
    ],
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'assets', 'maps', 'forest');
mkdirSync(outDir, { recursive: true });
for (const screen of FOREST_SCREENS) {
  const map = buildMap(screen);
  const outPath = resolve(outDir, `${screen.id}.json`);
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
}
console.log(`Wrote ${FOREST_SCREENS.length} Forest region screen maps → ${outDir}`);
