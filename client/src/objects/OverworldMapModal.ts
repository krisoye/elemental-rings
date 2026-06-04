import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { createOverlay } from './ui/ModalShell';
import { addDomLabel, crispCanvasText } from './ui/DomLabel';
import { FOREST_SCREENS } from '../../../shared/world/forest';
import { FOREST_SCREEN_META, type BossTier } from './world/forestMeta';

// ── Layout constants ────────────────────────────────────────────────────────

const CELL_W = 110;  // pixels per grid column
const CELL_H = 72;   // pixels per grid row
const NODE_W = 96;   // node rectangle width
const NODE_H = 52;   // node rectangle height

// Grid extents (derived from FOREST_SCREENS coords): columns −2..6 (9 wide),
// rows −5..3 (9 tall). MIN_COL/MIN_ROW are computed dynamically below so the
// layout follows the screen manifest with no manual sync.
const _coords = FOREST_SCREENS.filter((s) => s.coord).map((s) => s.coord!);
if (_coords.length === 0)
  throw new Error(
    'OverworldMapModal: FOREST_SCREENS has no coordinated screens — cannot compute grid bounds',
  );
const MIN_COL = Math.min(..._coords.map((c) => c.x));
const MIN_ROW = Math.min(..._coords.map((c) => -c.y));
const MAX_COL = Math.max(..._coords.map((c) => c.x));
const MAX_ROW = Math.max(..._coords.map((c) => -c.y));

// The hidden alcove is teleport-only (no coord, exits {}). It is the ONLY
// node with a hardcoded grid position — placed isolated at the east edge.
const ALCOVE_COL = 6;
const ALCOVE_ROW = 0;

// swamp_entry is not a Forest ScreenDef — it belongs to the Swamp biome.
// Kept as a single static node south of forest_swamp_gate (coord (−1,−2) →
// col=−1, row=2; the swamp sits one step further south at row=3).
const SWAMP_NODE = {
  id: 'swamp_entry',
  label: 'Swamp',
  col: -1,
  row: 3,
  biome: 'swamp' as const,
};

// snow_entry is not a Forest ScreenDef — it belongs to the Snow biome.
// Placed one step north of forest_snow_gate (coord (0,2) → col=0, row=−2;
// the snow entry sits one step further north at row=−3).
const SNOW_NODE = {
  id: 'snow_entry',
  label: 'Snow Fields',
  col: 0,
  row: -3,
  biome: 'snow' as const,
};

// ── Panel + grid layout (computed at show() time from CANVAS_W/CANVAS_H) ──
// PANEL_MARGIN: gap between canvas edge and panel edge (both sides).
const PANEL_MARGIN = 12;
// Derived panel dimensions fill the viewport minus the margin.
const PANEL_W = CANVAS_W - PANEL_MARGIN * 2;
const PANEL_H = CANVAS_H - PANEL_MARGIN * 2;
const PANEL_X = PANEL_MARGIN;                    // panel top-left X
const PANEL_Y = PANEL_MARGIN;                    // panel top-left Y

// Top-left of the grid drawing area (inside the panel), relative to the
// panel origin (0,0 in panel-local coords = panel top-left on screen).
const TITLE_STRIP_H = 38;   // height reserved for the panel title bar
const LEGEND_STRIP_H = 32;  // height reserved for the legend + close-hint strip
const CTRL_STRIP_H   = 22;  // height reserved for zoom control buttons

// The raw content size for the map graph. Cols span MIN_COL..max(ALCOVE_COL, MAX_COL),
// rows span MIN_ROW..max(SWAMP_NODE.row, MAX_ROW).
const _maxCol = Math.max(ALCOVE_COL, MAX_COL);
const _maxRow = Math.max(SWAMP_NODE.row, MAX_ROW);
const GRID_COLS = _maxCol - MIN_COL + 1;
const GRID_ROWS = _maxRow - MIN_ROW + 1;
// Content bounding box in unscaled space (origin at top-left = first cell origin)
const CONTENT_W = GRID_COLS * CELL_W;
const CONTENT_H = GRID_ROWS * CELL_H;

