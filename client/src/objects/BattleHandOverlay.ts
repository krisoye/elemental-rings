import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES, THUMB_PASSIVE_INFO, SLOT_KEYS } from '../Constants';
import type { SlotKey } from '../Constants';
import type { RingData } from './InventoryGrid';
import { usePips } from './ui/RingCard';
import { CLOSE_GLYPH } from './ui/ModalShell';
import { attachTooltip } from './ui/Tooltip';
import { SlotSwapManager, type SwapSlot } from './ui/SlotSwapManager';
import { apiFetch, fetchMe, getToken } from '../net/api';
import { addDomLabel, crispCanvasText } from './ui/DomLabel';

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
  private spareScrollRow = 0;
  private spareWheelHandler: ((p: unknown, g: unknown, dx: number, dy: number) => void) | null = null;
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
    this.spareScrollRow = 0;
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
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    // #348 — the discard confirm is a separate depth-3000 container (not a child of
    // manageModal), so a re-render would orphan it. Dismiss it before rebuilding.
    this.dismissDiscardConfirm();
    // #305 — the previous render's Thumb-passive tooltip is bound to objects in the
    // about-to-be-destroyed container; detach it before rebuilding.
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach();
      this.thumbTooltipDetach = null;
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
    // #356 — panel expanded to 515 tall to fix spare-label/recharge/status-echo overlap.
    // New panel spans y=44–559. MODAL_TOP is the panel's top y-edge; every
    // y-constant below is derived from it.
    const MODAL_TOP = 44;
    const PANEL_H = 515;
    const panelCenterY = MODAL_TOP + PANEL_H / 2; // 44 + 257.5 = 301.5
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, panelCenterY, 640, PANEL_H, 0x222233)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xffcc88);
    // Title sits 16px below the panel top edge.
    // #363 — the title is a static, screen-fixed, non-interactive label → DOM (crisp).
    // It is NOT a container child; it is tracked in this.domLabels for cleanup.
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
      .text(CANVAS_W / 2 + 290, titleY, CLOSE_GLYPH, { fontSize: '18px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());
    container.add([overlay, panel, close]);

    // ── #348/#350/#352 — three gap-separated 2-row clusters ──────────────────
    // Absolute card-centre coordinates (canvas 1024×576; modal top at y=44).
    // Cards are 92×80 (span ±46 / ±40). Clusters:
    //   Group 1 (Won / Discard), col x=303:   row0 = pending won ring or placeholder;
    //                                          row1 = DISCARD slot.
    //   Group 2 (HP / Status), col x=460:      row0 = HP (heart); row1 = STATUS (thumb).
    //                                          #352 swap: HP now on row 0. Isolated by
    //                                          gaps on BOTH sides (~65px each).
    //   Group 3 (Combat), cols x=617/721:      row0 = A1,A2; row1 = D1,D2. Pair gap 12px.
    // Rows: row0 y=178, row1 y=268 (top cluster shifted up 8px for spare-grid buffer). Labels at row_y − 34.
    // Derivation (inner span [192,832], W=92, half=46, margins=gaps=65, pair=12):
    //   G1=192+65+46=303; G2=303+92+65=460; A1=460+92+65=617; A2=617+92+12=721;
    //   right margin=832−(721+46)=65. Equal margins + equal HP/STATUS isolation. #350
    const GROUP1_X = 303;
    const GROUP2_X = 460;
    const GROUP3_X = [617, 721];
    const ROW0_Y = 178;
    const ROW1_Y = 268;

    // ── Group 1, row 0 — pending won ring, or a dim placeholder ───────────────
    // EPIC #378 — the WON ring is now in_carry=1 (it appears in manageRings /
    // allRings). pendingRingId comes from /api/me (server-authoritative), not
    // localStorage. Selecting it then clicking DISCARD discards it.
    const pendingId = this.pendingRingId;
    const pendingRing = pendingId ? this.allRings.find((r) => r.id === pendingId) : undefined;
    if (pendingRing) {
      const wonSelected = this.selRingId === pendingRing.id && this.selFromSlot === null;
      const wonRect = this.scene.add
        .rectangle(GROUP1_X, ROW0_Y, 92, 80, ELEMENT_COLORS[pendingRing.element] ?? 0x444444)
        .setScrollFactor(0)
        .setStrokeStyle(3, wonSelected ? 0xffff00 : 0xffcc44)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          // Select / deselect the pending won ring (source 'spare' sentinel — it is
          // not a slot; the held id alone identifies it for the discard route).
          if (wonSelected) this.swap.clear();
          else this.swap.select(pendingRing.id, 'spare');
          this.renderManageModal();
        });
      container.add(wonRect);
      this.addRingInfo(container, GROUP1_X, ROW0_Y, pendingRing);
      // #352 — label with dark backing rect for legibility over element colour.
      this.addCardDomLabel(GROUP1_X, ROW0_Y - 34, 'WON ◆', 11, '#ffcc44'); // #363
      if (window.__encounterState) {
        window.__encounterState.pendingWonRing = { ringId: pendingRing.id, element: pendingRing.element };
      }
    } else {
      // Dim placeholder holds group-1 row-0 when no won ring is pending.
      const ph = this.scene.add
        .rectangle(GROUP1_X, ROW0_Y, 92, 80, 0x2a2a33)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x555566)
        .setAlpha(0.5);
      container.add(ph);
    }

    // ── Group 1, row 1 — DISCARD slot (3-step safe discard, no × buttons) ─────
    // A card-shaped faint-red outline with a DISCARD label above it (#350). Clicking
    // it WITH a card selected opens the confirm modal; with nothing selected it is a
    // no-op. Named so E2E can locate it without a pixel read.
    const discardRect = this.scene.add
      .rectangle(GROUP1_X, ROW1_Y, 92, 80, 0x331a1a, 0.4)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xaa4444)
      .setName('discard-slot')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onDiscardSlotClick());
    container.add(discardRect);
    // #350/#352 — DISCARD label with dark backing rect for legibility. #363 — DOM.
    this.addCardDomLabel(GROUP1_X, ROW1_Y - 34, 'DISCARD', 11, '#aa4444');

    // ── Group 2 row 0 — HP (heart) card; element + HP pips, recharge/swap. ────
    // #352 swap: HP is now on row 0 (top), STATUS on row 1 (bottom).
    this.renderHeartCard(container, GROUP2_X, ROW0_Y);

    // ── Group 2 row 1 (thumb→STATUS) + Group 3 (a1/a2 row 0, d1/d2 row 1) ─────
    // SLOT_KEYS = ['thumb','a1','a2','d1','d2']. Map each to its cluster position.
    const slotPos: Record<BattleSlot, { x: number; y: number }> = {
      thumb: { x: GROUP2_X, y: ROW1_Y },
      a1: { x: GROUP3_X[0], y: ROW0_Y },
      a2: { x: GROUP3_X[1], y: ROW0_Y },
      d1: { x: GROUP3_X[0], y: ROW1_Y },
      d2: { x: GROUP3_X[1], y: ROW1_Y },
    };
    SLOT_KEYS.forEach((slot) => {
      const { x: sx, y: slotY } = slotPos[slot];
      const ringId = this.manageLoadout[slot] ?? null;
      const ring = ringId ? this.manageRings.find((r) => r.id === ringId) : null;
      const color = ring ? ELEMENT_COLORS[ring.element] ?? 0x333333 : 0x333333;
      const slotSelected = this.selFromSlot === slot;
      const strokeColor = slotSelected ? 0xffff00 : 0x888888;
      const strokeWidth = slotSelected ? 3 : 2;
      const slotRect = this.scene.add
        .rectangle(sx, slotY, 92, 80, color)
        .setScrollFactor(0)
        .setStrokeStyle(strokeWidth, strokeColor)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const selId = this.selRingId;
          const selSlot = this.selFromSlot;
          if (selSlot === HEART_SLOT) {
            // Heart ring selected — swap it slot-for-slot with this battle slot.
            void this.swap.moveTo(slot);
          } else if (selId !== null && selSlot === null) {
            // Spare ring selected — assign it to this slot (existing path).
            void this.swap.moveTo(slot);
          } else if (selId !== null && selSlot !== null) {
            // Slot ring selected — swap the two slots or deselect.
            if (selSlot === slot) {
              this.swap.clear();
              this.renderManageModal();
            } else {
              void this.swap.moveTo(slot);
            }
          } else if (ringId) {
            // Nothing selected and slot occupied — select this slot's ring.
            this.swap.select(ringId, slot);
            this.renderManageModal();
          }
        });
      container.add(slotRect);
      // #347/#348/#352 — the thumb slot reads STATUS (cross-screen parity);
      // a1/a2/d1/d2 keep their uppercase labels. #363 — static slot headers → DOM.
      const labelText = slot === 'thumb' ? 'STATUS' : slot.toUpperCase();
      this.addCardDomLabel(sx, slotY - 34, labelText, 11, '#cccccc');
      // #305 — the Thumb passive is a hover tooltip on the STATUS card.
      if (slot === 'thumb') {
        this.thumbTooltipDetach = attachTooltip(this.scene, slotRect, () => this.thumbPassiveText(), {
          maxWidth: 180,
        });
      }
      if (ring) {
        this.addRingInfo(container, sx, slotY, ring);
      } else {
        const dash = this.scene.add
          .text(sx, slotY, '—', { fontSize: '11px', color: '#888888' })
          .setScrollFactor(0)
          .setOrigin(0.5);
        container.add(dash);
      }
    });

    // Carried rings row (selectable) — exclude rings already in a battle slot so
    // the player only sees spare carried rings available for assignment.
    const slottedIds = new Set(Object.values(this.manageLoadout).filter(Boolean) as string[]);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    // EPIC #378 — spare_ring_max from /api/me (per-player, server-computed). When
    // at/above max, the spare row is greyed-out and non-interactive; the server
    // enforces the cap with 400 too. A WON ring in overflow means usedSpares can
    // equal spare_ring_max+1 — the grid still renders but shows full.
    const spareCapacity = this.managePlayer?.spare_ring_max ?? 0;
    const usedSpares = availableRings.length;
    const spareFull = usedSpares >= spareCapacity && spareCapacity >= 0;

    // #348 — spare grid is 5 cols × 2 rows, both rows always visible (≤10 cells).
    // Label sits above the grid; the warning line (when full) tucks beside it so the
    // two fixed grid rows never shift. Discard now goes through the DISCARD slot, so
    // there is no per-card × here.
    const SPARE_COLS = 5;
    const SPARE_COL_X = [332, 422, 512, 602, 692];
    // Spare rows at [382, 470] — the TOP row is shifted up 8px (from 390) to open an
    // 8px buffer between the two visible grid rows; the BOTTOM row is unchanged (470).
    // Top row spans 342–422, bottom row spans 430–510 → an 8px gap (422→430).
    // The whole top cluster (carried-ring rows, spare header) shifts up 8px with it;
    // the bottom row, recharge section, and panel bottom (y=559, PANEL_H=515) stay fixed.
    // With label at 326 (382−56) and recharge at 526 (470+56): spare label bottom (340)
    // → row-0 card top (342): 2px; row-1 card bottom (510) → recharge top (526): 16px.
    const SPARE_ROW_Y = [382, 470];
    const SPARE_ROW_H = 80;
    const spareLabelText = `Spare: ${usedSpares} / ${spareCapacity} — select to assign, or click two slots to swap`;
    const spareLabelColor = spareFull ? '#ff8888' : '#aaccff';
    // Spare label y=326 (SPARE_ROW_Y[0]−56); 12px font → half-height≈14px → bottom≈340; card-0 top=342; clearance≈2px.
    // #363 — the spare-section HEADER is a static, screen-fixed, non-interactive
    // label → DOM (crisp). Tracked in this.domLabels for cleanup; not a container child.
    this.domLabels.push(
      addDomLabel(this.scene, CANVAS_W / 2, SPARE_ROW_Y[0] - 56, spareLabelText, {
        fontPx: 12,
        color: spareLabelColor,
        align: 'center',
      }),
    );

    // Spare cards sub-container — visibility-windowed (kept for the >10 fallback).
    const spareContainer = this.scene.add.container(0, 0);
    container.add(spareContainer);
    // Per-row group containers toggled by updateSpareVisibility() (only used when a
    // spareCapacity > 10 forces more than the 2 always-visible rows).
    const spareRowGroups: Map<number, Phaser.GameObjects.Container[]> = new Map();
    // #350 — pre-compute whether an empty spare placeholder should be interactive.
    // EPIC #378 — the WON ring is now in_carry=1 (in manageRings). A pending ring
    // is identified by this.pendingRingId (server-authoritative). Battle-slot and
    // heart selections are identified by selFromSlot.
    // Spare-selected or nothing-selected → no-op (isActionable = false).
    const _emptySelId = this.selRingId;
    const _emptySelSlot = this.selFromSlot;
    // isHoldingPending: selection source is 'spare' (selFromSlot===null) AND the id
    // matches the pending WON ring (which IS in manageRings since it is in_carry=1).
    const _isHoldingPending =
      _emptySelId !== null &&
      _emptySelSlot === null &&
      _emptySelId === this.pendingRingId;
    const _isBattleSlotSel = _emptySelId !== null && _emptySelSlot !== null && _emptySelSlot !== HEART_SLOT;
    const _isHeartSel = _emptySelSlot === HEART_SLOT;
    const emptySpareActionable = _isBattleSlotSel || _isHeartSel || _isHoldingPending;
    const emptySpareSelId = _emptySelId;
    const emptySpareSelSlot = _emptySelSlot;

    // Render filled spare cards, then dim placeholders up to spareCapacity so the
    // grid reads complete (5×2). Capacity normally ≤ 10 → exactly the 2 visible rows.
    const gridCells = Math.max(usedSpares, Math.min(spareCapacity, SPARE_COLS * SPARE_ROW_Y.length));
    for (let i = 0; i < Math.max(gridCells, usedSpares); i++) {
      const col = i % SPARE_COLS;
      const row = Math.floor(i / SPARE_COLS);
      const rx = SPARE_COL_X[col];
      // Rows 0/1 use the fixed y; any overflow row (capacity > 10) extends downward
      // off the always-visible window and is reachable only via the wheel fallback.
      const ry = row < SPARE_ROW_Y.length ? SPARE_ROW_Y[row] : SPARE_ROW_Y[1] + (row - 1) * SPARE_ROW_H;
      const ring = availableRings[i];
      const ringGrp = this.scene.add.container(rx, ry);

      if (ring) {
        const selected = this.selRingId === ring.id && this.selFromSlot === null;
        const cardAlpha = (spareFull && !emptySpareActionable) ? 0.45 : 1;
        const rect = this.scene.add
          .rectangle(0, 0, 72, 80, ELEMENT_COLORS[ring.element] ?? 0x444444)
          .setScrollFactor(0)
          .setStrokeStyle(selected ? 3 : 2, selected ? 0xffff00 : 0x888888)
          .setAlpha(cardAlpha)
          .setInteractive({ useHandCursor: !spareFull || emptySpareActionable })
          .on('pointerdown', () => {
            const selSlot = this.selFromSlot;
            const selId = this.selRingId;
            if (selSlot === HEART_SLOT) {
              // #305 — heart selected, then a spare: equip this spare into the heart
              // slot, releasing the old heart ring to spare.
              void this.equipHeartFromSpare(ring.id);
            } else if (selSlot !== null && selId !== null) {
              void this.swapSlotWithSpare(selSlot, selId, ring.id);
            } else if (selId !== null && selSlot === null && selId === this.pendingRingId) {
              // EPIC #378 — WON ring selected, then a filled spare card clicked.
              // Both are spare rings already — no positional swap is needed (the
              // spare grid has no fixed positions). The WON ring is in_carry=1 and
              // pending; clicking another spare card is a no-op. Deselect.
              this.swap.clear();
              this.renderManageModal();
            } else {
              if (selected) { this.swap.clear(); } else { this.swap.select(ring.id, 'spare'); }
              this.renderManageModal();
            }
          });
        ringGrp.add(rect);

        const pips = usePips(ring.current_uses, ring.max_uses);
        // #364 — per-card labels live inside the scrolling/masked spareContainer →
        // DOM-ineligible (DOM cannot be clipped by a Phaser mask). crispCanvasText
        // keeps them smooth on fractional DPI — the accepted canvas-text ceiling.
        ringGrp.add([
          crispCanvasText(this.scene.add.text(0, -22, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' })).setScrollFactor(0).setOrigin(0.5),
          crispCanvasText(this.scene.add.text(0, -6, pips, { fontSize: '10px', color: '#000000' })).setScrollFactor(0).setOrigin(0.5),
          crispCanvasText(this.scene.add.text(0, 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' })).setScrollFactor(0).setOrigin(0.5),
          crispCanvasText(this.scene.add.text(0, 24, `T${ring.tier}`, { fontSize: '9px', color: '#000000' })).setScrollFactor(0).setOrigin(0.5),
        ]);
      } else {
        // #350 — empty spare placeholder: interactive when a battle-slot ring,
        // heart ring, or pending won ring is held, so the player can unstake /
        // release it to the spare pool. Spare-selected or nothing-selected → no-op.
        const ph = this.scene.add
          .rectangle(0, 0, 72, 80, 0x2a2a33)
          .setScrollFactor(0)
          .setStrokeStyle(2, emptySpareActionable ? 0x665544 : 0x444455)
          .setAlpha(emptySpareActionable ? 0.7 : 0.5);
        if (emptySpareActionable) {
          ph.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
            void this.moveHeldRingToSpare(emptySpareSelId!, emptySpareSelSlot);
          });
        }
        ringGrp.add(ph);
      }

      spareContainer.add(ringGrp);
      if (!spareRowGroups.has(row)) spareRowGroups.set(row, []);
      spareRowGroups.get(row)!.push(ringGrp);
    }

    // Both rows of the 5×2 grid are always visible. The wheel handler is retained
    // ONLY as a fallback for the rare spareCapacity > 10 case; otherwise a no-op.
    const totalRows = Math.max(1, Math.ceil(Math.max(gridCells, usedSpares) / SPARE_COLS));
    const VISIBLE_ROWS = SPARE_ROW_Y.length; // 2
    const updateSpareVisibility = (): void => {
      spareRowGroups.forEach((grps, row) => {
        const visible = row >= this.spareScrollRow && row < this.spareScrollRow + VISIBLE_ROWS;
        grps.forEach((g) => g.setVisible(visible));
      });
      spareContainer.y = -this.spareScrollRow * SPARE_ROW_H;
    };
    updateSpareVisibility();

    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    if (totalRows > VISIBLE_ROWS) {
      const hint = this.scene.add
        .text(CANVAS_W / 2, SPARE_ROW_Y[1] + 48, '▼ scroll', {
          fontSize: '11px', color: '#556677',
        })
        .setScrollFactor(0)
        .setOrigin(0.5, 0);
      container.add(hint);
      this.spareWheelHandler = (_p: unknown, _g: unknown, _dx: number, dy: number) => {
        const maxRow = Math.max(0, totalRows - VISIBLE_ROWS);
        this.spareScrollRow = Phaser.Math.Clamp(this.spareScrollRow + (dy > 0 ? 1 : -1), 0, maxRow);
        updateSpareVisibility();
      };
      this.scene.input.on('wheel', this.spareWheelHandler);
    }

    // ── Recharge controls (spirit-powered, mirrors Sanctum) ──────────────────
    // #356 — rechargeY offset increased to +56 (from +40) to clear row-1 card bottom.
    // At y=526, recharge buttons sit 16px below row-1 card bottom (510). Status echo
    // at +16 = 542, giving 17px clearance to panel bottom (559).
    const rechargeY = SPARE_ROW_Y[1] + 56;
    const rechargeBtn = this.scene.add
      .text(CANVAS_W / 2 - 100, rechargeY, '[Recharge]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeSelected());
    const rechargeAllBtn = this.scene.add
      .text(CANVAS_W / 2 + 60, rechargeY, '[Recharge All]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeAll());
    this.manageStatusText = this.scene.add
      .text(CANVAS_W / 2, rechargeY + 16, '', { fontSize: '11px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add([rechargeBtn, rechargeAllBtn, this.manageStatusText]);

    this.manageModal = container;
    // #137 — let a zoomed dual-camera host route this freshly-built container to
    // its UI camera (cameras.main.ignore) so the overlay renders at 1:1, not 2×.
    this.onModalRender?.(container);

    // #87 Part D — re-expose the discard hook the original inlined EncounterScene
    // modal published (tests/e2e/carry.spec.ts calls window.__encounterDiscardRing).
    // The lambda captures `this`, so it routes to this overlay's private discard.
    window.__encounterDiscardRing = (ringId: string): void => void this.discardCarriedRing(ringId);
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
   * #305 / #348 — render the dedicated Heart-slot card (HP, group-2 row-1). The
   * equipped heart ring shows the standard element + HP-pip info; an empty slot
   * shows a grayed-out ♥ placeholder. Discard routes through the DISCARD slot's
   * 3-step confirm (#348), so the card no longer carries an × button. It participates
   * in the existing select-then-click system via the {@link HEART_SLOT} sentinel:
   *  - heart selected + [Recharge] → POST /api/spirit/recharge (heart ring id)
   *  - heart selected + click spare/battle slot (or the reverse) → PUT /api/heart-slot
   * An EMPTY heart slot means 0 HP = cannot duel (#304 guard); it can still receive
   * a spare/battle ring (select the other card, then click here).
   */
  private renderHeartCard(container: Phaser.GameObjects.Container, cx: number, cy: number): void {
    const heart = this.heartRing;
    const selected = this.selFromSlot === HEART_SLOT;
    const color = heart ? ELEMENT_COLORS[heart.element] ?? 0x333333 : 0x2a2a33;
    const rect = this.scene.add
      .rectangle(cx, cy, 92, 80, color)
      .setScrollFactor(0)
      .setStrokeStyle(selected ? 3 : 2, selected ? 0xffff00 : 0x888888)
      .setAlpha(heart ? 1 : 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onHeartCardClick());
    // #347/#348/#352 — the heart card label shows ♥ cur/max (equipped) or ♥ 0/0
    // (empty). Discard now routes through the DISCARD slot's 3-step confirm, so
    // there is no per-card × here. Uses addCardLabel for dark backing rect (#352).
    container.add(rect);
    const hpText = heart ? `♥ ${heart.current_uses}/${heart.max_uses}` : '♥ 0/0';
    this.addCardLabel(container, cx, cy - 34, hpText, {
      fontSize: '11px',
      color: heart ? '#ff99aa' : '#777777',
    });

    if (heart) {
      this.addRingInfo(container, cx, cy, heart);
    } else {
      const placeholder = this.scene.add
        .text(cx, cy, '♥\nempty\n0 HP', {
          fontSize: '10px',
          color: '#777777',
          align: 'center',
          lineSpacing: 1,
        })
        .setScrollFactor(0)
        .setOrigin(0.5);
      container.add(placeholder);
    }

    // #305 — E2E hook: the heart card's display state, read by the spec to assert
    // pips heal on recharge and the empty placeholder shows when the slot is clear.
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
   * Render the 4-line ring info (element name, use pips, XP, tier) centred at
   * (cx, cy) and add the labels to `container`. Mirrors the Sanctum's InventoryGrid
   * tile so stats read identically across screens.
   */
  private addRingInfo(
    container: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    ring: RingData,
  ): void {
    const pips = usePips(ring.current_uses, ring.max_uses);
    // #364 — these labels are container-bound (depth-interleaved with card rects)
    // → DOM-ineligible. crispCanvasText keeps them smooth on fractional DPI.
    const nameLbl = crispCanvasText(
      this.scene.add.text(cx, cy - 22, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' }),
    )
      .setScrollFactor(0)
      .setOrigin(0.5);
    const pipsLbl = crispCanvasText(
      this.scene.add.text(cx, cy - 6, pips, { fontSize: '10px', color: '#000000' }),
    )
      .setScrollFactor(0)
      .setOrigin(0.5);
    const xpLbl = crispCanvasText(
      this.scene.add.text(cx, cy + 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' }),
    )
      .setScrollFactor(0)
      .setOrigin(0.5);
    const tierLbl = crispCanvasText(
      this.scene.add.text(cx, cy + 24, `T${ring.tier}`, { fontSize: '9px', color: '#000000' }),
    )
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add([nameLbl, pipsLbl, xpLbl, tierLbl]);
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
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    this.spareScrollRow = 0;
    // #348 — tear down the discard confirm modal if it is open.
    this.dismissDiscardConfirm();
    // #305 — tear down the Thumb-passive hover tooltip before the modal is gone.
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach();
      this.thumbTooltipDetach = null;
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
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    this.dismissDiscardConfirm(); // #348
    if (this.thumbTooltipDetach) {
      this.thumbTooltipDetach(); // #305
      this.thumbTooltipDetach = null;
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
    delete window.__encounterDiscardRing;
  }
}
