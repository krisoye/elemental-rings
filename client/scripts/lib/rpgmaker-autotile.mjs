// RPG Maker VX/Ace A2 autotile decoder — PURE function (no fs, no side effects).
//
// Takes a pngjs PNG of the Starter Village A2 autotile sheet and returns a new
// pngjs PNG: a flat horizontal strip of the 48 blob-autotile variants, each
// expanded into a full 32x32 tile (so the strip is 48*32 = 1536 px wide, 32 tall).
//
// Each output 32x32 tile is assembled from four 16x16 quarter-tiles
// (top-left, top-right, bottom-left, bottom-right) selected by the standard
// VX/Ace 48-variant lookup. Quarter-tile coordinates in the table below are in
// 16px units, relative to the source block origin (blockX*32, blockY*32).
//
// The A2 source for this pack is 512x384 (32px native → 16 cols x 12 rows of
// 32px tiles, i.e. 32 cols x 24 rows of 16px quarter-tiles). A single autotile
// "block" occupies a 6-wide x 8-tall region of quarter-tiles (3x4 32px tiles).
//
// At 32px native, each 16x16 quarter assembles directly into the 32x32 output
// tile (TL→(0,0), TR→(16,0), BL→(0,16), BR→(16,16)) with no upscale, so output
// is crisp and byte-stable.
//
// NOTE: This tool produces a strip for visual INSPECTION of the autotile material.
// The exact RPG Maker variant geometry is approximated by the table below; the
// load-bearing guarantees are: correct output dimensions (1536x32), variant 0
// (solid interior) sampling the block's solid-fill region, deterministic
// byte-stable output, and a thrown error on a too-small source.

import { PNG } from 'pngjs';
import { resolveAutotileVariant, cornerStates } from './autotile-resolver.mjs';

// A quarter-tile is 16x16 at native (32px-tile) source resolution.
const QUARTER = 16;
// Each output variant tile is 32x32 (= 2 quarter-tiles wide/tall after 2x scale).
const OUT_TILE = 32;
const VARIANT_COUNT = 48;

// Standard RPG Maker VX/Ace A2 autotile quarter-tile positions.
// Each entry = [TL_col, TL_row, TR_col, TR_row, BL_col, BL_row, BR_col, BR_row]
// in 16px quarter-tile units within the source block (origin = block top-left).
// The block is 6 quarter-cols x 8 quarter-rows. Variant 0 is the fully-surrounded
// solid interior (samples the block's inner solid-fill quarters).
const AUTOTILE_TABLE = [
  [4, 0, 5, 0, 4, 1, 5, 1], // 0: surrounded (solid interior)
  [2, 4, 3, 4, 4, 1, 5, 1], // 1
  [4, 0, 5, 0, 4, 3, 5, 3], // 2
  [2, 4, 3, 4, 4, 3, 5, 3], // 3
  [4, 2, 5, 2, 4, 1, 5, 1], // 4
  [2, 4, 3, 2, 4, 1, 5, 1], // 5
  [4, 2, 5, 2, 4, 3, 5, 3], // 6
  [2, 4, 3, 2, 4, 3, 5, 3], // 7
  [4, 0, 1, 4, 4, 1, 3, 5], // 8
  [2, 4, 1, 4, 4, 1, 3, 5], // 9
  [4, 0, 1, 4, 4, 3, 3, 5], // 10
  [2, 4, 1, 4, 4, 3, 3, 5], // 11
  [4, 2, 1, 4, 4, 1, 3, 5], // 12
  [2, 2, 3, 4, 4, 1, 5, 1], // 13
  [4, 2, 1, 4, 4, 3, 3, 5], // 14
  [2, 2, 3, 4, 4, 3, 5, 3], // 15
  [0, 4, 1, 4, 0, 5, 1, 5], // 16
  [2, 4, 1, 4, 0, 5, 1, 5], // 17
  [0, 4, 1, 4, 4, 3, 3, 5], // 18
  [2, 4, 1, 4, 4, 3, 3, 5], // 19
  [0, 4, 1, 2, 0, 5, 1, 5], // 20
  [2, 2, 3, 2, 0, 5, 1, 5], // 21
  [0, 4, 1, 2, 4, 3, 3, 5], // 22
  [2, 2, 3, 2, 4, 3, 3, 5], // 23
  [4, 0, 5, 0, 0, 5, 1, 5], // 24
  [2, 4, 3, 4, 0, 5, 1, 5], // 25
  [4, 0, 5, 0, 0, 3, 1, 3], // 26
  [2, 4, 3, 4, 0, 3, 1, 3], // 27
  [4, 2, 5, 2, 0, 5, 1, 5], // 28
  [2, 2, 5, 2, 0, 5, 1, 5], // 29
  [4, 2, 5, 2, 0, 3, 1, 3], // 30
  [2, 2, 5, 2, 0, 3, 1, 3], // 31
  [0, 2, 1, 2, 0, 5, 1, 5], // 32
  [0, 2, 1, 4, 0, 5, 1, 5], // 33
  [0, 2, 1, 2, 4, 3, 3, 5], // 34
  [0, 2, 1, 4, 4, 3, 3, 5], // 35
  [0, 2, 1, 2, 0, 3, 1, 3], // 36
  [0, 2, 1, 4, 0, 3, 1, 3], // 37
  [0, 2, 1, 2, 0, 3, 1, 3], // 38
  [2, 2, 3, 2, 0, 3, 1, 3], // 39
  [4, 0, 5, 2, 4, 1, 5, 1], // 40
  [2, 4, 5, 0, 4, 1, 5, 1], // 41
  [4, 0, 5, 0, 4, 1, 1, 3], // 42
  [4, 0, 5, 0, 0, 1, 5, 1], // 43
  [0, 4, 1, 0, 0, 1, 1, 1], // 44 (open / isolated corners)
  [2, 0, 3, 0, 2, 1, 3, 1], // 45
  [0, 2, 1, 2, 0, 3, 1, 3], // 46 (isolated)
  [2, 2, 3, 2, 2, 3, 3, 3], // 47 (center)
];

