// Procedural RPG Maker VX/Ace A2 corner-piece cell for cliff/rocky terrain.
//
// Pure function: returns a 64×96 pngjs PNG (no file I/O, no side effects).
// Designed so decodeAutotileCorner() + downscaleNearest(2) produces readable
// 16px cliff tiles with a warm-gray stone surface and a darker cliff-face edge
// on every exposed terrain boundary.
//
// QUARTER LAYOUT (4 qcols × 6 qrows, each 16×16 px at 32px native):
//
//   [0,0] outer-NW   [1,0] outer-NE  |  [2,0] concave-NW  [3,0] concave-NE
//   [0,1] outer-SW   [1,1] outer-SE  |  [2,1] concave-SW  [3,1] concave-SE
//   ---------------------------------------------------------------
//   [0,2] (unused)   [1,2] W-face    [2,2] E-face    [3,2] (unused)
//   [0,3] N-face     [1,3] fill      [2,3] fill      [3,3] N-face
//   [0,4] S-face     [1,4] fill      [2,4] fill      [3,4] S-face
//   [0,5] (unused)   [1,5] W-face    [2,5] E-face    [3,5] (unused)
//
// "Unused" quarters ([0,2],[3,2],[0,5],[3,5]) are never read by decodeAutotileCorner;
// they are painted for visual completeness only.
//
// FACE SIDE DERIVATION (from CORNER_PIECES in rpgmaker-autotile.mjs):
//   NW.edgeA = [1,2]: N present, W absent → WEST face on left   (face_W)
//   NW.edgeB = [0,3]: W present, N absent → NORTH face on top   (face_N)
//   NE.edgeA = [2,2]: N present, E absent → EAST face on right  (face_E)
//   NE.edgeB = [3,3]: E present, N absent → NORTH face on top   (face_N)
//   SW.edgeA = [1,5]: S present, W absent → WEST face on left   (face_W)
//   SW.edgeB = [0,4]: W present, S absent → SOUTH face on bottom(face_S)
//   SE.edgeA = [2,5]: S present, E absent → EAST face on right  (face_E)
//   SE.edgeB = [3,4]: E present, S absent → SOUTH face on bottom(face_S)

import { PNG } from 'pngjs';

const Q   = 16;  // quarter size (px at 32px native)
const CW  = 64;  // cell width  = 4 * Q
const CH  = 96;  // cell height = 6 * Q
const FT  = 8;   // face thickness in px at source (→ 4px after 2× downscale)
const CNT = 4;   // concave notch size in px at source (→ 2px after downscale)

// Palette (RGBA)
const STONE_L = [162, 152, 130, 255]; // cliff top, light
const STONE_M = [136, 126, 106, 255]; // cliff top, mid
const FACE_L  = [82,   66,  46, 255]; // cliff face, lighter
const FACE_D  = [48,   36,  22, 255]; // cliff face, dark

function stonePixel(px, py) {
  return ((px * 3 + py * 5) & 3) < 2 ? STONE_M : STONE_L;
}

function facePixel(px, py) {
  // Vertical-stripe rock-wall texture.
  return ((px + py) & 7) < 4 ? FACE_D : FACE_L;
}

/**
 * Paint a 16×16 quarter at absolute canvas position (x0, y0).
 *
 * @param {Buffer} data  PNG data buffer (RGBA, row-stride = CW * 4)
 * @param {number} x0    quarter left (px)
 * @param {number} y0    quarter top  (px)
 * @param {object} face  face flags:
 *   { N, S, W, E }           — full-side cliff face on the named edge
 *   { cNW, cNE, cSW, cSE }  — small concave notch in the named corner
 */
