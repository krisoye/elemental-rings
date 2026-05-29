// Build-time generator (8E) for 16px 48-variant autotile strips + a visual proof.
//
// Produces the committed terrain strips under client/public/assets/terrain/:
//   autotile_grass_16.png  — light-grass A2 corner-piece cell
//   autotile_dirt_16.png   — dark-grass A2 corner-piece cell (see GATE NOTE)
//   autotile_water_16.png  — A1 water corner-piece cell (frame 0)
//   autotile_proof_16.png  — a test-patch proof autotiled with the resolver
// plus (gate permitting) autotile_cliff_16.png.
//
// Each strip is 768x16 = 48 variants x 16px, produced by decoding a 32px
// corner-piece cell with decodeAutotileCorner() and downscaling 2x nearest-
// neighbour. Variant order matches resolveAutotileVariant(), so map cell mask M
// draws strip tile resolveAutotileVariant(M). Output is deterministic/byte-stable.
//
// GATE OUTCOMES (see the team report for detail):
//   grass : PASS — StarterVillage A2 light-grass corner-piece cell at tile (8,0)
//   dirt  : PASS (substitute) — the A2 pack has NO brown-dirt autotile; the dark-
//           grass corner-piece cell at tile (8,9) is used as a second, visually
//           distinct ground autotile. Real, correctly-decoded geometry — not a
//           stamped fake — but green-toned. Flagged here for honesty.
//   water : PASS — StarterVillage A1 water corner-piece cell (frame 0) at (0,0)
//   cliff : FAIL — no corner-piece cliff/wall autotile cell exists in ColdCave
//           or GreenForest (only decorative single-blob cliff objects). Per the
//           hard-gate rule we do NOT fabricate one; autotile_cliff_16.png is not
//           produced. See CLIFF_GATE below.
//
// Run from client/:  node scripts/gen-autotile-16.mjs  (or npm run gen:autotile-16).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { STARTER_VILLAGE_A2, STARTER_VILLAGE_A1 } from './asset-sources.mjs';
import { decodeAutotileCorner, downscaleNearest } from './lib/rpgmaker-autotile.mjs';
import { resolveAutotileVariant } from './lib/autotile-resolver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'assets', 'terrain');
const TILE_16 = 16;

// cliff GATE: no corner-piece cliff/wall autotile cell exists in the source art.
// Keep false until a real cliff blob cell is available; flip to a cell spec then.
const CLIFF_GATE = false;

/**
 * Decode a source sheet's corner-piece cell into a 768x16 (48 x 16px) strip.
 * @param {string} sourcePath absolute path to the source PNG.
 * @param {{cellX:number, cellY:number}} cell cell origin in 32px-tile units.
 * @returns {PNG} 768x16 strip, tile N = resolver variant N.
 */
function buildStrip(sourcePath, cell) {
  const src = PNG.sync.read(readFileSync(sourcePath));
  const strip32 = decodeAutotileCorner(src, cell);
  return downscaleNearest(strip32, 2);
}

/**
 * Copy a 16px variant tile from a strip into the proof canvas at (px,py).
 * @param {PNG} strip 768x16 source strip.
 * @param {PNG} canvas destination canvas.
 * @param {number} variant variant index 0..47.
 * @param {number} px destination x (px).
 * @param {number} py destination y (px).
 */
function blitTile(strip, canvas, variant, px, py) {
  const sx0 = variant * TILE_16;
  for (let y = 0; y < TILE_16; y++) {
    for (let x = 0; x < TILE_16; x++) {
      const sIdx = (y * strip.width + (sx0 + x)) << 2;
      const dIdx = ((py + y) * canvas.width + (px + x)) << 2;
      canvas.data[dIdx] = strip.data[sIdx];
      canvas.data[dIdx + 1] = strip.data[sIdx + 1];
      canvas.data[dIdx + 2] = strip.data[sIdx + 2];
      canvas.data[dIdx + 3] = strip.data[sIdx + 3];
    }
  }
}

/**
 * Compute the 8-neighbour same-terrain bitmask for cell (col,row) of a boolean
 * grid. Bit order N,NE,E,SE,S,SW,W,NW (bit0=N … bit7=NW). Out-of-grid = empty.
 * @param {boolean[][]} grid grid[row][col] = true when the cell is terrain.
 * @param {number} col
 * @param {number} row
 * @returns {number} 8-bit neighbour mask.
 */
