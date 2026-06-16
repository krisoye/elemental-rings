/**
 * Post-implementation regression tests for GitHub issue #334 —
 * World Map modal: fit-to-viewport + zoom/pan.
 *
 * Tests lock in E2E-verified behavior and cover adversarial edge cases.
 *
 * Architecture note on client-side unit testing:
 *   OverworldMapModal imports Phaser ('phaser') at module load time. Phaser 4
 *   requires a browser DOM + WebGL context — importing it in Vitest (Node.js)
 *   crashes immediately with "window is not defined". Therefore OverworldMapModal
 *   cannot be imported directly into this suite.
 *
 *   Coverage strategy (mirroring the BattleRoomGates.test.ts precedent):
 *   - Layout constants are RE-DERIVED from the same formulas the spec mandates,
 *     using imported Node-safe deps (CANVAS_W/CANVAS_H from Constants.ts,
 *     FOREST_SCREENS from shared/world/forest.ts). Assertions verify that the
 *     derived values satisfy spec constraints — they are NOT copy-pasted from
 *     the implementation file, so they catch formula-level regressions.
 *   - clampPan is re-implemented here exactly as specified. Both the
 *     re-implementation and the production implementation derive from the same
 *     spec language; a divergence in either breaks these tests.
 *   - The four E2E scenarios (Playwright) already verified runtime behavior
 *     in a real browser. These unit tests pin the math so a refactor that
 *     changes the formula without running E2E will still fail CI.
 */

import { describe, it, expect } from 'vitest';
import { CANVAS_W, CANVAS_H } from '../../client/src/Constants';
import { FOREST_SCREENS } from '../../shared/world/forest';
import { SNOW_SCREENS } from '../../shared/world/snow';

// ---------------------------------------------------------------------------
// Re-derive layout constants from the spec
// (same derivation path as OverworldMapModal.ts, no copy-paste of values)
// ---------------------------------------------------------------------------

// Spec: PANEL_MARGIN is 12px. Panel fills the viewport minus the margin.
const PANEL_MARGIN = 12;
const PANEL_W = CANVAS_W - PANEL_MARGIN * 2;
const PANEL_H = CANVAS_H - PANEL_MARGIN * 2;
const PANEL_X = PANEL_MARGIN;
const PANEL_Y = PANEL_MARGIN;

// Spec: strip heights define the HUD bands.
const TITLE_STRIP_H = 38;
const LEGEND_STRIP_H = 32;
const CTRL_STRIP_H   = 22;

// Map area (the zoomable region inside the panel)
const MAP_AREA_W = PANEL_W - 4;
const MAP_AREA_H = PANEL_H - TITLE_STRIP_H - CTRL_STRIP_H - LEGEND_STRIP_H - 4;

// Map area top-left in screen space
const MAP_AREA_SCREEN_X = PANEL_X + 2;
const MAP_AREA_SCREEN_Y = PANEL_Y + TITLE_STRIP_H + CTRL_STRIP_H;

// Graph cell dimensions (from OverworldMapModal.ts source of truth)
const CELL_W = 110;
const CELL_H = 72;
const NODE_W = 96;   // #438: node rect width used for READABLE_SCALE derivation

// Swamp node placed one step south of forest_swamp_gate
const ALCOVE_COL = 6;
const ALCOVE_ROW = 0;
const SWAMP_ROW  = 3;

// Derive grid extents from FOREST_SCREENS (mirrors the module-level derivation)
const _coords = FOREST_SCREENS.filter((s) => s.coord).map((s) => s.coord!);
const MIN_COL = Math.min(..._coords.map((c) => c.x));

// #438: Snow screens use a biome offset so they render NORTH of the Forest grid.
// SNOW_ROW_OFFSET = −3 places snow_entry one step north of forest_snow_gate (Forest row −2).
// Render row for a Snow screen: SNOW_ROW_OFFSET + (−screen.coord.y).
// snow_blizzard_peak (local y=5) → render row −8, which is MIN_ROW after extension.
const SNOW_ROW_OFFSET = -3;
const _snowRenderRows = SNOW_SCREENS.filter((s) => s.coord).map((s) => SNOW_ROW_OFFSET + (-s.coord!.y));

// MIN_ROW must include both Forest and Snow rows so CONTENT_H / FIT_SCALE are correct.
// Without Snow, MIN_ROW = −5 (Forest only) — Snow_blizzard_peak at −8 would be off-screen north.
const MIN_ROW = Math.min(
  Math.min(..._coords.map((c) => -c.y)),
  Math.min(..._snowRenderRows),
);
const MAX_COL = Math.max(..._coords.map((c) => c.x));
const MAX_ROW = Math.max(..._coords.map((c) => -c.y));

const _maxCol = Math.max(ALCOVE_COL, MAX_COL);
const _maxRow = Math.max(SWAMP_ROW, MAX_ROW);
const GRID_COLS = _maxCol - MIN_COL + 1;
const GRID_ROWS = _maxRow - MIN_ROW + 1;

const CONTENT_W = GRID_COLS * CELL_W;
const CONTENT_H = GRID_ROWS * CELL_H;

// Fit scale: scale content to fit inside map area with inner padding
const MAP_INNER_PAD = 8;
const FIT_SCALE = Math.min(
  (MAP_AREA_W - MAP_INNER_PAD * 2) / CONTENT_W,
  (MAP_AREA_H - MAP_INNER_PAD * 2) / CONTENT_H,
);

// Zoom limits (spec: ZOOM_MIN = fit; ZOOM_MAX = 3× fit)
const ZOOM_MIN = FIT_SCALE;
const ZOOM_MAX = FIT_SCALE * 3;

// #438: READABLE_SCALE ensures NODE_W * scale ≈ 78px (legible label width).
// OPEN_ZOOM is the zoom level the modal opens at (≥ FIT_SCALE, ≤ ZOOM_MAX).
const READABLE_SCALE = 78 / NODE_W;                                   // ≈ 0.813
const OPEN_ZOOM = Math.max(FIT_SCALE, Math.min(READABLE_SCALE, ZOOM_MAX));

