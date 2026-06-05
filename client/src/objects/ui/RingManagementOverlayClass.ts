import Phaser from 'phaser';
import { SLOT_KEYS, CANVAS_W, CANVAS_H } from '../../Constants';
import type { SlotKey } from '../../Constants';
import { InventoryGrid, type RingData } from '../InventoryGrid';
import { RingCard } from './RingCard';
import { CLOSE_GLYPH } from './ModalShell';
import { SlotSwapManager, type SwapSlot } from './SlotSwapManager';
import { addDomLabel, crispCanvasText } from './DomLabel';
import { BenchHealthCombat } from './BenchHealthCombat';
import type { BenchHealthCombatMe } from './BenchHealthCombat';
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

// Left-column geometry (LOOT / WON / DISCARD in field mode).
const COL0_X = 559;   // WON / DISCARD x-center
const ROW0_Y = 193;
const ROW1_Y = 291;
const CARD_W = 70;
const CARD_H = 90;
const LABEL_Y_ROW0 = ROW0_Y - 34;  // 159
const LABEL_Y_ROW1 = ROW1_Y - 34;  // 257

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
  ) => Promise<void>;

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

  /** DISCARD slot clicked (field mode). */
  onDiscardSlotClick?: (overlay: RingManagementOverlay) => void;

  /** Spare grid card selected (field mode — adapter routes swaps). */
  onSpareGridSelect?: (ring: RingData | null, overlay: RingManagementOverlay) => void;

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
  /** Field mode — the spare InventoryGrid (bench, scrollable). */
  private spareGrid: InventoryGrid | null = null;
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
   * E2E bridge — exposes the spare InventoryGrid (field mode). Null in sanctum mode
   * or when the overlay is closed. Matches pre-#395 `battleHand.spareGrid`.
   */
  getSpareGrid(): InventoryGrid | null {
    return this.spareGrid;
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
    this.bhc.build(me, this.swap.selection?.source ?? null);
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
    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, MODAL_W, MODAL_H, 0x222233)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xffcc88);

    // Title (DOM — crisp).
    const titleText = this.mode === 'sanctum' ? 'Reliquary' : 'Manage Battle Rings';
    this.domLabels.push(
      addDomLabel(this.scene, CANVAS_W / 2, MODAL_TOP + 16, titleText, {
        fontPx: 18,
        color: '#ffffff',
        align: 'center',
      }),
    );

    // Close button (canvas — interactive).
    const closeBtn = this.scene.add
      .text(CANVAS_W / 2 + MODAL_W / 2 - 20, MODAL_TOP + 16, CLOSE_GLYPH, {
        fontSize: '18px', color: '#ff8888',
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());
    c.add([backdrop, panel, closeBtn]);

    // ── Left column ──────────────────────────────────────────────────────────
    if (this.mode === 'field') {
      this.renderFieldLeft(c);
    } else if (this.mode === 'sanctum') {
      this.opts.renderLeft?.(c);
    }
    // fusion left column is Sub-B — skip here.

    // ── Shared right half (BenchHealthCombat) ───────────────────────────────
    const bhc = new BenchHealthCombat(
      this.scene,
      () => this.opts.onRecharge(this),
      (slot) => this.onSlotClick(slot),
      () => this.opts.getThumbTooltip?.() ?? '',
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
    bhc.build(me, this.swap.selection?.source ?? null);
    c.add(bhc);
    this.bhc = bhc;

    // Status text.
    const STATUS_Y = MODAL_TOP + MODAL_H - 14;
    this.statusText = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, STATUS_Y, '', { fontSize: '11px', color: '#ff8888' })
        .setScrollFactor(0)
        .setOrigin(0.5),
    );
    c.add(this.statusText);

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
  }

  private renderFieldLeft(c: Phaser.GameObjects.Container): void {
    const slottedIds = new Set(
      (SLOT_KEYS as readonly string[]).map((k) => this.manageLoadout[k]).filter(Boolean) as string[],
    );
    if (this.heartRing) slottedIds.add(this.heartRing.id);
    if (this.pendingRingId) slottedIds.add(this.pendingRingId);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    const spareMax = this.managePlayer?.spare_ring_max ?? 0;
    const benchFull = availableRings.length >= spareMax && spareMax >= 0;

    // WON card.
    const pendingRing = this.pendingRingId
      ? this.allRings.find((r) => r.id === this.pendingRingId)
      : undefined;
    if (pendingRing) {
      const wonSel =
        this.swap.selection?.ringId === pendingRing.id && this.swap.selection?.source === 'spare';
      const wonCard = new RingCard(this.scene, COL0_X, ROW0_Y, {
        width: CARD_W, height: CARD_H, scrollFactor: 0,
        strokeColor: wonSel ? 0xffff00 : 0xffcc44,
        strokeWidth: wonSel ? 3 : 2,
      });
      wonCard.setRing({
        element: pendingRing.element, tier: pendingRing.tier, xp: pendingRing.xp,
        currentUses: pendingRing.current_uses, maxUses: pendingRing.max_uses,
        fusionParents: pendingRing.fusionParents,
      });
      wonCard.bg
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          if (wonSel) this.swap.clear();
          else this.swap.select(pendingRing.id, 'spare');
          this.rerenderIfOpen();
        });
      this.scene.add.existing(wonCard);
      c.add(wonCard);
      this.domLabels.push(
        addDomLabel(this.scene, COL0_X, LABEL_Y_ROW0, 'WON ◆', { fontPx: 11, color: '#ffcc44', align: 'center' }),
      );
      if (window.__encounterState) {
        window.__encounterState.pendingWonRing = {
          ringId: pendingRing.id,
          element: pendingRing.element,
        };
      }
    } else {
      const ph = this.scene.add
        .rectangle(COL0_X, ROW0_Y, CARD_W, CARD_H, 0x2a2a33)
        .setScrollFactor(0)
        .setStrokeStyle(2, 0x555566)
        .setAlpha(0.5);
      c.add(ph);
    }

    // DISCARD slot.
    const discardRect = this.scene.add
      .rectangle(COL0_X, ROW1_Y, CARD_W, CARD_H, 0x331a1a, 0.4)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xaa4444)
      .setName('discard-slot')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.opts.onDiscardSlotClick?.(this));
    c.add(discardRect);
    this.domLabels.push(
      addDomLabel(this.scene, COL0_X, LABEL_Y_ROW1, 'DISCARD', { fontPx: 11, color: '#aa4444', align: 'center' }),
    );

    // Spare InventoryGrid (reused from the old BattleHandOverlay layout).
    const GRID_ORIGIN_X = 234;
    const GRID_CONTENT_TOP_Y = 148;
    const RINGWALL_VISIBLE_ROWS = 3;

    const spareGrid = new InventoryGrid(
      this.scene,
      GRID_ORIGIN_X,
      GRID_CONTENT_TOP_Y,
      (ring) => this.opts.onSpareGridSelect?.(ring, this),
      3,
    );
    spareGrid.setScrollFactor(0);
    spareGrid.populate(availableRings);
    spareGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);
    const selId = this.swap.selection?.ringId ?? null;
    const selSrc = this.swap.selection?.source ?? null;
    if (selId !== null && selSrc === 'spare') {
      const selBg = spareGrid.getCardBg(selId);
      if (selBg) selBg.setStrokeStyle(3, 0xffff00);
    }
    if (benchFull) {
      availableRings.forEach((r) => {
        const bg = spareGrid.getCardBg(r.id);
        if (bg) bg.setAlpha(0.45);
      });
    }
    this.scene.add.existing(spareGrid);
    c.add(spareGrid);
    this.spareGrid = spareGrid;
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
    this.opts.onStatus?.(msg);
  }

  private teardown(fireCb = false): void {
    if (this.bhc) {
      this.bhc.destroy();
      this.bhc = null;
    }
    if (this.spareGrid) {
      this.spareGrid.destroy();
      this.spareGrid = null;
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
      this.swap.clear();
      clearRingMgmtState();
      const cb = this.onCloseCb;
      this.onCloseCb = undefined;
      cb?.();
    }
  }
}
