import Phaser from 'phaser';
import { SLOT_KEYS, CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../../Constants';
import type { SlotKey } from '../../Constants';
import { InventoryGrid, type RingData, GRID_CARD_W, GRID_COL_GAP, GRID_ROW_GAP } from '../InventoryGrid';
import { RingCard } from './RingCard';
import { CLOSE_GLYPH } from './ModalShell';
import { SlotSwapManager, type SwapSlot } from './SlotSwapManager';
import { addDomLabel, crispCanvasText } from './DomLabel';
import { BenchHealthCombat } from './BenchHealthCombat';
import type { BenchHealthCombatMe } from './BenchHealthCombat';
import {
  isFusion,
  isFusionEligibleParent,
  fusionOf,
  fusionParents,
} from '../../../../shared/fusions';
import { FusedCardFill } from '../fusedFill';
import {
  type RingMgmtMode,
  benchSpareCount,
  publishRingMgmtState,
  clearRingMgmtState,
} from './RingManagementOverlay';

/**
 * #395 — Phaser overlay class for the unified ring-management UI.
 *
 * Pure helpers (benchSpareCount, COLUMN_LABELS, publishRingMgmtState, etc.) live in
 * `RingManagementOverlay.ts` (no Phaser) so unit tests can import them without
 * triggering a browser environment. This class file is Phaser-only and is imported
 * by adapters (`BattleHandOverlay`, `CampScene`) that already depend on Phaser.
 */

/** 760×500 frame, matching the #384 field overlay. */
const MODAL_W = 760;
const MODAL_H = 500;
const MODAL_TOP = CANVAS_H / 2 - MODAL_H / 2;   // 38 at 576 canvas


/** Data passed to `open()` / `refresh()` — mirrors a /api/me payload. */
export interface OverlayData {
  player: {
    spirit_current?: number; spirit_max?: number; aggregate_xp?: number;
    carry_cap?: number; spare_ring_max?: number;
    heart_ring?: RingData | null;
    pending_ring_id?: string | null;
  } | null;
  rings: RingData[];
  loadout: Record<string, string | null>;
}

/** Host-supplied callbacks injected into the overlay at construction time. */
export interface RingManagementOverlayOpts {
  /**
   * Resolve a single swap move. The overlay passes `self` for context (e.g. to
   * call `self.clearSelection()` after the round-trip). Must call
   * `self.refresh(newData)` when done to re-render.
   */
  resolveMove: (
    ringId: string,
    from: SwapSlot,
    to: SwapSlot,
    overlay: RingManagementOverlay,
  ) => Promise<boolean>;

  /** Called when `[RECHARGE]` is clicked. */
  onRecharge: (overlay: RingManagementOverlay) => void;

  /**
   * Render the left column into the container. Only called for sanctum mode (field
   * renders its own fixed left column; fusion is Sub-B).
   */
  renderLeft?: (container: Phaser.GameObjects.Container) => void;

  /** Lazy thumb-passive tooltip text. */
  getThumbTooltip?: () => string;

  /** HEALTH or COMBAT slot card clicked — adapter handles swap routing. */
  onSlotClick?: (slot: 'heart' | SlotKey, overlay: RingManagementOverlay) => void;

  /** DISCARD slot clicked (all modes — BHC now owns it). */
  onDiscardSlotClick?: (overlay: RingManagementOverlay) => void;

  /** Bench ghost placeholder clicked (#423 — always-visible ghost cell). */
  onBenchGhostClick?: (overlay: RingManagementOverlay) => void;

  /**
   * Bench grid card selected (field and sanctum modes — adapter routes swaps).
   * Replaces the old `onSpareGridSelect`.
   */
  onBenchGridSelect?: (ring: RingData | null, overlay: RingManagementOverlay) => void;

  /**
   * Called with the freshly-built container after each render. Used by dual-camera
   * hosts to route the container to the UI camera.
   */
  onRender?: (container: Phaser.GameObjects.Container) => void;

  /**
   * Called when the overlay has a status message to surface (e.g. a network error
   * or validation rejection). The adapter decides how to display it.
   */
  onStatus?: (msg: string) => void;

  /**
   * Called just before the overlay container is destroyed, while it is still alive.
   * Use this to remove any adopted (externally-owned) children from the container so
   * `destroy(true)` does not take them with it (e.g. CampScene's `sanctumGrid`).
   */
  onBeforeDestroy?: (container: Phaser.GameObjects.Container) => void;

  // ── Fusion-mode opts (Sub-B / #396) ─────────────────────────────────────────

  /**
   * Called when `[FUSE]` is clicked with the two chosen parent ring ids.  The
   * adapter should POST /api/fusion/combine, then call `overlay.refresh(newData)`
   * on success or `overlay.setStatusMessage(msg)` on failure.
   */
  onFuse?: (ringId1: string, ringId2: string, overlay: RingManagementOverlay) => Promise<void>;

  /**
   * Fusion mode: when provided only the recipe whose RESULT element equals this
   * value is offered in the FUSE column (Shrine Fusion pre-filter, #231).
   * Omitted → all recipes.
   */
  filterElement?: number;
}

/**
 * Promoted real overlay class (#395). Owns the 760×500 modal frame, instantiates
 * the shared `BenchHealthCombat` right half, renders the pluggable left column per
 * mode, and owns the single unified `SlotSwapManager`.
 *
 * Pure adapters (`BattleHandOverlay`, `CampScene.openRingwallOverlay`) wrap this.
 */
export class RingManagementOverlay {
  readonly mode: RingMgmtMode;
  private readonly scene: Phaser.Scene;

  /** Root container (backdrop + panel + content). Null when closed. */
  private container: Phaser.GameObjects.Container | null = null;
  /** Shared right-half component. */
  private bhc: BenchHealthCombat | null = null;
  /** DOM chrome labels (title, column headers). Destroyed on close. */
  private domLabels: Phaser.GameObjects.DOMElement[] = [];
  /** Status text (errors). */
  private statusText: Phaser.GameObjects.Text | null = null;
  /** Fired when the overlay closes. */
  private onCloseCb?: () => void;

  // ── Field-mode data ───────────────────────────────────────────────────────
  private allRings: RingData[] = [];
  private manageRings: RingData[] = [];
  private heartRing: RingData | null = null;
  private manageLoadout: Record<string, string | null> = {};
  private pendingRingId: string | null = null;
  private managePlayer: {
    spirit_current?: number; spirit_max?: number;
    aggregate_xp?: number; carry_cap?: number; spare_ring_max?: number;
  } | null = null;

  // ── Fusion-mode state (#396) ──────────────────────────────────────────────
  /** First parent ring selected for fusion (assigned on first bench click). */
  private fuseParent1: RingData | null = null;
  /** Second parent ring selected for fusion (assigned on second bench click). */
  private fuseParent2: RingData | null = null;

  /** The unified swap controller (one instance per open overlay). */
  private readonly swap: SlotSwapManager;

  /**
   * Callbacks injected by the field/sanctum adapters for left-column + server ops.
   */
  private readonly opts: RingManagementOverlayOpts;

  constructor(scene: Phaser.Scene, mode: RingMgmtMode, opts: RingManagementOverlayOpts) {
    this.scene = scene;
    this.mode = mode;
    this.opts = opts;

    const validSlots: SwapSlot[] =
      mode === 'field'
        ? ['spare', 'thumb', 'heart', 'a1', 'a2', 'd1', 'd2']
        : ['reliquary', 'spare', 'thumb', 'heart', 'a1', 'a2', 'd1', 'd2'];

    this.swap = new SlotSwapManager({
      validSlots,
      resolveMove: (ringId, from, to) => this.opts.resolveMove(ringId, from, to, this),
      onAfter: () => { /* resolveMove already reloads */ },
    });
  }

  /** Build and show the overlay. */
  open(data: OverlayData, onClose?: () => void): void {
    if (this.container) return;
    if (onClose) this.onCloseCb = onClose;
    this.storeData(data);
    this.render();
  }

  /** Close and destroy the overlay. */
  close(): void {
    this.teardown(true);
  }

  isOpen(): boolean {
    return this.container !== null;
  }

  /** Update data and re-render in place (called after each mutation). */
  refresh(data: OverlayData): void {
    if (!this.container) return;
    this.storeData(data);
    this.render();
  }

  /** Current swap selection (for adapters that need to inspect it). */
  get selection(): { ringId: string; source: SwapSlot } | null {
    return this.swap.selection;
  }

  /** Programmatic select (used by sanctum E2E hook). */
  selectRing(ringId: string, source: SwapSlot): void {
    this.swap.select(ringId, source);
  }

  /** Programmatic moveTo (used by sanctum E2E hook). */
  async moveRingTo(target: SwapSlot): Promise<void> {
    await this.swap.moveTo(target);
  }

  clearSelection(): void {
    this.swap.clear();
  }

  getContainer(): Phaser.GameObjects.Container | null {
    return this.container;
  }

  /**
   * E2E bridge — exposes the swap controller so Playwright scripts can drive
   * selections without mocking the full UI interaction. Matches the pre-#395
   * `battleHand.swap` access pattern (TypeScript `private` is JS-runtime-transparent).
   */
  getSwap(): SlotSwapManager {
    return this.swap;
  }

  /**
   * E2E bridge — exposes the bench InventoryGrid for all modes. Delegates to
   * BHC's bench grid (single source of truth after #413 consolidation). Null
   * when the overlay is closed. Matches pre-#395 `battleHand.spareGrid` contract.
   */
  getSpareGrid(): InventoryGrid | null {
    return this.bhc?.getBenchGrid() ?? null;
  }

  /**
   * E2E bridge — exposes the BenchHealthCombat's bench InventoryGrid (sanctum mode).
   * Null in field mode or when the overlay is closed. Used by `__campLoadoutScroll`.
   */
  getBenchGrid(): InventoryGrid | null {
    return this.bhc?.getBenchGrid() ?? null;
  }

  /**
   * Rebuild only the BenchHealthCombat right half with new data, without re-running
   * `renderLeft`. Used by CampScene's `renderReliquaryHeader` to keep BENCH / HEALTH
   * / COMBAT columns in sync after each swap without full overlay re-render.
   */
  refreshBhc(data: OverlayData): void {
    if (!this.bhc || !this.container) return;
    this.storeData(data);
    const me: BenchHealthCombatMe = {
      player: {
        spare_ring_max: this.managePlayer?.spare_ring_max,
        pending_ring_id: this.pendingRingId,
        heart_ring: this.heartRing ?? null,
      },
      rings: this.allRings,
      loadout: this.manageLoadout,
    };
    const selRingIdBhc =
      this.swap.selection?.source === 'spare' ? (this.swap.selection.ringId ?? null) : null;
    this.bhc.build(me, this.swap.selection?.source ?? null, selRingIdBhc);
    const spareMax = this.managePlayer?.spare_ring_max ?? 0;
    const benchN = benchSpareCount(this.allRings, this.manageLoadout, this.pendingRingId);
    publishRingMgmtState(
      this.mode,
      { bench: { n: benchN, max: spareMax } },
      this.container,
    );
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private storeData(data: OverlayData): void {
    this.allRings = data.rings;
    this.manageRings = data.rings.filter((r) => r.in_carry === 1);
    this.heartRing = data.player?.heart_ring ?? null;
    this.manageLoadout = data.loadout ?? {};
    this.pendingRingId = data.player?.pending_ring_id ?? null;
    this.managePlayer = data.player;
  }

  private render(): void {
    // Teardown any existing modal (re-render path).
    this.teardown(false /* don't fire close callback */);

    const c = this.scene.add.container(0, 0).setDepth(2000);
    // Field mode: no LOOT column — panel narrows from 760 to 560px, right-aligned
    // to the same right edge as the 760-wide panel: CANVAS_W/2 + MODAL_W/2 = 892.
    // panelCenterX = 512 + (760-560)/2 = 612; right edge = 612 + 560/2 = 892 ✓
    const MODAL_W_FIELD = 560;
    const modalW = this.mode === 'field' ? MODAL_W_FIELD : MODAL_W;
    const panelCenterX = this.mode === 'field'
      ? CANVAS_W / 2 + (MODAL_W - MODAL_W_FIELD) / 2
      : CANVAS_W / 2;

    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.scene.add
      .rectangle(panelCenterX, CANVAS_H / 2, modalW, MODAL_H, 0x222233)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xffcc88);

    // Title (DOM — crisp).
    const titleText =
      this.mode === 'sanctum'
        ? 'Reliquary'
        : this.mode === 'fusion'
          ? 'Fuse Rings'
          : 'Manage Battle Rings';
    this.domLabels.push(
      addDomLabel(this.scene, panelCenterX, MODAL_TOP + 16, titleText, {
        fontPx: 18,
        color: '#ffffff',
        align: 'center',
      }),
    );

    // Close button (canvas — interactive).
    // Sanctum mode uses '[×]' so the reliquary-modal E2E harness can locate it by
    // text (`kids.find((o) => o.text === '[×]')`). Field/fusion keep CLOSE_GLYPH.
    const closeBtnText = this.mode === 'sanctum' ? '[×]' : CLOSE_GLYPH;
    const closeBtn = this.scene.add
      .text(panelCenterX + modalW / 2 - 20, MODAL_TOP + 16, closeBtnText, {
        fontSize: '18px', color: '#ff8888',
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());
    c.add([backdrop, panel, closeBtn]);

    // ── Left column ──────────────────────────────────────────────────────────
    if (this.mode === 'sanctum') {
      this.opts.renderLeft?.(c);
    } else if (this.mode === 'fusion') {
      this.renderFusionLeft(c);
    }
    // Field mode has no left column — WON/DISCARD/ghost now live in BHC.

    // ── WON/DISCARD/ghost callbacks for BHC (#423) ────────────────────────────
    // pendingWonRing is published here on CLICK only (not at render time): the
    // open-time publication that E2E waits on (carry.spec.ts) is owned by
    // EncounterScene.ts, which sets __encounterState.pendingWonRing BEFORE the
    // overlay opens. No test reads it between overlay open and WON click.
    const onWonSelect = (): void => {
      const pendingId = this.pendingRingId;
      if (!pendingId) return;
      if (this.swap.selection?.ringId === pendingId && this.swap.selection?.source === 'spare') {
        this.swap.clear();
      } else {
        this.swap.select(pendingId, 'spare');
        // Publish pendingWonRing for E2E (field mode only).
        if (window.__encounterState) {
          const pendingRing = this.allRings.find((r) => r.id === pendingId);
          if (pendingRing) {
            window.__encounterState.pendingWonRing = { ringId: pendingId, element: pendingRing.element };
          }
        }
      }
      this.rerenderIfOpen();
    };

    const onDiscardClick = (): void => this.opts.onDiscardSlotClick?.(this);
    const onBenchGhostClick = (): void => this.opts.onBenchGhostClick?.(this);

    // ── Shared right half (BenchHealthCombat) ───────────────────────────────
    // Per-mode bench-select callback wired into BHC (replaces the old no-op).
    const onBenchSelect =
      this.mode === 'fusion'
        ? (ring: RingData | null) => { if (ring) this.onFusionBenchClick(ring); }
        : (ring: RingData | null) => this.opts.onBenchGridSelect?.(ring, this);

    const bhc = new BenchHealthCombat(
      this.scene,
      () => this.opts.onRecharge(this),
      (slot) => this.onSlotClick(slot),
      () => this.opts.getThumbTooltip?.() ?? '',
      onBenchSelect,
      onWonSelect,
      onDiscardClick,
      onBenchGhostClick,
    );
    const me: BenchHealthCombatMe = {
      player: {
        spare_ring_max: this.managePlayer?.spare_ring_max,
        pending_ring_id: this.pendingRingId,
        heart_ring: this.heartRing ?? null,
      },
      rings: this.allRings,
      loadout: this.manageLoadout,
    };
    // Pass selected bench ring id so BHC can apply yellow stroke + dim inside build().
    const selRingId =
      this.swap.selection?.source === 'spare' ? (this.swap.selection.ringId ?? null) : null;
    bhc.build(me, this.swap.selection?.source ?? null, selRingId);
    c.add(bhc);
    this.bhc = bhc;

    // ♥ cur/max label with dark backing rect — added as direct children of the
    // modal container (not inside BenchHealthCombat) so the flat modal.getAll()
    // scan used by E2E can see the [hpBg, hpLbl] pair at adjacent positions.
    const HP_X = 659;
    const HP_Y = 159; // ROW_STATUS_Y(193) - LABEL_ABOVE_Y_OFFSET(34)
    const heartRing = this.heartRing;
    const hpText = heartRing
      ? `♥ ${heartRing.current_uses}/${heartRing.max_uses}`
      : '♥ 0/0';
    const hpLbl = this.scene.add
      .text(HP_X, HP_Y, hpText, {
        fontSize: '11px',
        color: heartRing ? '#cccccc' : '#777777',
      })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const hpBg = this.scene.add
      .rectangle(HP_X, HP_Y, hpLbl.width + 6, hpLbl.height + 2, 0x000000, 0.55)
      .setScrollFactor(0)
      .setOrigin(0.5);
    c.add([hpBg, hpLbl]);

    // Status text.
    const STATUS_Y = MODAL_TOP + MODAL_H - 14;
    this.statusText = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, STATUS_Y, '', { fontSize: '11px', color: '#ff8888' })
        .setScrollFactor(0)
        .setOrigin(0.5),
    );
    c.add(this.statusText);
    // #421 E2E hook — mirror the (re)built status text so Playwright can read the
    // current status without walking the scene graph. A re-render resets it to ''.
    (window as unknown as Record<string, unknown>).__ringMgmtStatus = '';

    this.container = c;
    this.opts.onRender?.(c);

    // Publish structure reporter.
    const spareMax = this.managePlayer?.spare_ring_max ?? 0;
    const benchN = benchSpareCount(this.allRings, this.manageLoadout, this.pendingRingId);
    publishRingMgmtState(
      this.mode,
      { bench: { n: benchN, max: spareMax } },
      c,
    );

    // Sanctum mode — publish the bench lock state so E2E hooks are available the
    // instant onRender fires (before CampScene's applyReliquaryLockState runs).
    // CampScene.applyReliquaryLockState will overwrite with the canonical value
    // including card-alpha updates; this seed ensures __reliquaryLocked is never
    // undefined while the overlay is open.
    if (this.mode === 'sanctum') {
      window.__reliquaryLocked = benchN >= spareMax;
    }
  }

  /**
   * Surface a status/error message in the overlay's status bar. Used by host
   * adapters for fusion rejections and (#421) rejected swap moves — field adapters
   * call this AFTER a failed-move `refresh()` (which rebuilds the modal and resets
   * the status text) so the error survives the re-render instead of being wiped.
   */
  setStatusMessage(msg: string): void {
    this.setStatus(msg);
  }

  // ── Fusion left column (#396) ─────────────────────────────────────────────

  /**
   * Geometry for the FUSE left column. Modal left edge: CANVAS_W/2 - MODAL_W/2 = 132.
   * BENCH grid starts at x=370. Two compact 50×70 parent cards fit side-by-side at ~195.
   * R1 center=165, R2 center=230, column centre≈197 (well left of BENCH at 370).
   */
  private static readonly FUSE_R1_X = 165;
  private static readonly FUSE_R2_X = 230;
  private static readonly FUSE_PARENT_Y = 210;
  private static readonly FUSE_RESULT_X = 197;
  private static readonly FUSE_RESULT_Y = 325;
  private static readonly FUSE_BTN_Y = 420;
  private static readonly FUSE_CARD_W = 50;
  private static readonly FUSE_CARD_H = 70;
  private static readonly FUSE_LABEL_OFFSET = 18;

  /**
   * Render the FUSE left column (R1, R2 parent slots, FR result, [FUSE] button).
   * Bench card clicks assign rings to R1 then R2; clicking an occupied parent
   * clears it.
   */
  private renderFusionLeft(c: Phaser.GameObjects.Container): void {
    const {
      FUSE_R1_X, FUSE_R2_X, FUSE_PARENT_Y, FUSE_RESULT_X, FUSE_RESULT_Y,
      FUSE_BTN_Y, FUSE_CARD_W, FUSE_CARD_H, FUSE_LABEL_OFFSET,
    } = RingManagementOverlay;

    // ── Column header ─────────────────────────────────────────────────────────
    this.domLabels.push(
      addDomLabel(this.scene, FUSE_RESULT_X, MODAL_TOP + 40, 'FUSE', {
        fontPx: 13, color: '#cc88ff', align: 'center',
      }),
    );

    // ── R1 slot ───────────────────────────────────────────────────────────────
    const r1 = this.fuseParent1;
    const r1Card = new RingCard(this.scene, FUSE_R1_X, FUSE_PARENT_Y, {
      width: FUSE_CARD_W, height: FUSE_CARD_H, scrollFactor: 0,
      strokeColor: r1 ? 0xffcc44 : 0x555566, strokeWidth: r1 ? 2 : 1,
    });
    if (r1) {
      r1Card.setRing({
        element: r1.element, tier: r1.tier, xp: r1.xp,
        currentUses: r1.current_uses, maxUses: r1.max_uses,
        fusionParents: r1.fusionParents,
      });
    } else {
      r1Card.clear('R1');
      r1Card.setAlpha(0.6);
    }
    r1Card.bg.setInteractive({ useHandCursor: !!r1 }).on('pointerdown', () => {
      if (this.fuseParent1) { this.fuseParent1 = null; this.rerenderIfOpen(); }
    });
    this.scene.add.existing(r1Card);
    c.add(r1Card);
    this.domLabels.push(
      addDomLabel(
        this.scene, FUSE_R1_X,
        FUSE_PARENT_Y - FUSE_CARD_H / 2 - FUSE_LABEL_OFFSET, 'R1',
        { fontPx: 10, color: '#cc88ff', align: 'center' },
      ),
    );

    // ── R2 slot ───────────────────────────────────────────────────────────────
    const r2 = this.fuseParent2;
    const r2Card = new RingCard(this.scene, FUSE_R2_X, FUSE_PARENT_Y, {
      width: FUSE_CARD_W, height: FUSE_CARD_H, scrollFactor: 0,
      strokeColor: r2 ? 0xffcc44 : 0x555566, strokeWidth: r2 ? 2 : 1,
    });
    if (r2) {
      r2Card.setRing({
        element: r2.element, tier: r2.tier, xp: r2.xp,
        currentUses: r2.current_uses, maxUses: r2.max_uses,
        fusionParents: r2.fusionParents,
      });
    } else {
      r2Card.clear('R2');
      r2Card.setAlpha(0.6);
    }
    r2Card.bg.setInteractive({ useHandCursor: !!r2 }).on('pointerdown', () => {
      if (this.fuseParent2) { this.fuseParent2 = null; this.rerenderIfOpen(); }
    });
    this.scene.add.existing(r2Card);
    c.add(r2Card);
    this.domLabels.push(
      addDomLabel(
        this.scene, FUSE_R2_X,
        FUSE_PARENT_Y - FUSE_CARD_H / 2 - FUSE_LABEL_OFFSET, 'R2',
        { fontPx: 10, color: '#cc88ff', align: 'center' },
      ),
    );

    // ── FR result slot ────────────────────────────────────────────────────────
    const { frElement, eligible } = this.computeFusionResult();

    this.domLabels.push(
      addDomLabel(
        this.scene, FUSE_RESULT_X,
        FUSE_RESULT_Y - FUSE_CARD_H / 2 - FUSE_LABEL_OFFSET, 'FR',
        { fontPx: 10, color: eligible ? '#aaffaa' : '#555566', align: 'center' },
      ),
    );

    if (r1 && r2 && eligible && frElement !== null) {
      // Both parents eligible — preview the fused result element.
      const frBg = this.scene.add
        .rectangle(FUSE_RESULT_X, FUSE_RESULT_Y, FUSE_CARD_W, FUSE_CARD_H, 0x222233)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0xaaffaa);
      c.add(frBg);
      // Two-tone FusedCardFill: (scene, container, cx, cy, w, h, scrollFactor).
      const fill = new FusedCardFill(this.scene, c, FUSE_RESULT_X, FUSE_RESULT_Y, FUSE_CARD_W, FUSE_CARD_H, 0);
      fill.paint(frElement);
      const frLabel = crispCanvasText(
        this.scene.add
          .text(FUSE_RESULT_X, FUSE_RESULT_Y, ELEMENT_NAMES[frElement] ?? '?', {
            fontSize: '9px', color: '#ffffff',
          })
          .setScrollFactor(0).setOrigin(0.5),
      );
      c.add(frLabel);
      // Publish the FR preview for window.__campFusedFills so E2E can observe it.
      if (window.__campFusedFills !== undefined) {
        window.__campFusedFills[`fr_preview_${frElement}`] = [frElement];
      }
    } else if (r1 && r2) {
      // Both set but ineligible — error state.
      const frBg = this.scene.add
        .rectangle(FUSE_RESULT_X, FUSE_RESULT_Y, FUSE_CARD_W, FUSE_CARD_H, 0x331a1a)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0xff4444);
      c.add(frBg);
      const errLabel = crispCanvasText(
        this.scene.add
          .text(FUSE_RESULT_X, FUSE_RESULT_Y, 'ineligible', {
            fontSize: '9px', color: '#ff4444',
          })
          .setScrollFactor(0).setOrigin(0.5),
      );
      c.add(errLabel);
    } else {
      // One or both slots empty — dim placeholder.
      const frPh = this.scene.add
        .rectangle(FUSE_RESULT_X, FUSE_RESULT_Y, FUSE_CARD_W, FUSE_CARD_H, 0x1a1a22)
        .setScrollFactor(0)
        .setStrokeStyle(1, 0x555566)
        .setAlpha(0.5);
      c.add(frPh);
    }

    // ── [FUSE] button ─────────────────────────────────────────────────────────
    const fuseActive = eligible && r1 !== null && r2 !== null && frElement !== null;
    const fuseBtn = crispCanvasText(
      this.scene.add
        .text(FUSE_RESULT_X, FUSE_BTN_Y, '[FUSE]', {
          fontSize: '14px',
          color: fuseActive ? '#aaffaa' : '#555566',
        })
        .setScrollFactor(0)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: fuseActive })
        .on('pointerdown', () => {
          if (!fuseActive || !r1 || !r2) return;
          void this.opts.onFuse?.(r1.id, r2.id, this);
        }),
    );
    c.add(fuseBtn);

    // ── Publish __fusionState E2E hook ────────────────────────────────────────
    // Mirrors the schema the old FusionPanel.ts published so existing E2E tests
    // (sanctum-zones.spec.ts line 203) continue to work unchanged.
    this.publishFusionState();

    // Bench card clicks for parent assignment are wired via the onBenchSelect callback
    // passed to BHC in render(). The delayedCall(0) hack is no longer needed.
  }

  /**
   * Compute the fusion result element (if any) from the current two parent rings,
   * applying the `filterElement` restriction. Returns `{ frElement, eligible }`.
   */
  private computeFusionResult(): { frElement: number | null; eligible: boolean } {
    const r1 = this.fuseParent1;
    const r2 = this.fuseParent2;
    if (!r1 || !r2) return { frElement: null, eligible: false };
    if (!isFusionEligibleParent(r1.element, r1.xp)) return { frElement: null, eligible: false };
    if (!isFusionEligibleParent(r2.element, r2.xp)) return { frElement: null, eligible: false };
    const result = fusionOf(r1.element, r2.element);
    if (result === null) return { frElement: null, eligible: false };
    const fe = this.opts.filterElement;
    if (fe !== undefined && result !== fe) return { frElement: null, eligible: false };
    return { frElement: result, eligible: true };
  }

  /**
   * Publish `window.__fusionState` so E2E tests can observe which fusion recipes
   * are currently ready (mirrors the old FusionPanel.ts hook schema).
   *
   * Schema:
   * ```
   * window.__fusionState = {
   *   recipes: Array<{
   *     parents: [elem0, elem1],
   *     result: elem,
   *     ready: boolean,
   *     parentAId: string | null,
   *     parentBId: string | null,
   *   }>
   * }
   * ```
   * A recipe is `ready` when the player's bench contains at least one
   * fusion-eligible ring of each parent element.
   */
  private publishFusionState(): void {
    // Build a map from element → highest-XP eligible ring (mirrors the old
    // FusionPanel.computeAvailability which scanned ALL player rings, not just
    // bench rings — Reliquary rings are also valid fusion parents).
    const byElement = new Map<number, RingData>();
    for (const r of this.allRings) {
      if (!isFusionEligibleParent(r.element, r.xp)) continue;
      const existing = byElement.get(r.element);
      if (!existing || r.xp > existing.xp) byElement.set(r.element, r);
    }

    // Enumerate all 10 fusion elements (5-14) and build a recipe entry for each.
    const BASE_COUNT = 5; // ElementEnum values 0-4 are the base elements
    const FUSION_COUNT = 10; // elements 5-14
    const recipes: {
      parents: [number, number];
      result: number;
      ready: boolean;
      parentAId: string | null;
      parentBId: string | null;
    }[] = [];
    for (let i = BASE_COUNT; i < BASE_COUNT + FUSION_COUNT; i++) {
      const pair = fusionParents(i);
      if (!pair) continue;
      const [ea, eb] = pair;
      const parentA = byElement.get(ea) ?? null;
      const parentB = byElement.get(eb) ?? null;
      recipes.push({
        parents: [ea, eb],
        result: i,
        ready: parentA !== null && parentB !== null,
        parentAId: parentA?.id ?? null,
        parentBId: parentB?.id ?? null,
      });
    }

    (window as unknown as Record<string, unknown>).__fusionState = { recipes };
  }

  /**
   * Returns the bench rings visible for fusion parent selection (non-fusion,
   * in-carry, not battle-slotted, not pending).
   */
  private getBenchRingsForFusion(): RingData[] {
    const battleSlotIds = new Set(
      (SLOT_KEYS as readonly string[]).map((k) => this.manageLoadout[k]).filter(Boolean) as string[],
    );
    if (this.heartRing) battleSlotIds.add(this.heartRing.id);
    if (this.pendingRingId) battleSlotIds.add(this.pendingRingId);
    return this.manageRings.filter(
      (r) => !battleSlotIds.has(r.id) && !isFusion(r.element),
    );
  }

  /**
   * Handle a bench ring click in fusion mode: assign to R1 (first empty slot) then
   * R2 (second), or replace R2 if both are occupied. Clicking an already-assigned
   * parent (via the parent card bg pointerdown) clears it; this handler assigns.
   */
  private onFusionBenchClick(ring: RingData): void {
    if (this.fuseParent1?.id === ring.id) {
      this.fuseParent1 = null;
    } else if (this.fuseParent2?.id === ring.id) {
      this.fuseParent2 = null;
    } else if (!this.fuseParent1) {
      this.fuseParent1 = ring;
    } else if (!this.fuseParent2) {
      this.fuseParent2 = ring;
    } else {
      this.fuseParent2 = ring;
    }
    this.rerenderIfOpen();
  }

  private rerenderIfOpen(): void {
    if (!this.container) return;
    this.render();
  }

  private onSlotClick(slot: 'heart' | SlotKey): void {
    this.opts.onSlotClick?.(slot, this);
  }

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.setText(msg);
    // #421 E2E hook — surface the status message for Playwright state readback
    // (reads are bridge-eligible; only gestures must use real pointer input).
    (window as unknown as Record<string, unknown>).__ringMgmtStatus = msg;
    this.opts.onStatus?.(msg);
  }

  /**
   * Clear both fusion parent selections. Called explicitly by adapters (e.g.
   * CampScene.onFuse) immediately before `ov.refresh()` on a successful fusion
   * so stale deleted-ring references do not survive the re-render.
   */
  clearFuseParents(): void {
    this.fuseParent1 = null;
    this.fuseParent2 = null;
  }

  private teardown(fireCb = false): void {
    if (this.bhc) {
      this.bhc.destroy();
      this.bhc = null;
    }
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels = [];
    if (this.container) {
      // Notify the adapter to release any externally-owned children (e.g.
      // CampScene's sanctumGrid) before the container is destroyed.
      this.opts.onBeforeDestroy?.(this.container);
      this.container.destroy(true);
      this.container = null;
    }
    this.statusText = null;
    if (fireCb) {
      // Clear fusion parent selections only on genuine close — a re-render
      // (fireCb=false) must preserve the user's R1/R2 choices between renders.
      this.fuseParent1 = null;
      this.fuseParent2 = null;
      this.swap.clear();
      clearRingMgmtState();
      // Clear the #421 status hook so tests never read a stale message after close.
      (window as unknown as Record<string, unknown>).__ringMgmtStatus = undefined;
      // Clear the fusion E2E hook so tests can detect the overlay is closed.
      if (this.mode === 'fusion') {
        (window as unknown as Record<string, unknown>).__fusionState = undefined;
      }
      const cb = this.onCloseCb;
      this.onCloseCb = undefined;
      cb?.();
    }
  }
}