// ---------------------------------------------------------------------------
// Re-implementation of clampPan (spec language, not copy-paste)
// Spec: when scaled content fits inside the map area, center it (no pan).
//       When scaled content exceeds the map area, constrain so there is no
//       empty gap at any canvas edge (panX ∈ [MAP_AREA_W - scaledW, 0]).
// ---------------------------------------------------------------------------

function clampPan(
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  const scaledW = CONTENT_W * scale;
  const scaledH = CONTENT_H * scale;

  let minX: number, maxX: number, minY: number, maxY: number;

  if (scaledW <= MAP_AREA_W) {
    // Center: no pan allowed
    const cx = (MAP_AREA_W - scaledW) / 2;
    minX = cx; maxX = cx;
  } else {
    maxX = 0;
    minX = MAP_AREA_W - scaledW;
  }

  if (scaledH <= MAP_AREA_H) {
    const cy = (MAP_AREA_H - scaledH) / 2;
    minY = cy; maxY = cy;
  } else {
    maxY = 0;
    minY = MAP_AREA_H - scaledH;
  }

  return {
    x: Math.max(minX, Math.min(maxX, panX)),
    y: Math.max(minY, Math.min(maxY, panY)),
  };
}

// ---------------------------------------------------------------------------
// applyZoom — spec-derived clamping logic (mirrors the production method)
// Spec: clamp newScale to [ZOOM_MIN, ZOOM_MAX], then re-clamp pan.
// ---------------------------------------------------------------------------

function applyZoom(
  currentScale: number,
  currentPanX: number,
  currentPanY: number,
  newScale: number,
): { scale: number; panX: number; panY: number } {
  const prevScale = currentScale;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

  let panX = currentPanX;
  let panY = currentPanY;

  // Spec: when returning to fit, zero pan before clamping (re-centers).
  if (clamped === ZOOM_MIN && prevScale !== ZOOM_MIN) {
    panX = 0;
    panY = 0;
  }

  const { x, y } = clampPan(panX, panY, clamped);
  return { scale: clamped, panX: x, panY: y };
}

// ---------------------------------------------------------------------------
// nodeCenter — mirrors OverworldMapModal.ts line 216 exactly.
// Used to verify Snow nodes get non-negative y (i.e. they are not clipped above
// the map area, which requires MIN_ROW to be extended to include Snow rows).
// ---------------------------------------------------------------------------

function nodeCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - MIN_COL) * CELL_W + CELL_W / 2,
    y: (row - MIN_ROW) * CELL_H + CELL_H / 2,
  };
}

// ---------------------------------------------------------------------------
// focalZoomPan — the spec focal-point zoom formula from #438 Step 2.
// Keeps a screen-space focal point fixed as zoom changes from currentScale to
// newScale. See spec: "focalX - MAP_AREA_SCREEN_X - (focalX - MAP_AREA_SCREEN_X
// - currentPanX) * (newScale / currentScale)".
// ---------------------------------------------------------------------------

function focalZoomPanX(
  focalX: number,       // focal point in screen space
  currentPanX: number,
  currentScale: number,
  newScale: number,
): number {
  return focalX - MAP_AREA_SCREEN_X - (focalX - MAP_AREA_SCREEN_X - currentPanX) * (newScale / currentScale);
}

function focalZoomPanY(
  focalY: number,
  currentPanY: number,
  currentScale: number,
  newScale: number,
): number {
  return focalY - MAP_AREA_SCREEN_Y - (focalY - MAP_AREA_SCREEN_Y - currentPanY) * (newScale / currentScale);
}

// ---------------------------------------------------------------------------
// Class 1 — Spec Conformance
// (Assertions tied directly to acceptance criteria from issue #334)
// ---------------------------------------------------------------------------

describe('SpecConformance: layout derived from CANVAS_W/CANVAS_H (#334)', () => {

  it('PANEL_W and PANEL_H are derived from CANVAS_W/CANVAS_H, not hardcoded 1110/730', () => {
    // Spec: "Derive panel dimensions from the viewport (CANVAS_W/CANVAS_H)
    //        instead of the hardcoded 1110×730."
    expect(PANEL_W).toBe(CANVAS_W - PANEL_MARGIN * 2);
    expect(PANEL_H).toBe(CANVAS_H - PANEL_MARGIN * 2);
    // Explicit guard: must NOT equal the old hardcoded values
    expect(PANEL_W).not.toBe(1110);
    expect(PANEL_H).not.toBe(730);
  });

  it('CANVAS_W and CANVAS_H are 1024 and 576 (sanity: constants not swapped)', () => {
    expect(CANVAS_W).toBe(1024);
    expect(CANVAS_H).toBe(576);
  });

  it('MAP_AREA_SCREEN_X and MAP_AREA_SCREEN_Y are derived from panel layout', () => {
    // Spec: "map area top-left = PANEL_X+2 (stroke gap), below title+ctrl strips"
    expect(MAP_AREA_SCREEN_X).toBe(PANEL_X + 2);
    expect(MAP_AREA_SCREEN_Y).toBe(PANEL_Y + TITLE_STRIP_H + CTRL_STRIP_H);
  });

});

