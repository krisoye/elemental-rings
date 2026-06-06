import Phaser from 'phaser';
import { InventoryGrid, type RingData, GRID_CARD_W, GRID_COL_GAP, GRID_ROW_GAP } from '../objects/InventoryGrid';
import { RingCard, usePips } from '../objects/ui/RingCard';
import { attachTooltip } from '../objects/ui/Tooltip';
import { SlotSwapManager, type SwapSlot } from '../objects/ui/SlotSwapManager';
import {
  benchSpareCount,
  publishRingMgmtState,
  clearRingMgmtState,
} from '../objects/ui/RingManagementOverlay';
import {
  RingManagementOverlay,
  type OverlayData,
  type RingManagementOverlayOpts,
} from '../objects/ui/RingManagementOverlayClass';
import { DifficultyModal } from '../objects/DifficultyModal';
import { ELEMENT_NAMES, CANVAS_W, CANVAS_H, THUMB_PASSIVE_INFO, SLOT_KEYS } from '../Constants';
import { type DifficultyTier } from '../../../shared/types';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { BlinkController } from '../objects/world/BlinkController';
import { DiscardConfirm } from '../objects/ui/DiscardConfirm';
import { getTalisman } from '../../../shared/talismans';
import { FOREST_SCREENS } from '../../../shared/world/forest';
import { restAtCamp, summonSanctum as summonSanctumHelper } from '../net/campActions';
import { API_BASE, apiClient, apiFetch, fetchMe, getToken } from '../net/api';
import { DualCameraScene } from './DualCameraScene';
import { addDomLabel, crispCanvasText, setDomLabelText } from '../objects/ui/DomLabel';

// #389 — the four combat-hand loadout slots (formerly the LoadoutPanel's type).
// The Thumb (STATUS) slot is tracked separately as `'thumb' | LoadoutSlot`.
type LoadoutSlot = 'a1' | 'a2' | 'd1' | 'd2';

// #85 Fix 2A — the inventory grids in the Ring Storage overlay clip to this many
// rows; beyond that the ▲/▼ arrows + mouse wheel scroll the grid. 3 rows fit
// comfortably above the status echo without colliding with the header row.
const RINGWALL_VISIBLE_ROWS = 3;

// Reliquary modal layout. The modal is 760×500 centered at (CANVAS_W/2, CANVAS_H/2);
// content is inset 20px from the panel edges.
//
// Three-column layout:
//   Left   (x=152): RELIQUARY 3×3 scrollable grid (208px wide)
//   Middle (x=372): SPARES    3×3 scrollable grid (208px wide)
//   Right  (x=594): BATTLE HAND — Thumb row + A1/A2 + D1/D2 (right-aligned rings)
//
// #389 — COMBAT column (right): the STATUS thumb card + the 2×2 A1/A2 · D1/D2
// cluster, left-aligned to BATTLEHAND_RING_X (the former LoadoutPanel origin).
const MODAL_W = 760;
const MODAL_H = 500;
const MODAL_LEFT = CANVAS_W / 2 - MODAL_W / 2; // 132
const CONTENT_LEFT = MODAL_LEFT + 20; // 152
const CONTENT_RIGHT = CANVAS_W / 2 + MODAL_W / 2 - 20; // 872
const COL_RELIQUARY_X = CONTENT_LEFT; // 152
// COMBAT cluster left edge, right-aligned to CONTENT_RIGHT (2-col width=148).
const BATTLEHAND_RING_X = CONTENT_RIGHT - 148; // 724 — COMBAT column left edge

// #347 — Heart slot card now lives in its own HEALTH column between SPARES and
// COMBAT (it no longer sits above A1). Origin x is in the gap between the SPARES
// grid right edge (≈600) and the A1 left edge (724): the card body (centered at
// +35) renders at ≈659, spanning ≈624–694 — clear of both neighbours.
const HEART_CARD_X = 624; // HEALTH column origin
const HEART_CARD_Y = 148;
// The ♥ heart card body matches the COMBAT cell geometry (70×90, card center
// at +35 horizontally).
const HEART_CARD_W = 70;
const HEART_CARD_H = 90;

// #389 — COMBAT cluster (STATUS thumb left-aligned above the 2×2 A1/A2 · D1/D2).
// The 2×2 grid: card width 70, 78px column pitch → A1/D1 left col center 759,
// A2/D2 right col center 837; rows at y=291 (A1/A2) and y=389 (D1/D2). STATUS is
// left-aligned with the A1/D1 column (center 759), one row above at y=193.
const COMBAT_CARD_W = 70;
const COMBAT_CARD_H = 90;
const COMBAT_COL_LEFT_X = BATTLEHAND_RING_X + 35;  // 759 — A1/D1 + STATUS column
const COMBAT_COL_RIGHT_X = BATTLEHAND_RING_X + 113; // 837 — A2/D2 column
const COMBAT_STATUS_Y = 193;
const COMBAT_ROW0_Y = 291; // A1 / A2
const COMBAT_ROW1_Y = 389; // D1 / D2

// The off-screen holding origin for the reusable panel instances. The panels are
// created once and parked here while the spatial room is shown; 8A.2 re-parents
// them into modal overlay containers on demand. Far off the visible canvas.
const OFFSCREEN_X = -5000;
const OFFSCREEN_Y = -5000;

/**
 * Sanctum — the protagonist's spatial home room (GDD §10.6). A top-down,
 * tilemap-driven walkable scene: the player roams the room with WASD / arrows
 * and (8A.2) interacts with zones (bed, meditation circle, ring-storage walls,
 * campfire, exit door) to open modal panels.
 *
 * Architecture: purely presentational. Every game rule (carry cap, spirit cost,
 * ownership, fusion validity) is enforced by the server. The scene GETs /api/me
 * on load and after every mutation, and PUTs /api/carry / /api/loadout / POSTs
 * spirit & fusion routes. The data layer and every `window.__camp*` hook are
 * preserved as direct-action paths that work WITHOUT walking, keeping the
 * deterministic E2E flows (camp.spec.ts etc.) green.
 *
 * Pools (issue #40):
 *   - At Sanctum  = in_carry === 0
 *   - Loadout     = in_carry === 1 and NOT in a battle slot
 *   - Battle Hand = the 5 named slots (thumb/a1/a2/d1/d2), a subset of carry
 */
export class CampScene extends DualCameraScene {
  // ── Spatial engine state ──────────────────────────────────────────────────
  private player!: Player;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  // ── Dual-camera split (#118) ──────────────────────────────────────────────
  // uiCam (zoom 1, no follow) + uiRoot (depth-4000 HUD container ignored by
  // cameras.main once) are provided by DualCameraScene. The "Settings" button and
  // the transient teleport confirm toast live in uiRoot so they render at a fixed
  // 1:1 while the world zooms 2×. Modal overlays do NOT live in uiRoot: they stay
  // at the scene root (preserving E2E traversal depth) and are routed to uiCam via
  // routeToUi() per-container in beginModalOverlay().

  // ── Interaction zones + modal overlays (8A.2) ─────────────────────────────
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  /**
   * Set when the player's body first overlaps the door zone. Prevents the auto-exit
   * timer from being scheduled more than once per Sanctum visit.
   */
  private leavingViaDoor = false;
  /**
   * Set the instant routeToBiome() is invoked (from either the 500ms auto-exit timer
   * OR the E-press / __sanctumInteract path). Guards against double-fire when both
   * paths are active simultaneously.
   */
  private doorTransitionStarted = false;
  /** The currently-open modal overlay container, or null. */
  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayName: string | null = null;
  /** Callback run when the overlay closes (re-parks adopted panels off-screen). */
  private overlayOnClose: (() => void) | null = null;
  /** #87 Part A — double-click-to-blink controller (onto interaction zones). */
  private blink: BlinkController | null = null;

  // ── Reusable inventory panels (parked off-screen, shown in overlays) ───────
  private sanctumGrid!: InventoryGrid;
  private loadoutGrid!: InventoryGrid;
  /** #396 — fusion overlay (replaces standalone FusionPanel; null when closed). */
  private fusionOverlay: RingManagementOverlay | null = null;
  // EPIC #279 — Settings → difficulty selector. Self-contained modal (FusionPanel
  // lifecycle shape); opened by the persistent Settings button on uiRoot.
  private difficultyModal!: DifficultyModal;
  private ringMap: Map<string, RingData> = new Map();
  private loadoutHeaderText!: Phaser.GameObjects.Text;
  private statLineText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  // ── Reliquary modal (#154) — live header + click-then-click selection ──────
  /**
   * EPIC #302 — the three live stats header segments that replace the old single
   * centered string. Left: `Spirit: cur/max [Tier]`; Center: `♥ cur/max` for the
   * equipped heart ring; Right (right-aligned to CONTENT_RIGHT): `Total XP | Avg
   * Battle XP`. All overlay-container-scoped — the container destroy reclaims them
   * on close, so the references are simply dropped. Re-rendered from the
   * authoritative `window.__campState` after every move.
   */
  private reliquaryHeaderLeft: Phaser.GameObjects.Text | null = null;
  private reliquaryHeaderCenter: Phaser.GameObjects.Text | null = null;
  private reliquaryHeaderRight: Phaser.GameObjects.Text | null = null;
  /**
   * EPIC #302 / #347 — the Heart-slot card (in the HEALTH column). A {@link RingCard}
   * that participates in the click-then-click selection system as the `'heart'`
   * source and target. Overlay-container-scoped: created on open, dropped on close.
   */
  private heartCard: RingCard | null = null;
  /**
   * EPIC #302 — the detach handle for the Thumb passive hover tooltip. Replaces
   * the permanent passive strip; called in the overlay's onClose callback.
   */
  private thumbTooltipDetach: (() => void) | null = null;
  /**
   * #426 — the DOM SPIRIT header label that replaces the old canvas `reliquary-label`
   * + `spirit-counter` pair. NOT a child of the overlay container — tracked manually
   * and destroyed in onBeforeDestroy / nulled in onClose (same pattern as BHC domLabels).
   */
  private spiritHeader: Phaser.GameObjects.DOMElement | null = null;
  /**
   * #389 — the COMBAT cluster cards (STATUS thumb + A1/A2/D1/D2), built fresh per
   * overlay open and added to the overlay container (reclaimed on close), replacing
   * the retired StakePanel + LoadoutPanel. Each card's bg routes clicks through the
   * universal-swap state machine via {@link onBattleSlotClicked}.
   */
  private combatCards: Map<'thumb' | LoadoutSlot, RingCard> = new Map();
  /** #389 — the STATUS card's escrow LOCKED label (preserved from StakePanel). */
  private statusLockLabel: Phaser.GameObjects.Text | null = null;
  /**
   * EPIC #291 WS I (#307) — the shared click-then-click swap state machine. Holds
   * the current "picked up" selection ({@link SlotSwapManager.selection}) and
   * orchestrates a move when a target slot is clicked. Its `resolveMove` delegates
   * to {@link reliquaryMove} (the same PUT /api/carry|loadout|heart-slot calls as
   * before); `onAfter` reloads /api/me and re-renders the header. Built lazily on
   * first use so `this` is available. The Reliquary and Spare sources are the
   * InventoryGrids (their own selection stroke shows); a battle-slot source
   * (thumb/a1/a2/d1/d2) highlights that slot card; 'heart' paints the Heart card
   * stroke. Cleared after every completed move and on overlay close.
   */
  private swapManager: SlotSwapManager | null = null;
  /** #395 — the unified overlay class instance while the ringwall overlay is open. */
  private sanctumOverlay: RingManagementOverlay | null = null;
  /** #423 — shared discard-confirm dialog for the sanctum DISCARD slot. */
  private sanctumDiscard_: DiscardConfirm | null = null;
  // #78 ④ — last-computed Thumb passive reminder (recomputed every refreshPools),
  // mirrored into __campState and surfaced as the Thumb hover tooltip (EPIC #302).
  private stakedPassive: { name: string | null; effect: string } | null = null;

  // Cached snapshot of the last /api/me load.
  private rings: RingData[] = [];
  private loadout: Record<string, string | null> = {};
  private carryCap = 10;

  constructor() {
    super({ key: 'CampScene' });
  }

