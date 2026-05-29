// RPG Maker VX/Ace blob-autotile 8-neighbor RESOLVER — PURE function.
//
// Given the 8-neighbor "same-terrain" bitmask for a tile, returns the integer
// variant index 0..47 to draw, using the canonical RPG Maker VX/Ace blob layout.
//
// This is the runtime companion to the build-time decoder in
// ./rpgmaker-autotile.mjs: the decoder emits a 48-tile strip whose tile N is the
// variant for the neighbour configuration that resolveAutotileVariant() maps to N.
// The two share ONE variant ordering (defined here and mirrored by the decoder's
// AUTOTILE_TABLE), so a map cell with neighbour-mask M draws strip-tile
// resolveAutotileVariant(M).
//
// NEIGHBOUR BIT ORDER (the `neighborMask` argument):
//   bit0 = N   bit1 = NE   bit2 = E   bit3 = SE
//   bit4 = S   bit5 = SW   bit6 = W   bit7 = NW
// A bit is SET when that neighbour is the SAME terrain as the centre tile.
//
// CORNER RULE (standard RPG Maker blob): a diagonal neighbour only "connects"
// (fills its corner) when BOTH of its adjacent edge neighbours are also same-
// terrain. E.g. the NE corner is only filled when N AND E AND NE are all set.
// This collapses the 256 raw masks onto the 48 distinct blob variants.
//
// VARIANT ORDERING (load-bearing — the decoder mirrors it):
//   variant 0  = fully surrounded interior (all 4 edges + all 4 corners present)
//   variant 47 = isolated tile (no same-terrain neighbour in any of the 8 cells)
//   the 46 in between enumerate every other reachable corner-state combination,
//   in ascending order of a stable 12-bit corner-state key (see below).
//
// 47 vs 48: corner-based blob autotiling has exactly 47 *visually distinct*
// renders (a well-known result — the "47-blob"). RPG Maker's A2 sheet, and the
// decoder's AUTOTILE_TABLE, physically hold 48 slots; the surplus slot is a
// duplicate of the isolated render. We allocate all 48 indices so every slot is
// reachable and round-trippable:
//   index 0      = surrounded interior (mask 0xFF),
//   indices 1..45 = the 45 other distinct *connected* renders (ascending key),
//   index 46     = isolated render reached when ONLY diagonal neighbours are
//                  present (no cardinal edges) — renders identically to 47 but is
//                  a distinct mask family, mirroring RPG Maker's duplicate slot,
//   index 47     = the fully-isolated tile (mask 0x00, no neighbours at all).
// Slots 46 and 47 render the same isolated tile; both are kept so the strip and
// the resolver agree on all 48 positions.
//
// PURE: no fs, no imports, no side effects. Exports resolveAutotileVariant and,
// for the decoder/tests, the ordering primitives.

// Edge bit positions within neighborMask.
const N = 1 << 0;
const NE = 1 << 1;
const E = 1 << 2;
const SE = 1 << 3;
const S = 1 << 4;
const SW = 1 << 5;
const W = 1 << 6;
const NW = 1 << 7;

// Each tile is drawn from four corner-quarters. A corner has one of three states:
//   0 = OUTER  — neither adjacent edge present (an outer/convex corner)
//   1 = EDGE_H — exactly one adjacent edge present
//   2 = EDGE_V — the other adjacent edge present
//   3 = INNER  — both adjacent edges present AND the diagonal present (flat fill)
//   4 = CONCAVE— both adjacent edges present but the diagonal MISSING (inner corner)
// Encoding all four corners (5 states each) over-counts; the reachable set is the
// 48 canonical blob variants. We compute a CANONICAL KEY per mask and rank all
// reachable keys to assign 0..47 deterministically with variant 0 = surrounded
// and variant 47 = isolated.

/**
 * Classify one corner from its two adjacent edges and its diagonal.
 *
 * @param {boolean} edgeA  first adjacent cardinal edge present (same terrain)
 * @param {boolean} edgeB  second adjacent cardinal edge present
 * @param {boolean} diag   the diagonal neighbour present
 * @returns {0|1|2|3} corner state:
 *   0 outer (no edges), 1 only edgeA, 2 only edgeB,
 *   3 both edges present (then diag decides fill vs concave at key level).
 */
function cornerBase(edgeA, edgeB, diag) {
  if (edgeA && edgeB) return 3; // both edges → filled or concave (diag decides)
  if (edgeA) return 1;
  if (edgeB) return 2;
  return 0;
}

/**
 * Compute the canonical 12-bit blob key for a neighbour mask.
 * Layout (low→high): NW(3) NE(3) SW(3) SE(3) + 4 "diagonal-fill" bits.
 * The key is a stable, collision-free fingerprint of the *drawn* tile, so two
 * masks that render identically (corner rule) collapse to the same key.
 *
 * @param {number} mask 8-bit neighbour mask.
 * @returns {number} canonical key (only used for ordering / dedup).
 */
function canonicalKey(mask) {
  const n = !!(mask & N);
  const e = !!(mask & E);
  const s = !!(mask & S);
  const w = !!(mask & W);
  const ne = !!(mask & NE);
  const se = !!(mask & SE);
  const sw = !!(mask & SW);
  const nw = !!(mask & NW);

  // Per-corner base state (0..3) from the two adjacent edges.
  const cNW = cornerBase(n, w, nw);
  const cNE = cornerBase(n, e, ne);
  const cSW = cornerBase(s, w, sw);
  const cSE = cornerBase(s, e, se);

  // Diagonal-fill bit: only meaningful when both adjacent edges present (base 3).
  // 1 = concave inner corner (diag MISSING), 0 = flat fill (diag present).
  const dNW = cNW === 3 && !nw ? 1 : 0;
  const dNE = cNE === 3 && !ne ? 1 : 0;
  const dSW = cSW === 3 && !sw ? 1 : 0;
  const dSE = cSE === 3 && !se ? 1 : 0;

  return (
    (cNW << 0) |
    (cNE << 2) |
    (cSW << 4) |
    (cSE << 6) |
    (dNW << 8) |
    (dNE << 9) |
    (dSW << 10) |
    (dSE << 11)
  );
}