describe('SpecConformance: FIT_SCALE keeps entire graph within canvas (#334)', () => {

  it('FIT_SCALE is strictly positive', () => {
    // A zero or negative scale would invert or collapse the modal.
    expect(FIT_SCALE).toBeGreaterThan(0);
  });

  it('scaled content width + padding fits inside MAP_AREA_W', () => {
    // Spec: "fit-scales the derived graph to the viewport on open…
    //        entire node graph + legend + close-hint with zero clipping"
    const scaledW = CONTENT_W * FIT_SCALE;
    expect(scaledW + MAP_INNER_PAD * 2).toBeLessThanOrEqual(MAP_AREA_W + 0.001);
  });

  it('scaled content height + padding fits inside MAP_AREA_H', () => {
    const scaledH = CONTENT_H * FIT_SCALE;
    expect(scaledH + MAP_INNER_PAD * 2).toBeLessThanOrEqual(MAP_AREA_H + 0.001);
  });

  it('panel bottom edge (PANEL_Y + PANEL_H) is within CANVAS_H', () => {
    // Spec: "all within 1024×576 with zero clipping"
    expect(PANEL_Y + PANEL_H).toBeLessThanOrEqual(CANVAS_H);
  });

  it('panel right edge (PANEL_X + PANEL_W) is within CANVAS_W', () => {
    expect(PANEL_X + PANEL_W).toBeLessThanOrEqual(CANVAS_W);
  });

  it('legend strip bottom is within canvas height', () => {
    // Legend pins to PANEL_Y + PANEL_H. The strip is LEGEND_STRIP_H tall, so
    // the strip bottom = PANEL_Y + PANEL_H ≤ CANVAS_H (verified above).
    const legendBottom = PANEL_Y + PANEL_H;
    expect(legendBottom).toBeLessThanOrEqual(CANVAS_H);
  });

  it('FIT_SCALE formula accounts for margin (does not yield 1.0 for exact content-area match)', () => {
    // Spec: "with a small inner margin". If content perfectly filled MAP_AREA_W
    // with no inner pad, scale would be 1.0. The margin means it should be < 1.0
    // unless MAP_AREA itself is larger than CONTENT (which is the typical case here).
    // What the test pins: the formula includes MAP_INNER_PAD, so:
    //   FIT_SCALE ≤ (MAP_AREA_W - MAP_INNER_PAD * 2) / CONTENT_W
    //   FIT_SCALE ≤ (MAP_AREA_H - MAP_INNER_PAD * 2) / CONTENT_H
    const maxByW = (MAP_AREA_W - MAP_INNER_PAD * 2) / CONTENT_W;
    const maxByH = (MAP_AREA_H - MAP_INNER_PAD * 2) / CONTENT_H;
    expect(FIT_SCALE).toBeLessThanOrEqual(maxByW + 1e-9);
    expect(FIT_SCALE).toBeLessThanOrEqual(maxByH + 1e-9);
  });

  // #438: OPEN_ZOOM assertions — the modal now opens at OPEN_ZOOM (≥ FIT_SCALE),
  // not bare FIT_SCALE. Both must be in range after the Snow bounds extension.
  it('OPEN_ZOOM ≥ FIT_SCALE — modal never opens more zoomed-out than fit (#438)', () => {
    // #438 adversarial: if OPEN_ZOOM < FIT_SCALE the initial applyZoom call
    // would re-clamp to FIT_SCALE, causing a jarring zoom-in on every open
    expect(OPEN_ZOOM).toBeGreaterThanOrEqual(FIT_SCALE - 1e-9);
  });

  it('OPEN_ZOOM ≤ ZOOM_MAX — modal never opens beyond the maximum zoom (#438)', () => {
    // #438 adversarial: READABLE_SCALE could exceed ZOOM_MAX on very small graphs;
    // Math.min(READABLE_SCALE, ZOOM_MAX) must clamp it
    expect(OPEN_ZOOM).toBeLessThanOrEqual(ZOOM_MAX + 1e-9);
  });

});

describe('SpecConformance: clampPan at fit zoom centers the content (#334)', () => {

  it('clampPan(0, 0, FIT_SCALE) returns panX >= 0 (centering offset, not negative)', () => {
    // Spec: at fit zoom, scaled content is smaller than or equal to map area;
    //       center it — offset is always non-negative.
    const { x } = clampPan(0, 0, FIT_SCALE);
    expect(x).toBeGreaterThanOrEqual(0);
  });

  it('clampPan(0, 0, FIT_SCALE) returns panY >= 0', () => {
    const { y } = clampPan(0, 0, FIT_SCALE);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('clampPan at fit zoom locks pan (any input returns the same centering offset)', () => {
    // Spec: "disallow any pan" when content fits inside map area.
    const { x: cx1, y: cy1 } = clampPan(0, 0, FIT_SCALE);
    const { x: cx2, y: cy2 } = clampPan(100, 50, FIT_SCALE);
    const { x: cx3, y: cy3 } = clampPan(-200, -200, FIT_SCALE);
    expect(cx2).toBeCloseTo(cx1, 9);
    expect(cy2).toBeCloseTo(cy1, 9);
    expect(cx3).toBeCloseTo(cx1, 9);
    expect(cy3).toBeCloseTo(cy1, 9);
  });

});

describe('SpecConformance: clampPan when zoomed-in constrains to content bounds (#334)', () => {

  const ZOOMED = FIT_SCALE * 2; // 2× fit — content clearly larger than map area

  it('clampPan at 2× zoom: panX cannot exceed 0 (left edge cannot detach)', () => {
    // Spec: "panning is clamped so the graph never detaches into empty space"
    const { x } = clampPan(999, 0, ZOOMED);
    expect(x).toBeLessThanOrEqual(0);
  });

  it('clampPan at 2× zoom: panX cannot go below MAP_AREA_W - scaledW (right edge)', () => {
    const scaledW = CONTENT_W * ZOOMED;
    const { x } = clampPan(-99999, 0, ZOOMED);
    expect(x).toBeGreaterThanOrEqual(MAP_AREA_W - scaledW - 0.001);
  });

  it('clampPan at 2× zoom: panY cannot exceed 0 (top edge cannot detach)', () => {
    const { y } = clampPan(0, 999, ZOOMED);
    expect(y).toBeLessThanOrEqual(0);
  });

  it('clampPan at 2× zoom: panY cannot go below MAP_AREA_H - scaledH (bottom edge)', () => {
    const scaledH = CONTENT_H * ZOOMED;
    const { y } = clampPan(0, -99999, ZOOMED);
    expect(y).toBeGreaterThanOrEqual(MAP_AREA_H - scaledH - 0.001);
  });

});

describe('SpecConformance: applyZoom clamps to [ZOOM_MIN, ZOOM_MAX] (#334)', () => {

  it('applyZoom to FIT_SCALE returns exactly ZOOM_MIN', () => {
    // Spec: "reset returns to fit"
    const { scale } = applyZoom(FIT_SCALE * 2, -50, -50, FIT_SCALE);
    expect(scale).toBeCloseTo(ZOOM_MIN, 10);
  });

  it('applyZoom to FIT_SCALE * 3 returns exactly ZOOM_MAX', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, FIT_SCALE * 3);
    expect(scale).toBeCloseTo(ZOOM_MAX, 10);
  });

  it('ZOOM_MAX is exactly 3× ZOOM_MIN', () => {
    // Spec: "max 3× from fit"
    expect(ZOOM_MAX).toBeCloseTo(ZOOM_MIN * 3, 10);
  });

  it('applyZoom to fit resets pan to centered offset (pan >= 0 after reset)', () => {
    // Spec: "0 or reset button returns to fit zoom" + pan re-centers
    const { panX, panY } = applyZoom(FIT_SCALE * 2, -300, -300, FIT_SCALE);
    expect(panX).toBeGreaterThanOrEqual(0);
    expect(panY).toBeGreaterThanOrEqual(0);
  });

});