// Available area for the zoomable map layer (inside the panel, below title+ctrl, above legend)
const MAP_AREA_W = PANEL_W - 4;
const MAP_AREA_H = PANEL_H - TITLE_STRIP_H - CTRL_STRIP_H - LEGEND_STRIP_H - 4;

// Fit scale: scale so content fits exactly within the map area with a small inner margin
const MAP_INNER_PAD = 8;
const FIT_SCALE = Math.min(
  (MAP_AREA_W - MAP_INNER_PAD * 2) / CONTENT_W,
  (MAP_AREA_H - MAP_INNER_PAD * 2) / CONTENT_H,
);

// The map area top-left (in screen space), inside the panel
// Panel center in ModalShell is PANEL_X + PANEL_W/2, PANEL_Y + PANEL_H/2.
// The panel's local-space origin is at its center, so map-area in screen
// coords = PANEL_X + 2 (stroke gap), below the title + ctrl strips.
const MAP_AREA_SCREEN_X = PANEL_X + 2;
const MAP_AREA_SCREEN_Y = PANEL_Y + TITLE_STRIP_H + CTRL_STRIP_H;

// Zoom limits
const ZOOM_MIN = FIT_SCALE;           // can never zoom below fit
const ZOOM_MAX = FIT_SCALE * 3;       // max 3× from fit
const ZOOM_STEP = 0.10;               // 10% per step (relative to FIT_SCALE)

// ── Node color palette ──────────────────────────────────────────────────────

const COLOR_SAFE  = 0x1e3d6b;   // blue  – safe (hub anchorage)
const COLOR_D1    = 0x1f4a1f;   // green – danger 1
const COLOR_D2    = 0x5a3210;   // amber – danger 2
const COLOR_D3    = 0x5a1010;   // red   – danger 3
const COLOR_SWAMP = 0x0d2a17;   // teal-green – swamp biome
const COLOR_SNOW  = 0x4a7ca8;   // icy blue   – snow biome
const COLOR_UNK   = 0x222222;   // fallback

const STROKE_DEFAULT  = 0x445577;
const STROKE_CURRENT  = 0xffffff;
const STROKE_ISOLATED = 0x887722; // dashed-style (drawn as dotted)

const EDGE_NORMAL = 0x556688;
const EDGE_BIOME  = 0x44bb44;

const DOT_ANCHOR_ATTUNED   = 0xffcc00;
const DOT_ANCHOR_UNATTUNED = 0x555533;

// Boss markers — a screen hosting a boss-tier NPC gets a corner glyph. Tier
// drives the icon + colour (legend below). 'major' = a major boss, 'gate' = a
// warden physically blocking an exit, 'guardian' = a fusion-shrine sub-boss.
const BOSS_GLYPH: Record<BossTier, string> = {
  major:    '⚔',
  gate:     '⚔',
  guardian: '✦',
};
const BOSS_COLOR: Record<BossTier, string> = {
  major:    '#ff5555', // bright red – the region's major boss
  gate:     '#ffaa33', // amber – an exit-blocking gate warden
  guardian: '#cc88ff', // violet – a fusion-shrine guardian (matches altar art)
};

// ── Derived data ────────────────────────────────────────────────────────────

type EdgeType = 'normal' | 'biome';

/**
 * A renderable map node. Positions and the danger/safe/anchorage tags are
 * derived from `ScreenDef` (shared/world/forest.ts); the label + boss tier come
 * from `FOREST_SCREEN_META`. The only hardcoded node is `swamp_entry` (Swamp
 * biome) and the only hardcoded position is `forest_hidden_alcove` (isolated).
 */
interface RenderNode {
  id:        string;
  label:     string;
  col:       number;
  row:       number;
  biome:     'forest' | 'swamp' | 'snow';
  danger?:   1 | 2 | 3;
  safe?:     true;
  anchorage?: string;   // anchorage id on this screen
  isolated?:  true;     // no walking exits — teleport only
  boss?:      BossTier; // a boss-tier NPC lives on this screen
}

