import Phaser from 'phaser';
import { SLOT_KEYS } from '../../Constants';
import type { SlotKey } from '../../Constants';
import { InventoryGrid, type RingData, GRID_CARD_W, GRID_COL_GAP, GRID_ROW_GAP } from '../InventoryGrid';
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
   * @param scene             host Phaser scene
   * @param onRecharge        fired when `[RECHARGE]` is clicked
   * @param onSlotClick       fired when a HEALTH or COMBAT slot card is clicked
   * @param getThumbTooltip   lazy supplier for the STATUS hover tooltip text
   * @param onBenchSelect     fired when a bench card is clicked (ring | null for deselect)
   * @param onWonSelect       fired when the WON card is clicked (#423)
   * @param onDiscardClick    fired when the DISCARD slot is clicked (#423)
   * @param onBenchGhostClick fired when the bench ghost placeholder is clicked (#423)
   */
  constructor(
    scene: Phaser.Scene,
    private readonly onRecharge: () => void,
    private readonly onSlotClick: (slot: 'heart' | SlotKey) => void,
    private readonly getThumbTooltip: () => string,
    private readonly onBenchSelect: (ring: RingData | null) => void,
    private readonly onWonSelect?: () => void,
    private readonly onDiscardClick?: () => void,
    private readonly onBenchGhostClick?: () => void,
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
  }

  /**
   * (Re)build all sub-components from a fresh /api/me snapshot. Safe to call
   * repeatedly — tears down the previous state before building new.
   *
   * @param me              latest /api/me payload
   * @param swapSource      the currently-selected slot/section, or null (drives strokes)
   * @param selectedRingId  ring id currently selected from the bench (source = 'spare'),
   *                        or null. When provided, the bench card bg gets a yellow stroke
   *                        and all other bench cards are dimmed to 0.45 alpha.
   */
  build(me: BenchHealthCombatMe, swapSource: string | null, selectedRingId: string | null = null): void {
    this.teardown();

    const loadout = me.loadout ?? {};
    const heartRing = me.player?.heart_ring ?? null;
    const pendingId = me.player?.pending_ring_id ?? null;
    const pendingRing = pendingId ? me.rings.find((r) => r.id === pendingId) ?? null : null;
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
      (ring) => this.onBenchSelect(ring),
      3,
    );
    benchGrid.setScrollFactor(0);
    benchGrid.populate(benchRings);
    benchGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);

    // Apply yellow selection stroke to the currently-selected bench ring.
    // #424 — bench-full dim removed: occupied bench cards are always valid swap
    // targets regardless of pool fullness. Only ghost (empty) cells are insertion
    // targets and they are hidden when the bench is at capacity.
    if (selectedRingId !== null) {
      const selBg = benchGrid.getCardBg(selectedRingId);
      if (selBg) selBg.setStrokeStyle(3, 0xffff00);
    }

    // ── Bench ghost placeholder (#423) ─────────────────────────────────────────
    // Always-visible ghost at the next open bench cell when the bench is below cap.
    // Removes the old emptySpareActionable gate; the ghost is now passive until clicked.
    // Added unconditionally to the card container — the InventoryGrid scroll mask
    // hides off-screen cells naturally, so no visibility guard is needed.
    if (benchN < spareMax) {
      const GHOST_NUM_COLS = 3;
      const GHOST_CARD_H = 88; // CARD_H in InventoryGrid (not exported)
      // Next open cell index = benchRings.length → row = floor(n/3), col = n%3.
      const phY = Math.floor(benchRings.length / GHOST_NUM_COLS) * GRID_ROW_GAP + GHOST_CARD_H / 2;
      const nextCol = benchRings.length % GHOST_NUM_COLS;
      const phX = nextCol * GRID_COL_GAP + GRID_CARD_W / 2;
      const ph = this.scene.add
        .rectangle(phX, phY, GRID_CARD_W, GHOST_CARD_H, 0x2a2a33)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x665544)
        .setAlpha(0.7)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onBenchGhostClick?.());
      benchGrid.getCardContainer().add(ph);
    }

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

    // ── WON slot (#423) — at (837, 193), right of STATUS in COMBAT row 1 ──────
    // Visible in all modes; shows a ghost rectangle when no pending ring exists.
    // Pending WON ring is selected with source='spare' by convention (established
    // in the original renderFieldLeft and preserved in onWonSelect). Do not change
    // to 'pending' — SlotSwapManager has no such slot.
    const wonSel =
      pendingId !== null &&
      selectedRingId === pendingId &&
      swapSource === 'spare';
    if (pendingRing) {
      const wonCard = new RingCard(this.scene, COL_COMBAT_RIGHT_X, ROW_STATUS_Y, {
        width: CARD_W,
        height: CARD_H,
        scrollFactor: 0,
        strokeColor: wonSel ? 0xffff00 : 0xffcc44,
        strokeWidth: wonSel ? 3 : 2,
      });
      wonCard.setRing({
        element: pendingRing.element,
        tier: pendingRing.tier,
        xp: pendingRing.xp,
        currentUses: pendingRing.current_uses,
        maxUses: pendingRing.max_uses,
        fusionParents: pendingRing.fusionParents,
      });
      wonCard.bg
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onWonSelect?.());
      this.scene.add.existing(wonCard);
      this.add(wonCard);
    } else {
      // Empty ghost when no pending ring (all modes)
      const wonGhost = this.scene.add
        .rectangle(COL_COMBAT_RIGHT_X, ROW_STATUS_Y, CARD_W, CARD_H, 0x2a2a33)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x555566)
        .setAlpha(0.5);
      this.add(wonGhost);
    }
    // WON label above (y = 193 - 34 = 159)
    this.addDomLbl(COL_COMBAT_RIGHT_X, ROW_STATUS_Y - LABEL_ABOVE_Y_OFFSET, 'WON ◆', 11, '#ffcc44');

    // ── DISCARD slot (#423) — at (659, 291), HEALTH column row 2 ────────────
    // Visible in all modes; gives sanctum + shrine fusion a discard path.
    const discardRect = this.scene.add
      .rectangle(COL_HEALTH_X, ROW_COMBAT0_Y, CARD_W, CARD_H, 0x331a1a, 0.4)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xaa4444)
      .setName('discard-slot')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onDiscardClick?.());
    this.add(discardRect);
    this.addDomLbl(COL_HEALTH_X, ROW_COMBAT0_Y - LABEL_ABOVE_Y_OFFSET, 'DISCARD', 11, '#aa4444', true);

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