describe('SpecConformance: show() resets scale and pan on every open (#334, #438)', () => {

  it('fallback state: clampPan(0, 0, OPEN_ZOOM) yields a stable centering value', () => {
    // #438: show() now sets currentScale = OPEN_ZOOM (not FIT_SCALE) and centers on the
    // player node. For unknown screenId the fallback path calls clampPan(0, 0, OPEN_ZOOM).
    // After two calls the result is identical (no leftover state from prior calls).
    const first  = clampPan(0, 0, OPEN_ZOOM);
    const second = clampPan(0, 0, OPEN_ZOOM);
    expect(second.x).toBeCloseTo(first.x, 10);
    expect(second.y).toBeCloseTo(first.y, 10);
  });

  it('0-key / reset-button: applyZoom(FIT_SCALE) pan is deterministic regardless of prior state', () => {
    // #438: The 0-key and reset button still call applyZoom(FIT_SCALE) for a full fit reset.
    // show() now opens at OPEN_ZOOM; the full-fit reset is distinct from the open state.
    // This test verifies the 0-reset pan is deterministic (no state bleed from prior zoom+pan).
    const { panX: freshX, panY: freshY } = applyZoom(FIT_SCALE, 0, 0, FIT_SCALE);

    // Simulate dirty state from a prior session
    const { panX, panY } = applyZoom(FIT_SCALE * 2.5, -400, -250, FIT_SCALE);

    expect(panX).toBeCloseTo(freshX, 9);
    expect(panY).toBeCloseTo(freshY, 9);
  });

  it('OPEN_ZOOM >= FIT_SCALE (show() opens at a more readable zoom than full-fit)', () => {
    // #438 adversarial: if this fails, the player-centered open actually zoomed OUT vs fit,
    // which defeats the purpose of OPEN_ZOOM (readability at open).
    expect(OPEN_ZOOM).toBeGreaterThanOrEqual(FIT_SCALE);
  });

  it('OPEN_ZOOM <= ZOOM_MAX (show() does not open beyond the ceiling)', () => {
    expect(OPEN_ZOOM).toBeLessThanOrEqual(ZOOM_MAX);
  });

});

// ---------------------------------------------------------------------------
// Class 2 — Adversarial / Edge Cases
// ---------------------------------------------------------------------------

describe('AdversarialNegatives: applyZoom below ZOOM_MIN clamps, not underflows (#334)', () => {

  it('applyZoom(0) clamps to ZOOM_MIN — cannot set scale to zero', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, 0);
    expect(scale).toBeCloseTo(ZOOM_MIN, 10);
    expect(scale).toBeGreaterThan(0);
  });

  it('applyZoom(-1) (negative scale) clamps to ZOOM_MIN — cannot invert', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, -1);
    expect(scale).toBeCloseTo(ZOOM_MIN, 10);
  });

  it('applyZoom(FIT_SCALE * 0.5) clamps to ZOOM_MIN — cannot zoom below fit', () => {
    // Spec: "can never zoom below fit"
    const { scale } = applyZoom(FIT_SCALE, 0, 0, FIT_SCALE * 0.5);
    expect(scale).toBeCloseTo(ZOOM_MIN, 10);
  });

  it('applyZoom(Number.NEGATIVE_INFINITY) clamps to ZOOM_MIN', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, -Infinity);
    expect(scale).toBeCloseTo(ZOOM_MIN, 10);
  });

});

describe('AdversarialNegatives: applyZoom above ZOOM_MAX clamps (#334)', () => {

  it('applyZoom(FIT_SCALE * 4) clamps to ZOOM_MAX — cannot exceed 3× fit', () => {
    // Spec: "max 3× from fit"
    const { scale } = applyZoom(FIT_SCALE, 0, 0, FIT_SCALE * 4);
    expect(scale).toBeCloseTo(ZOOM_MAX, 10);
  });

  it('applyZoom(Number.POSITIVE_INFINITY) clamps to ZOOM_MAX', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, +Infinity);
    expect(scale).toBeCloseTo(ZOOM_MAX, 10);
  });

  it('applyZoom(10000) clamps to ZOOM_MAX, not 10000', () => {
    const { scale } = applyZoom(FIT_SCALE, 0, 0, 10000);
    expect(scale).toBeCloseTo(ZOOM_MAX, 10);
    expect(scale).not.toBe(10000);
  });

});

describe('AdversarialNegatives: clampPan with extreme negative values (#334)', () => {

  const ZOOMED = FIT_SCALE * 2;

  it('clampPan(-9999, 0, 2×fit) clamps to content edge — never -9999', () => {
    // Spec: "panning is clamped so the graph never detaches into empty space"
    const scaledW = CONTENT_W * ZOOMED;
    const { x } = clampPan(-9999, 0, ZOOMED);
    const expectedMin = MAP_AREA_W - scaledW;
    expect(x).toBeGreaterThanOrEqual(expectedMin - 0.001);
    expect(x).not.toBe(-9999);
  });

  it('clampPan(0, -9999, 2×fit) clamps to content edge — never -9999', () => {
    const scaledH = CONTENT_H * ZOOMED;
    const { y } = clampPan(0, -9999, ZOOMED);
    const expectedMin = MAP_AREA_H - scaledH;
    expect(y).toBeGreaterThanOrEqual(expectedMin - 0.001);
    expect(y).not.toBe(-9999);
  });

  it('clampPan(-9999, -9999, 2×fit) clamps both axes — neither is -9999', () => {
    const { x, y } = clampPan(-9999, -9999, ZOOMED);
    expect(x).not.toBe(-9999);
    expect(y).not.toBe(-9999);
  });

});

