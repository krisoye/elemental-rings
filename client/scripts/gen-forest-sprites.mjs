// Forest decoration sprite-atlas generator (8D.4).
//
// Crops standalone decoration objects (trees / foliage / rocks / bush) from the
// GreenForest source (16px native), 2x NEAREST-upscales them, and lays them out
// as a horizontal strip of 32x32 sprites →
// client/public/assets/sprites/forest-decoration.png.
//
// These source tiles carry partial alpha (they are overlay decorations, not full
// ground tiles), so each 32x32 sprite has transparency around the object and
// reads correctly when placed over a ground layer by Decoration.placeDecoration.
//
// Atlas layout (left → right, 32px each):
//   0 tree-a     (dense canopy)
//   1 tree-b     (lighter foliage)
//   2 tree-c     (dark conifer)
//   3 rock       (grey boulder)
//   4 bush       (low green shrub)
//   5 clearing   (pond / mossy blob)
//
// Output is byte-stable (deterministic crop, no RNG).
//
// Run from the client/ directory:  node scripts/gen-forest-sprites.mjs
// (or `npm run gen:forest-sprites`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { GREENFOREST_TILESET } from './asset-sources.mjs';
import { cropTile, nearestScale, buildStrip } from './lib/tile-utils.mjs';

const TILE = 32; // output sprite size (32px after 2x upscale of 16px native)

// GreenForest 16px-tile grid positions of standalone decoration objects, chosen
// for partial-alpha (transparent margins) so each reads as an object on grass:
//   tree-a   → (9,0)  green canopy   rgb[162,193,91]
//   tree-b   → (11,0) bright foliage rgb[141,183,60]
//   tree-c   → (13,1) dark foliage   rgb[74,114,61]
//   rock     → (9,2)  grey boulder   rgb[169,172,167]
//   bush     → (13,0) dark shrub     rgb[85,140,52]
//   clearing → (15,3) mossy blob     rgb[154,195,58]
const SPRITE_TILES = [
  { tx: 9, ty: 0 }, // tree-a
  { tx: 11, ty: 0 }, // tree-b
  { tx: 13, ty: 1 }, // tree-c
  { tx: 9, ty: 2 }, // rock
  { tx: 13, ty: 0 }, // bush
  { tx: 15, ty: 3 }, // clearing
];

const src16 = PNG.sync.read(readFileSync(GREENFOREST_TILESET)); // 16px native
const scaled = nearestScale(src16, 2); // 32px tiles now

const sprites = SPRITE_TILES.map((s) => cropTile(scaled, s.tx, s.ty, TILE));
const strip = buildStrip(sprites, TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'forest-decoration.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} forest decoration atlas → ${outPath}`);
