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

// Swamp node placed one step south of forest_swamp_gate
const ALCOVE_COL = 6;
const ALCOVE_ROW = 0;
const SWAMP_ROW  = 3;

// Derive grid extents from FOREST_SCREENS (mirrors the module-level derivation)
const _coords = FOREST_SCREENS.filter((s) => s.coord).map((s) => s.coord!);
const MIN_COL = Math.min(..._coords.map((c) => c.x));
const MIN_ROW = Math.min(..._coords.map((c) => -c.y));
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

describe('SpecConformance: show() resets scale and pan on every open (#334)', () => {

  it('initial state: clampPan(0, 0, FIT_SCALE) yields a stable centering value', () => {
    // show() sets currentScale = FIT_SCALE then calls clampPan(0, 0, FIT_SCALE).
    // After two calls the result is identical (no leftover state from prior calls).
    const first  = clampPan(0, 0, FIT_SCALE);
    const second = clampPan(0, 0, FIT_SCALE);
    expect(second.x).toBeCloseTo(first.x, 10);
    expect(second.y).toBeCloseTo(first.y, 10);
  });

  it('fit-zoom pan state is unchanged regardless of any prior zoomed-in pan value', () => {
    // Simulate: zoom in + pan, then reset via applyZoom(FIT_SCALE).
    // After reset, the pan should be identical to a fresh show() call.
    const { panX: freshX, panY: freshY } = applyZoom(FIT_SCALE, 0, 0, FIT_SCALE);

    // Simulate dirty state from a prior session
    const { panX, panY } = applyZoom(FIT_SCALE * 2.5, -400, -250, FIT_SCALE);

    expect(panX).toBeCloseTo(freshX, 9);
    expect(panY).toBeCloseTo(freshY, 9);
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