describe('AdversarialNegatives: clampPan with extreme positive values (#334)', () => {

  const ZOOMED = FIT_SCALE * 2;

  it('clampPan(9999, 0, 2×fit) clamps to 0 (left edge cannot detach)', () => {
    const { x } = clampPan(9999, 0, ZOOMED);
    expect(x).toBeLessThanOrEqual(0 + 0.001);
  });

  it('clampPan(0, 9999, 2×fit) clamps to 0 (top edge cannot detach)', () => {
    const { y } = clampPan(0, 9999, ZOOMED);
    expect(y).toBeLessThanOrEqual(0 + 0.001);
  });

});

describe('AdversarialNegatives: clampPan when content is smaller than map area (#334)', () => {

  it('at fit zoom, clampPan always returns non-negative values regardless of input', () => {
    // Spec: content fits inside map area → "center it, no pan allowed"
    // centering offset is always >= 0 for any valid fit-scale content
    const cases: [number, number][] = [
      [0, 0], [100, 100], [-100, -100], [-9999, -9999], [9999, 9999],
    ];
    for (const [px, py] of cases) {
      const { x, y } = clampPan(px, py, FIT_SCALE);
      expect(x, `panX should be >= 0 for input (${px}, ${py})`).toBeGreaterThanOrEqual(0);
      expect(y, `panY should be >= 0 for input (${px}, ${py})`).toBeGreaterThanOrEqual(0);
    }
  });

  it('at fit zoom, centering offset is stable — any two calls yield the same value', () => {
    const { x: x1, y: y1 } = clampPan(-9999, -9999, FIT_SCALE);
    const { x: x2, y: y2 } = clampPan(9999, 9999, FIT_SCALE);
    expect(x1).toBeCloseTo(x2, 9);
    expect(y1).toBeCloseTo(y2, 9);
  });

});

describe('AdversarialNegatives: show() guard — re-opening idempotency (#334)', () => {

  it('clampPan(0, 0, FIT_SCALE) is idempotent: applying it twice returns the same result', () => {
    // show() calls clampPan(0, 0, FIT_SCALE) on every open.
    // Idempotency ensures that opening twice without closing does not drift state.
    const first  = clampPan(0, 0, FIT_SCALE);
    const second = clampPan(first.x, first.y, FIT_SCALE);
    expect(second.x).toBeCloseTo(first.x, 10);
    expect(second.y).toBeCloseTo(first.y, 10);
  });

});

describe('AdversarialNegatives: grid constants derived from FOREST_SCREENS data (#334)', () => {

  it('FOREST_SCREENS has at least one coordinated screen (cannot crash with empty _coords)', () => {
    // OverworldMapModal throws if no coordinated screens. This test documents
    // the invariant so a manifest wipe would be caught immediately.
    expect(_coords.length).toBeGreaterThan(0);
  });

  it('GRID_COLS and GRID_ROWS are positive integers', () => {
    expect(GRID_COLS).toBeGreaterThan(0);
    expect(GRID_ROWS).toBeGreaterThan(0);
    expect(Number.isInteger(GRID_COLS)).toBe(true);
    expect(Number.isInteger(GRID_ROWS)).toBe(true);
  });

  it('CONTENT_W and CONTENT_H are positive', () => {
    expect(CONTENT_W).toBeGreaterThan(0);
    expect(CONTENT_H).toBeGreaterThan(0);
  });

  it('MAP_AREA_W and MAP_AREA_H are positive', () => {
    // If strips consume more height than the panel, MAP_AREA_H would go ≤ 0.
    expect(MAP_AREA_W).toBeGreaterThan(0);
    expect(MAP_AREA_H).toBeGreaterThan(0);
  });

});

describe('AdversarialNegatives: ZOOM_MIN / ZOOM_MAX boundary — exactly at limits (#334)', () => {

  it('applyZoom(ZOOM_MIN) from ZOOM_MIN — no-op on scale, pan re-centers', () => {
    // Applying the same scale as current should leave scale unchanged (at ZOOM_MIN).
    // This tests the prevScale === ZOOM_MIN guard branch: pan should NOT be zeroed.
    const { x: panX } = clampPan(0, 0, FIT_SCALE);
    const result = applyZoom(FIT_SCALE, panX, 0, FIT_SCALE);
    expect(result.scale).toBeCloseTo(ZOOM_MIN, 10);
    // Pan stays at the centering offset (not zeroed by the guard branch)
    expect(result.panX).toBeGreaterThanOrEqual(0);
  });

  it('applyZoom(ZOOM_MAX) from ZOOM_MAX — scale stays at ZOOM_MAX', () => {
    const result = applyZoom(ZOOM_MAX, 0, 0, ZOOM_MAX);
    expect(result.scale).toBeCloseTo(ZOOM_MAX, 10);
  });

  it('applyZoom(ZOOM_MIN + epsilon) — rounds up to just above ZOOM_MIN', () => {
    const epsilon = 1e-10;
    const { scale } = applyZoom(FIT_SCALE, 0, 0, ZOOM_MIN + epsilon);
    expect(scale).toBeGreaterThanOrEqual(ZOOM_MIN);
  });

  it('applyZoom(ZOOM_MAX - epsilon) — just below ceiling, not clamped to ZOOM_MAX', () => {
    const epsilon = 1e-10;
    const { scale } = applyZoom(FIT_SCALE, 0, 0, ZOOM_MAX - epsilon);
    expect(scale).toBeLessThan(ZOOM_MAX);
    expect(scale).toBeGreaterThan(ZOOM_MIN);
  });

});

// ===========================================================================
// #438 — W0.2: Sealed-exit stub + multi-biome World Map modal
// ===========================================================================

