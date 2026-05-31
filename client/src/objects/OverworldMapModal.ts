import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';

// ── Layout constants ────────────────────────────────────────────────────────

const CELL_W = 110;  // pixels per grid column
const CELL_H = 72;   // pixels per grid row
const NODE_W = 96;   // node rectangle width
const NODE_H = 52;   // node rectangle height

// Grid extents: columns −1..5 (7 wide), rows −2..3 (6 tall)
const MIN_COL = -1;
const MIN_ROW = -2;

const PANEL_W = 830;
const PANEL_H = 512;
const PANEL_X = Math.floor((CANVAS_W - PANEL_W) / 2);
const PANEL_Y = Math.floor((CANVAS_H - PANEL_H) / 2);

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
const DOT_STONE_ATTUNED    = 0x44eeff;
const DOT_STONE_UNATTUNED  = 0x224444;

// ── Static data ─────────────────────────────────────────────────────────────

interface NodeSpec {
  id:        string;
  label:     string;
  col:       number;
  row:       number;
  biome:     'forest' | 'swamp';
  danger?:   1 | 2 | 3;
  safe?:     true;
  anchorage?: string; // waystone id of the anchorage on this screen
  waystone?:  string; // waystone id of the discovery stone on this screen
  isolated?:  true;   // no walking exits — teleport only
}

// Grid positions are anchored so forest_anchorage (hub) sits at col=0, row=0.
// Row decreases northward; col increases eastward.
const NODE_SPECS: NodeSpec[] = [
  // ── North arm ──────────────────────────────────────────────────────────────
  { id: 'forest_snow_gate',     label: 'Snow Gate',   col: 0,  row: -2, biome: 'forest', danger: 2, waystone: 'forest_north_stone' },
  { id: 'forest_north_road',    label: 'North Road',  col: 0,  row: -1, biome: 'forest', danger: 1 },
  // ── West arm ───────────────────────────────────────────────────────────────
  { id: 'forest_mossy_fen',     label: 'Mossy Fen',   col: -1, row:  0, biome: 'forest', danger: 1 },
  // ── Hub ────────────────────────────────────────────────────────────────────
  { id: 'forest_anchorage',     label: 'Anchorage',   col: 0,  row:  0, biome: 'forest', safe: true, anchorage: 'forest_entry' },
  // ── East corridor ──────────────────────────────────────────────────────────
  { id: 'forest_east_path',     label: 'East Path',   col: 1,  row:  0, biome: 'forest', danger: 1 },
  { id: 'forest_glade',         label: 'The Glade',   col: 2,  row:  0, biome: 'forest', danger: 1, anchorage: 'forest_glade' },
  // ── South arm ──────────────────────────────────────────────────────────────
  { id: 'forest_south_path',    label: 'South Path',  col: 0,  row:  1, biome: 'forest', danger: 1 },
  { id: 'forest_hollow',        label: 'Hollow',      col: 0,  row:  2, biome: 'forest', danger: 2 },
  { id: 'forest_swamp_gate',    label: 'Swamp Gate',  col: -1, row:  2, biome: 'forest', danger: 2, waystone: 'forest_sw_stone' },
  // ── Northeast cluster ──────────────────────────────────────────────────────
  { id: 'forest_crossroads',    label: 'Crossroads',  col: 2,  row: -1, biome: 'forest', danger: 1 },
  { id: 'forest_ridge',         label: 'Ridge',       col: 2,  row: -2, biome: 'forest', danger: 2 },
  { id: 'forest_briar_pass',    label: 'Briar Pass',  col: 3,  row: -1, biome: 'forest', danger: 2 },
  { id: 'forest_deepwood',      label: 'Deepwood',    col: 3,  row: -2, biome: 'forest', danger: 3, anchorage: 'forest_depths' },
  { id: 'forest_boss_clearing', label: 'Boss\nClearing', col: 4, row: -2, biome: 'forest', danger: 3 },
  // ── Isolated (teleport only) ───────────────────────────────────────────────
  { id: 'forest_hidden_alcove', label: 'Hidden\nAlcove', col: 5, row: 0, biome: 'forest', danger: 1, isolated: true, anchorage: 'forest_hidden_anchor', waystone: 'forest_hidden_glade' },
  // ── Swamp biome ────────────────────────────────────────────────────────────
  { id: 'swamp_entry',          label: 'Swamp',       col: -1, row:  3, biome: 'swamp' },
];

