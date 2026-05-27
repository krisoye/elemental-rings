// Sanctum furniture sprite-atlas generator (8D.3).
//
// Crops individual furniture pieces from the Cozy Indoor furniture sheet (32px
// native, 256x256 = 8x8 pieces) and lays them out as a horizontal strip of 32x32
// sprites → client/public/assets/sprites/sanctum-furniture.png.
//
// CampScene.renderZoneMarkers places one of these sprites at each interaction
// zone center (bed / meditation / ring-wall / campfire / door), replacing the
// flat placeholder rectangles. The source pieces carry transparency, so each
// reads as a discrete furniture item over the wood floor.
//
// Atlas layout (left → right, 32px each) — order matches FURNITURE_ORDER in
// CampScene so frame index maps to a zone:
//   0 bed         (3,4)
//   1 meditation  (3,1) blue mat
//   2 ringwall    (0,1) shelf / cabinet
//   3 campfire    (1,2) brazier / lamp
//   4 door        (2,6) wooden door / frame
//
// Output is byte-stable (deterministic crop, no RNG).
//
// Run from the client/ directory:  node scripts/gen-sanctum-sprites.mjs
// (or `npm run gen:sanctum-sprites`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { COZY_FURNITURE } from './asset-sources.mjs';
import { cropTile, buildStrip } from './lib/tile-utils.mjs';

const TILE = 32; // Cozy Indoor furniture is 32px native — no upscale needed.

// Cozy Indoor furniture 32px-tile grid positions (verified distinct via colour-
// sampling). Order MUST match CampScene's FURNITURE_ORDER (frame index → zone).
const SPRITE_TILES = [
  { tx: 3, ty: 4 }, // 0 bed
  { tx: 3, ty: 1 }, // 1 meditation (blue mat)
  { tx: 0, ty: 1 }, // 2 ringwall (shelf)
  { tx: 1, ty: 2 }, // 3 campfire (brazier)
  { tx: 2, ty: 6 }, // 4 door
];

const src = PNG.sync.read(readFileSync(COZY_FURNITURE)); // 32px native

const sprites = SPRITE_TILES.map((s) => cropTile(src, s.tx, s.ty, TILE));
const strip = buildStrip(sprites, TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'sanctum-furniture.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} sanctum furniture atlas → ${outPath}`);