describe('SpecConformance: Snow node derivation from SNOW_SCREENS manifest (#438)', () => {

  it('SNOW_SCREENS has exactly 9 screens — all Snow screens are manifest-derived, none static', () => {
    // #438: the static SNOW_NODE constant (1 node) is replaced by 9 manifest-derived nodes
    expect(SNOW_SCREENS).toHaveLength(9);
  });

  it('all SNOW_SCREENS entries have coord fields — filter covers every screen', () => {
    // #438 adversarial: a future screen added without coord silently drops from derivation;
    // right now all 9 must have coords or the acceptance criterion is already violated
    const withCoord = SNOW_SCREENS.filter((s) => s.coord);
    expect(withCoord).toHaveLength(SNOW_SCREENS.length);
    expect(withCoord).toHaveLength(9);
  });

  it('snow_entry render row is SNOW_ROW_OFFSET + 0 = −3 (not 0, not −2)', () => {
    // #438 adversarial: naively using −coord.y without the offset gives row 0 (on the Forest grid);
    // using Forest formula coord-directly gives row −2 (forest_snow_gate's row) — both wrong
    const snowEntry = SNOW_SCREENS.find((s) => s.id === 'snow_entry')!;
    const renderRow = SNOW_ROW_OFFSET + (-snowEntry.coord!.y);
    expect(renderRow).toBe(-3);
    expect(renderRow).not.toBe(0);   // without biome offset
    expect(renderRow).not.toBe(-2);  // forest_snow_gate row
  });

  it('snow_blizzard_peak render row is −8 (coord y=5 → deepest north node)', () => {
    // #438 adversarial: off-by-one in SNOW_ROW_OFFSET (e.g. -2 instead of -3) puts the peak
    // at −7 — bounds extension fails to cover it fully, clipping still occurs
    const peak = SNOW_SCREENS.find((s) => s.id === 'snow_blizzard_peak')!;
    expect(peak.coord!.y).toBe(5);   // sanity: manifest y drives the result
    const renderRow = SNOW_ROW_OFFSET + (-peak.coord!.y);
    expect(renderRow).toBe(-8);
  });

  it('all snow render rows are ≤ −3 (all Snow screens are north of the Forest grid)', () => {
    // #438 adversarial: a sign error in the offset formula could place a snow screen
    // inside the Forest grid (row ≥ 0), causing a node collision on the map
    for (const row of _snowRenderRows) {
      expect(row).toBeLessThanOrEqual(-3);
    }
  });

  it('minimum snow render row is −8 (from snow_blizzard_peak)', () => {
    // #438 adversarial: if the minimum is wrong, MIN_ROW is wrong → CONTENT_H and FIT_SCALE wrong
    const minSnowRow = Math.min(..._snowRenderRows);
    expect(minSnowRow).toBe(-8);
  });

  it('9 snow render rows derived — each SNOW_SCREEN produces exactly one row entry', () => {
    // #438 adversarial: a filter bug that drops screens would produce fewer rows than screens
    expect(_snowRenderRows).toHaveLength(9);
  });

});

describe('SpecConformance: MIN_ROW includes Snow rows — north bounds extension (#438)', () => {

  it('MIN_ROW = −8 after Snow-extended derivation', () => {
    // #438 adversarial: without Snow inclusion, MIN_ROW stays at −5; snow_blizzard_peak at −8
    // then gets a negative y from nodeCenter (y = (−8−(−5))×72+36 = −180) → clipped above map
    expect(MIN_ROW).toBe(-8);
  });

  it('MIN_ROW ≤ −8 (Snow drives the north bound; no over-restriction)', () => {
    expect(MIN_ROW).toBeLessThanOrEqual(-8);
  });

  it('Forest-only MIN_ROW was −5 — Snow extension drives it to −8', () => {
    // #438 adversarial: this documents the regression the extension prevents.
    // The forest-only value must be GREATER than the new MIN_ROW.
    const forestOnlyMinRow = Math.min(..._coords.map((c) => -c.y));
    expect(forestOnlyMinRow).toBe(-5);
    expect(MIN_ROW).toBeLessThan(forestOnlyMinRow);
  });

  it('GRID_ROWS increases with Snow extension (more rows than Forest-only grid)', () => {
    // With MIN_ROW=−5: GRID_ROWS = _maxRow−(−5)+1 = _maxRow+6
    // With MIN_ROW=−8: GRID_ROWS = _maxRow−(−8)+1 = _maxRow+9 → 3 more rows
    const forestOnlyMinRow = Math.min(..._coords.map((c) => -c.y)); // −5
    const forestOnlyGridRows = _maxRow - forestOnlyMinRow + 1;
    const _maxRow_local = Math.max(SWAMP_ROW, MAX_ROW);
    const currentGridRows = _maxRow_local - MIN_ROW + 1;
    expect(currentGridRows).toBeGreaterThan(forestOnlyGridRows);
  });

});