type EdgeType = 'normal' | 'biome';

const EDGES: Array<{ a: string; b: string; type?: EdgeType }> = [
  { a: 'forest_anchorage',  b: 'forest_north_road' },
  { a: 'forest_north_road', b: 'forest_snow_gate' },
  { a: 'forest_anchorage',  b: 'forest_mossy_fen' },
  { a: 'forest_anchorage',  b: 'forest_east_path' },
  { a: 'forest_east_path',  b: 'forest_glade' },
  { a: 'forest_glade',      b: 'forest_crossroads' },
  { a: 'forest_crossroads', b: 'forest_ridge' },
  { a: 'forest_crossroads', b: 'forest_briar_pass' },
  { a: 'forest_ridge',      b: 'forest_deepwood' },
  { a: 'forest_deepwood',   b: 'forest_boss_clearing' },
  { a: 'forest_briar_pass', b: 'forest_boss_clearing' },
  { a: 'forest_anchorage',  b: 'forest_south_path' },
  { a: 'forest_south_path', b: 'forest_hollow' },
  { a: 'forest_hollow',     b: 'forest_swamp_gate' },
  { a: 'forest_swamp_gate', b: 'swamp_entry', type: 'biome' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function nodeCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: GRID_LEFT + (col - MIN_COL) * CELL_W + CELL_W / 2,
    y: GRID_TOP  + (row - MIN_ROW) * CELL_H + CELL_H / 2,
  };
}

function nodeBgColor(spec: NodeSpec): number {
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
    const c = s.add.container(0, 0).setScrollFactor(0).setDepth(1200);

    // Backdrop
    c.add(
      s.add
        .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
        .setScrollFactor(0),
    );

    // Panel background + border
    const panelCx = PANEL_X + PANEL_W / 2;
    const panelCy = PANEL_Y + PANEL_H / 2;
    c.add(s.add.rectangle(panelCx, panelCy, PANEL_W, PANEL_H, 0x0d1523, 1).setScrollFactor(0));
    c.add(
      s.add.rectangle(panelCx, panelCy, PANEL_W, PANEL_H, 0x000000, 0)
        .setStrokeStyle(1, 0x3d5577)
        .setScrollFactor(0),
    );

    // Title
    c.add(
      s.add
        .text(PANEL_X + PANEL_W / 2, PANEL_Y + 14, 'World Map', {
          fontSize: '15px', color: '#99bbdd',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    // Close button
    c.add(
      s.add
        .text(PANEL_X + PANEL_W - 14, PANEL_Y + 14, '✕', {
          fontSize: '15px', color: '#cc5555',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.hide()),
    );

    // ── Graphics layer (edges + node fills) ─────────────────────────────────
    const gfx = s.add.graphics().setScrollFactor(0);
    c.add(gfx);

    // Build lookup for node positions
    const byId = new Map(NODE_SPECS.map((n) => [n.id, n]));

    // Edges
    for (const edge of EDGES) {
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
    for (const spec of NODE_SPECS) {
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

      // Discovery waystone dot (top-left corner of node)
      if (spec.waystone) {
        const dotX = x - NODE_W / 2 + 7;
        const dotY = y - NODE_H / 2 + 7;
        const col = attuned.has(spec.waystone) ? DOT_STONE_ATTUNED : DOT_STONE_UNATTUNED;
        gfx.fillStyle(col, 1);
        gfx.fillCircle(dotX, dotY, 4);
        gfx.lineStyle(1, 0x000000, 0.5);
        gfx.strokeCircle(dotX, dotY, 4);
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
    // Waystone legend
    gfx.fillStyle(DOT_STONE_ATTUNED, 1);
    gfx.fillCircle(lx + 4, legendY + 6, 4);
    c.add(s.add.text(lx + 10, legendY, 'Waystone\n(found)', { fontSize: '8px', color: '#44aaaa', lineSpacing: 2 }).setScrollFactor(0));
    lx += 74;
    gfx.fillStyle(DOT_STONE_UNATTUNED, 1);
    gfx.fillCircle(lx + 4, legendY + 6, 4);
    c.add(s.add.text(lx + 10, legendY, 'Waystone\n(undiscovered)', { fontSize: '8px', color: '#224444', lineSpacing: 2 }).setScrollFactor(0));

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