/**
 * Copy one 16x16 quarter-tile from the source PNG into the destination PNG at
 * (destX, destY), 1:1 (the source is 32px native, so quarters are already 16px
 * and assemble directly into a 32x32 tile).
 *
 * @param {PNG} src     source pngjs PNG
 * @param {PNG} dst     destination pngjs PNG
 * @param {number} sqx  source quarter-tile column (16px units)
 * @param {number} sqy  source quarter-tile row (16px units)
 * @param {number} destX destination top-left x (px)
 * @param {number} destY destination top-left y (px)
 */
function blitQuarter(src, dst, sqx, sqy, destX, destY) {
  const srcX0 = sqx * QUARTER;
  const srcY0 = sqy * QUARTER;
  for (let qy = 0; qy < QUARTER; qy++) {
    for (let qx = 0; qx < QUARTER; qx++) {
      const sIdx = ((srcY0 + qy) * src.width + (srcX0 + qx)) << 2;
      const dIdx = ((destY + qy) * dst.width + (destX + qx)) << 2;
      dst.data[dIdx] = src.data[sIdx];
      dst.data[dIdx + 1] = src.data[sIdx + 1];
      dst.data[dIdx + 2] = src.data[sIdx + 2];
      dst.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
}

/**
 * Decode an RPG Maker VX/Ace A2 autotile block into a flat 48-variant strip.
 *
 * @param {PNG} sourcePng  pngjs PNG of the A2 autotile sheet.
 * @param {{ blockX?: number, blockY?: number, nativeSize?: number }} blockOpts
 *        blockX/blockY select the autotile block in 32px-tile units (default 0,0).
 *        nativeSize is the native tile size (16 or 32); only 32 is supported here
 *        (the StarterVillage A2 pack is 32px native). Provided for API symmetry.
 * @returns {PNG} a new PNG, 1536x32 (48 tiles x 32px), each tile a decoded variant.
 * @throws {Error} if the source is not a valid PNG or is too small for the block.
 */
export function decodeAutotile(sourcePng, blockOpts = {}) {
  if (!sourcePng || typeof sourcePng.width !== 'number' || !sourcePng.data) {
    throw new Error('decodeAutotile: sourcePng must be a pngjs PNG object');
  }

  const { blockX = 0, blockY = 0, nativeSize = 32 } = blockOpts;
  if (nativeSize !== 32) {
    throw new Error(
      `decodeAutotile: only nativeSize 32 is supported (got ${nativeSize}); ` +
        'the StarterVillage A2 pack is 32px native'
    );
  }

  // Block origin in quarter-tile (16px) units. A 32px tile = 2 quarter-tiles.
  // The block spans 6 quarter-cols x 8 quarter-rows.
  const blockOriginQx = blockX * 2;
  const blockOriginQy = blockY * 2;
  const requiredW = (blockOriginQx + 6) * QUARTER;
  const requiredH = (blockOriginQy + 8) * QUARTER;
  if (sourcePng.width < requiredW || sourcePng.height < requiredH) {
    throw new Error(
      `decodeAutotile: source too small (${sourcePng.width}x${sourcePng.height}); ` +
        `block at (${blockX},${blockY}) needs at least ${requiredW}x${requiredH}`
    );
  }

  const out = new PNG({
    width: VARIANT_COUNT * OUT_TILE,
    height: OUT_TILE,
    filterType: -1,
  });

  for (let v = 0; v < VARIANT_COUNT; v++) {
    const [tlc, tlr, trc, trr, blc, blr, brc, brr] = AUTOTILE_TABLE[v];
    const destX = v * OUT_TILE;
    // Four 16x16 quarters assemble into the 32x32 output tile.
    // TL → (0,0), TR → (16,0), BL → (0,16), BR → (16,16) in output px.
    blitQuarter(sourcePng, out, blockOriginQx + tlc, blockOriginQy + tlr, destX + 0, 0);
    blitQuarter(sourcePng, out, blockOriginQx + trc, blockOriginQy + trr, destX + 16, 0);
    blitQuarter(sourcePng, out, blockOriginQx + blc, blockOriginQy + blr, destX + 0, 16);
    blitQuarter(sourcePng, out, blockOriginQx + brc, blockOriginQy + brr, destX + 16, 16);
  }

  return out;
}

// ---------------------------------------------------------------------------
// CORNER-PIECE A2 decode (8E) — the geometrically correct path.
//
// The approximate decodeAutotile above is kept byte-stable for the legacy 32px
// proof. This path instead reads a *standard RPG Maker VX/Ace A2 corner-piece
// cell* (2 tiles wide x 3 tiles tall = 4 quarter-cols x 6 quarter-rows) and
// assembles each of the 48 variants by selecting, per corner, the correct
// quarter-piece for that corner's state (outer / edge / concave / fill). The
// per-variant corner states come from the shared resolver (cornerStates), so the
// decoded strip order matches resolveAutotileVariant() exactly.
//
// CELL QUARTER LAYOUT (relative quarter-cols/rows within the cell):
//   qr0-1, qc0-1 : OUTER-corner tile   (grass rounds away on the outside)
//   qr0-1, qc2-3 : CONCAVE-corner tile (inner corner; both edges present, no diag)
//   qr2-5, qc0-3 : MAIN edge+fill block:
//        qc0,qr2 NW-corner   qc1-2,qr2 N-edge    qc3,qr2 NE-corner
//        qc0,qr3-4 W-edge    qc1-2,qr3-4 FILL    qc3,qr3-4 E-edge
//        qc0,qr5 SW-corner   qc1-2,qr5 S-edge    qc3,qr5 SE-corner
// ---------------------------------------------------------------------------

// For each tile-corner (NW/NE/SW/SE), the source quarter (qc,qr) to use for each
// corner state. Coordinates are quarter units relative to the cell origin.
// States: outer | edgeA | edgeB | concave | fill.
//   edgeA = the corner's "first" cardinal edge (N for NW/NE, S for SW/SE),
//   edgeB = the corner's "second" cardinal edge (W for NW/SW, E for NE/SE).
const CORNER_PIECES = {
  // NW corner of the output tile (top-left quarter).
  NW: {
    outer: [0, 0], // outer-corner tile, top-left quarter
    concave: [2, 0], // concave-corner tile, top-left quarter
    edgeA: [1, 2], // N-edge (top edge), left half  → main block (qc1,qr2)
    edgeB: [0, 3], // W-edge (left edge), top half  → main block (qc0,qr3)
    fill: [1, 3], // fill, top-left  → main block (qc1,qr3)
  },
  // NE corner (top-right quarter).
  NE: {
    outer: [1, 0],
    concave: [3, 0],
    edgeA: [2, 2], // N-edge, right half (qc2,qr2)
    edgeB: [3, 3], // E-edge, top half  (qc3,qr3)
    fill: [2, 3],
  },
  // SW corner (bottom-left quarter).
  SW: {
    outer: [0, 1],
    concave: [2, 1],
    edgeA: [1, 5], // S-edge, left half (qc1,qr5)
    edgeB: [0, 4], // W-edge, bottom half (qc0,qr4)
    fill: [1, 4],
  },
  // SE corner (bottom-right quarter).
  SE: {
    outer: [1, 1],
    concave: [3, 1],
    edgeA: [2, 5], // S-edge, right half (qc2,qr5)
    edgeB: [3, 4], // E-edge, bottom half (qc3,qr4)
    fill: [2, 4],
  },
};

// Destination quarter offset (px) within the 32px output tile, per corner.
const CORNER_DEST = {
  NW: [0, 0],
  NE: [16, 0],
  SW: [0, 16],
  SE: [16, 16],
};

/**
 * Map a corner state name + corner position to the source quarter coords.
 * @param {string} corner  'NW'|'NE'|'SW'|'SE'
 * @param {string} state   'outer'|'edgeA'|'edgeB'|'concave'|'fill'
 * @returns {[number, number]} [qc, qr] quarter coords relative to cell origin.
 */
function pieceFor(corner, state) {
  const piece = CORNER_PIECES[corner][state];
  if (!piece) {
    throw new Error(`pieceFor: unknown corner/state ${corner}/${state}`);
  }
  return piece;
}

/**
 * Decode a standard RPG Maker A2 corner-piece cell into the 48-variant strip,
 * with variant order matching resolveAutotileVariant().
 *
 * @param {PNG} sourcePng  pngjs PNG containing the A2 corner-piece cell.
 * @param {{ cellX?: number, cellY?: number }} opts
 *        cellX/cellY = cell origin in 32px-tile units (the cell is 2 wide x 3
 *        tall). Defaults to (0,0).
 * @returns {PNG} 1536x32 strip (48 tiles x 32px), tile N = variant N.
 * @throws {Error} on an invalid PNG or a cell that overruns the source.
 */
export function decodeAutotileCorner(sourcePng, opts = {}) {
  if (!sourcePng || typeof sourcePng.width !== 'number' || !sourcePng.data) {
    throw new Error('decodeAutotileCorner: sourcePng must be a pngjs PNG object');
  }
  const { cellX = 0, cellY = 0 } = opts;

  // Cell origin in quarter units; cell spans 4 quarter-cols x 6 quarter-rows.
  const originQx = cellX * 2;
  const originQy = cellY * 2;
  const requiredW = (originQx + 4) * QUARTER;
  const requiredH = (originQy + 6) * QUARTER;
  if (sourcePng.width < requiredW || sourcePng.height < requiredH) {
    throw new Error(
      `decodeAutotileCorner: source too small (${sourcePng.width}x${sourcePng.height}); ` +
        `cell at (${cellX},${cellY}) needs at least ${requiredW}x${requiredH}`
    );
  }

  const out = new PNG({
    width: VARIANT_COUNT * OUT_TILE,
    height: OUT_TILE,
    filterType: -1,
  });

  // For each variant, find a representative mask, decompose it into corner
  // states, and blit the matching source quarter for each corner.
  const repForVariant = buildVariantReps();
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const mask = repForVariant[v];
    const states = cornerStates(mask);
    const destX = v * OUT_TILE;
    for (const corner of ['NW', 'NE', 'SW', 'SE']) {
      const [qc, qr] = pieceFor(corner, states[corner]);
      const [dx, dy] = CORNER_DEST[corner];
      blitQuarter(sourcePng, out, originQx + qc, originQy + qr, destX + dx, dy);
    }
  }

  return out;
}

/**
 * Build a length-48 array mapping variant index → a representative neighbour
 * mask (lowest mask that resolves to that variant), for the corner decoder.
 * @returns {number[]}
 */
function buildVariantReps() {
  const reps = new Array(VARIANT_COUNT).fill(-1);
  for (let mask = 0; mask < 256; mask++) {
    const v = resolveAutotileVariant(mask);
    if (reps[v] === -1) reps[v] = mask;
  }
  return reps;
}

/**
 * Downscale a PNG by an integer factor using nearest-neighbour (top-left sample
 * of each source block). Deterministic and byte-stable. Used to turn a 32px
 * strip into a 16px strip (factor 2).
 *
 * @param {PNG} src     source pngjs PNG.
 * @param {number} factor integer downscale factor (>= 1); width/height must be
 *        divisible by it.
 * @returns {PNG} a new PNG of (width/factor) x (height/factor).
 * @throws {Error} if factor is invalid or dimensions are not divisible.
 */
export function downscaleNearest(src, factor) {
  if (!src || typeof src.width !== 'number' || !src.data) {
    throw new Error('downscaleNearest: src must be a pngjs PNG object');
  }
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`downscaleNearest: factor must be a positive integer, got ${factor}`);
  }
  if (src.width % factor !== 0 || src.height % factor !== 0) {
    throw new Error(
      `downscaleNearest: ${src.width}x${src.height} not divisible by factor ${factor}`
    );
  }
  const dw = src.width / factor;
  const dh = src.height / factor;
  const out = new PNG({ width: dw, height: dh, filterType: -1 });
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sIdx = (y * factor * src.width + x * factor) << 2;
      const dIdx = (y * dw + x) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}