/**
 * Node list derived from FOREST_SCREENS. Each screen's grid cell comes from its
 * `coord` (`col = x`, `row = −y`); the isolated alcove (no coord) gets the only
 * static position. Display label + boss tier are looked up in FOREST_SCREEN_META.
 * The static `SWAMP_NODE` is appended last (not a Forest ScreenDef).
 */
const RENDER_NODES: RenderNode[] = FOREST_SCREENS.map((screen) => {
  const meta = FOREST_SCREEN_META[screen.id];
  const isolated = meta?.isolated;
  const col = screen.coord ? screen.coord.x : ALCOVE_COL;
  const row = screen.coord ? -screen.coord.y : ALCOVE_ROW;
  return {
    id: screen.id,
    label: meta?.label ?? screen.name,
    col,
    row,
    biome: 'forest' as const,
    danger: screen.danger,
    safe: screen.safe,
    anchorage: screen.anchorage,
    isolated,
    boss: meta?.boss,
  };
});
RENDER_NODES.push(SWAMP_NODE);
RENDER_NODES.push(SNOW_NODE);

/**
 * Undirected edge list derived from `FOREST_SCREENS.exits`. Each reciprocal pair
 * is emitted once via a canonical `[min, max]` dedup key. The biome edge to
 * `swamp_entry` is added statically (swamp_entry is not a Forest ScreenDef).
 * The removed `root_tangle ↔ deepwood` backdoor never appears here because it no
 * longer exists in `forest.ts`.
 */
const DERIVED_EDGES: Array<{ a: string; b: string; type?: EdgeType }> = [];
{
  const seenEdges = new Set<string>();
  for (const screen of FOREST_SCREENS) {
    for (const neighborId of Object.values(screen.exits)) {
      const key = [screen.id, neighborId].sort().join('|');
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      DERIVED_EDGES.push({ a: screen.id, b: neighborId });
    }
  }
  DERIVED_EDGES.push({ a: 'forest_swamp_gate', b: 'swamp_entry', type: 'biome' });
  DERIVED_EDGES.push({ a: 'forest_snow_gate',  b: 'snow_entry',  type: 'biome' });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Node center in unscaled content-local coordinates (origin = top-left of the
 * grid drawing area). The `mapContainer` is positioned so its (0,0) maps to the
 * grid's top-left in screen space; scaling is applied via the container's scale.
 */
function nodeCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - MIN_COL) * CELL_W + CELL_W / 2,
    y: (row - MIN_ROW) * CELL_H + CELL_H / 2,
  };
}

function nodeBgColor(spec: RenderNode): number {
  if (spec.biome === 'swamp') return COLOR_SWAMP;
  if (spec.biome === 'snow')  return COLOR_SNOW;
  if (spec.safe)              return COLOR_SAFE;
  switch (spec.danger) {
    case 1: return COLOR_D1;
    case 2: return COLOR_D2;
    case 3: return COLOR_D3;
    default: return COLOR_UNK;
  }
}

/**
 * Clamp `panOffset` so that the scaled content never shows an empty gap at
 * any canvas edge within the map area.
 *
 * The `mapContainer` has its origin at its (0,0) = top-left of the content.
 * In screen space the container's top-left is at:
 *   (MAP_AREA_SCREEN_X + panOffset.x, MAP_AREA_SCREEN_Y + panOffset.y)
 * The container's bottom-right in screen space is:
 *   (MAP_AREA_SCREEN_X + panOffset.x + CONTENT_W * scale, ...)
 *
 * We want:
 *   left edge  ≤ MAP_AREA_SCREEN_X          → panOffset.x ≤ 0
 *   right edge ≥ MAP_AREA_SCREEN_X + MAP_AREA_W → panOffset.x ≥ MAP_AREA_W - CONTENT_W * scale
 *   top edge   ≤ MAP_AREA_SCREEN_Y           → panOffset.y ≤ 0
 *   bottom edge ≥ MAP_AREA_SCREEN_Y + MAP_AREA_H → panOffset.y ≥ MAP_AREA_H - CONTENT_H * scale
 *
 * When the content is smaller than the map area (fit scale), center it and
 * disallow any pan.
 */