function paintQ(data, x0, y0, face) {
  for (let py = 0; py < Q; py++) {
    for (let px = 0; px < Q; px++) {
      const isFace =
        (face.N   && py < FT) ||
        (face.S   && py >= Q - FT) ||
        (face.W   && px < FT) ||
        (face.E   && px >= Q - FT) ||
        (face.cNW && px < CNT && py < CNT) ||
        (face.cNE && px >= Q - CNT && py < CNT) ||
        (face.cSW && px < CNT && py >= Q - CNT) ||
        (face.cSE && px >= Q - CNT && py >= Q - CNT);

      const [r, g, b, a] = isFace ? facePixel(px, py) : stonePixel(px, py);
      const idx = ((y0 + py) * CW + (x0 + px)) << 2;
      data[idx]     = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
}

/**
 * Generate the 64×96 RPG Maker VX/Ace A2 corner-piece cell for cliff terrain.
 * Quarter assignments exactly match the CORNER_PIECES table consumed by
 * decodeAutotileCorner() in rpgmaker-autotile.mjs.
 *
 * @returns {import('pngjs').PNG} 64×96 PNG (32px native, downscale 2× for 16px output)
 */
export function generateCliffCell() {
  const png = new PNG({ width: CW, height: CH, filterType: -1 });
  const d   = png.data;

  // ── Outer corner tile (qc 0-1, qr 0-1 → px 0-31, y 0-31) ─────────────────
  // These quarters are used when the output tile's corner has NO same-terrain
  // neighbor on either adjacent cardinal side — two cliff faces visible.
  paintQ(d,  0,  0, { N:true, W:true });  // [0,0] NW.outer: face top + left
  paintQ(d, 16,  0, { N:true, E:true });  // [1,0] NE.outer: face top + right
  paintQ(d,  0, 16, { S:true, W:true });  // [0,1] SW.outer: face bottom + left
  paintQ(d, 16, 16, { S:true, E:true });  // [1,1] SE.outer: face bottom + right

  // ── Concave corner tile (qc 2-3, qr 0-1 → px 32-63, y 0-31) ──────────────
  // Used when both adjacent cardinal neighbors are present but the diagonal is
  // absent — a small concave notch marks the inner corner.
  paintQ(d, 32,  0, { cNW:true });        // [2,0] NW.concave: notch top-left
  paintQ(d, 48,  0, { cNE:true });        // [3,0] NE.concave: notch top-right
  paintQ(d, 32, 16, { cSW:true });        // [2,1] SW.concave: notch bottom-left
  paintQ(d, 48, 16, { cSE:true });        // [3,1] SE.concave: notch bottom-right

  // ── Main block row qr2 (y 32-47) ──────────────────────────────────────────
  paintQ(d,  0, 32, { N:true, W:true });  // [0,2] UNUSED — paint for completeness
  paintQ(d, 16, 32, { W:true });          // [1,2] NW/SW.edgeA: west cliff face
  paintQ(d, 32, 32, { E:true });          // [2,2] NE/SE.edgeA: east cliff face
  paintQ(d, 48, 32, { N:true, E:true });  // [3,2] UNUSED — paint for completeness

  // ── Main block row qr3 (y 48-63) ──────────────────────────────────────────
  paintQ(d,  0, 48, { N:true });          // [0,3] NW.edgeB: north cliff face
  paintQ(d, 16, 48, {});                  // [1,3] NW.fill: solid stone top
  paintQ(d, 32, 48, {});                  // [2,3] NE.fill: solid stone top
  paintQ(d, 48, 48, { N:true });          // [3,3] NE.edgeB: north cliff face

  // ── Main block row qr4 (y 64-79) ──────────────────────────────────────────
  paintQ(d,  0, 64, { S:true });          // [0,4] SW.edgeB: south cliff face
  paintQ(d, 16, 64, {});                  // [1,4] SW.fill: solid stone top
  paintQ(d, 32, 64, {});                  // [2,4] SE.fill: solid stone top
  paintQ(d, 48, 64, { S:true });          // [3,4] SE.edgeB: south cliff face

  // ── Main block row qr5 (y 80-95) ──────────────────────────────────────────
  paintQ(d,  0, 80, { S:true, W:true });  // [0,5] UNUSED — paint for completeness
  paintQ(d, 16, 80, { W:true });          // [1,5] SW.edgeA: west cliff face
  paintQ(d, 32, 80, { E:true });          // [2,5] SE.edgeA: east cliff face
  paintQ(d, 48, 80, { S:true, E:true });  // [3,5] UNUSED — paint for completeness

  return png;
}