  preload(): void {
    Player.preload(this);
    this.load.image('cozy-furniture', 'assets/interiors/interior_cozy_furniture.png');
    this.load.image('cozy-ceiling', 'assets/interiors/interior_cozy_ceiling.png');
    this.load.image('cozy-floor', 'assets/interiors/interior_cozy_floor.png');
    this.load.image('cozy-wallfloor', 'assets/interiors/interior_cozy_walls.png');
    this.load.tilemapTiledJSON('sanctum', 'assets/maps/sanctum.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'CampScene';
    // Scene instance is reused across re-entries — reset per-create flags.
    this.leavingViaDoor = false;
    this.doorTransitionStarted = false;

    // ── Build the Sanctum room from the Tiled map ─────────────────────────
    const map = this.make.tilemap({ key: 'sanctum' });
    const tsFurniture = map.addTilesetImage('spr_tile_cozy_indoor_furniture', 'cozy-furniture')!;
    const tsCeiling = map.addTilesetImage('spr_tile_cozy_indoor_ceiling_auto_3x3', 'cozy-ceiling')!;
    const tsFloor = map.addTilesetImage('spr_tile_cozy_indoor_floor_auto_2x2', 'cozy-floor')!;
    const tsWallFloor = map.addTilesetImage('spr_tile_cozy_indoor_wall_floor', 'cozy-wallfloor')!;
    const allTilesets = [tsFurniture, tsCeiling, tsFloor, tsWallFloor];

    this.groundLayer = map.createLayer('Floor', allTilesets, 0, 0)!;
    this.groundLayer.setCollisionByProperty({ collides: true });

    // Furniture and Ceiling layers also carry collideable tiles (walls, table,
    // appliances, bookcases). Enable collision so the player can't walk through them.
    const furnitureLayer = map.createLayer('Furniture', allTilesets, 0, 0)!;
    furnitureLayer.setCollisionByProperty({ collides: true });

    const ceilingLayer = map.createLayer('Ceiling', allTilesets, 0, 0)!;
    ceilingLayer.setCollisionByProperty({ collides: true });
    ceilingLayer.setDepth(10);

    // ── Spawn the player at the `spawn` object ────────────────────────────
    const spawn = this.findObject(map, 'spawn');
    this.player = new Player(this, spawn?.x ?? map.widthInPixels / 2, spawn?.y ?? map.heightInPixels / 2);
    this.physics.add.collider(this.player, this.groundLayer);
    this.physics.add.collider(this.player, furnitureLayer);
    this.physics.add.collider(this.player, ceilingLayer);

    // ── Camera follows the player, clamped to map bounds ──────────────────
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(2); // #118 — 2× world zoom (UI is on uiCam). Lowered from 4× — the 16px interior tiles lack the resolution to read cleanly at 4×.
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // ── Dual-camera split (#118) ──────────────────────────────────────────
    // initDualCamera() (DualCameraScene) builds uiRoot (HUD + toasts) ignored by
    // cameras.main once, then adds uiCam (full-viewport, zoom 1, no follow) AFTER
    // main so it draws on top — correct for UI occluding the world. Modal overlays
    // are routed to uiCam per-container in beginModalOverlay() so they can stay at
    // the scene root for E2E traversal.
    this.initDualCamera();

    // EPIC #279 — persistent Settings button (top-right HUD). The camp's other
    // actions (Reliquary / Recharge / Sleep) are spatial interaction zones, but
    // difficulty is a global preference, so it lives as an always-visible HUD
    // button rather than a station you walk to. Opens the DifficultyModal.
    // #382 — settingsBtn is added to uiRoot (a Container) → crispCanvasText.
    const settingsBtn = crispCanvasText(
      this.add
        .text(CANVAS_W - 16, 16, '[Settings]', { fontSize: '14px', color: '#ffdd66' })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setName('settings-btn')
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.openDifficultyModal()),
    );
    this.uiRoot.add(settingsBtn);
    // uiCam ignores world objects; collected after buildZones() below.

    // ── Reusable inventory panels (parked off-screen) ─────────────────────
    this.buildPanels();

    // ── Interaction zones (8A.2) ──────────────────────────────────────────
    this.buildZones(map);

    // ── Tell uiCam to ignore all world objects (#118) ─────────────────────
    // Collected once after buildZones(): tilemap layers, player sprite, and
    // every InteractionZone's display objects (zone + prompt). The uiRoot
    // subtree is already excluded from cameras.main; these world objects are
    // excluded from uiCam symmetrically. We walk the display list to pick up
    // all tilemap layers (Floor, Furniture, Ceiling) regardless of type,
    // matching on the layer name stored in the base TilemapLayer type.
    {
      const worldObjects: Phaser.GameObjects.GameObject[] = [];
      // Collect all tilemap layers created above (Floor, Furniture, Ceiling).
      this.children.getAll().forEach((child) => {
        if (child.type === 'TilemapLayer') {
          worldObjects.push(child as Phaser.GameObjects.GameObject);
        }
      });
      worldObjects.push(this.player);
      this.zones.forEach((z) => worldObjects.push(...z.displayObjects));
      this.ignoreWorldObjects(worldObjects);
    }

    // #87 Part A — double-click a Sanctum interaction zone within range to blink
    // onto it (spending spirit, cost ∝ distance). Suppressed while a modal overlay
    // is open (getModalOpen reads this.overlay). Registered on the built zones.
    this.blink = new BlinkController(this, this.player, () => this.overlay !== null);
    this.blink.register(this.zones);

    // ── Input ─────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    // E fires the active zone; Esc closes the open overlay.
    this.input.keyboard!.on('keydown-E', () => this.fireActiveZone());
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.overlay) this.closeModalOverlay();
    });

    // Spatial hooks (deterministic E2E parity with E / Esc).
    window.__sanctumZones = [];
    window.__sanctumInteract = (): void => this.fireActiveZone();
    window.__sanctumOverlayOpen = null;

    // ── E2E hooks ─────────────────────────────────────────────────────────
    window.__player = this.player;
    window.__campGoEncounter = (): void => this.goToEncounter();
    window.__campSleep = (): void => void this.doSleep();
    window.__campRecharge = (ringId: string): Promise<void> => this.doRechargeById(ringId);
    // #397 — hook proxies Sanctum RECHARGE; passes includeReliquary=true so E2E
    // tests assert reliquary ring restoration without a separate hook.
    window.__campRechargeAll = (): Promise<void> => this.doRechargeAll(true);
    window.__campAddToLoadout = async (ringId: string): Promise<void> => { await this.moveToCarry(ringId, true); };
    window.__campLeaveAtSanctum = async (ringId: string): Promise<void> => { await this.moveToCarry(ringId, false); };
    window.__campOpenFusion = (): void => this.openFusionPanel();
    window.__campFuse = (ringId1: string, ringId2: string): Promise<string | null> =>
      this.doFuse(ringId1, ringId2);
    // EPIC #279 — open the difficulty selector (same path as the Settings button).
    window.__campOpenSettings = (): void => this.openDifficultyModal();
    // #63 teleport hooks — open the modal / travel directly to a waystone.
    window.__campOpenTeleport = (): Promise<void> => this.openTeleportModal();
    window.__campTeleport = (waystoneId: string): Promise<void> =>
      this.doTeleport(
        waystoneId,
        window.__teleportState?.rows.find((r) => r.id === waystoneId)?.name ?? waystoneId,
      );
    window.__teleportState = undefined;

    this.events.once('shutdown', () => {
      window.__campGoEncounter = undefined;
      window.__campSleep = undefined;
      window.__campRecharge = undefined;
      window.__campRechargeAll = undefined;
      window.__campAddToLoadout = undefined;
      window.__campLeaveAtSanctum = undefined;
      window.__campOpenFusion = undefined;
      window.__campFuse = undefined;
      window.__campOpenSettings = undefined;
      window.__difficultyState = undefined;
      window.__campFusedFills = undefined;
      window.__campOpenTeleport = undefined;
      window.__campTeleport = undefined;
      window.__campHitTestRing = undefined;
      window.__campSanctumScroll = undefined;
      window.__campLoadoutScroll = undefined;
      window.__reliquaryMove = undefined;
      window.__reliquarySelect = undefined;
      window.__teleportState = undefined;
      // __campState intentionally NOT cleared: Phaser's scene queue stops the old
      // scene (firing shutdown) before starting the new one, so clearing here would
      // wipe campState before the biome scene's checkNpcDetection can read it.
      // The global persists until the next CampScene.refreshPools() overwrites it.
      window.__fusionState = undefined;
      window.__player = null;
      window.__scene = null;
      // __sanctumZones intentionally NOT cleared: leaves ['door'] visible so
      // waitForFunction(includes('door')) can resolve before ForestScene overwrites it.
      // __sanctumInteract intentionally NOT cleared: if the 500ms touch-exit timer
      // fires before the test calls __sanctumInteract(), the test can still call it
      // safely — it resolves to a no-op (activeZone = null after shutdown).
      window.__sanctumInteract = undefined;
      window.__sanctumOverlayOpen = undefined;
      this.blink?.destroy();
      this.blink = null;
      this.zones.forEach((z) => z.destroy());
      this.zones = [];
      // #423 — never leave an orphaned discard confirm (container + Y/N key
      // listeners) behind on scene shutdown.
      this.sanctumDiscard_?.dismiss();
      this.sanctumDiscard_ = null;
    });

    // ── Initial data load ─────────────────────────────────────────────────
    void this.loadData();
  }

  update(): void {
    // Suppress movement while a modal overlay is open: the avatar holds still so
    // it doesn't continue drifting behind the panel.
    if (this.overlay) {
      this.player.halt();
      return;
    }
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
  }

  // ── Interaction zones (8A.2) ────────────────────────────────────────────

  /**
   * Build an InteractionZone per named rectangle on the `objects` layer. The exit
   * `door` is built without a prompt: it fires on touch (see updateActiveZone), so
   * a "Press E" hint would be misleading. All other zones keep the E-press prompt.
   */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      const cb = this.zoneCallback(o.name ?? '');
      if (!cb) continue;
      const promptText = o.name === 'door' ? null : 'Press E';
      const zone = new InteractionZone(this, o, cb, promptText);
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }
  }

  /** Map a zone name to the method it opens. Returns null for non-zone objects. */
  private zoneCallback(name: string): (() => void) | null {
    switch (name) {
      case 'ringwall':
        return () => this.openRingwallOverlay();
      case 'meditation':
        return () => this.openMeditationOverlay();
      case 'bed':
        return () => this.openBedOverlay();
      case 'eat':
        return () => this.openCampfireOverlay();
      case 'door':
        return () => this.onDoorInteract();
      case 'training':
        return () => this.goToEncounter();
      default:
        return null;
    }
  }

  /**
   * Each frame, pick the nearest zone the player overlaps and show only its
   * prompt. Publishes the overlapping zone names to `window.__sanctumZones`.
   */
  private updateActiveZone(): void {
    const px = this.player.x;
    const py = this.player.y;
    const overlapping = this.zones.filter((z) => z.contains(px, py));
    // Publish first so the E2E `walkToZone` probe sees 'door' even on the frame
    // the touch-to-exit fires below.
    window.__sanctumZones = overlapping.map((z) => z.name);

    // Touch-to-exit: when the player steps on the door, schedule the transition
    // after 500ms. This keeps the door as the `activeZone` (the early return is
    // intentionally absent) so the existing E / __sanctumInteract path also works:
    // fireActiveZone() will fire the door immediately, and the 500ms timer is a
    // no-op because onDoorInteract() is guarded by `doorTransitionStarted`.
    if (!this.leavingViaDoor && overlapping.some((z) => z.name === 'door')) {
      this.leavingViaDoor = true;
      this.time.delayedCall(500, () => this.onDoorInteract());
    }

    let nearest: InteractionZone | null = null;
    let best = Infinity;
    for (const z of overlapping) {
      const d = z.distanceSqTo(px, py);
      if (d < best) {
        best = d;
        nearest = z;
      }
    }

    if (nearest !== this.activeZone) {
      this.activeZone?.setActive(false);
      nearest?.setActive(true);
      this.activeZone = nearest;
    }
  }

  /** Fire the active zone's interaction (E key or __sanctumInteract hook). */
  private fireActiveZone(): void {
    if (this.overlay) return; // an overlay is already open
    this.activeZone?.interact();
  }

  /**
   * Door zone → leave the Sanctum into the biome containing the anchored waystone
   * (#82). Wired to OverworldScene in 8A.3; 8C.2 makes it biome-aware: the Sanctum
   * follows its anchor, so exiting near a Swamp anchor lands in the Swamp, and
   * exiting after teleporting to the hidden Forest alcove lands there. Fetches the
   * authoritative anchor, then routes; falls back to OverworldScene. Guarded so it
   * is a safe no-op until the target scene is registered.
   */
  private onDoorInteract(): void {
    if (this.doorTransitionStarted) return;
    this.doorTransitionStarted = true;
    void this.routeToBiome();
  }

  /**
   * Resolve the scene key for the currently-anchored waystone and start it. The
   * Sanctum anchor (server authority) determines which biome the player exits
   * into. For the Forest, the anchor also selects the SCREEN (8E): the door opens
   * on the Forest screen whose anchorage matches the anchor (the hub for
   * forest_entry, the glade for forest_glade, the alcove for forest_hidden_anchor,
   * …), falling back to the hub. Defaults to ForestScene on any failure so the
   * door always works.
   */
  private async routeToBiome(): Promise<void> {
    let anchor = 'forest_entry';
    if (getToken()) {
      try {
        const res = await apiFetch('/api/waystones');
        if (res.ok) {
          anchor = ((await res.json()) as { anchor: string }).anchor ?? anchor;
        }
      } catch {
        // Network error — fall through to the default Forest overworld.
      }
    }
    const target = CampScene.biomeSceneForAnchor(anchor);
    const data = CampScene.forestScreenForAnchor(anchor);
    if (this.scene.manager.keys[target]) {
      // fromSanctum suppresses edge transitions in BaseBiomeScene until
      // loadWaystones repositions the player at the sanctum door.
      this.scene.start(target, { ...data, fromSanctum: true });
    } else if (this.scene.manager.keys['ForestScene']) {
      this.scene.start('ForestScene', { fromSanctum: true });
    }
  }

  /**
   * For a Forest anchor, the screen the door should open on (8E). The anchor is an
   * anchorage waystone id; the door opens on the FOREST_SCREENS screen that carries
   * that anchorage (e.g. forest_glade → the forest_glade screen, forest_hidden_anchor
   * → forest_hidden_alcove). forest_entry resolves to the hub. Returns undefined when
   * no screen owns the anchor (e.g. a Swamp anchor), so the scene picks its default.
   */
  private static forestScreenForAnchor(anchorId: string): { screenId: string } | undefined {
    const screen = FOREST_SCREENS.find((s) => s.anchorage === anchorId);
    return screen ? { screenId: screen.id } : undefined;
  }

  /**
   * Map an anchor waystone id to the biome scene that contains it (#82, 8E). The
   * Swamp and Snow are distinct scenes; every Forest anchor — including the hidden
   * alcove (`forest_hidden_*`, now a Forest screen rather than its own scene) —
   * routes to the unified ForestScene, which selects the matching screen.
   */
  private static biomeSceneForAnchor(anchorId: string): string {
    if (anchorId.startsWith('swamp')) return 'SwampScene';
    if (anchorId.startsWith('snow')) return 'SnowScene';
    return 'ForestScene';
  }

  // ── Tiled object helpers ────────────────────────────────────────────────

  /** Find a named object on the `objects` object layer (point or rectangle). */
  private findObject(
    map: Phaser.Tilemaps.Tilemap,
    name: string,
  ): Phaser.Types.Tilemaps.TiledObject | undefined {
    return map.getObjectLayer('objects')?.objects.find((o) => o.name === name);
  }

  // ── Modal overlays (8A.2) ─────────────────────────────────────────────────

  // #118 — unignoreMain() (clear a stale main-camera ignore bit before destroy) is
  // provided by DualCameraScene.

  /**
   * Create a fresh modal overlay container: a dimmed full-screen backdrop fixed
   * to the camera, plus a titled panel. Returns the container; callers add panel
   * content into it. Closing destroys the container (and any non-adopted
   * children); adopted reusable panels are released via `overlayOnClose`.
   */
  private beginModalOverlay(
    name: string,
    title: string,
    onClose?: () => void,
    size?: { width: number; height: number },
  ): Phaser.GameObjects.Container {
    this.closeModalOverlay(); // never stack overlays
    // #118: the overlay container stays at the SCENE ROOT (not inside uiRoot) so
    // the existing E2E single-level flatMap traversals still reach its children.
    // To render it at 1:1 instead of the 2× world camera we tell cameras.main to
    // ignore the container; ignoring a container cascades to its whole subtree,
    // so children added later (panels, labels) are excluded automatically.
    const c = this.add.container(0, 0).setDepth(4000);
    const backdrop = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setInteractive(); // swallow clicks to the room behind
    // #154 — the Reliquary modal passes a larger panel so its header + two stacked
    // right-column panels (Battle Hand over Spare) fit; other overlays keep the
    // historic 760×470.
    const panelW = size?.width ?? 760;
    const panelH = size?.height ?? 470;
    const panel = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, panelW, panelH, 0x161622)
      .setStrokeStyle(2, 0x6082aa);
    // #382 — title and close button are Container children → crispCanvasText.
    const titleText = crispCanvasText(
      this.add
        .text(CANVAS_W / 2, 60, title, { fontSize: '20px', color: '#ffffff' })
        .setOrigin(0.5),
    );
    const closeBtn = crispCanvasText(
      this.add
        .text(CANVAS_W / 2 + 360, 56, '[×]', { fontSize: '16px', color: '#ff8888' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.closeModalOverlay()),
    );
    c.add([backdrop, panel, titleText, closeBtn]);
    this.routeToUi(c);

    this.overlay = c;
    this.overlayName = name;
    this.overlayOnClose = onClose ?? null;
    window.__sanctumOverlayOpen = name;
    return c;
  }

  /** Close the open overlay, releasing any adopted panels first. */
  private closeModalOverlay(): void {
    if (!this.overlay) return;
    // #395 — the ringwall overlay is owned by RingManagementOverlay. Delegate to its
    // close() method which fires onBeforeDestroy (releases sanctumGrid) → destroys
    // the container → calls the onCloseCb (nulls this.overlay / etc.).
    if (this.sanctumOverlay) {
      this.sanctumOverlay.close();
      return;
    }
    // All non-ringwall overlays: destroy the container directly.
    this.overlayOnClose?.();
    // #118: the overlay container lives at the scene root. Clear its main-camera
    // ignore flag before destroying it (mirrors the ignore() in beginOverlay).
    this.unignoreMain(this.overlay);
    this.overlay.destroy(true);
    this.overlay = null;
    this.overlayName = null;
    this.overlayOnClose = null;
    window.__sanctumOverlayOpen = null;
    // #396: close the fusion overlay if it is open (replaces FusionPanel.close()).
    if (this.fusionOverlay?.isOpen()) this.fusionOverlay.close();
  }

  /**
   * Adopt a reusable panel into the overlay container at a local position. The
   * panel keeps its populated state; `releasePanel` returns it off-screen.
   */
  private adoptPanel(
    container: Phaser.GameObjects.Container,
    panel: Phaser.GameObjects.Container,
    x: number,
    y: number,
  ): void {
    container.add(panel);
    panel.setPosition(x, y);
    panel.setScrollFactor(0);
    panel.setVisible(true); // #118 P2: shown while adopted into the visible overlay
  }

  /** Return an adopted panel to the scene root, parked off-screen. */
  private releasePanel(container: Phaser.GameObjects.Container, panel: Phaser.GameObjects.Container): void {
    container.remove(panel); // re-parents to the scene display list
    panel.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    panel.setVisible(false); // #118 P2: hidden while parked so cameras skip it
  }

  /**
   * Reliquary wall (#154): a two-panel loadout manager with a live stats header.
   *   - Full-width header: aggregate_xp / spirit_max / spirit current-max, read
   *     from the authoritative `window.__campState` and re-rendered after every
   *     move (the server owns spirit_max — never computed client-side).
   *   - Left panel RELIQUARY: scrollable grid of all NOT-carried rings (in_carry
   *     = 0). Locked (non-interactive) when the carry cap is full.
   *   - Middle panel SPARES: 3×3 scrollable grid of carried rings not in a battle slot.
   *   - Right panel BATTLE HAND: Thumb row (effect display | Thumb card) then
   *     Attack row (A1 | A2) and Defense row (D1 | D2), ring grid right-aligned.
   * Interaction is click-then-click (no drag): select a ring, then click the
   * target section/slot. Reuses the exact reusable panel instances.
   */
  private openRingwallOverlay(): void {
    // #395 P1-A — delegate to RingManagementOverlay in 'sanctum' mode. The overlay
    // class owns the single SlotSwapManager; CampScene receives a reference to it via
    // getSwap() and assigns it to this.swapManager so all existing swap-consumer
    // methods (onRingClicked, onBattleSlotClicked, etc.) continue to work unchanged.
    if (this.overlay) return; // guard against double-open (mirroring beginModalOverlay)

    this.sanctumOverlay = new RingManagementOverlay(this, 'sanctum', {
      // ── resolveMove: delegate to CampScene's existing reliquaryMove ──────────
      resolveMove: async (ringId, from, to) => {
        // #421 — reliquaryMove surfaces its own errors and reports whether the
        // mutation committed; propagate so the shared SlotSwapManager keeps the
        // selection held when a sanctum move is rejected.
        return await this.reliquaryMove(ringId, to, from);
      },

      // ── onBenchGridSelect: route bench card clicks through onGridSelectionChanged ─
      onBenchGridSelect: (ring) => {
        if (ring) this.onGridSelectionChanged(ring, 'spare');
        else this.clearReliquarySelection();
      },

      // ── onRecharge: Sanctum RECHARGE includes reliquary resting pool (#397) ──
      onRecharge: () => {
        void this.doRechargeAll(true);
      },

      // ── renderLeft: build the SPIRIT left column into the overlay container ──
      // Adds: live stats header, shard button, divider, SPIRIT label+counter,
      // sanctumGrid (adopted reusable panel), and the deselect zone.
      renderLeft: (c) => {
        // Deselect zone — click empty panel space to deselect. Inserted at index 1
        // (above backdrop, below everything interactive) so the [×] close button wins.
        const deselectZone = this.add
          .rectangle(CANVAS_W / 2, CANVAS_H / 2, MODAL_W, MODAL_H, 0x000000, 0.001)
          .setScrollFactor(0)
          .setName('reliquary-deselect-zone')
          .setInteractive()
          .on('pointerdown', () => this.clearReliquarySelection());
        c.addAt(deselectZone, 1);

        // Three-part live stats header (EPIC #302). Left: Spirit+difficulty;
        // center: ♥ cur/max; right: Total XP | Avg Battle XP. All crispCanvasText.
        this.reliquaryHeaderLeft = crispCanvasText(
          this.add
            .text(COL_RELIQUARY_X, 92, '', { fontSize: '14px', color: '#ffdd66' })
            .setOrigin(0, 0).setScrollFactor(0).setName('reliquary-header-left'),
        );
        this.reliquaryHeaderCenter = crispCanvasText(
          this.add
            .text(CANVAS_W / 2, 92, '', { fontSize: '14px', color: '#ff8888' })
            .setOrigin(0.5, 0).setScrollFactor(0).setName('reliquary-header-center'),
        );
        this.reliquaryHeaderRight = crispCanvasText(
          this.add
            .text(CONTENT_RIGHT, 92, '', { fontSize: '13px', color: '#aaccff' })
            .setOrigin(1, 0).setScrollFactor(0).setName('reliquary-header-right'),
        );
        c.add([this.reliquaryHeaderLeft, this.reliquaryHeaderCenter, this.reliquaryHeaderRight]);

        // #182 — "Add Shard" button (right-aligned at y=128); only if shards > 0.
        const reliquaryShards: number = window.__campState?.reliquaryShards ?? 0;
        if (reliquaryShards > 0) {
          c.add(
            crispCanvasText(
              this.add
                .text(
                  CONTENT_RIGHT, 128,
                  `[Add Shard (+10)] (${reliquaryShards} available)`,
                  { fontSize: '11px', color: '#ffcc44' },
                )
                .setOrigin(1, 0).setScrollFactor(0).setName('add-shard-btn')
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => void this.doExpandReliquary()),
            ),
          );
        }

        // Thin divider beneath the header.
        c.add(
          this.add.rectangle(CANVAS_W / 2, 118, CONTENT_RIGHT - CONTENT_LEFT, 1, 0x6082aa)
            .setScrollFactor(0),
        );

        // SPIRIT DOM header — crisp, center-anchored at the grid midpoint (same row/size/
        // anchor formula as BHC bench header). NOT added to the container — tracked in
        // this.spiritHeader and destroyed manually in onBeforeDestroy. (#426)
        {
          const campS = window.__campState;
          const reliqCount: number = campS?.reliquaryCount ??
            (campS?.rings ?? []).filter(
              (r: RingData) => r.in_carry === 0 && !(r as { escrowed?: number }).escrowed && r.heart_slot !== 1,
            ).length;
          const reliqCap: number = campS?.reliquaryCap ?? 0;
          const full = reliqCount >= reliqCap;
          this.spiritHeader = addDomLabel(
            this,
            COL_RELIQUARY_X + 104,
            128,
            `SPIRIT: ${reliqCount} / ${reliqCap}`,
            { fontPx: 12, color: full ? '#ff5555' : '#ffdd66', align: 'center', id: 'spirit-header' },
          );
        }

        // Invisible canvas hit-rect that forwards pointer events to onReliquaryDropClicked.
        // Required because DOM labels are pointer-events:none. Added to the container
        // AFTER the deselect zone so it wins input. (#426)
        const spiritDropHit = this.add
          .rectangle(COL_RELIQUARY_X + 104, 128, 208, 18, 0x000000, 0.001)
          .setScrollFactor(0)
          .setName('spirit-drop-hit')
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.onReliquaryDropClicked());
        c.add(spiritDropHit);

        // Adopt the reusable SPIRIT (Reliquary) grid. The BENCH grid is created
        // fresh by BenchHealthCombat; loadoutGrid is no longer adopted here.
        this.adoptPanel(c, this.sanctumGrid, COL_RELIQUARY_X, 148);
        this.sanctumGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);

        // SPIRIT ghost (#423) — always-visible ghost cell at index reliquaryCount
        // when the reliquary pool is below cap. Click with selection = move to reliquary.
        // Added unconditionally to the card container — the InventoryGrid scroll mask
        // hides off-screen cells naturally, so no visibility guard is needed.
        {
          const campS = window.__campState;
          // Same count source as applyReliquaryLockState / renderReliquaryHeader:
          // authoritative __campState.reliquaryCount with the resting-rings fallback.
          const reliqCount: number = campS?.reliquaryCount ??
            (campS?.rings ?? []).filter(
              (r: RingData) => r.in_carry === 0 && !(r as { escrowed?: number }).escrowed && r.heart_slot !== 1,
            ).length;
          const reliqCap: number = campS?.reliquaryCap ?? 0;
          if (reliqCount < reliqCap) {
            const G_NUM_COLS = 3;
            const G_CARD_H = 88; // CARD_H in InventoryGrid (not exported)
            // Next open cell index = reliqCount → row = floor(n/3), col = n%3.
            const phY = Math.floor(reliqCount / G_NUM_COLS) * GRID_ROW_GAP + G_CARD_H / 2;
            const nextCol = reliqCount % G_NUM_COLS;
            const phX = nextCol * GRID_COL_GAP + GRID_CARD_W / 2;
            const spiritGhost = this.add
              .rectangle(phX, phY, GRID_CARD_W, G_CARD_H, 0x1a2233)
              .setScrollFactor(0)
              .setStrokeStyle(2, 0x446688)
              .setAlpha(0.7)
              .setInteractive({ useHandCursor: true })
              .on('pointerdown', () => {
                const sel = this.sanctumOverlay?.selection;
                if (!sel) return;
                void this.reliquaryMove(sel.ringId, 'reliquary');
              });
            this.sanctumGrid.getCardContainer().add(spiritGhost);
          }
        }

        // Live status echo, inside the modal above the bottom edge.
        c.add(
          crispCanvasText(
            this.add
              .text(CONTENT_LEFT, 478, this.statusText.text, { fontSize: '12px', color: '#ff8888' })
              .setName('overlay-status').setScrollFactor(0),
          ),
        );
      },

      // ── getThumbTooltip ───────────────────────────────────────────────────────
      getThumbTooltip: () => this.thumbPassiveTooltipText(),

      // ── onSlotClick: route HEALTH / COMBAT slot clicks to CampScene handlers ─
      onSlotClick: async (slot) => {
        if (slot === 'heart') await this.onHeartCardClicked();
        else await this.onBattleSlotClicked(slot as 'thumb' | LoadoutSlot);
      },

      // ── onRender: wire the fresh container into CampScene's overlay tracking ─
      onRender: (c) => {
        this.overlay = c;
        this.overlayName = 'ringwall';
        this.overlayOnClose = null; // sanctumOverlay owns close; no overlayOnClose needed
        this.routeToUi(c);
        window.__sanctumOverlayOpen = 'ringwall';
      },

      // ── onStatus: surface errors through the scene's status display ───────────
      onStatus: (msg) => this.setStatus(msg),

      // ── onDiscardSlotClick: sanctum discard confirm (#423) ──────────────────
      onDiscardSlotClick: (ov) => {
        const sel = ov.selection;
        if (!sel) return;
        const campS = window.__campState;
        const ring = sel.source === 'heart'
          ? (campS?.heart_ring as RingData | null ?? null)
          : this.rings.find((r) => r.id === sel.ringId) ?? null;
        if (!this.sanctumDiscard_) this.sanctumDiscard_ = new DiscardConfirm(this);
        this.sanctumDiscard_.open(ring, sel.ringId,
          () => void this.deleteRingFromSanctum(sel.ringId, ov),
          () => { ov.clearSelection(); },
        );
      },

      // ── onBenchGhostClick: accept WON ring or move bench ring (#423) ─────────
      onBenchGhostClick: async (ov) => {
        const sel = ov.selection;
        if (!sel) return;
        const campS = window.__campState;
        const pendingId = (campS?.player?.pending_ring_id as string | null | undefined) ?? null;
        if (sel.ringId === pendingId) {
          // Accept the WON ring to bench via PUT /api/rings/:id/accept.
          // Errors surface in the OVERLAY status bar (ov.setStatusMessage), not the
          // scene status — the player is looking at the modal, not the room.
          try {
            const res = await apiFetch(`/api/rings/${sel.ringId}/accept`, { method: 'PUT', json: {} });
            if (res.ok) {
              ov.clearSelection();
              await this.loadData();
              this.afterReliquaryReload();
            } else {
              const body = await res.json().catch(() => ({}));
              ov.setStatusMessage((body as { error?: string }).error ?? 'Accept failed');
            }
          } catch {
            ov.setStatusMessage('Accept failed — network error');
          }
        } else {
          // Routes through reliquaryMove, which owns the #421 drop-time guard
          // and error surfacing for sanctum moves.
          await this.reliquaryMove(sel.ringId, 'spare');
        }
      },

      // ── onBeforeDestroy: release the adopted sanctumGrid before the container
      // is destroyed so destroy(true) does not reclaim the reusable panel.
      onBeforeDestroy: (c) => {
        this.sanctumGrid.setVisibleRows(0);
        this.sanctumGrid.setMaskOrigin(null, null);
        this.releasePanel(c, this.sanctumGrid);
        // Clear the discard confirm dialog if open.
        this.sanctumDiscard_?.dismiss();
        this.sanctumDiscard_ = null;
        // #426 — destroy the DOM SPIRIT header (not a container child; must be
        // destroyed before the container to avoid a dangling DOM node).
        this.spiritHeader?.destroy();
        this.spiritHeader = null;
      },
    });

    // Build OverlayData from the current /api/me cache.
    const s = window.__campState;
    const data: OverlayData = {
      player: s ? {
        spirit_current: s.spirit_current,
        spirit_max: s.spirit_max,
        aggregate_xp: s.aggregate_xp,
        carry_cap: this.carryCap,
        spare_ring_max: s.spare_ring_max,
        heart_ring: (s.heart_ring as RingData | null) ?? null,
        pending_ring_id: (s.player?.pending_ring_id as string | null | undefined) ?? null,
      } : null,
      rings: this.rings,
      loadout: this.loadout,
    };

    // Open the overlay. renderLeft fires synchronously inside open(). After open()
    // returns, this.overlay is set (via onRender) and this.sanctumGrid is adopted.
    this.sanctumOverlay.open(data, () => {
      // ── onClose callback — fires after the overlay container is destroyed ────
      // sanctumGrid was already released by onBeforeDestroy before container destroy.
      this.input.off('wheel', this.onRingwallWheel, this);
      window.__campSanctumScroll = undefined;
      window.__campLoadoutScroll = undefined;
      // Drop all overlay-container-scoped refs.
      this.reliquaryHeaderLeft = null;
      this.reliquaryHeaderCenter = null;
      this.reliquaryHeaderRight = null;
      this.heartCard = null;
      this.spiritHeader = null; // #426 — already destroyed in onBeforeDestroy; null the ref
      this.combatCards.clear();
      this.statusLockLabel = null;
      // Clear swap manager and E2E hooks.
      this.swapManager = null;
      window.__campHitTestRing = undefined;
      window.__reliquaryMove = undefined;
      window.__reliquarySelect = undefined;
      window.__reliquaryFull = undefined;
      // Clear overlay tracking (the container is already destroyed by the overlay class).
      this.overlay = null;
      this.overlayName = null;
      this.overlayOnClose = null;
      this.sanctumOverlay = null;
      window.__sanctumOverlayOpen = null;
      if (this.fusionOverlay?.isOpen()) this.fusionOverlay.close();
    });

    // #395 — the overlay class owns the single SlotSwapManager. Expose it via
    // this.swapManager so all existing swap-consumer methods (onRingClicked, etc.)
    // continue to work without modification.
    this.swapManager = this.sanctumOverlay.getSwap();

    // Mouse wheel over a scrollable grid scrolls it.
    this.input.on('wheel', this.onRingwallWheel, this);

    // E2E scroll hooks.
    window.__campSanctumScroll = (delta: number): void => {
      this.sanctumGrid.scrollBy(delta);
      this.publishScrollState();
    };
    window.__campLoadoutScroll = (delta: number): void => {
      this.sanctumOverlay?.getBenchGrid()?.scrollBy(delta);
      this.publishScrollState();
    };
    this.publishScrollState();

    // Apply Reliquary lock state and render the live header.
    this.applyReliquaryLockState();
    this.renderReliquaryHeader();

    // E2E programmatic select + move hooks.
    window.__campHitTestRing = (ringId: string): { found: boolean; hit: boolean } => {
      const bg = this.sanctumGrid.getCardBg(ringId)
        ?? this.sanctumOverlay?.getBenchGrid()?.getCardBg(ringId)
        ?? null;
      if (!bg) return { found: false, hit: false };
      const m = bg.getWorldTransformMatrix();
      const out: Phaser.GameObjects.GameObject[] = [];
      this.input.manager.hitTest(
        { x: m.tx, y: m.ty } as unknown as Phaser.Input.Pointer,
        [bg],
        this.uiCam,
        out,
      );
      return { found: true, hit: out.indexOf(bg) !== -1 };
    };
    window.__reliquarySelect = (
      ringId: string,
      source: 'reliquary' | 'spare' | 'battle',
    ): void => this.selectReliquaryRing(ringId, source);
    window.__reliquaryMove = async (
      ringId: string,
      target: 'reliquary' | 'spare' | 'thumb' | 'heart' | LoadoutSlot,
    ): Promise<void> => { await this.reliquaryMove(ringId, target); };
  }

  /**
   * EPIC #302 / #347 — build the Heart slot card in the HEALTH column. A standalone {@link RingCard}
   * (not a parked reusable panel) created fresh per overlay and added to the
   * overlay container `c`, so the container destroy on close reclaims it. Its bg is
   * made interactive and routes clicks through the universal-swap state machine as
   * the `'heart'` source/target. An `HP` title sits above the card. The card is
   * painted from `window.__campState.heart_ring`.
   */
  private buildHeartCard(c: Phaser.GameObjects.Container): void {
    const cx = HEART_CARD_W / 2; // 35 — card body centred within its column
    const cy = HEART_CARD_H / 2;
    const card = new RingCard(this, HEART_CARD_X, HEART_CARD_Y, {
      width: HEART_CARD_W,
      height: HEART_CARD_H,
      cx,
      cy,
      scrollFactor: 0,
      strokeColor: 0xcc4466,
      textColor: '#000000',
      fontSize: '9px',
      elementY: -22,
      pipsY: -5,
      xpY: 12,
      xpPrefix: 'XP:',
    });
    // #347 — HP title above the card (was a bare ♥ glyph). The three-part header's
    // centre `♥ cur/max` HP readout is a separate object and is unchanged.
    // #382 — HP title is a child of card (a Container) → crispCanvasText.
    const title = crispCanvasText(
      this.add
        .text(HEART_CARD_X + cx, HEART_CARD_Y + cy - 36, 'HP', { fontSize: '12px', color: '#ff6688' })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    card.add(title);
    // Click the heart card → enter the universal-swap state machine as 'heart'.
    card.bg
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.onHeartCardClicked());
    c.add(card);
    this.heartCard = card;
    this.renderHeartCard();
  }

  /**
   * EPIC #302 — paint the Heart card from the authoritative heart ring (in
   * `window.__campState.heart_ring`). Empty slot → the dim em-dash look. Also
   * re-applies the selection stroke when the heart is the active swap selection.
   */
  private renderHeartCard(): void {
    if (!this.heartCard) return;
    const heart = window.__campState?.heart_ring as RingData | null | undefined;
    if (heart) {
      this.heartCard.setRing({
        element: heart.element,
        tier: heart.tier,
        xp: heart.xp,
        currentUses: heart.current_uses,
        maxUses: heart.max_uses,
        fusionParents: heart.fusionParents,
      });
      this.heartCard.setTextColor('#000000');
    } else {
      this.heartCard.clear();
      this.heartCard.setElementText('—', '#888888');
    }
    const selected = this.swapManager?.selection?.source === 'heart';
    this.heartCard.setStroke(selected ? 3 : 2, selected ? 0xffff00 : 0xcc4466);
  }

  /**
   * #389 — build the COMBAT cluster: the STATUS (Thumb) card left-aligned above a
   * 2×2 of A1/A2 (top) · D1/D2 (bottom), each a {@link RingCard} added to the
   * overlay container `c` (reclaimed on close). Replaces the retired StakePanel +
   * LoadoutPanel; every card's bg routes clicks through {@link onBattleSlotClicked}.
   * A per-card crisp slot label sits above each card; the STATUS card additionally
   * gets an escrow LOCKED label (preserved from StakePanel). Painted by
   * {@link renderCombatCluster}.
   */
  private buildCombatCluster(c: Phaser.GameObjects.Container): void {
    this.combatCards.clear();
    const defs: { slot: 'thumb' | LoadoutSlot; label: string; x: number; y: number }[] = [
      { slot: 'thumb', label: 'STATUS', x: COMBAT_COL_LEFT_X, y: COMBAT_STATUS_Y },
      { slot: 'a1', label: 'A1', x: COMBAT_COL_LEFT_X, y: COMBAT_ROW0_Y },
      { slot: 'a2', label: 'A2', x: COMBAT_COL_RIGHT_X, y: COMBAT_ROW0_Y },
      { slot: 'd1', label: 'D1', x: COMBAT_COL_LEFT_X, y: COMBAT_ROW1_Y },
      { slot: 'd2', label: 'D2', x: COMBAT_COL_RIGHT_X, y: COMBAT_ROW1_Y },
    ];
    for (const def of defs) {
      const card = new RingCard(this, def.x, def.y, {
        width: COMBAT_CARD_W,
        height: COMBAT_CARD_H,
        scrollFactor: 0,
        strokeColor: def.slot === 'thumb' ? 0xaa8800 : 0x888888,
        textColor: '#000000',
        fontSize: '9px',
      });
      // Crisp slot label above each card (STATUS / A1 / A2 / D1 / D2). The card is a
      // Container positioned at (def.x, def.y) with its body drawn at the origin
      // (cx/cy default 0), so child labels use LOCAL coordinates — (0, −36) renders
      // 36px above the card center, not double-offset by (def.x, def.y).
      const lbl = crispCanvasText(
        this.add
          .text(0, -36, def.label, { fontSize: '10px', color: def.slot === 'thumb' ? '#ffcc44' : '#aaaaaa' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setName(`combat-label-${def.slot}`),
      );
      card.add(lbl);
      card.bg
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.onBattleSlotClicked(def.slot));
      // STATUS card carries the escrow LOCKED label (Thumb can be staked in a duel).
      if (def.slot === 'thumb') {
        this.statusLockLabel = crispCanvasText(
          this.add
            .text(0, 41, '', { fontSize: '10px', color: '#ff6666' })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setName('status-lock'),
        );
        card.add(this.statusLockLabel);
      }
      c.add(card);
      this.combatCards.set(def.slot, card);
    }
    this.renderCombatCluster();
  }

  /**
   * #389 — paint the COMBAT cluster cards from the authoritative loadout/ringMap.
   * Each slot shows its assigned ring (or the dim em-dash empty look), re-applies
   * the selection stroke (yellow when that slot is the active swap source), and
   * surfaces the STATUS escrow LOCKED label. A no-op once the cluster is torn down.
   */
  private renderCombatCluster(): void {
    if (this.combatCards.size === 0) return;
    const sel = this.swapManager?.selection ?? null;
    for (const [slot, card] of this.combatCards) {
      const ringId = this.loadout[slot] ?? null;
      const ring = ringId ? this.ringMap.get(ringId) : null;
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
      const selected = sel?.source === slot;
      const escrowed = slot === 'thumb' && ring?.escrowed === 1;
      if (selected) card.setStroke(3, 0xffff00);
      else if (escrowed) card.setStroke(2, 0xff6666);
      else card.setStroke(2, slot === 'thumb' ? 0xaa8800 : 0x888888);
      if (slot === 'thumb' && this.statusLockLabel) {
        this.statusLockLabel.setText(escrowed ? 'LOCKED' : '');
      }
    }
  }

  // ── Reliquary modal — selection + moves (#154) ────────────────────────────

  /**
   * Render the three-part live stats header from the authoritative snapshot in
   * `window.__campState` (populated from `/api/me`). EPIC #302 — replaces the old
   * single centered string with three independently-anchored segments and drops the
   * Reliquary/Loadout counts:
   *   - Left:   `Spirit: cur/max [Tier]`
   *   - Center: `♥ cur/max` for the equipped heart ring (`♥ 0/0` when empty)
   *   - Right:  `Total XP: N | Avg Battle XP: M`
   * Never computes spirit_max / total_xp / avg locally — all read from the server.
   * Also re-paints the Heart card and refreshes the LOADOUT count badge (turns red
   * at the carry cap). A no-op for any segment torn down (overlay closed).
   */
  private renderReliquaryHeader(): void {
    const s = window.__campState;
    if (s) {
      if (this.reliquaryHeaderLeft) {
        this.reliquaryHeaderLeft.setText(
          `Spirit: ${s.spirit_current} / ${s.spirit_max} ${CampScene.difficultyLabel(s.difficulty)}`,
        );
      }
      if (this.reliquaryHeaderCenter) {
        const heart = s.heart_ring as RingData | null | undefined;
        const hp = heart ? `${heart.current_uses}/${heart.max_uses}` : '0/0';
        this.reliquaryHeaderCenter.setText(`♥ ${hp}`);
      }
      if (this.reliquaryHeaderRight) {
        const totalXp = (s.total_xp ?? s.aggregate_xp ?? 0).toLocaleString();
        const avgXp = Math.round(s.battle_hand_avg_xp ?? 0).toLocaleString();
        this.reliquaryHeaderRight.setText(`Total XP: ${totalXp}  |  Avg Battle XP: ${avgXp}`);
      }
    }
    // #395 — HEALTH + COMBAT columns are now owned by BenchHealthCombat inside the
    // overlay class. Rebuild BHC with the latest data so strokes and ring content stay
    // in sync. Falls back to the old CampScene-owned renders if sanctumOverlay is null.
    if (this.sanctumOverlay) {
      this.sanctumOverlay.refreshBhc(this.makeSanctumData());
    } else {
      this.renderHeartCard();
      this.renderCombatCluster();
    }
    // #426 — update the DOM SPIRIT header text + color; publish the structure reporter.
    // Bench count excludes the pending WON ring (same as lock predicate).
    if (s) {
      const reliquaryCount =
        s.reliquaryCount ??
        s.rings.filter((r: RingData) => r.in_carry === 0 && !(r as { escrowed?: number }).escrowed && r.heart_slot !== 1).length;
      const reliquaryCap = s.reliquaryCap ?? 0;
      const pendingId = (s.player?.pending_ring_id as string | null | undefined) ?? null;
      const benchN = benchSpareCount(s.rings as RingData[], s.loadout, pendingId);
      const benchMax = s.spare_ring_max ?? 0;
      if (this.spiritHeader) {
        setDomLabelText(this.spiritHeader, `SPIRIT: ${reliquaryCount} / ${reliquaryCap}`);
        (this.spiritHeader.node as HTMLElement).style.color = reliquaryCount >= reliquaryCap ? '#ff5555' : '#ffdd66';
      }
      publishRingMgmtState(
        'sanctum',
        {
          spirit: { n: reliquaryCount, max: reliquaryCap },
          bench: { n: benchN, max: benchMax },
        },
        this.overlay,
      );
    }
  }

  /**
   * #395 — Build an OverlayData snapshot from the current /api/me cache. Used to
   * pass live data to the sanctum RingManagementOverlay (refreshBhc / open).
   */
  private makeSanctumData(): OverlayData {
    const s = window.__campState;
    return {
      player: s
        ? {
            spirit_current: s.spirit_current,
            spirit_max: s.spirit_max,
            aggregate_xp: s.aggregate_xp,
            carry_cap: this.carryCap,
            spare_ring_max: s.spare_ring_max,
            heart_ring: (s.heart_ring as RingData | null) ?? null,
            pending_ring_id: (s.player?.pending_ring_id as string | null | undefined) ?? null,
          }
        : null,
      rings: this.rings,
      loadout: this.loadout,
    };
  }

  /**
   * Dim and lock the Reliquary grid cards when the **spare (Bench) pool** is full
   * — the player cannot pull more rings from the Reliquary into the resting pool.
   * #424 — #388 lock removed: a full bench no longer dims SPIRIT cards or sets
   * __reliquaryLocked because occupied cards are now always valid swap targets.
   * Capacity limits apply only to insertions (ghost / drop-label paths), enforced
   * server-side and by the drop-time guard in reliquaryMove.
   *
   * Tracks Reliquary-full state (#182) via __reliquaryFull for the drop-label color.
   */
  private applyReliquaryLockState(): void {
    const s = window.__campState;
    if (!s) return;
    // #182 — track Reliquary-full state for the drop-label hint. The fallback
    // mirrors renderReliquaryHeader: resting rings are in_carry=0, not escrowed,
    // and NOT the equipped heart ring (heart_slot=1, which also rests at in_carry=0).
    const reliquaryCount: number =
      s.reliquaryCount ??
      s.rings.filter(
        (r: RingData) => r.in_carry === 0 && !(r as { escrowed?: number }).escrowed && r.heart_slot !== 1,
      ).length;
    const reliquaryCap: number = s.reliquaryCap ?? 20;
    window.__reliquaryFull = reliquaryCount >= reliquaryCap;
    // #426 — update the DOM SPIRIT header color to signal when the Reliquary is full.
    if (this.spiritHeader) {
      (this.spiritHeader.node as HTMLElement).style.color = window.__reliquaryFull ? '#ff5555' : '#ffdd66';
    }
  }

  /**
   * Selection callback from either InventoryGrid (universal-swap model, #154).
   * `ring` is the newly-selected ring or null on the grid's own deselect; `source`
   * is which grid fired. When a ring from a DIFFERENT source is already selected
   * the two are swapped; otherwise the click becomes the new selection. When the
   * Reliquary is locked (cap full) and nothing is selected, a Reliquary selection
   * is rejected (the card is inert until a carried slot is freed).
   */
  private onGridSelectionChanged(
    ring: RingData | null,
    source: 'reliquary' | 'spare',
  ): void {
    if (!ring) {
      // The grid deselected itself (same card clicked twice) — drop the selection.
      this.clearReliquarySelection();
      return;
    }
    void this.onRingClicked(ring.id, source);
  }

  /**
   * A ring was clicked from any section (grid card or battle slot). Implements the
   * universal-swap state machine: re-clicking the same ring deselects; clicking a
   * ring from a different source than the current selection swaps them; otherwise
   * the click replaces the selection. Carry-cap lock only blocks a fresh Reliquary
   * pick-up (swaps that free a carried slot are still allowed).
   */
  private async onRingClicked(ringId: string, source: SwapSlot): Promise<void> {
    const sel = this.swapManager?.selection ?? null;
    if (sel && sel.ringId === ringId) {
      // Same ring clicked twice — deselect.
      this.clearReliquarySelection();
      return;
    }
    if (sel && sel.source !== source) {
      // EPIC #302 — the Heart slot has dedicated server semantics (PUT
      // /api/heart-slot), so any swap touching it routes through reliquaryMove's
      // 'heart' path (the manager's resolveMove) rather than the carry/loadout
      // machinery in applySwap.
      if (source === 'heart' || sel.source === 'heart') {
        // A selected ring dropped onto the heart slot (equip, releasing the old
        // heart ring to the selected ring's section), OR the heart ring dropped
        // onto another section (unequip to that target). Both are a single move
        // of the held ring onto `source`, routed through the manager.
        await this.swapManager?.moveTo(source);
        return;
      }
      // Two distinct rings from distinct sources — perform the swap. The first
      // ring (sel) moves toward `source`'s section; reliquaryMove handles the
      // displaced occupant.
      await this.applySwap(sel, { ringId, source });
      return;
    }
    // Fresh pick-up (or re-pick from the same section).
    // #413 — Pick-up is never blocked; the bench-full guard fires at drop time in
    // reliquaryMove when target === 'spare'. SPIRIT ↔ battle-slot swaps are always
    // valid regardless of bench count (GDD §4 intent).
    this.setSelection({ ringId, source });
  }

  /**
   * Resolve a two-ring swap. #424 — every two-ring exchange (slot↔slot,
   * reliquary↔slot, spare↔slot, reliquary↔spare) routes through the atomic
   * PUT /api/rings/swap, a single server-side transaction. This replaces the
   * old multi-call carry/loadout orchestration (carrySwap / swapBattleSlots /
   * swapIntoBattleSlot), whose sequential PUTs could strand the loadout
   * referencing an uncarried ring on partial failure.
   */
  private async applySwap(
    a: { ringId: string; source: SwapSlot },
    b: { ringId: string; source: SwapSlot },
  ): Promise<void> {
    // EPIC #302 — heart sources/targets are routed before applySwap (onRingClicked),
    // so neither leg is ever 'heart' here. The wider type only satisfies the caller.
    this.clearReliquarySelection();
    if (await this.swapRingsMutation(a.ringId, b.ringId)) {
      await this.loadData();
      this.afterReliquaryReload();
    }
  }

  /**
   * Set the active selection and highlight the matching card/slot, clearing every
   * OTHER section's highlight. For grid sources the grid has already painted its
   * own selection stroke (the card click that called us), so we only clear the
   * non-grid sections and the opposite grid — never the grid that just selected
   * (clearing it would re-fire its onSelect(null) callback and recurse).
   */
  private setSelection(sel: { ringId: string; source: SwapSlot }): void {
    this.swapManager?.select(sel.ringId, sel.source);
    // The grids (reliquary/spare) own their stroke on click; clear the OTHER grid
    // so only one card is ever highlighted. For non-grid sources clear both grids.
    if (sel.source === 'reliquary') {
      this.loadoutGrid.clearSelection();
    } else if (sel.source === 'spare') {
      this.sanctumGrid.clearSelection();
    } else {
      this.sanctumGrid.clearSelection();
      this.loadoutGrid.clearSelection();
    }
    // #395 — HEALTH + COMBAT strokes are owned by BHC; repaint via refreshBhc.
    // Falls back to the old per-card repaint when the overlay class is not active.
    if (this.sanctumOverlay) {
      this.sanctumOverlay.refreshBhc(this.makeSanctumData());
    } else {
      this.renderHeartCard();
      this.renderCombatCluster();
    }
  }

  /**
   * Programmatic selection (E2E hook). Mirrors a click on a ring card / battle
   * slot. The `source` is the section name (`battle` is resolved to the actual
   * slot the ring is assigned to, for backward compatibility).
   */
  private selectReliquaryRing(
    ringId: string,
    source: 'reliquary' | 'spare' | 'battle',
  ): void {
    if (source === 'battle') {
      const slot = (SLOT_KEYS as readonly string[]).find((s) => this.loadout[s] === ringId) as
        | 'thumb'
        | LoadoutSlot
        | undefined;
      if (!slot) return;
      void this.onRingClicked(ringId, slot);
      return;
    }
    void this.onRingClicked(ringId, source);
  }

  /**
   * Click on a Battle Hand slot (Thumb / A1 / A2 / D1 / D2). Routes through the
   * universal-swap state machine: with a ring selected from a different section it
   * assigns/swaps into this slot; otherwise it picks up the slot's occupant as the
   * new selection. Clicking an empty slot with nothing selected is a no-op.
   */
  private async onBattleSlotClicked(slot: 'thumb' | LoadoutSlot): Promise<void> {
    const occupant = this.loadout[slot];
    if (occupant) {
      await this.onRingClicked(occupant, slot);
      return;
    }
    // Empty slot. If a ring is selected from elsewhere, assign it here (the
    // manager's moveTo resolves the move via reliquaryMove and clears selection).
    if (this.swapManager?.selection) {
      await this.swapManager.moveTo(slot);
    }
  }

  /**
   * EPIC #302 — click on the Heart slot card. With the heart occupied it routes
   * through onRingClicked with the `'heart'` source (which either picks up the
   * heart ring or, when a different ring is already selected, equips that ring).
   * With the heart empty and a ring selected elsewhere, equips that ring into the
   * heart slot, releasing nothing. Clicking an empty heart with nothing selected
   * is a no-op.
   */
  private async onHeartCardClicked(): Promise<void> {
    const heart = window.__campState?.heart_ring as RingData | null | undefined;
    if (heart) {
      await this.onRingClicked(heart.id, 'heart');
      return;
    }
    // Empty heart slot. If a ring is selected from elsewhere, equip it here — the
    // manager's moveTo passes the from-section as reliquaryMove's releaseFrom.
    if (this.swapManager?.selection) {
      await this.swapManager.moveTo('heart');
    }
  }

  /**
   * The RELIQUARY label was clicked: send the currently-selected carried ring
   * (Spare or Battle Hand) back to the Reliquary in one action. A Reliquary
   * selection or no selection is a no-op.
   */
  private async onReliquaryDropClicked(): Promise<void> {
    const sel = this.swapManager?.selection ?? null;
    if (!sel || sel.source === 'reliquary') return;
    await this.swapManager!.moveTo('reliquary');
  }

  /**
   * Execute a complete ring move from its current section to `target` and reload
   * authoritative state. The server is the source of truth for every effect:
   *   - Reliquary → Spare / Battle Hand: PUT /api/carry adds the ring to carry
   *     (aggregate_xp drops, spirit_max recomputed server-side); a Battle Hand
   *     target then PUTs /api/loadout to assign the slot.
   *   - Spare / Battle Hand → Reliquary: PUT /api/carry removes it (aggregate_xp
   *     rises); a battle ring is also nulled out of its slot.
   *   - within the loadout (Spare ↔ Battle Hand): PUT /api/loadout only — no
   *     carry change, so aggregate_xp is unchanged.
   * After the round-trip refreshPools rebuilds __campState and the header re-renders.
   *
   * #421 — returns `true` only when a mutation actually committed to the server.
   * Every early-return rejection path (ring not found, escrowed, bench-full guard,
   * failed carry/loadout/heart-slot round-trip) returns `false` so the shared
   * SlotSwapManager keeps the player's selection held instead of silently clearing
   * it (the Defect-2 symptom this fix removes from the field overlay).
   */
  private async reliquaryMove(
    ringId: string,
    target: SwapSlot,
    releaseFrom?: SwapSlot,
  ): Promise<boolean> {
    const ring = this.ringMap.get(ringId);
    if (!ring) {
      this.setStatus('Ring not found');
      return false;
    }
    if (ring.escrowed) {
      this.setStatus('Ring is locked in a duel');
      this.clearReliquarySelection();
      return false;
    }

    // #413 — Drop-time bench-full guard: reject any move that would overflow the bench.
    // Pick-up time no longer blocks; only a drop with target === 'spare' at capacity is
    // rejected. SPIRIT ↔ battle-slot swaps (target !== 'spare') are always valid.
    if (target === 'spare') {
      const s = window.__campState;
      const spareRingMax = s?.spare_ring_max ?? 9;
      const pendingId = (s?.player?.pending_ring_id as string | null | undefined) ?? null;
      const spareCount = benchSpareCount(this.rings as RingData[], this.loadout, pendingId);
      if (spareCount >= spareRingMax) {
        this.setStatus('Bench is full — discard a ring or move one to a battle slot first');
        return false;
      }
    }

    // EPIC #302 / #424 — Heart slot moves. An OCCUPIED heart target is a two-ring
    // exchange → atomic PUT /api/rings/swap (same occupied-vs-empty discriminant as
    // the battle-slot path below and BattleHandOverlay.resolveMove). PUT
    // /api/heart-slot is reserved for empty-heart insertions and unequips (the
    // heart ring moving out with no exchange partner).
    if (target === 'heart' || ring.heart_slot === 1) {
      const heartId = (window.__campState?.heart_ring as RingData | null | undefined)?.id ?? null;
      if (target === 'heart' && heartId && heartId !== ringId) {
        const swapped = await this.swapRingsMutation(ringId, heartId);
        this.clearReliquarySelection();
        if (!swapped) return false;
        await this.loadData();
        this.afterReliquaryReload();
        return true;
      }
      return this.heartSlotMove(ringId, target, releaseFrom);
    }

    const wasCarried = ring.in_carry === 1;
    const inBattleSlot = (SLOT_KEYS as readonly string[]).find((s) => this.loadout[s] === ringId);

    if (target === 'reliquary') {
      // Leave at the Reliquary: drop from carry. If it was in a battle slot, null
      // that slot first so the loadout never references an uncarried ring.
      if (inBattleSlot) {
        const ok = await this.putLoadout({ [inBattleSlot]: null });
        if (!ok) {
          this.clearReliquarySelection();
          return false;
        }
      }
      const moved = await this.moveToCarry(ringId, false);
      this.clearReliquarySelection();
      return moved;
    }

    if (target === 'spare') {
      // Into Spare: carry the ring if it isn't already, then unassign any battle
      // slot so it falls into the spare (carried-but-unslotted) pool.
      if (!wasCarried) {
        const ok = await this.carryRing(ringId);
        if (!ok) {
          this.clearReliquarySelection();
          return false;
        }
      } else if (inBattleSlot) {
        const ok = await this.putLoadout({ [inBattleSlot]: null });
        if (!ok) {
          this.clearReliquarySelection();
          return false;
        }
      }
      this.clearReliquarySelection();
      await this.loadData();
      this.afterReliquaryReload();
      return true;
    }

    // target is a named battle slot. #424 — if the slot is occupied, use PUT
    // /api/rings/swap (capacity-free exchange). An empty slot uses the existing
    // carry-first + assign path (genuine insertion).
    const slotOccupant = this.loadout[target] ?? null;
    if (slotOccupant && slotOccupant !== ringId) {
      const swapped = await this.swapRingsMutation(ringId, slotOccupant);
      this.clearReliquarySelection();
      if (!swapped) return false;
      await this.loadData();
      this.afterReliquaryReload();
      return true;
    }

    // Empty slot insertion — carry the ring first if needed, then assign.
    if (!wasCarried) {
      const ok = await this.carryRing(ringId);
      if (!ok) {
        this.clearReliquarySelection();
        return false;
      }
    }
    const assigned = await this.putLoadout({ [target]: ringId });
    this.clearReliquarySelection();
    if (!assigned) return false;
    await this.loadData();
    this.afterReliquaryReload();
    return true;
  }

  /**
   * #424 — PUT /api/rings/swap for a capacity-free two-ring exchange. Surfaces
   * errors via setStatus (mirrors putLoadout's error-surfacing pattern).
   */
  private async swapRingsMutation(ringId1: string, ringId2: string): Promise<boolean> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return false;
    }
    try {
      const res = await apiFetch('/api/rings/swap', { method: 'PUT', json: { ringId1, ringId2 } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Swap failed (${res.status})`);
        return false;
      }
    } catch (err: unknown) {
      console.error('[swapRings]', err);
      this.setStatus('Network error during ring swap');
      return false;
    }
    return true;
  }

  /**
   * #423 — Permanently delete a ring via DELETE /api/rings/:id and reload.
   * Used by the sanctum discard confirm flow (DISCARD slot in BHC).
   */
  private async deleteRingFromSanctum(ringId: string, ov: RingManagementOverlay): Promise<void> {
    try {
      await apiFetch(`/api/rings/${ringId}`, { method: 'DELETE' });
    } catch {
      this.setStatus('Discard failed — network error');
      ov.clearSelection();
      return;
    }
    ov.clearSelection();
    await this.loadData();
    this.afterReliquaryReload();
  }

  /**
   * EPIC #302 — execute a Heart-slot move via PUT /api/heart-slot and reload
   * authoritative state. The server owns the atomic equip/swap and recomputes
   * spirit. Two cases:
   *   - Equip into the heart (`target === 'heart'`): `ringId` becomes the heart
   *     ring; the displaced heart ring is released to `releaseFrom` (the section the
   *     equipped ring came from, defaulting to the Reliquary). For a battle-slot
   *     `releaseFrom` the server performs a slot-for-slot swap (ringId ignored).
   *   - Unequip the heart (`ringId` is the current heart ring, `target` ≠ 'heart'):
   *     the heart slot is cleared and the ring is routed to `target`.
   * The releaseTo targets the server accepts: reliquary | spare | thumb | a1..d2.
   *
   * #421 — returns `true` when the heart-slot mutation committed, `false` when the
   * round-trip failed, so {@link reliquaryMove} can propagate commit status.
   */
  private async heartSlotMove(
    ringId: string,
    target: SwapSlot,
    releaseFrom?: SwapSlot,
  ): Promise<boolean> {
    // Build the { ringId?, releaseTo? } body. Equip vs unequip is decided by
    // whether the heart is the move target. 'heart' is never a valid releaseTo.
    let body: { ringId?: string; releaseTo?: string };
    if (target === 'heart') {
      const releaseTo = releaseFrom && releaseFrom !== 'heart' ? releaseFrom : 'reliquary';
      body = { ringId, releaseTo };
    } else {
      // Unequip the current heart ring to `target` (no ringId → clear the slot).
      body = { releaseTo: target };
    }
    try {
      await apiClient.put('/api/heart-slot', body);
    } catch {
      this.setStatus('Heart slot move failed');
      this.clearReliquarySelection();
      return false;
    }
    this.clearReliquarySelection();
    await this.loadData();
    this.afterReliquaryReload();
    return true;
  }

  /**
   * Add one ring to the carried set via PUT /api/carry, enforcing the carry cap
   * locally for a friendly message (the server is still authoritative). Returns
   * whether the carry succeeded. Does NOT reload — the caller batches the reload.
   */
  private async carryRing(ringId: string): Promise<boolean> {
    const carried = new Set(this.rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    if (carried.has(ringId)) return true;
    if (carried.size >= this.carryCap) {
      this.setStatus('Loadout is full — leave a ring at the Reliquary first');
      return false;
    }
    carried.add(ringId);
    return this.putCarry(Array.from(carried), false);
  }

  /** Clear the pending selection and every section's selection highlight. */
  private clearReliquarySelection(): void {
    this.swapManager?.clear();
    this.clearSelectionHighlights();
  }

  /**
   * Clear the yellow selection stroke on both grids and the COMBAT cluster + heart
   * card without touching the swap manager's selection. Used before re-applying a
   * fresh highlight and when clearing the selection entirely.
   */
  private clearSelectionHighlights(): void {
    this.sanctumGrid.clearSelection();
    this.loadoutGrid.clearSelection();
    // #395 — HEALTH + COMBAT strokes are owned by BHC when sanctumOverlay is active.
    if (this.sanctumOverlay) {
      this.sanctumOverlay.refreshBhc(this.makeSanctumData());
    } else {
      this.renderHeartCard();
      this.renderCombatCluster();
    }
  }

  /** Re-render header + lock state after a Reliquary modal reload. */
  private afterReliquaryReload(): void {
    if (this.overlayName !== 'ringwall') return;
    this.applyReliquaryLockState();
    this.renderReliquaryHeader();
  }

  /**
   * #85 Fix 2A — route a mouse-wheel event to whichever inventory grid the pointer
   * is over (if any), scrolling it one row per notch. The pointer's screen
   * position is tested against each grid's clip rectangle (world transform +
   * getMaskSize). A wheel outside both grids, or over a non-scrollable grid, is a
   * no-op. Bound while the ring-storage overlay is open; removed in onClose.
   */
  private onRingwallWheel(
    pointer: Phaser.Input.Pointer,
    _over: unknown,
    _dx: number,
    deltaY: number,
  ): void {
    if (this.overlayName !== 'ringwall') return;
    const dir = deltaY > 0 ? 1 : -1;
    const grid = this.gridUnderPointer(pointer);
    if (!grid) return;
    grid.scrollBy(dir);
    this.publishScrollState();
  }

  /**
   * Return the inventory grid whose visible clip rectangle contains the pointer's
   * screen position, or null. The overlay is camera-pinned (scrollFactor 0), so a
   * grid's getWorldTransformMatrix tx/ty is its top-left in screen space and the
   * pointer's plain x/y compares directly.
   */
  private gridUnderPointer(pointer: Phaser.Input.Pointer): InventoryGrid | null {
    // #395 — when the sanctum overlay is active, scroll targets are sanctumGrid (SPIRIT)
    // and BHC's bench grid. Fall back to loadoutGrid for non-overlay contexts.
    const benchGrid = this.sanctumOverlay?.getBenchGrid() ?? this.loadoutGrid;
    for (const grid of [this.sanctumGrid, benchGrid]) {
      const m = grid.getWorldTransformMatrix();
      const { width, height } = grid.getMaskSize();
      if (
        pointer.x >= m.tx &&
        pointer.x <= m.tx + width &&
        pointer.y >= m.ty &&
        pointer.y <= m.ty + height
      ) {
        return grid;
      }
    }
    return null;
  }

  /**
   * #85 Fix 2A — mirror both grids' live scroll state into __campState so E2E can
   * assert it before/after every scroll. Only meaningful while the ring-storage
   * overlay is open (the grids are masked); a no-op when __campState is absent.
   */
  private publishScrollState(): void {
    if (!window.__campState) return;
    window.__campState.sanctumScrollRow = this.sanctumGrid.getScrollRow();
    window.__campState.sanctumTotalRows = this.sanctumGrid.getTotalRows();
    window.__campState.sanctumVisibleRows = this.sanctumGrid.getVisibleRows();
    // #395 — when the sanctum overlay is active, the BENCH (loadout) grid is owned
    // by BenchHealthCombat inside the overlay class. Mirror its scroll state;
    // fall back to the legacy loadoutGrid when the overlay is closed.
    const benchGrid = this.sanctumOverlay?.getBenchGrid() ?? this.loadoutGrid;
    window.__campState.loadoutScrollRow = benchGrid.getScrollRow();
    window.__campState.loadoutTotalRows = benchGrid.getTotalRows();
    window.__campState.loadoutVisibleRows = benchGrid.getVisibleRows();
  }

  /**
   * #81 — fetch GET /api/talisman-loadout, publish it to window.__talismanLoadout
   * for E2E, and render the equipped necklace talisman + remaining charges into
   * the given label (e.g. "Sanctum Stone ●●○"). When nothing is equipped the label
   * shows "Necklace: (empty)". Display-only — no equip UI. Best-effort: a network
   * or auth failure leaves the placeholder label as-is.
   */
  private async loadTalismanLoadout(label: Phaser.GameObjects.Text): Promise<void> {
    if (!getToken()) return;
    let payload: { necklaceId: string | null; necklaceCharges: number };
    try {
      const res = await apiFetch('/api/talisman-loadout');
      if (!res.ok) return;
      payload = await res.json();
    } catch {
      return;
    }
    window.__talismanLoadout = payload;
    // The label may have been destroyed if the overlay closed mid-fetch.
    if (!label.active) return;
    if (!payload.necklaceId) {
      label.setText('Necklace: (empty)');
      return;
    }
    const def = getTalisman(payload.necklaceId);
    const name = def?.name ?? payload.necklaceId;
    const max = def?.maxCharges ?? payload.necklaceCharges;
    label.setText(`${name} ${usePips(payload.necklaceCharges, max)}`);
  }

  /**
   * Meditation circle: ring recharge ([Recharge] selected / [Recharge All]) and
   * a disabled "Teleport (8B)" label. Recharge targets the grid selection — the
   * carry/loadout grids are not shown here, so [Recharge] recharges the
   * currently selected ring if any, and [Recharge All] tops off all carried.
   */
  private openMeditationOverlay(): void {
    const c = this.beginModalOverlay('meditation', 'MEDITATION CIRCLE');
    // #382 — all labels are Container (c) children → crispCanvasText.
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 150, 'Channel spirit to recharge your rings.', {
            fontSize: '13px',
            color: '#cccccc',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      ),
    );
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2 - 120, 220, '[Recharge]', { fontSize: '16px', color: '#ffcc44' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.doRechargeSelected()),
      ),
    );
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2 + 60, 220, '[Recharge All]', { fontSize: '16px', color: '#ffcc44' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.doRechargeAll()),
      ),
    );
    // Teleport (8B.3): opens the waystone teleport modal (server-gated).
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 300, '[Teleport]', { fontSize: '15px', color: '#ffcc44' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setName('teleport-btn')
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.openTeleportModal()),
      ),
    );
  }

  // ── Teleport / Sanctum anchoring (8B.3, #63) ──────────────────────────────

  /**
   * Open the teleport modal: GET /api/waystones, then render one row per
   * waystone in the correct gate state — undiscovered (not attuned) rows are
   * masked, attuned-but-XP-locked rows show their requirement, and attuned +
   * unlocked rows expose a [Travel] button. The current anchor is labeled. The
   * full payload is published to window.__teleportState for E2E before render.
   */
  private async openTeleportModal(): Promise<void> {
    if (!getToken()) return;
    let payload: {
      aggregateXp: number;
      spiritCurrent?: number;
      anchor: string;
      waystones: Array<{
        id: string;
        name: string;
        xpThreshold: number;
        spiritCost?: number;
        attuned: boolean;
        meetsThreshold: boolean;
      }>;
    };
    try {
      const res = await apiFetch('/api/waystones');
      if (!res.ok) return;
      payload = await res.json();
    } catch {
      return;
    }

    // Publish for E2E before rendering. #87 Part B — include spirit cost + current
    // so tests can assert the §10.8 spirit-gate affordability per destination.
    window.__teleportState = {
      anchor: payload.anchor,
      spiritCurrent: payload.spiritCurrent,
      rows: payload.waystones.map((w) => ({
        id: w.id,
        name: w.name,
        attuned: w.attuned,
        meetsThreshold: w.meetsThreshold,
        xpThreshold: w.xpThreshold,
        spiritCost: w.spiritCost,
      })),
    };

    // Scroll grid layout: 5 rows visible, 52px per row. Visibility-windowed (same
    // pattern as InventoryGrid) — GeometryMask is unreliable in nested Containers
    // under a multi-camera setup in Phaser 4.
    const ROW_H = 52;
    const VISIBLE_ROWS = 5;
    const LIST_TOP = 140;
    const LIST_BOTTOM = LIST_TOP + VISIBLE_ROWS * ROW_H; // 400
    const ARROW_X = CANVAS_W / 2 + 330;
    const NAME_X = CANVAS_W / 2 - 310;
    const BTN_X = CANVAS_W / 2 + 80;

    let scrollRow = 0;
    const totalRows = payload.waystones.length;

    type RowEntry = {
      nameText: Phaser.GameObjects.Text;
      subText?: Phaser.GameObjects.Text;
      btnText?: Phaser.GameObjects.Text;
    };
    const rows: RowEntry[] = [];

    const c = this.beginModalOverlay('teleport', 'TELEPORT');

    // Spirit balance display
    // #382 — Container (c) child → crispCanvasText.
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 95, `Spirit: ${payload.spiritCurrent ?? 0}`, {
            fontSize: '14px',
            color: '#88ccff',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      ),
    );

    // Thin divider below header
    c.add(
      this.add
        .rectangle(CANVAS_W / 2, 115, 680, 1, 0x444466)
        .setScrollFactor(0),
    );

    // Scroll arrows — Container (c) children → crispCanvasText.
    const upArrow = crispCanvasText(
      this.add
        .text(ARROW_X, LIST_TOP + 8, '▲', { fontSize: '14px', color: '#aaaaaa' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true }),
    );
    const downArrow = crispCanvasText(
      this.add
        .text(ARROW_X, LIST_BOTTOM - 8, '▼', { fontSize: '14px', color: '#aaaaaa' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true }),
    );
    c.add([upArrow, downArrow]);

    const applyScroll = (): void => {
      for (let i = 0; i < rows.length; i++) {
        const inView = i >= scrollRow && i < scrollRow + VISIBLE_ROWS;
        const rowTopY = LIST_TOP + (i - scrollRow) * ROW_H;
        const r = rows[i];
        r.nameText.setVisible(inView).setY(rowTopY + 16);
        if (r.subText) r.subText.setVisible(inView).setY(rowTopY + 34);
        if (r.btnText) r.btnText.setVisible(inView).setY(rowTopY + 16);
      }
      upArrow.setAlpha(scrollRow > 0 ? 1 : 0.3);
      downArrow.setAlpha(scrollRow + VISIBLE_ROWS < totalRows ? 1 : 0.3);
    };

    const scroll = (delta: number): void => {
      const maxScroll = Math.max(0, totalRows - VISIBLE_ROWS);
      scrollRow = Math.max(0, Math.min(maxScroll, scrollRow + delta));
      applyScroll();
    };

    upArrow.on('pointerdown', () => scroll(-1));
    downArrow.on('pointerdown', () => scroll(1));

    // Mouse-wheel scrolls the list; removed when the overlay closes.
    const wheelHandler = (
      _p: Phaser.Input.Pointer,
      _go: unknown,
      _dx: number,
      dy: number,
    ): void => {
      if (this.overlayName !== 'teleport') return;
      scroll(dy > 0 ? 1 : -1);
    };
    this.input.on('wheel', wheelHandler);
    this.overlayOnClose = () => this.input.off('wheel', wheelHandler);

    // Build one row per waystone
    for (const w of payload.waystones) {
      const isAnchor = w.id === payload.anchor;
      const anchorMark = isAnchor ? ' ★' : '';

      // #382 — all waystone-row texts are Container (c) children → crispCanvasText.
      if (!w.attuned) {
        const nameText = crispCanvasText(
          this.add
            .text(NAME_X, 0, `??? — undiscovered${anchorMark}`, { fontSize: '14px', color: '#555555' })
            .setOrigin(0, 0.5)
            .setScrollFactor(0),
        );
        c.add(nameText);
        rows.push({ nameText });
      } else if (!w.meetsThreshold) {
        // #87 Part B — spirit-locked: name greyed out, cost shown as subtitle.
        const nameText = crispCanvasText(
          this.add
            .text(NAME_X, 0, `${w.name}${anchorMark}`, { fontSize: '14px', color: '#888888' })
            .setOrigin(0, 0.5)
            .setScrollFactor(0),
        );
        const subText = crispCanvasText(
          this.add
            .text(NAME_X, 0, `${w.spiritCost ?? 0} spirit required`, { fontSize: '12px', color: '#666666' })
            .setOrigin(0, 0.5)
            .setScrollFactor(0),
        );
        c.add([nameText, subText]);
        rows.push({ nameText, subText });
      } else {
        // Attuned + affordable — actionable [Travel] button.
        const nameText = crispCanvasText(
          this.add
            .text(NAME_X, 0, `${w.name}${anchorMark}`, { fontSize: '14px', color: '#cccccc' })
            .setOrigin(0, 0.5)
            .setScrollFactor(0),
        );
        const btnText = crispCanvasText(
          this.add
            .text(BTN_X, 0, `[Travel — ${w.spiritCost ?? 0} spirit]`, {
              fontSize: '13px',
              color: '#ffcc44',
            })
            .setOrigin(0, 0.5)
            .setScrollFactor(0)
            .setName(`travel-${w.id}`)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => void this.doTeleport(w.id, w.name)),
        );
        c.add([nameText, btnText]);
        rows.push({ nameText, btnText });
      }
    }

    applyScroll();
  }

  /**
   * POST /api/teleport to re-anchor the Sanctum. On success closes the modal and
   * shows a brief confirmation toast; on a 400 surfaces the server's error inline
   * in the open overlay. The anchor in window.__teleportState is updated so E2E
   * can read the new state without a re-fetch.
   */
  private async doTeleport(waystoneId: string, waystoneName: string): Promise<void> {
    if (!getToken()) return;
    let res: Response;
    try {
      res = await apiFetch('/api/teleport', { method: 'POST', json: { waystoneId } });
    } catch {
      this.showTeleportError('Network error during teleport');
      return;
    }
    if (res.ok) {
      this.closeModalOverlay();
      // #118: toast lives in uiRoot (a Container) → renders at 1:1 through uiCam.
      // #382 — Container (uiRoot) child → crispCanvasText.
      const msg = crispCanvasText(
        this.add
          .text(CANVAS_W / 2, CANVAS_H / 2 - 50, `Sanctum re-anchored near ${waystoneName}`, {
            fontSize: '14px',
            color: '#aaffaa',
            backgroundColor: '#222222',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(600)
          .setName('teleport-confirm'),
      );
      this.uiRoot.add(msg);
      this.time.delayedCall(2000, () => {
        this.uiRoot?.remove(msg);
        msg.destroy();
      });
      if (window.__teleportState) {
        window.__teleportState.anchor = waystoneId;
      }
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      this.showTeleportError(body?.error ?? 'Teleport failed');
    }
  }

  /**
   * Show a teleport error.
   *
   * #118: kept at scene root (not inside uiRoot) so that the E2E lookup
   * `scene.children.getByName('teleport-error')` continues to find it. To
   * render at 1:1 through uiCam rather than the 2× world camera we tell
   * cameras.main to ignore it individually and rely on uiCam (which ignores
   * nothing at the scene-root level) to display it.
   */
  private showTeleportError(message: string): void {
    // #382 — scene-level text (not in a Container) routed to uiCam → crispCanvasText.
    const errText = crispCanvasText(
      this.add
        .text(CANVAS_W / 2, 420, message, { fontSize: '13px', color: '#ff6666' })
        .setOrigin(0.5)
        .setDepth(4001) // above the overlay container (depth 4000)
        .setName('teleport-error'),
    );
    // Exclude from the 2× world camera so the text renders at 1:1 via uiCam.
    this.routeToUi(errText);
    this.time.delayedCall(8000, () => {
      if (errText.active) {
        // #118: clear the ignore flag before destroying (mirrors the ignore above).
        this.unignoreMain(errText);
        errText.destroy();
      }
    });
  }

  /** Bed: sleep confirmation overlay ([Sleep — 25 food] → doSleep). */
  private openBedOverlay(): void {
    const c = this.beginModalOverlay('bed', 'REST');
    const food = window.__campState?.food_units ?? 0;
    // #382 — Container (c) children → crispCanvasText.
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 170, `Sleep to fully restore spirit and advance a day. (Food: ${food})`, {
            fontSize: '13px',
            color: '#cccccc',
          })
          .setOrigin(0.5)
          .setScrollFactor(0),
      ),
    );
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 250, '[Sleep — 25 food]', { fontSize: '18px', color: '#88ccff' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setName('sleep-confirm')
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.confirmSleep()),
      ),
    );
  }

  /** Sleep, then close the bed overlay (state is reloaded by doSleep). */
  private async confirmSleep(): Promise<void> {
    await this.doSleep();
    if (this.overlayName === 'bed') this.closeModalOverlay();
  }

  /**
   * Campfire overlay (#181): two actions — [Rest] (25 food via /api/camp/sleep)
   * and [Summon Sanctum] (POST /api/sanctum/summon using the player's current
   * anchorage from window.__teleportState).
   */
  private openCampfireOverlay(): void {
    const c = this.beginModalOverlay('eat', 'CAMPFIRE');
    const food = window.__campState?.food_units ?? 0;

    // #382 — all campfire-overlay labels are Container (c) children → crispCanvasText.
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 150, `Food stores: ${food} units`, { fontSize: '14px', color: '#ffdd88' })
          .setOrigin(0.5)
          .setScrollFactor(0),
      ),
    );

    // Status label for results/errors.
    const statusLbl = crispCanvasText(
      this.add
        .text(CANVAS_W / 2, 370, '', { fontSize: '12px', color: '#ff8888' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setName('campfire-status'),
    );
    c.add(statusLbl);

    const setFireStatus = (msg: string, color = '#ff8888'): void => {
      statusLbl.setText(msg).setColor(color);
    };

    // [Rest — 25 food] button.
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 220, '[Rest — 25 food]', { fontSize: '17px', color: '#88ccff' })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            void (async () => {
              await this.doSleep();
              // doSleep calls loadData on success; surface errors via status label.
              if (this.overlayName === 'eat') setFireStatus('');
            })();
          }),
      ),
    );

    // [Summon Sanctum] button.
    const anchorId = window.__teleportState?.anchor ?? null;
    const summonColor = anchorId ? '#aaffcc' : '#888888';
    const summonLabel = anchorId
      ? '[Summon Sanctum]'
      : '[Summon Sanctum] — no anchorage attuned';
    c.add(
      crispCanvasText(
        this.add
          .text(CANVAS_W / 2, 295, summonLabel, { fontSize: '17px', color: summonColor })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            if (!anchorId) {
              setFireStatus('You are not attuned to any Anchorage');
              return;
            }
            void (async () => {
              await this.doSummonSanctum(anchorId, setFireStatus);
            })();
          }),
      ),
    );
  }

  /**
   * POST /api/sanctum/summon with the player's current anchorage. On success
   * shows the cost and reloads state; on error shows the error message.
   */
  private async doSummonSanctum(
    anchorageId: string,
    setStatus: (msg: string, color?: string) => void,
  ): Promise<void> {
    const token = getToken();
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    const result = await summonSanctumHelper(token, anchorageId);
    if ('error' in result) {
      setStatus(result.error);
      return;
    }
    setStatus(`Sanctum summoned! (cost: ${result.spiritCost} spirit)`, '#aaffcc');
    await this.loadData();
  }

  // ── Reusable panels (parked off-screen; overlays use them in 8A.2) ────────

  /**
   * Create the inventory/loadout/fusion panel instances once. They are parked
   * off the visible canvas so `loadData()` can still populate them (and
   * `__campState`) while the spatial room is shown. 8A.2 re-parents them into
   * modal overlay containers when a zone is interacted with.
   */
  private buildPanels(): void {
    // #395 — the swap controller is created per overlay open in openRingwallOverlay()
    // (one controller per open overlay, created fresh on each open, cleared on close).
    // #154 — the two grids drive the universal-swap selection. Both are 3-column
    // (Reliquary and Spare). The Reliquary grid (sanctumGrid) selecting a card
    // picks it up as a 'reliquary' source; the Spare grid (loadoutGrid) as 'spare'.
    // A null callback (the grid's own deselect) clears the pending selection.
    this.sanctumGrid = new InventoryGrid(
      this,
      OFFSCREEN_X,
      OFFSCREEN_Y,
      (ring) => void this.onGridSelectionChanged(ring, 'reliquary'),
      3,
    );
    this.loadoutGrid = new InventoryGrid(
      this,
      OFFSCREEN_X + 350,
      OFFSCREEN_Y,
      (ring) => void this.onGridSelectionChanged(ring, 'spare'),
      3,
    );
    // #389 — the COMBAT cluster (STATUS + A1/A2/D1/D2) is no longer a parked
    // reusable panel; it is built fresh per overlay open (buildCombatCluster) as
    // overlay-scoped RingCards, matching the field overlay and the heart card.
    // #118 P2: parked grids are invisible so neither camera traverses them per
    // frame. adoptPanel re-shows them when an overlay opens; releasePanel hides
    // them again. They are still populated by loadData() while hidden.
    this.sanctumGrid.setVisible(false);
    this.loadoutGrid.setVisible(false);
    // #396 — FusionPanel retired; fusion overlay is created on-demand in openFusionPanel().
    // EPIC #279 — difficulty selector. On a confirmed tier change the server
    // returns the recomputed spirit_max; mirror it into __campState and re-render
    // both stats displays (the main stat line + the open Reliquary header, if any).
    this.difficultyModal = new DifficultyModal(
      this,
      API_BASE,
      () => getToken(),
      (tier, spiritMax) => this.applyDifficultyChange(tier, spiritMax),
      (container) => {
        // #118: clear the main-camera ignore flag before the modal destroys it.
        if (container) this.unignoreMain(container);
      },
    );

    // Off-screen header/stat/status texts the panels & overlays update. These
    // mirror the old flat layout's labels but are not visible until an overlay
    // adopts them (8A.2 reads their text into overlay-local labels).
    // #382 — these offscreen tracking labels are scene-level (not Container children)
    // and are used for data storage / E2E access → crispCanvasText.
    this.statLineText = crispCanvasText(
      this.add
        .text(OFFSCREEN_X, OFFSCREEN_Y - 60, 'Day: — | Gold: — | Food: — | Spirit: —/—', {
          fontSize: '14px',
          color: '#ffdd66',
        })
        .setName('stat-line'),
    );
    this.loadoutHeaderText = crispCanvasText(
      this.add
        .text(OFFSCREEN_X + 350, OFFSCREEN_Y - 30, 'Loadout (0/10)', {
          fontSize: '14px',
          color: '#cccccc',
        })
        .setName('loadout-header'),
    );
    this.statusText = crispCanvasText(
      this.add
        .text(OFFSCREEN_X, OFFSCREEN_Y - 100, '', { fontSize: '13px', color: '#ff8888' })
        .setName('camp-status'),
    );
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /** Fetch /api/me and repopulate all three pools. */
  private async loadData(): Promise<void> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return;
    }

    let data: { player: any; rings: RingData[]; loadout: Record<string, string | null> };
    try {
      const res = await apiFetch('/api/me');
      if (res.status === 401) {
        localStorage.removeItem('er_token');
        this.scene.start('LoginScene');
        return;
      }
      if (!res.ok) {
        this.setStatus(`Failed to load data (${res.status})`);
        return;
      }
      data = await res.json();
    } catch {
      this.setStatus('Network error — could not reach server');
      return;
    }

    this.setStatus('');

    const { player, rings, loadout } = data;
    this.rings = rings;
    this.loadout = loadout ?? {};
    this.carryCap = player.carry_cap ?? 5;
    this.ringMap = new Map(rings.map((r) => [r.id, r]));

    this.refreshPools(player);
  }

  /**
   * EPIC #279 — bracketed difficulty label (e.g. `[Seeker]`) appended after the
   * spirit display. Defaults to Seeker before /api/me loads or if the field is
   * absent (older server). Capitalises the stored lowercase tier.
   */
  private static difficultyLabel(tier: DifficultyTier | undefined): string {
    const t: DifficultyTier = tier ?? 'seeker';
    return `[${t.charAt(0).toUpperCase()}${t.slice(1)}]`;
  }

  /**
   * EPIC #279 — the full-width main stat line. Extracted so both refreshPools and
   * applyDifficultyChange render the same string (with the bracketed difficulty
   * label after spirit). `aggregate_xp` is relabelled "XP" — still the raw
   * Reliquary XP sum used for ring-tier display, no longer a spirit_max input.
   */
  private buildStatLine(player: any): string {
    return (
      `Day: ${player.game_day ?? 0} | Gold: ${player.gold ?? 0} | ` +
      `Food: ${player.food_units ?? 0} | ` +
      `Spirit: ${player.spirit_current ?? 0}/${player.spirit_max ?? 0} ` +
      `${CampScene.difficultyLabel(player.difficulty)} | ` +
      `XP: ${player.aggregate_xp ?? 0}`
    );
  }

  /** Split rings into the three pools and repopulate the UI from current state. */
  private refreshPools(player: any): void {
    this.statLineText.setText(this.buildStatLine(player));

    const battleHandIds = new Set(
      SLOT_KEYS.map((s) => this.loadout[s]).filter(Boolean) as string[],
    );
    // EPIC #302 — the equipped heart ring rests outside carry (in_carry = 0) but is
    // shown in its own Heart card, NOT the SPIRIT (Reliquary) grid. Exclude it here
    // so it never appears in both places.
    const atSanctum = this.rings.filter((r) => r.in_carry === 0 && r.heart_slot !== 1);
    const loadoutPool = this.rings.filter((r) => r.in_carry === 1 && !battleHandIds.has(r.id));
    const carriedCount = this.rings.filter((r) => r.in_carry === 1).length;

    this.sanctumGrid.populate(atSanctum);
    this.loadoutGrid.populate(loadoutPool);
    // #389 — the COMBAT cluster (when the overlay is open) is repainted from the
    // fresh loadout/ringMap by afterReliquaryReload → renderCombatCluster below.

    // #263 — publish the rendered two-tone fill order per ring id (across both
    // grids) so an E2E test can assert which component color leads on each card
    // ([dominant, other] for a fusion, [element] for a base ring).
    window.__campFusedFills = {
      ...this.sanctumGrid.allFusedFillOrders(),
      ...this.loadoutGrid.allFusedFillOrders(),
    };

    // #78 ④ — derive the Thumb passive reminder. No staked Thumb ring → null; a
    // base element (0–4) → its named passive; a fusion (5–14, no entry) → an
    // explicit "no passive" note. The server owns the real passive at duel start.
    const thumbRing = this.loadout.thumb ? this.ringMap.get(this.loadout.thumb) : undefined;
    const passiveInfo = thumbRing ? THUMB_PASSIVE_INFO[thumbRing.element] : undefined;
    this.stakedPassive = !thumbRing
      ? null
      : passiveInfo
      ? { name: passiveInfo.name, effect: passiveInfo.effect }
      : { name: null, effect: 'Fused rings grant no passive' };
    // EPIC #302 — the passive is now a hover tooltip (read lazily on hover), so no
    // strip is repainted here; `stakedPassive` feeds both the tooltip and the
    // __campState.staked_passive mirror below.

    this.loadoutHeaderText.setText(`Loadout (${carriedCount}/${this.carryCap})`);

    window.__campState = {
      player,
      rings: this.rings,
      loadout: this.loadout,
      atSanctum,
      loadout_pool: loadoutPool,
      battleHand: SLOT_KEYS.map((s) => this.loadout[s])
        .filter(Boolean)
        .map((id) => this.ringMap.get(id as string))
        .filter(Boolean) as RingData[],
      carry_cap: this.carryCap,
      spirit_current: player.spirit_current ?? 0,
      spirit_max: player.spirit_max ?? 0,
      food_units: player.food_units ?? 0,
      aggregate_xp: player.aggregate_xp ?? 0,
      // EPIC #279 — difficulty tier from /api/me (default seeker on older servers).
      difficulty: (player.difficulty ?? 'seeker') as DifficultyTier,
      staked_passive: this.stakedPassive,
      // #182 — reliquary cap fields from /api/me
      reliquaryCap: player.reliquaryCap,
      reliquaryShards: player.reliquaryShards,
      reliquaryCount: player.reliquaryCount,
      // EPIC #378/#388 — spare-grid cap from /api/me (server-computed). Drives the
      // Reliquary SPIRIT-grid lock in applyReliquaryLockState. Replaces the dead
      // `spareCapacity` alias dropped in #383. Default 9 on older servers.
      spare_ring_max: player.spare_ring_max ?? 9,
      // EPIC #302 — heart slot fields from /api/me. heart_ring drives the Heart card
      // + center header (♥ cur/max); total_xp + battle_hand_avg_xp drive the right
      // header segment. All server-computed.
      heart_ring: player.heart_ring ?? null,
      total_xp: player.total_xp ?? undefined,
      battle_hand_avg_xp: player.battle_hand_avg_xp ?? undefined,
    };

    // #85 Fix 2A — refreshPools rebuilds __campState wholesale, which can happen
    // while the ring-storage overlay is open (after a carry move reloads). Re-mirror
    // the grids' live scroll state so the E2E scroll fields are never dropped.
    this.publishScrollState();

    // #154 — populate() rebuilt the Reliquary grid cards (resetting alpha), so the
    // cap-lock state and the live stats header must be re-applied if the modal is
    // open. afterReliquaryReload is a no-op when the modal is closed.
    this.afterReliquaryReload();
  }

  /**
   * EPIC #302 — the Thumb passive reminder text for the hover tooltip (replaces
   * the permanent strip). Read lazily by {@link attachTooltip} on every hover so it
   * tracks live stake/loadout changes. Empty string when no Thumb ring is staked
   * (the tooltip suppresses itself); otherwise the passive name (or "No passive"
   * for a fusion) and its effect text on two lines. The `stakedPassive` source is
   * still recomputed in refreshPools and mirrored into __campState.staked_passive.
   */
  private thumbPassiveTooltipText(): string {
    if (!this.stakedPassive) return '';
    return this.stakedPassive.name
      ? `${this.stakedPassive.name}\n${this.stakedPassive.effect}`
      : `No passive\n${this.stakedPassive.effect}`;
  }

  // ── Carry moves (#40, #154) ───────────────────────────────────────────────

  /**
   * Set a ring's carried state via PUT /api/carry. Computes the new carried set
   * from the cached snapshot and lets the server enforce the cap & ownership.
   * Used by the legacy __campAddToLoadout / __campLeaveAtSanctum E2E hooks and by
   * the Reliquary modal's "leave at Reliquary" path.
   */
  private async moveToCarry(ringId: string, inCarry: boolean): Promise<boolean> {
    // #421 — returns `true` only when the carry change committed to the server, so
    // reliquaryMove can propagate commit status to the shared SlotSwapManager.
    const carried = new Set(this.rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    if (inCarry) {
      if (carried.size >= this.carryCap) {
        this.setStatus('Loadout is full — leave a ring at the Reliquary first');
        return false;
      }
      carried.add(ringId);
    } else {
      carried.delete(ringId);
    }
    if (await this.putCarry(Array.from(carried), false)) {
      await this.loadData();
      this.afterReliquaryReload();
      return true;
    }
    return false;
  }

  /**
   * PUT /api/carry with the full carried set. When `reload` is true the cached
   * snapshot is refreshed via loadData(); the Reliquary modal passes false so it
   * can batch a carry + loadout change into a single reload. Returns success.
   */
  private async putCarry(ringIds: string[], reload = true): Promise<boolean> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return false;
    }
    try {
      const res = await apiFetch('/api/carry', { method: 'PUT', json: { ringIds } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Carry update failed (${res.status})`);
        return false;
      }
    } catch {
      this.setStatus('Network error during carry update');
      return false;
    }
    if (reload) {
      this.sanctumGrid.clearSelection();
      this.loadoutGrid.clearSelection();
      await this.loadData();
    }
    return true;
  }

  // ── Battle-slot assignment (#154) ──────────────────────────────────────────

  /**
   * PUT /api/loadout with a partial slot map (slot → ringId | null). The server
   * enforces the one-slot rule and ownership; this never reloads on its own so
   * the Reliquary modal can batch the reload after a carry + assign pair. Returns
   * whether the request succeeded.
   */
  private async putLoadout(partial: Record<string, string | null>): Promise<boolean> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return false;
    }
    try {
      const res = await apiFetch('/api/loadout', { method: 'PUT', json: partial });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Assignment failed (${res.status})`);
        return false;
      }
    } catch {
      this.setStatus('Network error during assignment');
      return false;
    }
    return true;
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────

  /** POST /api/camp/sleep — spend food, restore spirit, advance the day. */
  private async doSleep(): Promise<void> {
    const token = getToken();
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    const result = await restAtCamp(token);
    if ('error' in result) {
      this.setStatus(result.error);
      return;
    }
    await this.loadData();
  }

  // ── Recharge (#41 spirit) ───────────────────────────────────────────────────

  /** Recharge the currently selected ring (from either grid). */
  private async doRechargeSelected(): Promise<void> {
    const ring = this.loadoutGrid.getSelected() ?? this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring to recharge');
      return;
    }
    await this.doRechargeById(ring.id);
  }

  /** POST /api/spirit/recharge for a specific ring id (full top-off). */
  async doRechargeById(ringId: string): Promise<void> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await apiFetch('/api/spirit/recharge', { method: 'POST', json: { ringId } });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? 'Recharge not available');
        return;
      }
      if (!res.ok) {
        this.setStatus(`Recharge failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during recharge');
      return;
    }
    await this.loadData();
  }

  /**
   * POST /api/spirit/recharge-all — fill carried rings in priority order.
   *
   * When `includeReliquary` is `true` (Sanctum RECHARGE path — #397), also
   * recharges resting Reliquary rings after all carried rings. Field and Fusion
   * RECHARGE leave this flag absent (existing behavior).
   */
  async doRechargeAll(includeReliquary?: boolean): Promise<void> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const body = includeReliquary ? { includeReliquary: true } : undefined;
      const res = await apiFetch('/api/spirit/recharge-all', { method: 'POST', json: body });
      if (!res.ok) {
        this.setStatus(`Recharge-all failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during recharge-all');
      return;
    }
    await this.loadData();
  }

  // ── Fusion (#47 / #396) ──────────────────────────────────────────────────

  /**
   * Open the fusion overlay (unified RingManagementOverlay in fusion mode).
   * #396 — replaces `FusionPanel.open()`; `window.__campOpenFusion` still fires.
   */
  private openFusionPanel(): void {
    // Close existing overlay first (idempotent — close() is safe when not open).
    this.fusionOverlay?.close();

    const overlayOpts: RingManagementOverlayOpts = {
      resolveMove: async () => { /* fusion overlay does not use swap moves */ return true; },
      onRecharge: (ov) => {
        // Delegate recharge to the standard handler and refresh the overlay.
        void this.doRechargeAll(false).then(() => {
          if (ov.isOpen()) ov.refresh(this.buildOverlayData());
        });
      },
      onFuse: async (ringId1, ringId2, ov) => {
        const err = await this.doFuse(ringId1, ringId2);
        if (err) {
          ov.setStatusMessage(err);
        }
        // On success, clear the stale parent selections BEFORE re-rendering so
        // deleted rings do not appear in R1/R2 after the refresh.
        if (!err && ov.isOpen()) {
          ov.clearFuseParents();
          ov.refresh(this.buildOverlayData());
        }
      },
      onRender: (c) => {
        // Route to uiCam so it renders at 1:1 (mirrors old FusionPanel pattern).
        this.routeToUi(c);
        window.__sanctumOverlayOpen = 'fusion';
      },
      onBeforeDestroy: (c) => {
        this.unignoreMain(c);
      },
    };

    this.fusionOverlay = new RingManagementOverlay(this, 'fusion', overlayOpts);
    this.fusionOverlay.open(this.buildOverlayData(), () => {
      this.fusionOverlay = null;
      window.__sanctumOverlayOpen = null;
    });
  }

  /**
   * Build an `OverlayData` snapshot from the current /api/me cache. Shared by
   * `openFusionPanel` and the `onFuse` refresh callback.
   */
  private buildOverlayData(): OverlayData {
    const s = window.__campState;
    return {
      player: s ? {
        spare_ring_max: s.spare_ring_max,
        pending_ring_id: (s.player?.pending_ring_id as string | null | undefined) ?? null,
        heart_ring: (s.heart_ring as RingData | null) ?? null,
      } : null,
      rings: this.rings,
      loadout: this.loadout,
    };
  }

  /**
   * EPIC #279 — open the difficulty selector, highlighting the player's current
   * tier (read from __campState; defaults to 'seeker' before /api/me loads). The
   * container stays at the scene root and is main-camera-ignored so it renders
   * at 1:1 via uiCam (mirrors openFusionPanel).
   */
  private openDifficultyModal(): void {
    const current: DifficultyTier = window.__campState?.difficulty ?? 'seeker';
    this.difficultyModal.open(current);
    const dc = this.difficultyModal.getContainer();
    if (dc) this.routeToUi(dc);
  }

  /**
   * EPIC #279 — apply a confirmed difficulty change from the modal. The server
   * has already recomputed and persisted spirit_max under the new multiplier;
   * mirror both the tier and the authoritative spirit_max into __campState and
   * re-render the stats displays (main stat line + the Reliquary header, when
   * the Reliquary overlay is open). spirit_current is unchanged client-side —
   * the server clamps it server-side and the next /api/me load reconciles it.
   */
  private applyDifficultyChange(tier: DifficultyTier, spiritMax: number): void {
    const s = window.__campState;
    if (s) {
      s.difficulty = tier;
      s.spirit_max = spiritMax;
      s.player.difficulty = tier;
      s.player.spirit_max = spiritMax;
    }
    this.statLineText.setText(this.buildStatLine(s?.player ?? {}));
    this.renderReliquaryHeader();
  }

  /**
   * POST /api/fusion/combine with the chosen parent ring ids. On success,
   * reloads /api/me and reopens the fusion panel so the new ring is reflected
   * and the consumed parents disappear. Returns null on success or the server's
   * error message on a 400 (surfaced inline by the panel).
   */
  private async doFuse(ringId1: string, ringId2: string): Promise<string | null> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return 'Not authenticated';
    }
    try {
      const res = await apiFetch('/api/fusion/combine', {
        method: 'POST',
        json: { ringId1, ringId2 },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body?.error ?? `Fusion failed (${res.status})`;
      }
      const { ring } = (await res.json()) as { ring: RingData };
      this.setStatus(`Fusion complete! ${ELEMENT_NAMES[ring.element] ?? 'New'} ring added`);
      await this.loadData();
      return null;
    } catch {
      return 'Network error during fusion';
    }
  }

  // ── Reliquary expansion (#182) ──────────────────────────────────────────────

  /**
   * POST /api/sanctum/expand-reliquary — spend a Reliquary Shard to raise the
   * cap by 10. On success reloads state and re-renders the header/lock. On error
   * surfaces the message via setStatus.
   */
  private async doExpandReliquary(): Promise<void> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await apiFetch('/api/sanctum/expand-reliquary', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Expand failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during Shard expansion');
      return;
    }
    await this.loadData();
    this.afterReliquaryReload();
  }

  // ── Navigation / helpers ────────────────────────────────────────────────────

  private goToEncounter(): void {
    this.scene.start('EncounterScene');
  }

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.setText(msg);
    // Mirror the message onto the live overlay echo label, if an overlay is open.
    // The off-screen statusText is only snapshotted into 'overlay-status' at open
    // time, so without this the user never sees errors raised after the overlay
    // is already up (e.g. reliquaryMove failures).
    if (this.overlay) {
      const echo = this.overlay.getByName('overlay-status') as
        | Phaser.GameObjects.Text
        | null;
      if (echo) echo.setText(msg);
    }
  }
}
