// Real-art Swamp tilesheet generator (8D.2) — replaces the hand-coded palette
// (former gen-swamp-tiles.mjs) with cropped Cold Cave source art (mud / cave
// wall / water).
//
// Reads the Cold Cave tileset (32px native, 256x256 = 8x8 tiles) and crops a
// 4-GID horizontal strip → client/public/assets/tiles/swamp.png (128x32):
//   GID1 (col 0) void   — fully transparent (never placed)
//   GID2 (col 1) mud    — opaque grey-brown stone/mud floor (source tile 4,3)
//   GID3 (col 2) wall   — darkened cave wall, `collides: true` (composited)
//   GID4 (col 3) water  — opaque blue water accent (source tile 4,2)
//
// The Cold Cave wall tiles use partial-alpha overlays (no single opaque "wall"
// tile exists), so GID3 is the mud floor darkened by a deterministic shade
// overlay — keeping it visually distinct from the floor AND fully opaque so it
// reads as a solid wall.
//
// The output path (swamp.png), tileset name (`swamp`), and Phaser key
// (`swamp-tiles`) are unchanged from the prior generator.
//
// Output is byte-stable (deterministic crop + composite, no RNG).
//
// Run from the client/ directory:  node scripts/gen-swamp-tiles.mjs
// (or `npm run gen:swamp-tiles`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { COLD_CAVE_TILESET } from './asset-sources.mjs';
import { cropTile, buildStrip, transparentTile } from './lib/tile-utils.mjs';

const TILE = 32; // Cold Cave is 32px native — no upscale needed.

// Cold Cave 32px-tile grid positions (verified fully opaque via colour-sampling):
//   mud / stone floor → (4,3) rgb[144,127,136]
//   water accent      → (4,2) rgb[96,136,175] (blue)
const MUD_TILE = { tx: 4, ty: 3 };
const WATER_TILE = { tx: 4, ty: 2 };

/** Darken a copy of `mud` by a fixed factor to produce the cave-wall (GID3). */
function buildWall(mud) {
  const out = new PNG({ width: TILE, height: TILE, filterType: -1 });
  for (let i = 0; i < mud.data.length; i += 4) {
    // 0.45x darken keeps the wall recognisably the same material but clearly
    // darker than the floor; deterministic so output stays byte-stable.
    out.data[i] = Math.round(mud.data[i] * 0.45);
    out.data[i + 1] = Math.round(mud.data[i + 1] * 0.45);
    out.data[i + 2] = Math.round(mud.data[i + 2] * 0.45);
    out.data[i + 3] = mud.data[i + 3];
  }
  return out;
}

const src = PNG.sync.read(readFileSync(COLD_CAVE_TILESET)); // 32px native

const voidTile = transparentTile(TILE);
const mudTile = cropTile(src, MUD_TILE.tx, MUD_TILE.ty, TILE);
const wallTile = buildWall(mudTile);
const waterTile = cropTile(src, WATER_TILE.tx, WATER_TILE.ty, TILE);

const strip = buildStrip([voidTile, mudTile, wallTile, waterTile], TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'swamp.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} swamp tilesheet → ${outPath}`);