function clampPan(
  panX: number, panY: number, scale: number,
): { x: number; y: number } {
  const scaledW = CONTENT_W * scale;
  const scaledH = CONTENT_H * scale;

  let minX: number, maxX: number, minY: number, maxY: number;

  if (scaledW <= MAP_AREA_W) {
    // Content is narrower than viewport — center it, no pan allowed.
    const cx = (MAP_AREA_W - scaledW) / 2;
    minX = cx; maxX = cx;
  } else {
    maxX = 0;
    minX = MAP_AREA_W - scaledW;
  }

  if (scaledH <= MAP_AREA_H) {
    // Content is shorter than viewport — center it, no pan allowed.
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

// ── Modal class ─────────────────────────────────────────────────────────────

/**
 * Full-screen world-map overlay. Shows every biome screen as a labelled box,
 * connections as lines, discovered anchorages as gold dots (bright = attuned),
 * discovery waystones as cyan dots, and the player's current screen with a
 * white border + "you are here" arrow. Triggered by the M key.
 *
 * On open the graph is fit-scaled so the entire node graph, legend, and
 * close-hint are visible within the 1024×576 canvas with no clipping.
 * Optional zoom (+ / - keys or on-panel buttons) and pointer-drag pan (with
 * content-bounds clamping) allow inspection of detail. Press 0 or the Reset
 * button to return to fit zoom. The legend and close-hint are rendered in a
 * separate non-zoomed HUD layer so they remain readable at all zoom levels.
 */
export class OverworldMapModal {
  private container: Phaser.GameObjects.Container | null = null;
  private readonly scene: Phaser.Scene;
  private readonly onClose: () => void;

  // ── Zoom / pan state ───────────────────────────────────────────────────────
  private currentScale = FIT_SCALE;
  private panX = 0;
  private panY = 0;

  // Input handles — registered in show(), removed in hide()
  private keyPlus: Phaser.Input.Keyboard.Key | null = null;
  private keyMinus: Phaser.Input.Keyboard.Key | null = null;
  private keyReset: Phaser.Input.Keyboard.Key | null = null;
  private keyNumpadAdd: Phaser.Input.Keyboard.Key | null = null;
  private keyNumpadSub: Phaser.Input.Keyboard.Key | null = null;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragPanStartX = 0;
  private dragPanStartY = 0;

  // The zoomable map layer (edges + nodes). Separate from the outer `container`
  // so the legend/HUD container stays unscaled.
  private mapContainer: Phaser.GameObjects.Container | null = null;

  // Graphics object backing the geometry mask that clips `mapContainer` to the
  // map area — without it, zoomed content bleeds visually behind the legend/hint
  // strip. Stored so hide() can destroy it (the mask graphics is not a child of
  // the overlay container, so container.destroy() would otherwise leak it).
  private clipGfx: Phaser.GameObjects.Graphics | null = null;

  /**
   * #363 — screen-fixed, non-scaled HUD-strip labels (legend text + close hint)
   * migrated to crisp DOM. They are NOT children of the overlay container, so
   * hide() destroys them explicitly to avoid duplicate nodes on reopen. The map
   * node labels stay on canvas (they live inside the scaled, masked mapContainer).
   */
  private domLabels: Phaser.GameObjects.DOMElement[] = [];

  constructor(scene: Phaser.Scene, onClose: () => void) {
    this.scene = scene;
    this.onClose = onClose;
  }

  /**
   * @param currentScreenId – the scene's `screenId` (e.g. 'forest_glade')
   * @param attuned         – set of waystone ids the player has attuned
   * @param ignoreMain      – called with the root container so the caller can
   *                          route it through the UI camera (cameras.main.ignore)
   */
  show(
    currentScreenId: string,
    attuned: Set<string>,
    ignoreMain: (c: Phaser.GameObjects.Container) => void,
  ): void {
    if (this.container) return;

    // Reset zoom/pan state each time so reopening starts at fit.
    this.currentScale = FIT_SCALE;
    const clamped = clampPan(0, 0, FIT_SCALE);
    this.panX = clamped.x;
    this.panY = clamped.y;

    const s = this.scene;

    // Panel center for ModalShell.
    const panelCx = PANEL_X + PANEL_W / 2;
    const panelCy = PANEL_Y + PANEL_H / 2;

    // Shared modal scaffold (backdrop + panel + title + canonical ✕).
    const { container: c } = createOverlay(s, {
      width:        PANEL_W,
      height:       PANEL_H,
      title:        'World Map',
      onClose:      () => this.hide(),
      depth:        1200,
      backdropAlpha: 0.78,
      panelColor:   0x0d1523,
      strokeColor:  0x3d5577,
      strokeWidth:  1,
      titleColor:   '#99bbdd',
      titleSize:    '15px',
      centered:     false,
      panelX:       panelCx,
      panelY:       panelCy,
    });

    // ── Zoomable map container ───────────────────────────────────────────────
    // Origin at (MAP_AREA_SCREEN_X, MAP_AREA_SCREEN_Y) in screen space.
    // The container's (0,0) is the top-left of the grid content.
    const mc = s.add.container(
      MAP_AREA_SCREEN_X + this.panX,
      MAP_AREA_SCREEN_Y + this.panY,
    ).setScrollFactor(0);
    mc.setScale(this.currentScale);
    c.add(mc);
    this.mapContainer = mc;

    // Clip the map layer to the map area so zoomed content cannot bleed into the
    // legend/hint strip below it. The mask graphics is a free-standing object
    // (not a child of `c`), so hide() destroys it explicitly to avoid a leak.
    const clipGfx = s.add.graphics().setScrollFactor(0);
    clipGfx.fillRect(MAP_AREA_SCREEN_X, MAP_AREA_SCREEN_Y, MAP_AREA_W, MAP_AREA_H);
    mc.setMask(clipGfx.createGeometryMask());
    this.clipGfx = clipGfx;

    // ── Graphics layer (edges + node fills) — drawn in content-local coords ─
    const gfx = s.add.graphics().setScrollFactor(0);
    mc.add(gfx);

    // Build lookup for node positions
    const byId = new Map(RENDER_NODES.map((n) => [n.id, n]));

    // Edges
    for (const edge of DERIVED_EDGES) {
      const a = byId.get(edge.a);
      const b = byId.get(edge.b);
      if (!a || !b) continue;
      const ca = nodeCenter(a.col, a.row);
      const cb = nodeCenter(b.col, b.row);
      const color = edge.type === 'biome' ? EDGE_BIOME : EDGE_NORMAL;
      gfx.lineStyle(edge.type === 'biome' ? 2 : 1, color, 0.85);
      gfx.beginPath();
      gfx.moveTo(ca.x, ca.y);
      gfx.lineTo(cb.x, cb.y);
      gfx.strokePath();
    }

    // Isolated node: draw a dotted visual connector hinting "teleport only"
    // (hidden alcove floats right; no walking edges drawn above)
    {
      const alcove = byId.get('forest_hidden_alcove');
      if (alcove) {
        const ca = nodeCenter(alcove.col, alcove.row);
        // Short dashed stub toward east_path area
        gfx.lineStyle(1, 0x665500, 0.5);
        for (let dx = -60; dx < 0; dx += 10) {
          if (Math.floor((dx + 60) / 10) % 2 === 0) {
            gfx.beginPath();
            gfx.moveTo(ca.x + dx,     ca.y);
            gfx.lineTo(ca.x + dx + 5, ca.y);
            gfx.strokePath();
          }
        }
      }
    }

    // Node boxes + text labels + indicator dots
    for (const spec of RENDER_NODES) {
      const { x, y } = nodeCenter(spec.col, spec.row);
      const isCurrent = spec.id === currentScreenId;
      const bg = nodeBgColor(spec);

      // Background fill
      gfx.fillStyle(bg, 1);
      gfx.fillRect(x - NODE_W / 2, y - NODE_H / 2, NODE_W, NODE_H);

      // Border
      const borderColor = isCurrent ? STROKE_CURRENT : (spec.isolated ? STROKE_ISOLATED : STROKE_DEFAULT);
      gfx.lineStyle(isCurrent ? 2 : 1, borderColor, 1);
      gfx.strokeRect(x - NODE_W / 2, y - NODE_H / 2, NODE_W, NODE_H);

      // "Teleport only" text badge for hidden alcove
      // #382 — Container (mc) children → crispCanvasText.
      if (spec.isolated) {
        mc.add(
          crispCanvasText(
            s.add
              .text(x, y + NODE_H / 2 + 6, '✦ teleport', {
                fontSize: '8px', color: '#886600',
              })
              .setOrigin(0.5, 0)
              .setScrollFactor(0),
          ),
        );
      }

      // Node label
      mc.add(
        crispCanvasText(
          s.add
            .text(x, y, spec.label, {
              fontSize: '10px',
              color: isCurrent ? '#ffffff' : '#99bbcc',
              align: 'center',
              wordWrap: { width: NODE_W - 6 },
            })
            .setOrigin(0.5)
            .setScrollFactor(0),
        ),
      );

      // Anchorage dot (top-right corner of node)
      if (spec.anchorage) {
        const dotX = x + NODE_W / 2 - 7;
        const dotY = y - NODE_H / 2 + 7;
        const col = attuned.has(spec.anchorage) ? DOT_ANCHOR_ATTUNED : DOT_ANCHOR_UNATTUNED;
        gfx.fillStyle(col, 1);
        gfx.fillCircle(dotX, dotY, 5);
        gfx.lineStyle(1, 0x000000, 0.5);
        gfx.strokeCircle(dotX, dotY, 5);
      }

      // Boss marker (top-left corner of node) — glyph + colour by tier.
      if (spec.boss) {
        mc.add(
          s.add
            .text(x - NODE_W / 2 + 4, y - NODE_H / 2 + 2, BOSS_GLYPH[spec.boss], {
              fontSize: '13px', color: BOSS_COLOR[spec.boss],
            })
            .setOrigin(0, 0)
            .setScrollFactor(0),
        );
      }

      // "You are here" marker — small downward-pointing triangle below node
      if (isCurrent) {
        const tx = x;
        const ty = y + NODE_H / 2 + 5;
        gfx.fillStyle(0xffffff, 0.9);
        gfx.fillTriangle(tx, ty, tx - 6, ty + 9, tx + 6, ty + 9);
      }
    }

    // ── HUD layer (legend + close-hint + zoom controls) — NOT scaled by zoom ─
    // Pinned directly to the outer container `c` in screen space.

    // Zoom control buttons — just below the title bar
    const ctrlY = PANEL_Y + TITLE_STRIP_H + 4;
    const ctrlRightEdge = PANEL_X + PANEL_W - 14;

    const btnStyle = { fontSize: '11px', color: '#99bbdd', backgroundColor: '#1a2d47', padding: { x: 5, y: 2 } };

    const resetBtn = s.add
      .text(ctrlRightEdge, ctrlY, '0 Reset', btnStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.applyZoom(FIT_SCALE));
    c.add(resetBtn);

    const minusBtn = s.add
      .text(ctrlRightEdge - resetBtn.width - 6, ctrlY, '−', btnStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.applyZoom(this.currentScale - FIT_SCALE * ZOOM_STEP));
    c.add(minusBtn);

    const plusBtn = s.add
      .text(ctrlRightEdge - resetBtn.width - minusBtn.width - 12, ctrlY, '+', btnStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.applyZoom(this.currentScale + FIT_SCALE * ZOOM_STEP));
    c.add(plusBtn);

    // Legend — pinned to the bottom of the panel
    const legendY = PANEL_Y + PANEL_H - LEGEND_STRIP_H + 4;
    const legendGfx = s.add.graphics().setScrollFactor(0);
    c.add(legendGfx);

    const legendEntries: Array<{ color: number; label: string }> = [
      { color: COLOR_SAFE,  label: 'Safe' },
      { color: COLOR_D1,    label: 'D1' },
      { color: COLOR_D2,    label: 'D2' },
      { color: COLOR_D3,    label: 'D3' },
      { color: COLOR_SWAMP, label: 'Swamp' },
      { color: COLOR_SNOW,  label: 'Snow' },
    ];
    let lx = PANEL_X + 14;
    for (const entry of legendEntries) {
      legendGfx.fillStyle(entry.color, 1);
      legendGfx.fillRect(lx, legendY, 14, 12);
      legendGfx.lineStyle(1, 0x445566, 1);
      legendGfx.strokeRect(lx, legendY, 14, 12);
      // #363 — legend text is screen-fixed, non-interactive, NOT inside the scaled
      // map container → DOM (crisp). Tracked in this.domLabels for explicit cleanup.
      this.domLabels.push(
        addDomLabel(s, lx + 16, legendY, entry.label, {
          fontPx: 9,
          color: '#7799aa',
          align: 'left',
        }).setOrigin(0, 0),
      );
      lx += 48;
    }
    // Separator
    lx += 10;
    // Anchorage legend
    legendGfx.fillStyle(DOT_ANCHOR_ATTUNED, 1);
    legendGfx.fillCircle(lx + 5, legendY + 6, 5);
    // #363 — two-row anchorage legend labels → DOM; lineHeight mirrors the prior
    // lineSpacing:2 over an 8px font (≈10px line box).
    this.domLabels.push(
      addDomLabel(s, lx + 12, legendY, 'Anchorage\n(attuned)', {
        fontPx: 8,
        color: '#bbaa44',
        align: 'left',
        lineHeight: 10,
      }).setOrigin(0, 0),
    );
    lx += 80;
    legendGfx.fillStyle(DOT_ANCHOR_UNATTUNED, 1);
    legendGfx.fillCircle(lx + 5, legendY + 6, 5);
    this.domLabels.push(
      addDomLabel(s, lx + 12, legendY, 'Anchorage\n(unset)', {
        fontPx: 8,
        color: '#666644',
        align: 'left',
        lineHeight: 10,
      }).setOrigin(0, 0),
    );
    lx += 76;

    // Boss legend — glyph + colour per tier (see BossTier).
    const bossLegend: Array<{ tier: BossTier; label: string }> = [
      { tier: 'major',    label: 'Boss' },
      { tier: 'gate',     label: 'Gate' },
      { tier: 'guardian', label: 'Shrine' },
    ];
    for (const entry of bossLegend) {
      // #363 — boss glyph + label are screen-fixed HUD-strip labels → DOM.
      this.domLabels.push(
        addDomLabel(s, lx, legendY - 2, BOSS_GLYPH[entry.tier], {
          fontPx: 12,
          color: BOSS_COLOR[entry.tier],
          align: 'left',
        }).setOrigin(0, 0),
        addDomLabel(s, lx + 13, legendY + 1, entry.label, {
          fontPx: 8,
          color: '#7799aa',
          align: 'left',
        }).setOrigin(0, 0),
      );
      lx += 46;
    }

    // Close hint — pinned to bottom-right of panel. #363 — screen-fixed → DOM.
    // P2-A — stable data-label id for future E2E targeting. (The "World Map" panel
    // title is a ModalShell canvas Text, not a DomLabel, so it has no id here.)
    this.domLabels.push(
      addDomLabel(s, PANEL_X + PANEL_W - 10, PANEL_Y + PANEL_H - 8, 'Press M to close', {
        fontPx: 9,
        color: '#445566',
        align: 'right',
        id: 'world-map-close-hint',
      }).setOrigin(1, 1),
    );

    // ── Keyboard zoom/pan ────────────────────────────────────────────────────
    // PLUS (187) fires on both = and +; NUMPAD_ADD covers numpad users.
    // MINUS (189) / NUMPAD_SUBTRACT are the matching zoom-out pair.
    const kb = s.input.keyboard!;
    this.keyPlus      = kb.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS);
    this.keyMinus     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS);
    this.keyReset     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ZERO);
    this.keyNumpadAdd = kb.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ADD);
    this.keyNumpadSub = kb.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_SUBTRACT);

    const zoomIn  = (): void => this.applyZoom(this.currentScale + FIT_SCALE * ZOOM_STEP);
    const zoomOut = (): void => this.applyZoom(this.currentScale - FIT_SCALE * ZOOM_STEP);
    this.keyPlus.on('down',      zoomIn);
    this.keyNumpadAdd.on('down', zoomIn);
    this.keyMinus.on('down',     zoomOut);
    this.keyNumpadSub.on('down', zoomOut);
    this.keyReset.on('down', () => this.applyZoom(FIT_SCALE));

    // ── Pointer drag-to-pan ──────────────────────────────────────────────────
    s.input.on('pointerdown', this.onPointerDown, this);
    s.input.on('pointermove', this.onPointerMove, this);
    s.input.on('pointerup',   this.onPointerUp,   this);

    ignoreMain(c);
    this.container = c;
  }

  // ── Zoom / pan helpers ─────────────────────────────────────────────────────

  /**
   * Apply a new zoom scale, clamping to [ZOOM_MIN, ZOOM_MAX], and re-clamp the
   * pan offset. When resetting to fit, also zero the pan so the map re-centers.
   */
  private applyZoom(newScale: number): void {
    const prevScale = this.currentScale;
    this.currentScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

    // When returning to fit, also zero pan before clamping (which will center it).
    if (this.currentScale === ZOOM_MIN && prevScale !== ZOOM_MIN) {
      this.panX = 0;
      this.panY = 0;
    }

    const clamped = clampPan(this.panX, this.panY, this.currentScale);
    this.panX = clamped.x;
    this.panY = clamped.y;

    this.applyTransform();
  }

  /** Write currentScale and panX/Y into the mapContainer transform. */
  private applyTransform(): void {
    if (!this.mapContainer) return;
    this.mapContainer.setScale(this.currentScale);
    this.mapContainer.setPosition(
      MAP_AREA_SCREEN_X + this.panX,
      MAP_AREA_SCREEN_Y + this.panY,
    );
  }

  // ── Pointer event handlers ─────────────────────────────────────────────────

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    if (!this.container) return;
    // Only start a drag when zoomed beyond fit (no pan needed at fit scale).
    if (this.currentScale <= ZOOM_MIN + 0.001) return;
    this.isDragging = true;
    this.dragStartX = ptr.x;
    this.dragStartY = ptr.y;
    this.dragPanStartX = this.panX;
    this.dragPanStartY = this.panY;
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    if (!this.isDragging || !this.container) return;
    const dx = ptr.x - this.dragStartX;
    const dy = ptr.y - this.dragStartY;
    const clamped = clampPan(
      this.dragPanStartX + dx,
      this.dragPanStartY + dy,
      this.currentScale,
    );
    this.panX = clamped.x;
    this.panY = clamped.y;
    this.applyTransform();
  }

  private onPointerUp(): void {
    this.isDragging = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  hide(): void {
    if (!this.container) return;

    // Remove pointer listeners
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup',   this.onPointerUp,   this);

    // Remove keyboard keys. removeKey(key, true) destroys the key, which clears
    // its listeners and unregisters it from the plugin in one call.
    const kb = this.scene.input.keyboard!;
    if (this.keyPlus)      { kb.removeKey(this.keyPlus, true);      this.keyPlus      = null; }
    if (this.keyMinus)     { kb.removeKey(this.keyMinus, true);     this.keyMinus     = null; }
    if (this.keyReset)     { kb.removeKey(this.keyReset, true);     this.keyReset     = null; }
    if (this.keyNumpadAdd) { kb.removeKey(this.keyNumpadAdd, true); this.keyNumpadAdd = null; }
    if (this.keyNumpadSub) { kb.removeKey(this.keyNumpadSub, true); this.keyNumpadSub = null; }

    this.isDragging = false;
    this.mapContainer = null;
    // Destroy the mask graphics — it lives outside the overlay container, so
    // container.destroy() does not reach it.
    if (this.clipGfx) { this.clipGfx.destroy(); this.clipGfx = null; }
    // #363 — DOM labels are not container children; destroy them explicitly so a
    // reopen does not leave duplicate legend/close-hint nodes behind.
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels = [];
    this.container.destroy();
    this.container = null;
    this.onClose();
  }

  isOpen(): boolean {
    return this.container !== null;
  }
}
