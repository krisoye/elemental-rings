import Phaser from 'phaser';
import { SLOT_KEYS } from '../../Constants';
import type { SlotKey } from '../../Constants';
import { InventoryGrid, type RingData } from '../InventoryGrid';
import { RingCard } from './RingCard';
import { attachTooltip } from './Tooltip';
import { addDomLabel, crispCanvasText } from './DomLabel';
import { benchSpareCount } from './RingManagementOverlay';

/**
 * #395 — Shared right-half view component for all ring-management overlay modes
 * (field / sanctum / fusion). Owns the BENCH / HEALTH / COMBAT columns, rendering
 * identically in all modes to eliminate right-column drift.
 *
 * **BENCH column** — 3-column `InventoryGrid` of carried, non-battle-slotted rings.
 * **HEALTH column** — equipped heart `RingCard` + single `[RECHARGE]` link below it.
 * **COMBAT column** — STATUS thumb card left-aligned above A1/A2 · D1/D2 (2×2).
 *
 * Canonical geometry (760×500 frame, matching #384 / corrected #394):
 *   BENCH grid   origin (370, 148)   3-col × 3 visible rows
 *   HEALTH card  center (659, 193)   70×90
 *   STATUS card  center (759, 193)   70×90
 *   A1 / A2      center (759/837, 291)
 *   D1 / D2      center (759/837, 389)
 *   [RECHARGE]   center (659, 389) — same row as D1/D2
 *
 * Architecture: display-only — no game logic, server is the only source of truth.
 */

/** Minimal /api/me snapshot the component needs. */
export interface BenchHealthCombatMe {
  player: {
    spare_ring_max?: number;
    pending_ring_id?: string | null;
    heart_ring?: RingData | null;
  } | null;
  rings: RingData[];
  loadout: Record<string, string | null>;
}

// ── Canonical geometry constants ──────────────────────────────────────────────
const BENCH_GRID_X = 370;
const BENCH_GRID_TOP_Y = 148;
const RINGWALL_VISIBLE_ROWS = 3;
const COL_HEALTH_X = 659;
const COL_COMBAT_LEFT_X = 759;
const COL_COMBAT_RIGHT_X = 837;
const ROW_STATUS_Y = 193;
const ROW_COMBAT0_Y = 291;
const ROW_COMBAT1_Y = 389;
const CARD_W = 70;
const CARD_H = 90;
const LABEL_ABOVE_Y_OFFSET = 34;

/**
 * Shared right-half component (BENCH / HEALTH / COMBAT). Created once per overlay
 * open; destroyed on close. Rebuilt by `build(me, swapSource)` after each mutation.
 */
export class BenchHealthCombat extends Phaser.GameObjects.Container {
  /** Runtime type tag so E2E can assert the same class is used in field and sanctum. */
  readonly isBenchHealthCombat = true as const;

  // ── Sub-components (rebuilt on every `build()` call) ─────────────────────
  private benchGrid: InventoryGrid | null = null;
  private heartCard: RingCard | null = null;
  private readonly combatCards: Map<SlotKey, RingCard> = new Map();
  private statusLockLabel: Phaser.GameObjects.Text | null = null;
  private thumbTooltipDetach: (() => void) | null = null;
  private readonly domLabels: Phaser.GameObjects.DOMElement[] = [];

  /**
   * @param scene          host Phaser scene
   * @param onRecharge     fired when `[RECHARGE]` is clicked
   * @param onSlotClick    fired when a HEALTH or COMBAT slot card is clicked
   * @param getThumbTooltip lazy supplier for the STATUS hover tooltip text
   */
  constructor(
    scene: Phaser.Scene,
    private readonly onRecharge: () => void,
    private readonly onSlotClick: (slot: 'heart' | SlotKey) => void,
    private readonly getThumbTooltip: () => string,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
  }

