import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES, THUMB_PASSIVE_INFO, SLOT_KEYS } from '../Constants';
import type { SlotKey } from '../Constants';
import { InventoryGrid, type RingData, GRID_CARD_W, GRID_COL_GAP } from './InventoryGrid';
import { RingCard } from './ui/RingCard';
import { CLOSE_GLYPH } from './ui/ModalShell';
import { attachTooltip } from './ui/Tooltip';
import { SlotSwapManager, type SwapSlot } from './ui/SlotSwapManager';
import { apiFetch, fetchMe, getToken } from '../net/api';
import { addDomLabel } from './ui/DomLabel';
import { publishRingMgmtState, clearRingMgmtState } from './ui/RingManagementOverlay';

/**
 * EPIC #302 / #305 — sentinel slot identifier for the dedicated Heart slot. It
 * sits leftmost in the 6-card top row but is NOT a battle-hand loadout slot, so
 * it is tracked separately from {@link BattleSlot}. The heart card participates
 * in the existing selection system via this sentinel.
 */
const HEART_SLOT = 'heart' as const;
type HeartSel = typeof HEART_SLOT;

/**
 * #305 — the heart card's display state, published on `window.__heartCardState`
 * on each render so the manage-battle-rings E2E spec can assert recharge heals HP
 * and the empty-slot placeholder appears. Set to `undefined` while the overlay is
 * closed. Declared locally (cast at the write sites) to avoid threading a new
 * field through the shared global Window typing.
 */
type HeartCardState =
  | { equipped: true; element: number; currentUses: number; maxUses: number }
  | { equipped: false };

/** Narrow window accessor for the #305 E2E heart-card-state hook. */
function setHeartCardState(state: HeartCardState | undefined): void {
  (window as unknown as { __heartCardState?: HeartCardState }).__heartCardState = state;
}

// Local alias kept for readability; the canonical slot keys/type live in shared/.
type BattleSlot = SlotKey;

/**
 * Manage Battle-Hand overlay (#87 Part D — extracted from EncounterScene #40/#85).
 *
 * A standalone, self-contained overlay for reassigning carried rings to battle
 * slots, recharging rings with spirit, discarding rings, and resolving a pending
 * won ring. It owns its own data (fetches /api/me), its own modal container, and
 * all server round-trips — so it works identically from EncounterScene (where it
 * was previously inlined) AND from OverworldScene (where no encounter state
 * exists), opened by Tab.
 *
 * Server stays authoritative: every mutation (PUT /api/loadout, PUT /api/carry,
 * POST /api/spirit/recharge*, DELETE /api/rings/:id) round-trips and the overlay
 * re-renders from the fresh /api/me response. Purely presentation/input here.
 *
 * The #85 layout fixes (uncapped passive strip, shifted carried-rings + recharge
 * rows) are preserved verbatim from the original EncounterScene implementation.
 */
export class BattleHandOverlay {
  private readonly scene: Phaser.Scene;
  /** Optional sink for status messages that belong outside the modal (errors). */
  private readonly onStatus?: (msg: string) => void;
  /**
   * #137 — optional hook fired after each (re)render builds the modal container,
   * passing it so a dual-camera host (BaseBiomeScene under 2× zoom) can
   * `cameras.main.ignore(container)` and render the overlay at 1:1 through its UI
   * camera. The modal is rebuilt on every render, so this fires per render.
   */
  private readonly onModalRender?: (container: Phaser.GameObjects.Container) => void;
  /** Fired after the overlay closes (host scene re-enables movement, etc.). */
  private onCloseCb?: () => void;

  private manageModal: Phaser.GameObjects.Container | null = null;
  /**
   * #363 — screen-fixed, static modal chrome labels migrated to crisp DOM (overlay
   * title, spare-section HEADER, and the WON/DISCARD/slot section labels). DOM
   * elements are NOT children of the modal Container, so they are tracked here and
   * destroyed on every rebuild + on close to prevent duplicate nodes. The per-card
   * labels inside the scrolling spareContainer stay on canvas (handled in #364).
   */
  private domLabels: Phaser.GameObjects.DOMElement[] = [];
  /**
   * #381 — the reusable InventoryGrid for the spare pool (3-col, scrollable).
   * Created once and re-populated on every renderManageModal call so scroll state
   * resets correctly. Destroyed with the modal on close/rebuild.
   *
   * @internal E2E-visible via runtime access — do not rename without updating manage-battle-rings.spec.ts
   */
  private spareGrid: InventoryGrid | null = null;
  /**
   * EPIC #291 WS I (#307) — the shared click-then-click swap state machine,
   * replacing the bespoke `manageSelectedRingId` + `manageSelectedFromSlot` pair.
   * The held ring's section is the manager's `selection.source` (`'spare'` for the
   * spare row, a battle slot, or `'heart'`). The field modal has no Reliquary
   * access, so `validSlots` excludes `'reliquary'`. `resolveMove` routes each
   * single-target drop (onto a battle slot or the heart) through the existing
   * server helpers (PUT /api/loadout, PUT /api/heart-slot), which self-refresh —
   * so `onAfter` is a no-op. Two-ring swaps onto a SPECIFIC spare card stay
   * dispatched inline (the spare's id is needed), mirroring CampScene.applySwap.
   */
  private readonly swap = new SlotSwapManager({
    validSlots: ['spare', 'thumb', 'a1', 'a2', 'd1', 'd2', 'heart'],
    resolveMove: (ringId, from, to) => this.resolveManageMove(ringId, from, to),
    onAfter: () => {
      /* the delegated helpers already refreshManageData(). */
    },
  });
  private manageRings: RingData[] = [];
  /** #305 — the equipped heart ring from /api/me (`heart_ring`), or null when the slot is empty. */
  private heartRing: RingData | null = null;
  /** #305 — detacher for the Thumb-passive hover tooltip, called on each re-render + close. */
  private thumbTooltipDetach: (() => void) | null = null;
  private manageLoadout: Record<string, string | null> = {};
  /** Full /api/me ring list (carried or not) — needed to show a pending won ring. */
  private allRings: RingData[] = [];
  /**
   * EPIC #378 — the pending WON ring id from `/api/me` (`pending_ring_id`), or
   * null when no WON ring awaits resolution. Server-authoritative: replaces the
   * fragile `er_pending_ring` localStorage key. Set in `open()` and
   * `refreshManageData()`.
   */
  private pendingRingId: string | null = null;
  // pending_ring_id is intentionally promoted to this.pendingRingId — not stored here
  private managePlayer: { game_day?: number; gold?: number; food_units?: number; spirit_current?: number; spirit_max?: number; aggregate_xp?: number; carry_cap?: number; spare_ring_max?: number } | null = null;
  private manageStatusText: Phaser.GameObjects.Text | null = null;
  /**
   * #348 — the open discard-confirm modal container (mirrors BattleScene's
   * forfeitPrompt), or null. Built by {@link openDiscardConfirm}; torn down by
   * {@link dismissDiscardConfirm}. Its open state is mirrored on
   * `window.__discardConfirmOpen` for E2E.
   */
  private discardConfirm: Phaser.GameObjects.Container | null = null;
  /** #348 — detacher for the discard-confirm Y/N key listeners. */
  private discardKeyHandlers: (() => void) | null = null;

