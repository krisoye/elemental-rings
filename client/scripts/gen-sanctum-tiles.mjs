// Real-art Sanctum (Camp) tilesheet generator (8D.3) — produces the interior
// floor/wall tileset for CampScene from the Cozy Indoor wall/floor source art.
//
// Reads the Cozy Indoor wall/floor sheet (32px native, 256x256 = 8x8 tiles) and
// crops a 4-GID horizontal strip → client/public/assets/tiles/sanctum.png (128x32):
//   GID1 (col 0) void   — fully transparent (never placed)
//   GID2 (col 1) wood   — warm wood-plank floor, walkable (source tile 2,2)
//   GID3 (col 2) wall   — dark interior stone wall, `collides: true` (source 0,6)
//   GID4 (col 3) accent — light stone floor variant, walkable (source tile 2,6)
//
// The tileset name is `sanctum` and the Phaser texture key is `sanctum`.
// Output is byte-stable (deterministic crop, no RNG).
//
// Run from the client/ directory:  node scripts/gen-sanctum-tiles.mjs
// (or `npm run gen:sanctum-tiles`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { COZY_FLOOR_WALL } from './asset-sources.mjs';
import { cropTile, buildStrip, transparentTile } from './lib/tile-utils.mjs';

const TILE = 32; // Cozy Indoor is 32px native — no upscale needed.

// Cozy Indoor wall/floor 32px-tile grid positions (verified fully opaque):
//   wood floor   → (2,2) rgb[215,151,108]
//   stone wall   → (0,6) rgb[109,97,101]  (dark — reads as a solid wall)
//   stone accent → (2,6) rgb[176,168,178] (light stone floor variant)
const WOOD_FLOOR = { tx: 2, ty: 2 };
const STONE_WALL = { tx: 0, ty: 6 };
const STONE_ACCENT = { tx: 2, ty: 6 };

const src = PNG.sync.read(readFileSync(COZY_FLOOR_WALL)); // 32px native

const voidTile = transparentTile(TILE);
const floorTile = cropTile(src, WOOD_FLOOR.tx, WOOD_FLOOR.ty, TILE);
const wallTile = cropTile(src, STONE_WALL.tx, STONE_WALL.ty, TILE);
const accentTile = cropTile(src, STONE_ACCENT.tx, STONE_ACCENT.ty, TILE);

const strip = buildStrip([voidTile, floorTile, wallTile, accentTile], TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'sanctum.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} sanctum tilesheet → ${outPath}`);