  /**
   * (Re)build all sub-components from a fresh /api/me snapshot. Safe to call
   * repeatedly — tears down the previous state before building new.
   *
   * @param me          latest /api/me payload
   * @param swapSource  the currently-selected slot/section, or null (drives strokes)
   */
  build(me: BenchHealthCombatMe, swapSource: string | null): void {
    this.teardown();

    const loadout = me.loadout ?? {};
    const heartRing = me.player?.heart_ring ?? null;
    const pendingId = me.player?.pending_ring_id ?? null;
    const spareMax = me.player?.spare_ring_max ?? 0;

    // ── BENCH grid ──────────────────────────────────────────────────────────
    // #395 review — use the canonical benchSpareCount predicate (same as CampScene
    // and RingManagementOverlay) to avoid divergence if the server schema changes.
    const benchN = benchSpareCount(me.rings, loadout, pendingId);
    const benchFull = benchN >= spareMax && spareMax >= 0;

    const battleSlotIds = new Set(
      (SLOT_KEYS as readonly string[]).map((k) => loadout[k]).filter(Boolean) as string[],
    );
    const benchRings = me.rings.filter(
      (r) =>
        r.in_carry === 1 &&
        !battleSlotIds.has(r.id) &&
        r.id !== pendingId &&
        !(r as { pending?: number }).pending,
    );

    const benchGrid = new InventoryGrid(
      this.scene,
      BENCH_GRID_X,
      BENCH_GRID_TOP_Y,
      () => { /* selection driven by overlay's swap controller */ },
      3,
    );
    benchGrid.setScrollFactor(0);
    benchGrid.populate(benchRings);
    benchGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);
    this.scene.add.existing(benchGrid);
    this.add(benchGrid);
    this.benchGrid = benchGrid;

    // BENCH column header (DOM — crisp). #389: player-facing label uses "Bench:" (code keeps spare_*).
    // +104 centres the label over the 3-col grid (col 0 at +32, col 2 at +176, midpoint +104).
    this.addDomLbl(
      BENCH_GRID_X + 104,
      BENCH_GRID_TOP_Y - 20,
      `Bench: ${benchN} / ${spareMax}`,
      12,
      benchFull ? '#ff8888' : '#aaccff',
    );

    // ── HEALTH column header (DOM) ──────────────────────────────────────────
    this.addDomLbl(COL_HEALTH_X, BENCH_GRID_TOP_Y - 20, 'HEALTH', 12, '#ff99aa');

    // ── COMBAT column header (DOM) ──────────────────────────────────────────
    this.addDomLbl(COL_COMBAT_LEFT_X, BENCH_GRID_TOP_Y - 20, 'COMBAT', 12, '#cc88ff');