function neighborMask(grid, col, row) {
  const at = (c, r) => (grid[r] && grid[r][c] ? 1 : 0);
  const N = at(col, row - 1);
  const NE = at(col + 1, row - 1);
  const E = at(col + 1, row);
  const SE = at(col + 1, row + 1);
  const S = at(col, row + 1);
  const SW = at(col - 1, row + 1);
  const W = at(col - 1, row);
  const NW = at(col - 1, row - 1);
  return (
    (N << 0) |
    (NE << 1) |
    (E << 2) |
    (SE << 3) |
    (S << 4) |
    (SW << 5) |
    (W << 6) |
    (NW << 7)
  );
}

// Proof test patch: a boolean grid (1 = terrain) exercising interior, straight
// edges, outer corners, inner (concave) corners, a thin neck, and an isolated
// tile. '#' = terrain, '.' = empty. Designed so a reviewer can confirm the
// autotiled shoreline/edge geometry reads correctly.
const PATCH = [
  '..........',
  '.####.....',
  '.####..#..', // isolated tile at (7,2)
  '.####.....',
  '.#######..', // concave/inner corner where the L joins
  '....###...',
  '....###...',
  '..........',
];

/**
 * Render a terrain strip across the PATCH grid into a sub-image, autotiling each
 * terrain cell via resolveAutotileVariant(neighbourMask). Empty cells are left
 * transparent so edges/shorelines are visible against the background.
 * @param {PNG} strip the 768x16 terrain strip.
 * @returns {PNG} a (cols*16) x (rows*16) rendered patch.
 */
function renderPatch(strip) {
  const grid = PATCH.map((line) => [...line].map((ch) => ch === '#'));
  const rows = grid.length;
  const cols = grid[0].length;
  const out = new PNG({ width: cols * TILE_16, height: rows * TILE_16, filterType: -1 });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!grid[row][col]) continue;
      const variant = resolveAutotileVariant(neighborMask(grid, col, row));
      blitTile(strip, out, variant, col * TILE_16, row * TILE_16);
    }
  }
  return out;
}

/**
 * Stack rendered patches vertically (one per terrain) into a single proof image,
 * with a 1px gap row between patches. Deterministic.
 * @param {PNG[]} patches rendered patch images (same width).
 * @returns {PNG} combined proof image.
 */
function stackProofs(patches) {
  const gap = TILE_16; // one tile-row gap between terrains
  const width = patches[0].width;
  const height = patches.reduce((h, p) => h + p.height, 0) + gap * (patches.length - 1);
  const out = new PNG({ width, height, filterType: -1 });
  // Transparent background.
  out.data.fill(0);
  let y = 0;
  for (const p of patches) {
    for (let py = 0; py < p.height; py++) {
      for (let px = 0; px < p.width; px++) {
        const s = (py * p.width + px) << 2;
        const d = ((y + py) * width + px) << 2;
        out.data[d] = p.data[s];
        out.data[d + 1] = p.data[s + 1];
        out.data[d + 2] = p.data[s + 2];
        out.data[d + 3] = p.data[s + 3];
      }
    }
    y += p.height + gap;
  }
  return out;
}

function writePng(name, png) {
  const outPath = resolve(OUT_DIR, name);
  writeFileSync(outPath, PNG.sync.write(png));
  console.log(`Wrote ${png.width}x${png.height} → ${outPath}`);
  return png;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Strip cell specs (cell origin in 32px-tile units).
  const grass = buildStrip(STARTER_VILLAGE_A2, { cellX: 8, cellY: 0 });
  const dirt = buildStrip(STARTER_VILLAGE_A2, { cellX: 8, cellY: 9 });
  const water = buildStrip(STARTER_VILLAGE_A1, { cellX: 0, cellY: 0 });

  writePng('autotile_grass_16.png', grass);
  writePng('autotile_dirt_16.png', dirt);
  writePng('autotile_water_16.png', water);

  const proofStrips = [grass, dirt, water];
  if (CLIFF_GATE) {
    // Unreachable while cliff gate fails; wired for when a cliff cell exists.
    const cliff = buildStrip(STARTER_VILLAGE_A2, { cellX: 0, cellY: 0 });
    writePng('autotile_cliff_16.png', cliff);
    proofStrips.push(cliff);
  } else {
    console.log('GATE: cliff autotile not produced — no corner-piece cliff cell in source art.');
  }

  const proof = stackProofs(proofStrips.map(renderPatch));
  writePng('autotile_proof_16.png', proof);
}

main();