  /**
   * @param scene the host spatial/encounter scene
   * @param onStatus optional callback for errors that should surface outside the
   *   modal (e.g. EncounterScene's bottom status text); defaults to a no-op
   * @param onModalRender optional hook (#137) fired with the modal container after
   *   each render, so a zoomed dual-camera host can route it to its UI camera
   */
  constructor(
    scene: Phaser.Scene,
    onStatus?: (msg: string) => void,
    onModalRender?: (container: Phaser.GameObjects.Container) => void,
  ) {
    this.scene = scene;
    this.onStatus = onStatus;
    this.onModalRender = onModalRender;
  }

  /** True while the modal is on screen (host scene reads this to halt movement). */
  isOpen(): boolean {
    return this.manageModal !== null;
  }

  private status(msg: string): void {
    this.onStatus?.(msg);
  }

  /**
   * The held ring id from the swap manager (or null). Mirrors the old
   * `manageSelectedRingId` read sites.
   */
  private get selRingId(): string | null {
    return this.swap.selection?.ringId ?? null;
  }

  /**
   * The slot the held ring came from in the old representation: a battle slot, the
   * {@link HEART_SLOT} sentinel, or `null` when the held ring is a spare (the swap
   * manager models that section as `'spare'`). Mirrors the old
   * `manageSelectedFromSlot` read sites so the render/dispatch logic is unchanged.
   */
  private get selFromSlot(): BattleSlot | HeartSel | null {
    const src = this.swap.selection?.source;
    if (!src || src === 'spare') return null;
    return src as BattleSlot | HeartSel;
  }

  /**
   * Fetch /api/me and open the battle-hand reassignment modal. Only carried rings
   * (in_carry = 1) are offered; selecting one then clicking a slot PUTs
   * /api/loadout. No Sleep/Recharge-by-day here — purely loadout editing + spirit
   * recharge. `onClose` (optional) fires when the modal closes.
   */
  async open(onClose?: () => void): Promise<void> {
    if (this.manageModal) return;
    if (onClose) this.onCloseCb = onClose;
    if (!getToken()) return;

    try {
      const data = await fetchMe<{
        player: (BattleHandOverlay['managePlayer'] & { heart_ring?: RingData | null; pending_ring_id?: string | null }) | null;
        rings: RingData[];
        loadout: Record<string, string | null>;
      }>();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.heartRing = data.player?.heart_ring ?? null;
      this.manageLoadout = data.loadout ?? {};
      // EPIC #378 — pending WON ring id is now server-authoritative (pending_ring_id
      // from /api/me). The WON ring is already in_carry=1, so no auto-carry needed.
      this.pendingRingId = data.player?.pending_ring_id ?? null;
    } catch {
      return;
    }
    if (this.manageModal) return;
    this.renderManageModal();
  }

  /**
   * #352 — add a card label with a contrasting dark backing rect behind the text
   * so the label is legible over any ring-element colour. The backing rect is added
   * to the container BEFORE the text so the text renders on top in draw order.
   *
   * @param container - the modal container that owns these objects
   * @param x - horizontal centre of the label
   * @param y - vertical centre of the label
   * @param text - label string
   * @param style - Phaser TextStyle overrides (fontSize, color, etc.)
   */
  private addCardLabel(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    // Create the text first to measure its bounds; then back it with a rect.
    const lbl = this.scene.add
      .text(x, y, text, style)
      .setScrollFactor(0)
      .setOrigin(0.5);
    const tw = lbl.width;
    const th = lbl.height;
    const bg = this.scene.add
      .rectangle(x, y, tw + 6, th + 2, 0x000000, 0.55)
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add([bg, lbl]);
    return lbl;
  }

  /**
   * #363 — DOM equivalent of {@link addCardLabel} for the static screen-fixed
   * section labels (WON / DISCARD / slot headers). Renders crisp DOM text with a
   * dark backing replicated in CSS (the canvas helper used a 0x000000@0.55 rect
   * with +6/+2 padding around the text bounds). The node is centered (origin 0.5)
   * to match the canvas label and tracked in this.domLabels for explicit cleanup.
   */
  private addCardDomLabel(
    x: number,
    y: number,
    text: string,
    fontPx: number,
    color: string,
  ): void {
    const el = addDomLabel(this.scene, x, y, text, {
      fontPx,
      color,
      align: 'center',
      background: 'rgba(0,0,0,0.55)',
      padding: '1px 3px',
    });
    this.domLabels.push(el);
  }

  /** #363 — destroy all tracked DOM chrome labels (called on rebuild + close). */
  private clearDomLabels(): void {
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels = [];
  }

  /** Render (or re-render) the manage-battle-hand modal from cached state. */
  private renderManageModal(): void {
    // #348 — the discard confirm is a separate depth-3000 container (not a child of
    // manageModal), so a re-render would orphan it. Dismiss it before rebuilding.
    this.dismissDiscardConfirm();
    // #305 — the previous render's Thumb-passive tooltip is bound to objects in the
    // about-to-be-destroyed container; detach it before rebuilding.
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach();
      this.thumbTooltipDetach = null;
    }
    // #381 — destroy the old spare InventoryGrid before rebuilding (it is added as
    // an existing scene object; destroying the container alone does not reclaim it).
    if (this.spareGrid) {
      this.spareGrid.destroy();
      this.spareGrid = null;
    }
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    // #363 — DOM chrome labels are not container children; destroy any prior set
    // so a rebuild/close never leaves duplicate nodes behind.
    this.clearDomLabels();

    // #212 — host-agnostic open flag (EncounterScene or a biome). E2E reads it to
    // assert which post-duel route opened the overlay.
    window.__battleHandOpen = true;
    const container = this.scene.add.container(0, 0).setDepth(2000);
    const overlay = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setScrollFactor(0)
      .setInteractive();