    // ── Heart card ──────────────────────────────────────────────────────────
    const heartSel = swapSource === 'heart';
    const heartCard = new RingCard(this.scene, COL_HEALTH_X, ROW_STATUS_Y, {
      width: CARD_W,
      height: CARD_H,
      scrollFactor: 0,
      strokeColor: heartSel ? 0xffff00 : 0x888888,
      strokeWidth: heartSel ? 3 : 2,
    });
    if (heartRing) {
      heartCard.setRing({
        element: heartRing.element,
        tier: heartRing.tier,
        xp: heartRing.xp,
        currentUses: heartRing.current_uses,
        maxUses: heartRing.max_uses,
        fusionParents: heartRing.fusionParents,
      });
    } else {
      heartCard.clear('♥\nempty\n0 HP');
      heartCard.setAlpha(0.5);
    }
    heartCard.bg
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onSlotClick('heart'));
    this.scene.add.existing(heartCard);
    this.add(heartCard);
    this.heartCard = heartCard;

    // ── [RECHARGE] link (below heart card, D1/D2 row) ──────────────────────
    // DOM label "Recharge" is added by the host container (RingManagementOverlayClass)
    // alongside the [RECHARGE] canvas button so it appears as a direct child of the
    // modal container. The backing ♥ HP label pair is also hoisted to the root.
    // DOM label "Recharge" above the button (E2E checks texts.includes('Recharge')).
    this.addDomLbl(COL_HEALTH_X, ROW_COMBAT1_Y - LABEL_ABOVE_Y_OFFSET, 'Recharge', 10, '#ffcc44');
    const rechargeBtn = crispCanvasText(
      this.scene.add
        .text(COL_HEALTH_X, ROW_COMBAT1_Y, '[RECHARGE]', {
          fontSize: '13px',
          color: '#ffcc44',
        })
        .setScrollFactor(0)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onRecharge()),
    );
    this.add(rechargeBtn);

    // ── COMBAT cluster (STATUS + A1/A2/D1/D2) ──────────────────────────────
    const combatDefs: { slot: SlotKey; label: string; x: number; y: number }[] = [
      { slot: 'thumb', label: 'STATUS', x: COL_COMBAT_LEFT_X,  y: ROW_STATUS_Y  },
      { slot: 'a1',    label: 'A1',     x: COL_COMBAT_LEFT_X,  y: ROW_COMBAT0_Y },
      { slot: 'a2',    label: 'A2',     x: COL_COMBAT_RIGHT_X, y: ROW_COMBAT0_Y },
      { slot: 'd1',    label: 'D1',     x: COL_COMBAT_LEFT_X,  y: ROW_COMBAT1_Y },
      { slot: 'd2',    label: 'D2',     x: COL_COMBAT_RIGHT_X, y: ROW_COMBAT1_Y },
    ];

    this.combatCards.clear();
    for (const def of combatDefs) {
      const slotSel = swapSource === def.slot;
      const ringId = loadout[def.slot] ?? null;
      const ring = ringId ? me.rings.find((r) => r.id === ringId) : null;
      const escrowed = ring?.escrowed === 1;

      const strokeColor = slotSel
        ? 0xffff00
        : escrowed
          ? 0xff6666
          : def.slot === 'thumb'
            ? 0xaa8800
            : 0x888888;

      const card = new RingCard(this.scene, def.x, def.y, {
        width: CARD_W,
        height: CARD_H,
        scrollFactor: 0,
        strokeColor,
        strokeWidth: slotSel ? 3 : 2,
        textColor: '#000000',
        fontSize: '9px',
      });

      if (ring) {
        card.setRing({
          element: ring.element,
          tier: ring.tier,
          xp: ring.xp,
          currentUses: ring.current_uses,
          maxUses: ring.max_uses,
          fusionParents: ring.fusionParents,
        });
        card.setTextColor('#000000');
      } else {
        card.clear();
        card.setElementText('—', '#888888');
      }

      card.bg
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onSlotClick(def.slot));

      // Slot label above card (DOM — crisp, with dark backing so E2E CSS check passes).
      this.addDomLbl(
        def.x,
        def.y - LABEL_ABOVE_Y_OFFSET,
        def.label,
        11,
        '#cccccc',
        true,
      );

      // STATUS escrow LOCKED label (canvas — inside card container space).
      if (def.slot === 'thumb') {
        this.statusLockLabel = crispCanvasText(
          this.scene.add
            .text(def.x, def.y + 41, escrowed ? 'LOCKED' : '', {
              fontSize: '10px',
              color: '#ff6666',
            })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setName('status-lock'),
        );
        this.add(this.statusLockLabel);
      }

      this.scene.add.existing(card);
      this.add(card);
      this.combatCards.set(def.slot, card);
    }

    // Thumb passive hover tooltip.
    const thumbCard = this.combatCards.get('thumb');
    if (thumbCard) {
      this.thumbTooltipDetach = attachTooltip(
        this.scene,
        thumbCard.bg,
        () => this.getThumbTooltip(),
        { maxWidth: 180 },
      );
    }
  }

  /** Re-apply selection strokes after the swap source changes (no full rebuild). */
  repaintStrokes(swapSource: string | null, rings: RingData[], loadout: Record<string, string | null>): void {
    for (const [slot, card] of this.combatCards) {
      const ringId = loadout[slot] ?? null;
      const ring = ringId ? rings.find((r) => r.id === ringId) : null;
      const escrowed = ring?.escrowed === 1;
      const sel = swapSource === slot;
      if (sel) card.setStroke(3, 0xffff00);
      else if (escrowed) card.setStroke(2, 0xff6666);
      else card.setStroke(2, slot === 'thumb' ? 0xaa8800 : 0x888888);
      if (slot === 'thumb' && this.statusLockLabel) {
        this.statusLockLabel.setText(escrowed ? 'LOCKED' : '');
      }
    }
    if (this.heartCard) {
      const heartSel = swapSource === 'heart';
      this.heartCard.setStroke(heartSel ? 3 : 2, heartSel ? 0xffff00 : 0x888888);
    }
  }

  /** The bench InventoryGrid (for wheel-scroll routing + scroll-state hooks). */
  getBenchGrid(): InventoryGrid | null {
    return this.benchGrid;
  }

  /** Heart RingCard reference (tooltip, selection-stroke updates). */
  getHeartCard(): RingCard | null {
    return this.heartCard;
  }

  /** A specific COMBAT slot card. */
  getCombatCard(slot: SlotKey): RingCard | undefined {
    return this.combatCards.get(slot);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private addDomLbl(x: number, y: number, text: string, fontPx: number, color: string, backed = false): void {
    this.domLabels.push(
      addDomLabel(this.scene, x, y, text, {
        fontPx,
        color,
        align: 'center',
        background: backed ? 'rgba(0,0,0,0.55)' : undefined,
        padding: backed ? '1px 3px' : undefined,
      }),
    );
  }

  /** Tear down all child objects; leaves the container itself intact. */
  private teardown(): void {
    this.thumbTooltipDetach?.();
    this.thumbTooltipDetach = null;
    if (this.benchGrid) {
      this.benchGrid.destroy();
      this.benchGrid = null;
    }
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels.length = 0;
    this.heartCard = null;
    this.combatCards.clear();
    this.statusLockLabel = null;
    this.removeAll(true);
  }

  override destroy(fromScene?: boolean): void {
    this.teardown();
    super.destroy(fromScene);
  }
}
