import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { createOverlay } from './ui/ModalShell';
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
const MIN_COL = Math.min(..._coords.map((c) => c.x));
const MIN_ROW = Math.min(..._coords.map((c) => -c.y));

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

// New layout is 9 cols (−2..6) × 9 rows (−5..3). At CELL_W=110 / CELL_H=72 the
// grid content is 990×648px; margins for title + padding bring the panel to
// ~1110×760, centered in the 1280×720 canvas (PANEL_Y clamped ≥10).
const PANEL_W = 1110;
const PANEL_H = 700;
const PANEL_X = Math.max(10, Math.round((CANVAS_W - PANEL_W) / 2));
const PANEL_Y = Math.max(10, Math.round((CANVAS_H - PANEL_H) / 2));

// Top-left of the grid drawing area (inside the panel)
const GRID_LEFT = PANEL_X + 30;
const GRID_TOP  = PANEL_Y + 46;

// ── Node color palette ──────────────────────────────────────────────────────

const COLOR_SAFE  = 0x1e3d6b;   // blue  – safe (hub anchorage)
const COLOR_D1    = 0x1f4a1f;   // green – danger 1
const COLOR_D2    = 0x5a3210;   // amber – danger 2
const COLOR_D3    = 0x5a1010;   // red   – danger 3
const COLOR_SWAMP = 0x0d2a17;   // teal-green – swamp biome
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
  biome:     'forest' | 'swamp';
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
      const key = [screen.id, neighborId as string].sort().join('|');
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      DERIVED_EDGES.push({ a: screen.id, b: neighborId as string });
    }
  }
  DERIVED_EDGES.push({ a: 'forest_swamp_gate', b: 'swamp_entry', type: 'biome' });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nodeCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: GRID_LEFT + (col - MIN_COL) * CELL_W + CELL_W / 2,
    y: GRID_TOP  + (row - MIN_ROW) * CELL_H + CELL_H / 2,
  };
}

function nodeBgColor(spec: RenderNode): number {
  if (spec.biome === 'swamp') return COLOR_SWAMP;
  if (spec.safe)              return COLOR_SAFE;
  switch (spec.danger) {
    case 1: return COLOR_D1;
    case 2: return COLOR_D2;
    case 3: return COLOR_D3;
    default: return COLOR_UNK;
  }
}

// ── Modal class ─────────────────────────────────────────────────────────────

/**
 * Full-screen world-map overlay. Shows every biome screen as a labelled box,
 * connections as lines, discovered anchorages as gold dots (bright = attuned),
 * discovery waystones as cyan dots, and the player's current screen with a
 * white border + "you are here" arrow. Triggered by the M key.
 */
export class OverworldMapModal {
  private container: Phaser.GameObjects.Container | null = null;
  private readonly scene: Phaser.Scene;
  private readonly onClose: () => void;

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
    const s = this.scene;

    // Shared modal scaffold (backdrop + panel + title + canonical ✕), anchored to
    // the computed map-panel rect rather than the canvas center.
    const panelCx = PANEL_X + PANEL_W / 2;
    const panelCy = PANEL_Y + PANEL_H / 2;
    const { container: c } = createOverlay(s, {
      width: PANEL_W,
      height: PANEL_H,
      title: 'World Map',
      onClose: () => this.hide(),
      depth: 1200,
      backdropAlpha: 0.78,
      panelColor: 0x0d1523,
      strokeColor: 0x3d5577,
      strokeWidth: 1,
      titleColor: '#99bbdd',
      titleSize: '15px',
      centered: false,
      panelX: panelCx,
      panelY: panelCy,
    });

    // ── Graphics layer (edges + node fills) ─────────────────────────────────
    const gfx = s.add.graphics().setScrollFactor(0);
    c.add(gfx);

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
      if (spec.isolated) {
        c.add(
          s.add
            .text(x, y + NODE_H / 2 + 6, '✦ teleport', {
              fontSize: '8px', color: '#886600',
            })
            .setOrigin(0.5, 0)
            .setScrollFactor(0),
        );
      }

      // Node label
      c.add(
        s.add
          .text(x, y, spec.label, {
            fontSize: '10px',
            color: isCurrent ? '#ffffff' : '#99bbcc',
            align: 'center',
            wordWrap: { width: NODE_W - 6 },
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
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
        c.add(
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

    // ── Legend ───────────────────────────────────────────────────────────────
    const legendY = PANEL_Y + PANEL_H - 30;
    const legendEntries: Array<{ color: number; label: string }> = [
      { color: COLOR_SAFE,  label: 'Safe' },
      { color: COLOR_D1,    label: 'D1' },
      { color: COLOR_D2,    label: 'D2' },
      { color: COLOR_D3,    label: 'D3' },
      { color: COLOR_SWAMP, label: 'Swamp' },
    ];
    let lx = PANEL_X + 14;
    for (const entry of legendEntries) {
      gfx.fillStyle(entry.color, 1);
      gfx.fillRect(lx, legendY, 14, 12);
      gfx.lineStyle(1, 0x445566, 1);
      gfx.strokeRect(lx, legendY, 14, 12);
      c.add(
        s.add
          .text(lx + 16, legendY, entry.label, { fontSize: '9px', color: '#7799aa' })
          .setScrollFactor(0),
      );
      lx += 48;
    }
    // Separator
    lx += 10;
    // Anchorage legend
    gfx.fillStyle(DOT_ANCHOR_ATTUNED, 1);
    gfx.fillCircle(lx + 5, legendY + 6, 5);
    c.add(s.add.text(lx + 12, legendY, 'Anchorage\n(attuned)', { fontSize: '8px', color: '#bbaa44', lineSpacing: 2 }).setScrollFactor(0));
    lx += 80;
    gfx.fillStyle(DOT_ANCHOR_UNATTUNED, 1);
    gfx.fillCircle(lx + 5, legendY + 6, 5);
    c.add(s.add.text(lx + 12, legendY, 'Anchorage\n(unset)', { fontSize: '8px', color: '#666644', lineSpacing: 2 }).setScrollFactor(0));
    lx += 76;

    // Boss legend — glyph + colour per tier (see BossTier).
    const bossLegend: Array<{ tier: BossTier; label: string }> = [
      { tier: 'major',    label: 'Boss' },
      { tier: 'gate',     label: 'Gate' },
      { tier: 'guardian', label: 'Shrine' },
    ];
    for (const entry of bossLegend) {
      c.add(
        s.add
          .text(lx, legendY - 2, BOSS_GLYPH[entry.tier], { fontSize: '12px', color: BOSS_COLOR[entry.tier] })
          .setScrollFactor(0),
      );
      c.add(
        s.add
          .text(lx + 13, legendY + 1, entry.label, { fontSize: '8px', color: '#7799aa' })
          .setScrollFactor(0),
      );
      lx += 46;
    }

    // Hint
    c.add(
      s.add
        .text(PANEL_X + PANEL_W - 10, PANEL_Y + PANEL_H - 10, 'Press M to close', {
          fontSize: '9px', color: '#445566',
        })
        .setOrigin(1, 1)
        .setScrollFactor(0),
    );

    ignoreMain(c);
    this.container = c;
  }

  hide(): void {
    if (!this.container) return;
    this.container.destroy();
    this.container = null;
    this.onClose();
  }

  isOpen(): boolean {
    return this.container !== null;
  }
}