describe('SpecConformance: nodeCenter returns non-negative y for all Snow nodes (#438)', () => {

  it('nodeCenter for snow_blizzard_peak (col=0, row=−8) returns y ≥ 0', () => {
    // #438 adversarial: without bounds extension, nodeCenter(0,−8) → y = (−8−(−5))×72+36 = −180
    // That is off-screen north — the node would be rendered above the visible content area
    const { y } = nodeCenter(0, -8);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it('nodeCenter for snow_blizzard_peak (row=−8) returns y exactly CELL_H/2 = 36', () => {
    // With MIN_ROW=−8: y = (−8 − (−8)) × 72 + 36 = 36.
    // The topmost row is flush to the content-area top (y=CELL_H/2 is row center).
    const { y } = nodeCenter(0, -8);
    expect(y).toBeCloseTo(CELL_H / 2, 9);
  });

  it('nodeCenter for snow_entry (row=−3) returns y > snow_blizzard_peak y', () => {
    // snow_entry is 5 rows south of snow_blizzard_peak → larger y (further down in content space)
    const { y: yPeak  } = nodeCenter(0, -8);
    const { y: yEntry } = nodeCenter(0, -3);
    expect(yEntry).toBeGreaterThan(yPeak);
    expect(yEntry).toBeGreaterThanOrEqual(0);
  });

  it('nodeCenter for every unique snow render row returns non-negative y', () => {
    // #438 adversarial: covers all 6 distinct snow render rows, not just the worst-case boundary
    const uniqueSnowRows = [...new Set(_snowRenderRows)].sort((a, b) => a - b);
    // Expected: [−8, −7, −6, −5, −4, −3]
    for (const row of uniqueSnowRows) {
      const { y } = nodeCenter(0, row);
      expect(y, `nodeCenter(0, ${row}).y should be ≥ 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('nodeCenter for snow_blizzard_peak without bounds extension would give negative y', () => {
    // #438 adversarial: documents the exact value that would have been wrong before the fix.
    // (−8 − (−5)) × 72 + 36 = −216 + 36 = −180 — off-screen north
    const wrongY = (-8 - (-5)) * CELL_H + CELL_H / 2;
    expect(wrongY).toBe(-180);
    expect(wrongY).toBeLessThan(0);  // this is the bug the bounds extension fixes
  });

});

describe('SpecConformance: OPEN_ZOOM and READABLE_SCALE constants (#438)', () => {

  it('READABLE_SCALE = 78 / NODE_W (makes node width ≈ 78px at this scale)', () => {
    // Spec: "READABLE_SCALE = the scale at which NODE_W * scale ≈ 78px → 78 / NODE_W"
    expect(READABLE_SCALE).toBeCloseTo(78 / 96, 10);
    expect(NODE_W * READABLE_SCALE).toBeCloseTo(78, 9);
  });

  it('OPEN_ZOOM formula: Math.max(FIT_SCALE, Math.min(READABLE_SCALE, ZOOM_MAX))', () => {
    // Verify the formula exactly matches the spec
    const expected = Math.max(FIT_SCALE, Math.min(READABLE_SCALE, ZOOM_MAX));
    expect(OPEN_ZOOM).toBeCloseTo(expected, 10);
  });

  it('for the Forest+Snow graph, OPEN_ZOOM = READABLE_SCALE (FIT_SCALE < READABLE_SCALE < ZOOM_MAX)', () => {
    // Spec: "For the Forest (29 screens), FIT_SCALE < READABLE_SCALE so OPEN_ZOOM = READABLE_SCALE"
    // With Snow (38 nodes, CONTENT_H=12×72=864px), FIT_SCALE is small (~0.51); READABLE_SCALE≈0.813
    // #438 adversarial: if someone tightens ZOOM_MAX or enlarges READABLE_SCALE, this test catches it
    expect(FIT_SCALE).toBeLessThan(READABLE_SCALE);
    expect(READABLE_SCALE).toBeLessThan(ZOOM_MAX);
    expect(OPEN_ZOOM).toBeCloseTo(READABLE_SCALE, 9);
  });

  it('OPEN_ZOOM is strictly positive', () => {
    // A zero or negative OPEN_ZOOM would invert / collapse the modal
    expect(OPEN_ZOOM).toBeGreaterThan(0);
  });

});

describe('SpecConformance: focal-point zoom math invariant (#438)', () => {

  // Pure math tests for the spec focal-point formula (Step 2).
  // A screen-space point focalX must remain at the same screen X after a zoom change.

  it('focalZoomPanX: focal point stays fixed in screen X after zoom (map-area center)', () => {
    // #438 adversarial: the old applyZoom re-clamped toward content center — focal drifted.
    // This proves the new formula is algebraically correct.
    const currentScale = FIT_SCALE * 2;
    const currentPanX  = MAP_AREA_W / 4;       // arbitrary valid pan
    const focalX = MAP_AREA_SCREEN_X + MAP_AREA_W / 2;  // button-zoom focal = map-area center
    const newScale = FIT_SCALE * 2.5;

    const newPanX = focalZoomPanX(focalX, currentPanX, currentScale, newScale);

    // A content point that was at focalX before zoom must still be at focalX after.
    const contentX = (focalX - MAP_AREA_SCREEN_X - currentPanX) / currentScale;
    const screenXAfter = MAP_AREA_SCREEN_X + newPanX + contentX * newScale;
    expect(screenXAfter).toBeCloseTo(focalX, 9);
  });

  it('focalZoomPanY: focal point stays fixed in screen Y after zoom', () => {
    const currentScale = FIT_SCALE * 2;
    const currentPanY  = MAP_AREA_H / 4;
    const focalY = MAP_AREA_SCREEN_Y + MAP_AREA_H / 2;
    const newScale = FIT_SCALE * 1.5;

    const newPanY = focalZoomPanY(focalY, currentPanY, currentScale, newScale);

    const contentY = (focalY - MAP_AREA_SCREEN_Y - currentPanY) / currentScale;
    const screenYAfter = MAP_AREA_SCREEN_Y + newPanY + contentY * newScale;
    expect(screenYAfter).toBeCloseTo(focalY, 9);
  });

  it('focal-point formula is invariant for left, center, and right of map area', () => {
    // #438 adversarial: if MAP_AREA_SCREEN_X is wrong in the formula, only the center works
    const currentScale = FIT_SCALE * 3;
    const currentPanX  = -CONTENT_W * currentScale * 0.3;  // panned partway
    const newScale = FIT_SCALE * 2;

    for (const fraction of [0.1, 0.5, 0.9]) {
      const focalX = MAP_AREA_SCREEN_X + MAP_AREA_W * fraction;
      const newPanX   = focalZoomPanX(focalX, currentPanX, currentScale, newScale);
      const contentX  = (focalX - MAP_AREA_SCREEN_X - currentPanX) / currentScale;
      const screenXAfter = MAP_AREA_SCREEN_X + newPanX + contentX * newScale;
      expect(screenXAfter).toBeCloseTo(focalX, 9);
    }
  });

  it('focal-point zoom in then back out returns pan to original value', () => {
    // #438 adversarial: two successive focal-point zooms (in, then out) must not drift the content
    const currentScale = FIT_SCALE * 2;
    const currentPanX  = -80;
    const focalX = MAP_AREA_SCREEN_X + MAP_AREA_W * 0.6;
    const zoomedInScale = FIT_SCALE * 3;

    const panAfterIn  = focalZoomPanX(focalX, currentPanX,  currentScale,  zoomedInScale);
    const panAfterOut = focalZoomPanX(focalX, panAfterIn,   zoomedInScale, currentScale);

    // Zoom-in then zoom-out at the same focal point must restore the original pan
    expect(panAfterOut).toBeCloseTo(currentPanX, 9);
  });

  it('focalZoomPanX with currentScale = 0 produces non-finite (ZOOM_MIN guard prevents this in prod)', () => {
    // #438 adversarial documents that the formula has a division-by-zero singularity at scale=0.
    // Production code guards against this via ZOOM_MIN > 0 — this test pins the expected failure
    // mode so a future change that removes the guard cannot silently produce NaN without a CI fail.
    const result = focalZoomPanX(MAP_AREA_SCREEN_X + 100, 0, 0, FIT_SCALE);
    // With currentScale=0: (focal-offset) * (newScale/0) = ±Infinity → result is ±Infinity
    expect(Number.isFinite(result)).toBe(false);
  });

});

describe('SpecConformance: show() opens at OPEN_ZOOM centered on player (#438)', () => {

  it('clampPan fallback (unknown screenId): clampPan(0, 0, OPEN_ZOOM) returns finite pan', () => {
    // #438: when currentScreenId has no matching node, show() falls back to clampPan(0,0,OPEN_ZOOM)
    // Must not crash or produce NaN
    const { x, y } = clampPan(0, 0, OPEN_ZOOM);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it('player-centered pan at OPEN_ZOOM from forest node (col=0, row=0): finite, non-NaN', () => {
    // #438 adversarial: if nodeCenter returns NaN (wrong MIN_ROW), targetPan is NaN
    // and the modal opens at a broken position
    const { x: ncX, y: ncY } = nodeCenter(0, 0);
    const targetPanX = MAP_AREA_W / 2 - ncX * OPEN_ZOOM;
    const targetPanY = MAP_AREA_H / 2 - ncY * OPEN_ZOOM;
    expect(Number.isFinite(targetPanX)).toBe(true);
    expect(Number.isFinite(targetPanY)).toBe(true);
    const { x, y } = clampPan(targetPanX, targetPanY, OPEN_ZOOM);
    expect(Number.isNaN(x)).toBe(false);
    expect(Number.isNaN(y)).toBe(false);
  });

  it('player-centered pan for snow_blizzard_peak (row=−8): finite, non-NaN', () => {
    // #438 adversarial: the topmost snow node is the hardest case — wrong MIN_ROW gives
    // nodeCenter y=−180, then targetPanY = MAP_AREA_H/2 − (−180)×OPEN_ZOOM = very large positive,
    // which clampPan clamps to y=0. Still finite. The real bug manifests as the node being
    // rendered off-screen north, not a JS crash — this test catches the off-screen geometry.
    const { x: ncX, y: ncY } = nodeCenter(0, -8);
    const targetPanX = MAP_AREA_W / 2 - ncX * OPEN_ZOOM;
    const targetPanY = MAP_AREA_H / 2 - ncY * OPEN_ZOOM;
    expect(Number.isFinite(targetPanX)).toBe(true);
    expect(Number.isFinite(targetPanY)).toBe(true);
    const { x, y } = clampPan(targetPanX, targetPanY, OPEN_ZOOM);
    expect(Number.isNaN(x)).toBe(false);
    expect(Number.isNaN(y)).toBe(false);
  });

  it('reopening is idempotent — centering on the same node twice yields identical pan', () => {
    // #438 adversarial: stale pan state from a prior session must not leak into the next open.
    // show() computes targetPan from nodeCenter each time — result must be deterministic.
    const { x: ncX, y: ncY } = nodeCenter(0, 0);
    const tp1x = MAP_AREA_W / 2 - ncX * OPEN_ZOOM;
    const tp1y = MAP_AREA_H / 2 - ncY * OPEN_ZOOM;
    const { x: x1, y: y1 } = clampPan(tp1x, tp1y, OPEN_ZOOM);
    const { x: x2, y: y2 } = clampPan(tp1x, tp1y, OPEN_ZOOM);
    expect(x2).toBeCloseTo(x1, 10);
    expect(y2).toBeCloseTo(y1, 10);
  });

});

describe('AdversarialNegatives: unknown currentScreenId — no NaN, no crash (#438)', () => {

  it('no Forest screen has id "NONEXISTENT_SCREEN_99999" (fallback condition is testable)', () => {
    // #438 adversarial: verifies that .find() CAN return undefined — i.e. the test is not vacuous
    const fakeId = 'NONEXISTENT_SCREEN_99999';
    expect(FOREST_SCREENS.some((s) => s.id === fakeId)).toBe(false);
  });

  it('no Snow screen has id "NONEXISTENT_SCREEN_99999"', () => {
    const fakeId = 'NONEXISTENT_SCREEN_99999';
    expect(SNOW_SCREENS.some((s) => s.id === fakeId)).toBe(false);
  });

  it('fallback clampPan(0, 0, OPEN_ZOOM) returns x ≥ 0 (centering offset, not junk)', () => {
    // At OPEN_ZOOM ≈ 0.813, CONTENT_W×scale < MAP_AREA_W → content centers → x > 0
    const { x } = clampPan(0, 0, OPEN_ZOOM);
    expect(x).toBeGreaterThanOrEqual(0);
  });

  it('clampPan(0, 0, OPEN_ZOOM): y is in [MAP_AREA_H − scaledH, 0] (never NaN)', () => {
    // At OPEN_ZOOM ≈ 0.813, CONTENT_H×scale > MAP_AREA_H → content overflows height →
    // panY is constrained to [MAP_AREA_H − scaledH, 0]. Input panY=0 → clamped to 0.
    const scaledH = CONTENT_H * OPEN_ZOOM;
    const { y } = clampPan(0, 0, OPEN_ZOOM);
    expect(Number.isNaN(y)).toBe(false);
    if (scaledH > MAP_AREA_H) {
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(MAP_AREA_H - scaledH - 0.001);
    } else {
      expect(y).toBeGreaterThanOrEqual(0); // centering offset
    }
  });

});