    // #381 — panel widened to 760×500 (mirrors reliquary MODAL_W/MODAL_H).
    // Panel spans y=38–538 (center at 288), x=132–892 (center at 512).
    const MODAL_W = 760;
    const MODAL_H = 500;
    const MODAL_TOP = CANVAS_H / 2 - MODAL_H / 2; // 288 - 250 = 38
    const MODAL_BOTTOM = MODAL_TOP + MODAL_H;       // 538
    const panelCenterY = CANVAS_H / 2;              // 288
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, panelCenterY, MODAL_W, MODAL_H, 0x222233)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xffcc88);

    // Title sits near the panel top edge.
    // #363 — the title is a static, screen-fixed, non-interactive label → DOM (crisp).
    const titleY = MODAL_TOP + 16;
    this.domLabels.push(
      addDomLabel(this.scene, CANVAS_W / 2, titleY, 'Manage Battle Rings', {
        fontPx: 18,
        color: '#ffffff',
        align: 'center',
      }),
    );
    // The close glyph is interactive → stays canvas (DOM labels are pointer-events:none).
    const close = this.scene.add
      .text(CANVAS_W / 2 + MODAL_W / 2 - 20, titleY, CLOSE_GLYPH, { fontSize: '18px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());
    container.add([overlay, panel, close]);

    // ── Three-part header (mirrors reliquary renderReliquaryHeader) ───────────
    // Spirit left / ♥ cur/max center / Total+Avg XP right. Divider at y=118.
    const HEADER_Y = 92;
    const DIVIDER_Y = 118;
    const MODAL_LEFT_EDGE = CANVAS_W / 2 - MODAL_W / 2;   // 132
    const MODAL_RIGHT_EDGE = CANVAS_W / 2 + MODAL_W / 2;  // 892
    const spirit = this.managePlayer?.spirit_current ?? 0;
    const spiritMax = this.managePlayer?.spirit_max ?? 0;
    const headerLeft = this.scene.add
      .text(MODAL_LEFT_EDGE + 20, HEADER_Y, `Spirit: ${spirit} / ${spiritMax}`, {
        fontSize: '13px', color: '#ffdd66',
      })
      .setScrollFactor(0)
      .setOrigin(0, 0);
    const heart = this.heartRing;
    const hp = heart ? `${heart.current_uses}/${heart.max_uses}` : '0/0';
    const headerCenter = this.scene.add
      .text(CANVAS_W / 2, HEADER_Y, `♥ ${hp}`, { fontSize: '13px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5, 0);
    const totalXp = (this.managePlayer?.aggregate_xp ?? 0).toLocaleString();
    const headerRight = this.scene.add
      .text(MODAL_RIGHT_EDGE - 20, HEADER_Y, `Total XP: ${totalXp}`, {
        fontSize: '13px', color: '#aaccff',
      })
      .setScrollFactor(0)
      .setOrigin(1, 0);
    const divider = this.scene.add
      .rectangle(CANVAS_W / 2, DIVIDER_Y, MODAL_W - 40, 1, 0x6082aa)
      .setScrollFactor(0);
    container.add([headerLeft, headerCenter, headerRight, divider]);

    // ── #389 — converged right-section cluster (matches the Sanctum reliquary) ─
    // LOOT | HEALTH | COMBAT. COMBAT = STATUS thumb LEFT-ALIGNED above the 2×2
    // A1/A2 · D1/D2 (so STATUS sits over the A1/D1 column, identical to sanctum).
    // Card size 70×90 (RingCard). Card centers:
    //   Row 0 (y=193): WON (x=559), HP/heart (x=659), STATUS/thumb (x=759)
    //   Row 1 (y=291): DISCARD (x=559),               A1 (x=759), A2 (x=837)
    //   Row 2 (y=389):                                D1 (x=759), D2 (x=837)
    // Labels 34px above each card center.
    const COL0_X = 559; // WON / DISCARD
    const COL1_X = 659; // HP (HEALTH)
    const COL2_X = 759; // STATUS / A1 / D1 (COMBAT left column)
    const COL3_X = 837; // A2 / D2 (COMBAT right column)
    const ROW0_Y = 193; // WON · HP · STATUS
    const ROW1_Y = 291; // DISCARD · A1 · A2
    const ROW2_Y = 389; // D1 · D2
    const LABEL_Y_ROW0 = ROW0_Y - 34; // 159
    const LABEL_Y_ROW1 = ROW1_Y - 34; // 257
    const LABEL_Y_ROW2 = ROW2_Y - 34; // 355
    const CARD_W = 70;
    const CARD_H = 90;

    // ── WON card (col 0, row 0) — pending ring or dim placeholder ────────────
    // EPIC #378 — WON ring from this.pendingRingId (server-authoritative).
    const pendingId = this.pendingRingId;
    const pendingRing = pendingId ? this.allRings.find((r) => r.id === pendingId) : undefined;
    if (pendingRing) {
      const wonSelected = this.selRingId === pendingRing.id && this.selFromSlot === null;
      const wonCard = new RingCard(this.scene, COL0_X, ROW0_Y, {
        width: CARD_W,
        height: CARD_H,
        scrollFactor: 0,
        strokeColor: wonSelected ? 0xffff00 : 0xffcc44,
        strokeWidth: wonSelected ? 3 : 2,
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
        .on('pointerdown', () => {
          if (wonSelected) this.swap.clear();
          else this.swap.select(pendingRing.id, 'spare');
          this.renderManageModal();
        });
      this.scene.add.existing(wonCard);
      container.add(wonCard);
      this.addCardDomLabel(COL0_X, LABEL_Y_ROW0, 'WON ◆', 11, '#ffcc44');
      if (window.__encounterState) {
        window.__encounterState.pendingWonRing = { ringId: pendingRing.id, element: pendingRing.element };
      }
    } else {
      // Dim placeholder — no won ring pending.
      const ph = this.scene.add
        .rectangle(COL0_X, ROW0_Y, CARD_W, CARD_H, 0x2a2a33)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x555566)
        .setAlpha(0.5);
      container.add(ph);
    }

    // ── DISCARD slot (col 0, row 1) — plain rect, 3-step safe discard ────────
    const discardRect = this.scene.add
      .rectangle(COL0_X, ROW1_Y, CARD_W, CARD_H, 0x331a1a, 0.4)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xaa4444)
      .setName('discard-slot')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onDiscardSlotClick());
    container.add(discardRect);
    this.addCardDomLabel(COL0_X, LABEL_Y_ROW1, 'DISCARD', 11, '#aa4444');

    // ── HP / heart card (col 1, row 0) ───────────────────────────────────────
    this.renderHeartCard(container, COL1_X, ROW0_Y, CARD_W, CARD_H);

    // ── Battle slots (thumb/STATUS + a1/a2/d1/d2) — one RingCard each ────────
    // #389 — STATUS is left-aligned (COL2_X) ABOVE the 2×2; A1/A2 on row 1, D1/D2
    // on row 2. This matches the Sanctum COMBAT cluster exactly.
    const slotPos: Record<BattleSlot, { x: number; y: number; labelY: number; labelText: string }> = {
      thumb: { x: COL2_X, y: ROW0_Y, labelY: LABEL_Y_ROW0, labelText: 'STATUS' },
      a1:    { x: COL2_X, y: ROW1_Y, labelY: LABEL_Y_ROW1, labelText: 'A1' },
      a2:    { x: COL3_X, y: ROW1_Y, labelY: LABEL_Y_ROW1, labelText: 'A2' },
      d1:    { x: COL2_X, y: ROW2_Y, labelY: LABEL_Y_ROW2, labelText: 'D1' },
      d2:    { x: COL3_X, y: ROW2_Y, labelY: LABEL_Y_ROW2, labelText: 'D2' },
    };
    SLOT_KEYS.forEach((slot) => {
      const { x: sx, y: slotY, labelY: lblY, labelText } = slotPos[slot];
      const ringId = this.manageLoadout[slot] ?? null;
      const ring = ringId ? this.manageRings.find((r) => r.id === ringId) : null;
      const slotSelected = this.selFromSlot === slot;

      const slotCard = new RingCard(this.scene, sx, slotY, {
        width: CARD_W,
        height: CARD_H,
        scrollFactor: 0,
        strokeColor: slotSelected ? 0xffff00 : 0x888888,
        strokeWidth: slotSelected ? 3 : 2,
      });
      if (ring) {
        slotCard.setRing({
          element: ring.element,
          tier: ring.tier,
          xp: ring.xp,
          currentUses: ring.current_uses,
          maxUses: ring.max_uses,
          fusionParents: ring.fusionParents,
        });
      } else {
        slotCard.clear();
      }
      slotCard.bg
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const selId = this.selRingId;
          const selSlot = this.selFromSlot;
          if (selSlot === HEART_SLOT) {
            void this.swap.moveTo(slot);
          } else if (selId !== null && selSlot === null) {
            void this.swap.moveTo(slot);
          } else if (selId !== null && selSlot !== null) {
            if (selSlot === slot) {
              this.swap.clear();
              this.renderManageModal();
            } else {
              void this.swap.moveTo(slot);
            }
          } else if (ringId) {
            this.swap.select(ringId, slot);
            this.renderManageModal();
          }
        });
      this.scene.add.existing(slotCard);
      container.add(slotCard);

      // #347/#348/#352 — slot header labels → DOM (crisp, screen-fixed).
      this.addCardDomLabel(sx, lblY, labelText, 11, '#cccccc');

      // #305 — Thumb passive hover tooltip on the STATUS card.
      if (slot === 'thumb') {
        this.thumbTooltipDetach = attachTooltip(this.scene, slotCard.bg, () => this.thumbPassiveText(), {
          maxWidth: 180,
        });
      }
    });

    // ── Spare InventoryGrid (left section, 3-col, scrollable) ────────────────
    // Carried rings that are NOT in a battle slot, sorted element→XP→id.
    // Origin x≈234, content top y=148, setVisibleRows(3) mirrors RINGWALL_VISIBLE_ROWS.
    const slottedIds = new Set(Object.values(this.manageLoadout).filter(Boolean) as string[]);
    // Also exclude the heart ring from the spare pool display.
    if (this.heartRing) slottedIds.add(this.heartRing.id);
    // Exclude the WON (pending) ring — it renders in its own dedicated card above the grid.
    if (this.pendingRingId) slottedIds.add(this.pendingRingId);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    // EPIC #378 — spare_ring_max from /api/me (server-computed).
    const spareCapacity = this.managePlayer?.spare_ring_max ?? 0;
    const usedSpares = availableRings.length;
    const spareFull = usedSpares >= spareCapacity && spareCapacity >= 0;

    // Pre-compute empty-spare-placeholder actionability (same as before).
    const _emptySelId = this.selRingId;
    const _emptySelSlot = this.selFromSlot;
    const _isHoldingPending =
      _emptySelId !== null &&
      _emptySelSlot === null &&
      _emptySelId === this.pendingRingId;
    const _isBattleSlotSel = _emptySelId !== null && _emptySelSlot !== null && _emptySelSlot !== HEART_SLOT;
    const _isHeartSel = _emptySelSlot === HEART_SLOT;
    const emptySpareActionable = _isBattleSlotSel || _isHeartSel || _isHoldingPending;
    const emptySpareSelId = _emptySelId;
    const emptySpareSelSlot = _emptySelSlot;

    // The InventoryGrid onSelect wires directly to the SlotSwapManager, mirroring
    // CampScene.onGridSelectionChanged(ring, 'spare') (CampScene.ts:2042).
    const GRID_ORIGIN_X = 234;
    const GRID_CONTENT_TOP_Y = 148;
    const RINGWALL_VISIBLE_ROWS = 3;

    const spareGrid = new InventoryGrid(
      this.scene,
      GRID_ORIGIN_X,
      GRID_CONTENT_TOP_Y,
      (ring) => {
        if (!ring) {
          // Grid's own deselect (same card clicked twice) — mirror swap.clear().
          this.swap.clear();
          this.renderManageModal();
          return;
        }
        const selSlot = this.selFromSlot;
        const selId = this.selRingId;
        if (selSlot === HEART_SLOT) {
          // Heart selected, then a spare: equip the spare into the heart slot.
          void this.equipHeartFromSpare(ring.id);
        } else if (selSlot !== null && selId !== null) {
          // Battle-slot ring selected, then a spare: swap the slot with the spare.
          void this.swapSlotWithSpare(selSlot, selId, ring.id);
        } else if (selId !== null && selSlot === null && selId === this.pendingRingId) {
          // WON ring selected, then a filled spare clicked → no-op, deselect.
          this.swap.clear();
          this.renderManageModal();
        } else {
          // Fresh pick-up or deselect of the same card.
          if (this.selRingId === ring.id && this.selFromSlot === null) {
            this.swap.clear();
          } else {
            this.swap.select(ring.id, 'spare');
          }
          this.renderManageModal();
        }
      },
      3, // numCols
    );
    spareGrid.setScrollFactor(0);
    spareGrid.populate(availableRings);
    spareGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);
    // Reflect any currently-selected spare ring in the grid's own stroke.
    if (_emptySelId !== null && _emptySelSlot === null) {
      // Highlight the selected spare card (the grid's handleClick sets stroke on click;
      // on re-render we re-select it programmatically via clearSelection + direct bg access).
      const selBg = spareGrid.getCardBg(_emptySelId);
      if (selBg) selBg.setStrokeStyle(3, 0xffff00);
    }
    // Dim all spare cards when the spare pool is full and no actionable selection.
    if (spareFull && !emptySpareActionable) {
      availableRings.forEach((r) => {
        const bg = spareGrid.getCardBg(r.id);
        if (bg) bg.setAlpha(0.45);
      });
    }
    this.spareGrid = spareGrid;
    container.add(spareGrid);

    // Empty-spare placeholder: a single interactive rect below the grid's filled
    // cards, visible when the grid has empty capacity and something actionable is held.
    // InventoryGrid does not render empty-slot placeholders, so we add one manually
    // when relevant (mirrors the old plain-rect placeholder for empty spare slots).
    if (emptySpareActionable && usedSpares < spareCapacity) {
      // The InventoryGrid's card container sits at (GRID_ORIGIN_X, GRID_CONTENT_TOP_Y).
      // The placeholder is added to spareGrid.getCardContainer() so it scrolls with
      // the grid contents — adding it to the outer container would leave it fixed.
      // Coordinates are local to the card container (origin at GRID_ORIGIN_X, GRID_CONTENT_TOP_Y).
      const GRID_ROW_GAP = 92; // from InventoryGrid constants (GRID_ROW_GAP export)
      const GRID_CARD_H = 88;
      const NUM_COLS = 3;
      const MODAL_BOTTOM = 538; // MODAL_TOP(38) + MODAL_H(500)
      const filledRows = Math.ceil(availableRings.length / NUM_COLS);

      // Clamp phY so it stays within the visible grid window and within the modal.
      // Local y is relative to the cardContainer origin (which is at GRID_CONTENT_TOP_Y
      // in screen space). The visible window spans rows [scrollRow, scrollRow + RINGWALL_VISIBLE_ROWS).
      // We suppress the placeholder if clamping would push it outside the window — the
      // player can scroll to reveal capacity, and a non-scrolling placeholder would be confusing.
      const rawPhY = filledRows * GRID_ROW_GAP + GRID_CARD_H / 2;
      const maxLocalY = MODAL_BOTTOM - GRID_CONTENT_TOP_Y - GRID_CARD_H / 2 - 4;
      const phY = Math.min(rawPhY, maxLocalY);

      // Only render placeholder if it lands within the visible row window (rows 0–2).
      const GRID_VISIBLE_BOTTOM_LOCAL = RINGWALL_VISIBLE_ROWS * GRID_ROW_GAP;
      if (phY < GRID_VISIBLE_BOTTOM_LOCAL) {
        // L-1: place placeholder in the correct column (not always col 0).
        const nextCol = availableRings.length % NUM_COLS;
        const phX = nextCol * GRID_COL_GAP + GRID_CARD_W / 2;
        const ph = this.scene.add
          .rectangle(phX, phY, GRID_CARD_W, GRID_CARD_H, 0x2a2a33)
          .setScrollFactor(0)
          .setStrokeStyle(2, 0x665544)
          .setAlpha(0.7)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            void this.moveHeldRingToSpare(emptySpareSelId!, emptySpareSelSlot);
          });
        // Add to the scrollable card container so the placeholder follows scroll.
        spareGrid.getCardContainer().add(ph);
      }
    }

    // ── Spare count label and recharge controls ───────────────────────────────
    // Positioned below the spare grid visible window (3 rows × 92px = 276px tall).
    // Grid top y=148, window bottom y=148+276=424. Labels below:
    const GRID_VISIBLE_H = RINGWALL_VISIBLE_ROWS * 92; // 276
    const SPARE_LABEL_Y = GRID_CONTENT_TOP_Y + GRID_VISIBLE_H + 21; // ≈445
    const RECHARGE_Y = SPARE_LABEL_Y + 19;  // ≈464
    const STATUS_Y = RECHARGE_Y + 20;       // ≈484

    // #389 — player-facing "Bench" replaces "Spare" (the code keeps `spare_*`).
    const spareLabelText = `Bench: ${usedSpares} / ${spareCapacity}`;
    const spareLabelColor = spareFull ? '#ff8888' : '#aaccff';
    this.domLabels.push(
      addDomLabel(this.scene, GRID_ORIGIN_X + 68, SPARE_LABEL_Y, spareLabelText, {
        fontPx: 12,
        color: spareLabelColor,
        align: 'center',
      }),
    );

    const rechargeBtn = this.scene.add
      .text(CANVAS_W / 2 - 60, RECHARGE_Y, '[Recharge]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeSelected());
    const rechargeAllBtn = this.scene.add
      .text(CANVAS_W / 2 + 80, RECHARGE_Y, '[Recharge All]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeAll());
    this.manageStatusText = this.scene.add
      .text(CANVAS_W / 2, STATUS_Y, '', { fontSize: '11px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5);

    // Guard: clamp status text inside the panel bottom (MODAL_BOTTOM).
    if (STATUS_Y > MODAL_BOTTOM - 8) {
      this.manageStatusText.setY(MODAL_BOTTOM - 8);
    }
    container.add([rechargeBtn, rechargeAllBtn, this.manageStatusText]);

    this.manageModal = container;
    // #137 — let a zoomed dual-camera host route this freshly-built container to
    // its UI camera (cameras.main.ignore) so the overlay renders at 1:1, not 2×.
    this.onModalRender?.(container);

    // #87 Part D — re-expose the discard hook the original inlined EncounterScene
    // modal published (tests/e2e/carry.spec.ts calls window.__encounterDiscardRing).
    // The lambda captures `this`, so it routes to this overlay's private discard.
    window.__encounterDiscardRing = (ringId: string): void => void this.discardCarriedRing(ringId);

    // #389 — publish the converged structure reporter: the field overlay's columns
    // (LOOT | BENCH | HEALTH | COMBAT) and the Bench counter (usedSpares already
    // excludes battle-slotted, heart, and the pending WON ring — the same predicate
    // as benchSpareCount). No Spirit counter in the field (no resting pool access).
    publishRingMgmtState('field', {
      bench: { n: usedSpares, max: spareCapacity },
    });
  }

  /**
   * The Thumb passive reminder text (#78 ④), shown on hover over the Thumb card
   * (#305 — replacing the always-on strip). Reads the staked Thumb ring
   * (loadout.thumb) and resolves its passive via THUMB_PASSIVE_INFO — display-only;
   * the server owns the real passive resolution at duel start. Returns '' when no
   * Thumb is staked, which {@link attachTooltip} treats as "no tooltip".
   */
  private thumbPassiveText(): string {
    const thumbRingId = this.manageLoadout.thumb ?? null;
    const thumbRing = thumbRingId ? this.manageRings.find((r) => r.id === thumbRingId) : undefined;
    if (!thumbRing) return ''; // no Thumb staked → no tooltip
    const info = THUMB_PASSIVE_INFO[thumbRing.element];
    return info ? `${info.name}\n${info.effect}` : 'No passive\nFused rings grant no passive';
  }

  /**
   * #305 / #348 / #381 — render the dedicated Heart-slot card (HP, col-1 row-0).
   * Now uses a RingCard (two-tone fused fill) for visual parity with the reliquary.
   * An empty slot shows the card in its cleared state with a ♥ 0/0 label.
   * The ♥ cur/max label above the card keeps the existing canvas addCardLabel path
   * (interactive label + dark backing rect — the E2E spec asserts its backing).
   */
  private renderHeartCard(
    container: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    cardW: number,
    cardH: number,
  ): void {
    const heart = this.heartRing;
    const selected = this.selFromSlot === HEART_SLOT;

    const heartCard = new RingCard(this.scene, cx, cy, {
      width: cardW,
      height: cardH,
      scrollFactor: 0,
      strokeColor: selected ? 0xffff00 : 0x888888,
      strokeWidth: selected ? 3 : 2,
    });
    if (heart) {
      heartCard.setRing({
        element: heart.element,
        tier: heart.tier,
        xp: heart.xp,
        currentUses: heart.current_uses,
        maxUses: heart.max_uses,
        fusionParents: heart.fusionParents,
      });
    } else {
      heartCard.clear('♥\nempty\n0 HP');
      heartCard.setAlpha(0.5);
    }
    heartCard.bg
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onHeartCardClick());
    this.scene.add.existing(heartCard);
    container.add(heartCard);

    // #347/#348/#352 — ♥ cur/max label with dark backing rect stays on canvas.
    // The E2E spec searches for it (startsWith('♥')) and asserts the preceding
    // Rectangle is a backing rect (#352). Keep addCardLabel for this label.
    const hpText = heart ? `♥ ${heart.current_uses}/${heart.max_uses}` : '♥ 0/0';
    this.addCardLabel(container, cx, cy - 34, hpText, {
      fontSize: '11px',
      color: heart ? '#ff99aa' : '#777777',
    });

    // #305 — E2E hook: the heart card's display state.
    setHeartCardState(
      heart
        ? { equipped: true, element: heart.element, currentUses: heart.current_uses, maxUses: heart.max_uses }
        : { equipped: false },
    );
  }

  /**
   * Heart-card click dispatcher (#305). Resolves the click against the current
   * selection: a selected spare/battle ring swaps INTO the heart slot; clicking the
   * already-selected heart deselects; an unselected occupied heart becomes selected
   * (for recharge or to swap out).
   */
  private onHeartCardClick(): void {
    const selId = this.selRingId;
    const selSlot = this.selFromSlot;
    if (selId !== null && selSlot === null) {
      // Spare ring selected — equip it into the heart slot, releasing the old heart
      // ring to spare (server 400s 'carry cap exceeded' → "Free a slot first").
      void this.swap.moveTo('heart');
    } else if (selId !== null && selSlot !== null && selSlot !== HEART_SLOT) {
      // Battle-slot ring selected — slot-for-slot swap with the heart slot.
      void this.swap.moveTo('heart');
    } else if (selSlot === HEART_SLOT) {
      // The heart was already selected — toggle it off.
      this.swap.clear();
      this.renderManageModal();
    } else if (this.heartRing) {
      // Nothing selected and the heart is occupied — select it (recharge / swap-out).
      this.swap.select(this.heartRing.id, HEART_SLOT);
      this.renderManageModal();
    }
  }

  /**
   * EPIC #291 WS I (#307) — {@link SlotSwapManager} resolveMove for the field
   * modal. Routes a single-target drop of the held ring (`from`) onto `to` to the
   * existing server helper. Only `to === 'heart'` or a battle slot reach here —
   * drops onto a SPECIFIC spare card are dispatched inline (the spare's id is
   * needed). The delegated helpers self-refresh, so the manager's onAfter is a
   * no-op. Behaviour is identical to the pre-extraction inline dispatch.
   */
  private async resolveManageMove(_ringId: string, from: SwapSlot, to: SwapSlot): Promise<void> {
    if (to === 'heart') {
      // Equip into the heart slot. A spare source releases the old heart ring to
      // spare; a battle-slot source is a slot-for-slot swap.
      if (from === 'spare') {
        await this.equipHeartFromSpare(_ringId);
      } else {
        await this.swapHeartWithBattleSlot(from as BattleSlot);
      }
      return;
    }
    // `to` is a battle slot (validSlots excludes 'reliquary'; 'spare' targets never
    // reach resolveMove).
    const toSlot = to as BattleSlot;
    if (from === 'heart') {
      // Heart ring dropped onto a battle slot — slot-for-slot swap.
      await this.swapHeartWithBattleSlot(toSlot);
    } else if (from === 'spare') {
      // Spare ring assigned to the battle slot (server clears any prior slot). The
      // manager's selection is still set during resolveMove, so assignManageSlot's
      // `this.selRingId` read resolves to the held spare ring.
      await this.assignManageSlot(toSlot);
    } else {
      // Battle slot ↔ battle slot — swap the two assignments.
      const toRingId = this.manageLoadout[toSlot] ?? null;
      await this.swapManageSlots(from as BattleSlot, _ringId, toSlot, toRingId);
    }
  }


  /** Assign the selected carried ring to a battle slot via PUT /api/loadout. */
  private async assignManageSlot(slot: BattleSlot): Promise<void> {
    if (!this.selRingId) {
      this.status('Select a carried ring first');
      this.setManageStatus('Select a carried ring first');
      return;
    }
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/loadout', {
        method: 'PUT',
        json: { [slot]: this.selRingId },
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * Swap two battle slots by PUTting both assignments in one request. If `toBringId`
   * is null the target slot is empty — the selected ring simply moves there and its
   * old slot is cleared.
   */
  private async swapManageSlots(
    fromSlot: BattleSlot,
    fromRingId: string,
    toSlot: BattleSlot,
    toBringId: string | null,
  ): Promise<void> {
    if (!getToken()) return;
    const body: Record<string, string | null> = { [toSlot]: fromRingId, [fromSlot]: toBringId };
    try {
      const res = await apiFetch('/api/loadout', { method: 'PUT', json: body });
      if (!res.ok) {
        this.setManageStatus('Swap failed');
        return;
      }
    } catch {
      this.setManageStatus('Network error during swap');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * Assign `spareRingId` to `fromSlot`, displacing `slotRingId` to spare. The server's
   * one-slot rule automatically clears the old slot when the spare ring is assigned.
   */
  private async swapSlotWithSpare(
    fromSlot: BattleSlot,
    _slotRingId: string,
    spareRingId: string,
  ): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/loadout', {
        method: 'PUT',
        json: { [fromSlot]: spareRingId },
      });
      if (!res.ok) {
        this.setManageStatus('Swap failed');
        return;
      }
    } catch {
      this.setManageStatus('Network error during swap');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #305 — equip the selected spare ring into the Heart slot, releasing the old
   * heart ring to spare. PUT /api/heart-slot { ringId, releaseTo: 'spare' }. A 400
   * means carrying the displaced heart ring would exceed the carry cap; surface the
   * canonical "Free a slot first" prompt instead of the raw server message.
   */
  private async equipHeartFromSpare(spareRingId: string): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/heart-slot', {
        method: 'PUT',
        json: { ringId: spareRingId, releaseTo: 'spare' },
      });
      if (res.status === 400) {
        this.setManageStatus('Free a slot first');
        return;
      }
      if (!res.ok) {
        this.setManageStatus(`Heart swap failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during heart swap');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #305 — slot-for-slot swap between the Heart slot and a battle-hand slot. PUT
   * /api/heart-slot { releaseTo: <slot> } (no ringId — the ring in that battle slot
   * becomes the new heart ring, and the old heart ring takes the battle slot). The
   * net carried count is unchanged, so this never trips the carry cap.
   */
  private async swapHeartWithBattleSlot(slot: BattleSlot): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/heart-slot', {
        method: 'PUT',
        json: { releaseTo: slot },
      });
      if (!res.ok) {
        this.setManageStatus(`Heart swap failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during heart swap');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * EPIC #378 — dispatch a "move held ring to the spare pool" action routed by the
   * selection's source slot:
   *  - battle slot (a1/a2/d1/d2 or thumb) → PUT /api/loadout { [slot]: null }
   *    unstakes the ring (it remains carried; the slot just becomes empty).
   *  - heart → PUT /api/heart-slot { releaseTo: 'spare' } (no ringId);
   *    heart slot empties → 0 HP.
   *  - pending WON ring (selFromSlot===null, ringId===pendingRingId) → accept as
   *    regular spare via PUT /api/rings/:id/accept (Sub-1 endpoint). Valid only
   *    when spare ≤ spare_ring_max; 400 'spare grid still full' → "Free a slot
   *    first" message.
   *  - spare or nothing → no-op (callers guard against this case already).
   */
  private async moveHeldRingToSpare(
    ringId: string,
    fromSlot: BattleSlot | HeartSel | null,
  ): Promise<void> {
    if (fromSlot === HEART_SLOT) {
      await this.releaseHeartToSpare();
      return;
    }
    if (fromSlot !== null) {
      // Battle slot (thumb/a1/a2/d1/d2) — clear the slot, ring stays carried.
      await this.unstakeBattleSlotToSpare(fromSlot);
      return;
    }
    // fromSlot === null: pending WON ring (in_carry=1 with pending=1).
    // Accept it as a regular spare via PUT /api/rings/:id/accept.
    // Only succeeds when spare count has dropped to ≤ spare_ring_max (i.e. the
    // player has freed a slot since winning the ring).
    if (!getToken()) return;
    if (!ringId) {
      this.swap.clear();
      await this.refreshManageData();
      return;
    }
    try {
      const res = await apiFetch(`/api/rings/${ringId}/accept`, { method: 'PUT' });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body?.error ?? 'Free a slot first';
        this.setManageStatus(msg.includes('spare grid still full') ? 'Free a slot first' : msg);
        return;
      }
      if (!res.ok) {
        this.setManageStatus(`Accept failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during accept');
      return;
    }
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #350 — clear a battle slot via PUT /api/loadout { [slot]: null }. The ring
   * remains carried (it moves to the spare pool). Self-refreshes.
   */
  private async unstakeBattleSlotToSpare(slot: BattleSlot): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/loadout', {
        method: 'PUT',
        json: { [slot]: null },
      });
      if (!res.ok) {
        this.setManageStatus(`Unstake failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during unstake');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #350 — release the equipped heart ring to the spare pool via
   * PUT /api/heart-slot { releaseTo: 'spare' } (no ringId). The heart slot is then
   * empty → 0 HP. Self-refreshes.
   */
  private async releaseHeartToSpare(): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/heart-slot', {
        method: 'PUT',
        json: { releaseTo: 'spare' },
      });
      if (!res.ok) {
        this.setManageStatus(`Heart release failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during heart release');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #305 — permanently discard the equipped heart ring (DELETE /api/rings/:id, the
   * same path as a carried-ring discard). The slot is then empty = 0 HP (the #304
   * server guard blocks dueling); the placeholder card communicates this.
   */
  private async discardHeartRing(ringId: string): Promise<void> {
    try {
      await apiFetch(`/api/rings/${ringId}`, { method: 'DELETE' });
    } catch {
      this.status('Network error during discard');
      return;
    }
    this.swap.clear();
    await this.refreshManageData();
  }

  /**
   * #348 — DISCARD slot click. The safe 3-step flow's step 2: with a card selected,
   * open the confirm modal (it does NOT discard yet). With nothing selected it is a
   * no-op (a hint nudges the player). The held ring is resolved from the swap
   * manager's selection: a battle slot, the {@link HEART_SLOT} sentinel, the pending
   * won ring, or a spare (both of the latter carry the `'spare'` source).
   */
  private onDiscardSlotClick(): void {
    const ringId = this.selRingId;
    if (!ringId) {
      this.setManageStatus('Select a ring first, then click DISCARD');
      return;
    }
    this.openDiscardConfirm(ringId);
  }

  /**
   * #348 — the discard confirm modal (mirrors {@link BattleScene.showForfeitPrompt}).
   * A centred rect + `Discard [Element] T[tier] ring? Permanent.` with clickable
   * `[Discard]` / `[Cancel]` buttons (also Y / N keys). Confirm routes to the correct
   * existing server helper by the held ring's source; Cancel clears with no mutation.
   * `window.__discardConfirmOpen` mirrors the open state for E2E.
   */
  private openDiscardConfirm(ringId: string): void {
    if (this.discardConfirm) return;

    // Resolve the held ring + its source for the routing + the prompt label.
    // EPIC #378 — pending ring is identified by this.pendingRingId (server-authoritative).
    const selSlot = this.selFromSlot;
    const isPendingWon = selSlot === null && ringId === this.pendingRingId;
    const ring =
      selSlot === HEART_SLOT
        ? this.heartRing
        : this.allRings.find((r) => r.id === ringId) ?? null;
    const elementName = ring ? ELEMENT_NAMES[ring.element] ?? '?' : '?';
    const tier = ring ? ring.tier : '?';

    const bg = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 460, 110, 0x000000, 0.9)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xff4444);
    const text = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 20, `Discard ${elementName} T${tier} ring? Permanent.`, {
        fontSize: '16px',
        color: '#ffdddd',
      })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const discardBtn = this.scene.add
      .text(CANVAS_W / 2 - 70, CANVAS_H / 2 + 22, '[Discard]', { fontSize: '15px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setName('discard-confirm-yes')
      .on('pointerdown', () => this.confirmDiscard(ringId, selSlot, isPendingWon));
    const cancelBtn = this.scene.add
      .text(CANVAS_W / 2 + 70, CANVAS_H / 2 + 22, '[Cancel]', { fontSize: '15px', color: '#aaccff' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setName('discard-confirm-no')
      .on('pointerdown', () => this.dismissDiscardConfirm());
    // Depth above the modal container (2000) so it overlays the cards.
    const prompt = this.scene.add
      .container(0, 0, [bg, text, discardBtn, cancelBtn])
      .setDepth(3000);
    this.onModalRender?.(prompt); // #137 — route to the UI camera under 2× zoom.
    this.discardConfirm = prompt;
    window.__discardConfirmOpen = true;

    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.scene.input.keyboard;
    if (kb) {
      const yKey = kb.addKey(KC.Y);
      const nKey = kb.addKey(KC.N);
      const onYes = (): void => this.confirmDiscard(ringId, selSlot, isPendingWon);
      const onNo = (): void => this.dismissDiscardConfirm();
      yKey.on('down', onYes);
      nKey.on('down', onNo);
      this.discardKeyHandlers = () => {
        yKey.off('down', onYes);
        nKey.off('down', onNo);
      };
    }
  }

  /**
   * #348 — confirm step: route the discard to the correct existing helper by the
   * held ring's source, then tear down the prompt. The helpers self-refresh the
   * modal (re-render), so no extra render here.
   */
  private confirmDiscard(
    ringId: string,
    selSlot: BattleSlot | HeartSel | null,
    isPendingWon: boolean,
  ): void {
    this.dismissDiscardConfirm();
    void (async () => {
      if (isPendingWon) {
        await this.discardPendingWonRing();
      } else if (selSlot === HEART_SLOT) {
        await this.discardHeartRing(ringId);
      } else {
        // Spare or battle slot — both route through the carried-ring discard.
        await this.discardCarriedRing(ringId);
      }
    })();
  }

  /** #348 — tear down the discard confirm modal + its Y/N listeners; clear selection. */
  private dismissDiscardConfirm(): void {
    // Only clear the swap selection when the confirm was actually open (i.e. the player
    // cancelled mid-discard). renderManageModal calls this defensively on every rebuild
    // so it must not wipe an in-progress ring selection.
    const wasOpen = this.discardConfirm !== null;
    if (this.discardKeyHandlers) {
      this.discardKeyHandlers();
      this.discardKeyHandlers = null;
    }
    this.discardConfirm?.destroy(true);
    this.discardConfirm = null;
    window.__discardConfirmOpen = false;
    if (wasOpen) this.swap.clear();
  }

  /** Close the modal and fire the close callback (host re-enables movement). */
  close(): void {
    // #348 — tear down the discard confirm modal if it is open.
    this.dismissDiscardConfirm();
    // #305 — tear down the Thumb-passive hover tooltip before the modal is gone.
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach();
      this.thumbTooltipDetach = null;
    }
    // #381 — destroy the spare InventoryGrid before the modal container.
    if (this.spareGrid) {
      this.spareGrid.destroy();
      this.spareGrid = null;
    }
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    // #363 — DOM chrome labels are not container children; destroy any prior set
    // so a rebuild/close never leaves duplicate nodes behind.
    this.clearDomLabels();
    this.swap.clear();
    this.manageStatusText = null;
    window.__battleHandOpen = false; // #212
    setHeartCardState(undefined); // #305
    clearRingMgmtState(); // #389
    delete window.__encounterDiscardRing;
    const cb = this.onCloseCb;
    this.onCloseCb = undefined;
    cb?.();
  }

  /** Recharge the currently selected ring using spirit. */
  private async doManageRechargeSelected(): Promise<void> {
    if (!this.selRingId) {
      this.setManageStatus('Select a ring to recharge');
      return;
    }
    await this.doManageRechargeById(this.selRingId);
  }

  /** POST /api/spirit/recharge for a specific ring id. */
  private async doManageRechargeById(ringId: string): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/spirit/recharge', {
        method: 'POST',
        json: { ringId },
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        this.setManageStatus(body?.error ?? 'Recharge not available');
        return;
      }
      if (!res.ok) {
        this.setManageStatus(`Recharge failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge');
      return;
    }
    await this.refreshManageData();
  }

  /** POST /api/spirit/recharge-all — fill carried rings in priority order. */
  private async doManageRechargeAll(): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/spirit/recharge-all', { method: 'POST' });
      if (!res.ok) {
        this.setManageStatus(`Recharge-all failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge-all');
      return;
    }
    await this.refreshManageData();
  }

  /** Re-fetch /api/me and re-render the manage modal with fresh data. */
  private async refreshManageData(): Promise<void> {
    if (!getToken()) return;
    try {
      const data = await fetchMe<{
        player: (BattleHandOverlay['managePlayer'] & { heart_ring?: RingData | null; pending_ring_id?: string | null }) | null;
        rings: RingData[];
        loadout: Record<string, string | null>;
      }>();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.heartRing = data.player?.heart_ring ?? null;
      this.manageLoadout = data.loadout ?? {};
      // EPIC #378 — keep pendingRingId in sync with the server after every mutation.
      this.pendingRingId = data.player?.pending_ring_id ?? null;
    } catch {
      return;
    }
    this.renderManageModal();
  }

  private setManageStatus(msg: string): void {
    if (this.manageStatusText) this.manageStatusText.setText(msg);
  }

  /**
   * Permanently discard a carried ring (DELETE /api/rings/:id), then reload the
   * modal data. EPIC #378 — the WON ring is already in_carry=1, so no auto-carry
   * step is needed after discarding another ring.
   */
  private async discardCarriedRing(ringId: string): Promise<void> {
    try {
      await apiFetch(`/api/rings/${ringId}`, { method: 'DELETE' });
    } catch {
      this.status('Network error during discard');
      return;
    }
    await this.refreshManageData();
  }

  /**
   * DELETE the pending WON ring (EPIC #378 — server clears pending=0 via
   * discardRing; the server is authoritative). Clears window state and refreshes.
   */
  private async discardPendingWonRing(): Promise<void> {
    const ringId = this.pendingRingId;
    if (!ringId) return;
    try {
      await apiFetch(`/api/rings/${ringId}`, { method: 'DELETE' });
    } catch {
      this.status('Network error during discard');
    }
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    await this.refreshManageData();
  }

  /** Destroy the overlay (host scene shutdown). */
  destroy(): void {
    this.dismissDiscardConfirm(); // #348
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach(); // #305
      this.thumbTooltipDetach = null;
    }
    // #381 — destroy the spare InventoryGrid before the modal container.
    if (this.spareGrid) {
      this.spareGrid.destroy();
      this.spareGrid = null;
    }
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    // #363 — DOM chrome labels are not container children; destroy any prior set
    // so a rebuild/close never leaves duplicate nodes behind.
    this.clearDomLabels();
    this.manageStatusText = null;
    this.onCloseCb = undefined;
    setHeartCardState(undefined); // #305
    clearRingMgmtState(); // #389
    delete window.__encounterDiscardRing;
  }
}