// Total variant slots (matches the decoder's 48-tile strip). 47 distinct renders
// + 1 dedicated isolated slot = 48 indices, see header note.
const VARIANTS = 48;

/**
 * Build the deterministic key→index ordering over the 48 variant slots.
 * Enumerates all 256 masks, dedups by canonicalKey (yields 47 distinct keys),
 * then orders so that:
 *   index 0      = the surrounded key (mask 0xFF),
 *   indices 1..46 = the 46 other non-isolated distinct keys, ascending,
 *   index 47     = the isolated key (mask 0x00).
 * The isolated key is bound ONLY to index 47.
 *
 * @returns {{ keyToIndex: Map<number,number> }}
 */
function buildOrdering() {
  const keys = new Set();
  for (let mask = 0; mask < 256; mask++) keys.add(canonicalKey(mask));

  const surroundedKey = canonicalKey(0xff);
  const isolatedKey = canonicalKey(0x00);

  const middle = [...keys]
    .filter((k) => k !== surroundedKey && k !== isolatedKey)
    .sort((a, b) => a - b);

  // 45 connected middle keys → slots 1..45; surrounded → 0.
  // (The isolated key is handled separately, see resolveAutotileVariant.)
  const indexToKey = [surroundedKey, ...middle];
  const keyToIndex = new Map(indexToKey.map((k, i) => [k, i]));
  return { keyToIndex };
}

// Cardinal-edge bits: a tile is "connected" if it has any of N/E/S/W same-terrain.
const CARDINAL = N | E | S | W;
const DIAGONAL = NE | SE | SW | NW;

const { keyToIndex } = buildOrdering();

/**
 * Resolve the 8-neighbour same-terrain bitmask to a blob variant index 0..47.
 *
 * @param {number} neighborMask 8-bit mask; bit order N,NE,E,SE,S,SW,W,NW
 *        (bit0=N … bit7=NW). A set bit means that neighbour is the same terrain.
 * @returns {number} variant index in [0, 47]. 0 = surrounded interior,
 *          47 = isolated tile.
 * @throws {Error} if neighborMask is not an integer in [0, 255].
 */
export function resolveAutotileVariant(neighborMask) {
  if (
    !Number.isInteger(neighborMask) ||
    neighborMask < 0 ||
    neighborMask > 255
  ) {
    throw new Error(
      `resolveAutotileVariant: neighborMask must be an integer in [0,255], got ${neighborMask}`
    );
  }
  // No cardinal edges → isolated render. Split into two slots so all 48 are
  // reachable: any diagonal present → 46, nothing at all → 47.
  if ((neighborMask & CARDINAL) === 0) {
    return neighborMask & DIAGONAL ? VARIANTS - 2 : VARIANTS - 1;
  }

  const variant = keyToIndex.get(canonicalKey(neighborMask));
  if (variant === undefined) {
    // Unreachable: every connected mask's key is in the ordering by construction.
    throw new Error(`resolveAutotileVariant: no variant for mask ${neighborMask}`);
  }
  return variant;
}

/**
 * Total number of variant slots (48). Exported for decoder/tests.
 * @type {number}
 */
export const VARIANT_COUNT = VARIANTS;

/**
 * For each variant index 0..47, a representative neighbour mask that resolves to
 * it. Used by the decoder to know which corner-quarters to assemble per variant,
 * and by tests to round-trip resolve(repMask[v]) === v.
 *
 * @returns {number[]} length-48 array; representativeMasks[v] resolves to v.
 */
export function representativeMasks() {
  const reps = new Array(VARIANT_COUNT).fill(-1);
  // Prefer the LOWEST mask that maps to each variant for determinism.
  for (let mask = 0; mask < 256; mask++) {
    const v = resolveAutotileVariant(mask);
    if (reps[v] === -1) reps[v] = mask;
  }
  return reps;
}

/**
 * Decompose a neighbour mask into its four corner states, for the decoder to
 * pick corner-quarters from the source art. Each corner state is one of:
 *   'outer' | 'edgeA' | 'edgeB' | 'fill' | 'concave'.
 * For corner X with adjacent edges (a,b) and diagonal d:
 *   outer   = neither a nor b
 *   edgeA   = a only        edgeB = b only
 *   fill    = a and b and d (flat interior fill)
 *   concave = a and b and !d (inner/concave corner)
 *
 * @param {number} mask 8-bit neighbour mask.
 * @returns {{ NW:string, NE:string, SW:string, SE:string }}
 */
export function cornerStates(mask) {
  const n = !!(mask & N);
  const e = !!(mask & E);
  const s = !!(mask & S);
  const w = !!(mask & W);
  const ne = !!(mask & NE);
  const se = !!(mask & SE);
  const sw = !!(mask & SW);
  const nw = !!(mask & NW);

  const classify = (a, b, d) => {
    if (a && b) return d ? 'fill' : 'concave';
    if (a) return 'edgeA';
    if (b) return 'edgeB';
    return 'outer';
  };

  return {
    NW: classify(n, w, nw),
    NE: classify(n, e, ne),
    SW: classify(s, w, sw),
    SE: classify(s, e, se),
  };
}
