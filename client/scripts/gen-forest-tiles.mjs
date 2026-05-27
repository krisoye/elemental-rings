// Real-art Forest tilesheet generator (8D.2) — replaces the hand-coded
// gen-placeholder-tiles.mjs palette with cropped GreenForest source art.
//
// Reads the GreenForest tileset (16px native, 320x96 = 20x6 tiles), 2x
// NEAREST-upscales it to 32px tiles, then crops/composites a 4-GID horizontal
// strip → client/public/assets/tiles/forest.png (128x32):
//   GID1 (col 0) void   — fully transparent (never placed)
//   GID2 (col 1) grass  — bright-green walkable floor (source tile 0,0)
//   GID3 (col 2) tree   — dark canopy over grass, `collides: true` (composited)
//   GID4 (col 3) dirt   — tan path / accent, walkable (source tile 3,3)
//
// The tree (GID3) is a deterministic dark-green canopy circle composited onto the
// real grass base, since the GreenForest foliage tiles use partial-alpha overlays
// (no single opaque "tree" tile exists). This keeps GID3 visually distinct from
// grass AND fully opaque so it reads as a solid wall.
//
// Output is byte-stable (deterministic crop + composite, no RNG).
//
// Run from the client/ directory:  node scripts/gen-forest-tiles.mjs
// (or `npm run gen:forest-tiles`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { GREENFOREST_TILESET } from './asset-sources.mjs';
import { cropTile, nearestScale, buildStrip, transparentTile } from './lib/tile-utils.mjs';

const TILE = 32; // output tile size (32px after 2x upscale of 16px native)

// GreenForest 16px-tile grid positions (verified opaque via colour-sampling):
//   grass floor  → (0,0)  rgb[169,204,67]  — bright opaque grass
//   dirt accent  → (3,3)  rgb[210,193,118] — tan path / worn earth
const GRASS_TILE = { tx: 0, ty: 0 };
const DIRT_TILE = { tx: 3, ty: 3 };

// Deterministic dark canopy overlaid on the grass base to form the tree (GID3).
const CANOPY = { r: 26, g: 74, b: 26, a: 255 }; // dark-green crown
const CANOPY_RING = { r: 16, g: 48, b: 16, a: 255 }; // 1px darker edge
const TRUNK = { r: 74, g: 48, b: 28, a: 255 }; // brown trunk
const CROWN_R = 12; // crown radius (px)
const CENTER = (TILE - 1) / 2; // 15.5

/** Paint a deterministic dark tree (canopy + trunk) over a copy of `grass`. */
function buildTree(grass) {
  const out = new PNG({ width: TILE, height: TILE, filterType: -1 });
  out.data.set(grass.data);
  const setPx = (x, y, c) => {
    const i = (y * TILE + x) << 2;
    out.data[i] = c.r;
    out.data[i + 1] = c.g;
    out.data[i + 2] = c.b;
    out.data[i + 3] = c.a;
  };
  // Trunk: a short 4px-wide brown column at the base-centre.
  for (let y = TILE - 8; y < TILE - 2; y++) {
    for (let x = 14; x < 18; x++) setPx(x, y, TRUNK);
  }
  // Canopy: a filled dark-green circle with a darker 1px ring.
  for (let y = 1; y < TILE - 6; y++) {
    for (let x = 1; x < TILE - 1; x++) {
      const dist = Math.hypot(x - CENTER, y - (CENTER - 2));
      if (dist <= CROWN_R) setPx(x, y, dist >= CROWN_R - 1 ? CANOPY_RING : CANOPY);
    }
  }
  return out;
}

const src16 = PNG.sync.read(readFileSync(GREENFOREST_TILESET)); // 16px native
const scaled = nearestScale(src16, 2); // 32px tiles now

const voidTile = transparentTile(TILE);
const grassTile = cropTile(scaled, GRASS_TILE.tx, GRASS_TILE.ty, TILE);
const treeTile = buildTree(grassTile);
const dirtTile = cropTile(scaled, DIRT_TILE.tx, DIRT_TILE.ty, TILE);

const strip = buildStrip([voidTile, grassTile, treeTile, dirtTile], TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'forest.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} forest tilesheet → ${outPath}`);
