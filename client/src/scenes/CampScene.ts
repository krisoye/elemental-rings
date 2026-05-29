import Phaser from 'phaser';
import { InventoryGrid, type RingData } from '../objects/InventoryGrid';
import { LoadoutPanel, type LoadoutSlot } from '../objects/LoadoutPanel';
import { StakePanel } from '../objects/StakePanel';
import { FusionPanel } from '../objects/FusionPanel';
import { ELEMENT_NAMES, CANVAS_W, CANVAS_H, THUMB_PASSIVE_INFO, PASSIVE_STRIP_WIDTH } from '../Constants';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { BlinkController } from '../objects/world/BlinkController';
import { getTalisman } from '../../../shared/talismans';
import { FOREST_SCREENS } from '../../../shared/world/forest';

declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = WS.replace(/^ws/, 'http');

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;

// #78 ④ — the rendered width of the StakePanel Thumb card bg (StakePanel.CARD_W).
// The passive-reminder strip is constrained to this width so it wraps within the
// Thumb column (adopted at x=580) and never overlaps the LoadoutPanel battle
// slots that begin at x=670 to its right.
const STAKE_CARD_WIDTH = 70;

// #85 Fix 2A — the inventory grids in the Ring Storage overlay clip to this many
// rows; beyond that the ▲/▼ arrows + mouse wheel scroll the grid. 3 rows (6 rings)
// fit comfortably above the y=430 status echo without colliding with the action
// buttons relocated to the y=96 header row.
const RINGWALL_VISIBLE_ROWS = 3;

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
export class CampScene extends Phaser.Scene {
  // ── Spatial engine state ──────────────────────────────────────────────────
  private player!: Player;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  // ── Dual-camera split (#118) ──────────────────────────────────────────────
  /**
   * UI camera: zoom 1, no follow. Renders the persistent HUD/toast objects in
   * uiRoot plus the modal overlay containers (which cameras.main ignores). It
   * does not scroll, so UI renders at a fixed 1:1 while the world zooms 2×.
   */
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /**
   * Persistent container for HUD objects that have no E2E flatMap traversal —
   * the "Set Out →" button and the transient teleport confirm toast. cameras.main
   * ignores this whole subtree once at creation, so anything added later is
   * automatically excluded from the world camera. Modal overlays do NOT live
   * here: they stay at the scene root (preserving E2E traversal depth) and are
   * excluded from cameras.main via per-container ignore() in beginOverlay().
   */
  private uiRoot!: Phaser.GameObjects.Container;

  // ── Interaction zones + modal overlays (8A.2) ─────────────────────────────
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  /**
   * Guards the touch-to-exit door: routeToBiome() is async (fetch → scene.start),
   * so without this latch a second frame of overlap — or the E / __sanctumInteract
   * path firing in parallel — would kick off the transition twice. Set the instant
   * the door is touched; reset only matters within a single scene lifetime (a fresh
   * CampScene instance starts false).
   */
  private leavingViaDoor = false;
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
  private loadoutPanel!: LoadoutPanel;
  private stakePanel!: StakePanel;
  private fusionPanel!: FusionPanel;
  private ringMap: Map<string, RingData> = new Map();
  private loadoutHeaderText!: Phaser.GameObjects.Text;
  private statLineText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  // #78 ④ — last-computed Thumb passive reminder (recomputed every refreshPools),
  // mirrored into __campState and rendered as a strip in the ring-storage overlay.
  private stakedPassive: { name: string | null; effect: string } | null = null;
  // The overlay's passive-reminder Text strip, alive only while the ring-storage
  // overlay is open (it lives inside the overlay container, so closeOverlay's
  // container destroy reclaims it). Null while the overlay is closed.
  private passiveLabel: Phaser.GameObjects.Text | null = null;

  // Cached snapshot of the last /api/me load.
  private rings: RingData[] = [];
  private loadout: Record<string, string | null> = {};
  private carryCap = 10;

  constructor() {
    super({ key: 'CampScene' });
  }

  preload(): void {
    Player.preload(this);
    this.load.image('cozy-furniture', 'assets/tiles/spr_tile_cozy_indoor_furniture.png');
    this.load.image('cozy-ceiling', 'assets/tiles/spr_tile_cozy_indoor_ceiling_auto_3x3.png');
    this.load.image('cozy-floor', 'assets/tiles/spr_tile_cozy_indoor_floor_auto_2x2.png');
    this.load.image('cozy-wallfloor', 'assets/tiles/spr_tile_cozy_indoor_wall_floor.png');
    this.load.tilemapTiledJSON('sanctum', 'assets/maps/sanctum.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'CampScene';
    // The scene instance is reused across re-entries (Phaser does not reconstruct
    // it), so reset per-create flags — otherwise the door's touch-to-exit latch
    // stays set after the first exit and the player can never leave again.
    this.leavingViaDoor = false;

    // ── Build the Sanctum room from the Tiled map ─────────────────────────
    const map = this.make.tilemap({ key: 'sanctum' });
    const tsFurniture = map.addTilesetImage('spr_tile_cozy_indoor_furniture', 'cozy-furniture')!;
    const tsCeiling = map.addTilesetImage('spr_tile_cozy_indoor_ceiling_auto_3x3', 'cozy-ceiling')!;
    const tsFloor = map.addTilesetImage('spr_tile_cozy_indoor_floor_auto_2x2', 'cozy-floor')!;
    const tsWallFloor = map.addTilesetImage('spr_tile_cozy_indoor_wall_floor', 'cozy-wallfloor')!;
    const allTilesets = [tsFurniture, tsCeiling, tsFloor, tsWallFloor];

    this.groundLayer = map.createLayer('Floor', allTilesets, 0, 0)!;
    map.createLayer('Furniture', allTilesets, 0, 0);
    map.createLayer('Ceiling', allTilesets, 0, 0)!.setDepth(10);

    // ── Spawn the player at the `spawn` object ────────────────────────────
    const spawn = this.findObject(map, 'spawn');
    this.player = new Player(this, spawn?.x ?? map.widthInPixels / 2, spawn?.y ?? map.heightInPixels / 2);

    // ── Camera follows the player, clamped to map bounds ──────────────────
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(2); // #118 — 2× world zoom (UI is on uiCam). Lowered from 4× — the 16px interior tiles lack the resolution to read cleanly at 4×.
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // ── Dual-camera split (#118) ──────────────────────────────────────────
    // uiCam: full-viewport, zoom 1, no follow. cameras.main ignores uiRoot (HUD
    // + toasts) once. Modal overlays are ignored per-container in beginOverlay()
    // so they can stay at the scene root for E2E traversal. uiCam is added after
    // main, so it draws on top — correct for UI occluding the world.
    this.uiRoot = this.add.container(0, 0).setDepth(4000);
    this.cameras.main.ignore(this.uiRoot);
    this.uiCam = this.cameras.add(0, 0, CANVAS_W, CANVAS_H);
    // uiCam ignores world objects; collected after buildZones() below.

    // ── Dev/test shortcut: "Set Out →" HUD button → EncounterScene ────────
    // Parented into uiRoot so it renders at 1:1 through uiCam.
    const setOutBtn = this.add
      .text(CANVAS_W - 120, 16, 'Set Out →', { fontSize: '16px', color: '#aaffaa' })
      .setDepth(500)
      .setName('set-out-btn')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToEncounter());
    this.uiRoot.add(setOutBtn);

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
      this.uiCam.ignore(worldObjects);
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
      if (this.overlay) this.closeOverlay();
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
    window.__campRechargeAll = (): Promise<void> => this.doRechargeAll();
    window.__campAddToLoadout = (ringId: string): Promise<void> => this.moveToCarry(ringId, true);
    window.__campLeaveAtSanctum = (ringId: string): Promise<void> => this.moveToCarry(ringId, false);
    window.__campOpenFusion = (): void => this.openFusionPanel();
    window.__campFuse = (ringId1: string, ringId2: string): Promise<string | null> =>
      this.doFuse(ringId1, ringId2);
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
      window.__campOpenTeleport = undefined;
      window.__campTeleport = undefined;
      window.__campHitTestRing = undefined;
      window.__campSanctumScroll = undefined;
      window.__campLoadoutScroll = undefined;
      window.__teleportState = undefined;
      window.__campState = undefined;
      window.__fusionState = undefined;
      window.__player = null;
      window.__scene = null;
      window.__sanctumZones = undefined;
      window.__sanctumInteract = undefined;
      window.__sanctumOverlayOpen = undefined;
      this.blink?.destroy();
      this.blink = null;
      this.zones.forEach((z) => z.destroy());
      this.zones = [];
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
      case 'campfire':
        return () => this.openCampfireOverlay();
      case 'door':
        return () => this.onDoorInteract();
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

    // The exit door fires on touch — walking onto it leaves the Sanctum, no E
    // press required. Latched so the async routeToBiome() runs exactly once even
    // if the player lingers on the zone for several frames.
    if (!this.leavingViaDoor && overlapping.some((z) => z.name === 'door')) {
      this.leavingViaDoor = true;
      this.onDoorInteract();
      return;
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
    const token = localStorage.getItem('er_token');
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/waystones`, {
          headers: { Authorization: `Bearer ${token}` },
        });
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
      this.scene.start(target, data);
    } else if (this.scene.manager.keys['ForestScene']) {
      this.scene.start('ForestScene');
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
   * Swamp is a distinct scene; every Forest anchor — including the hidden alcove
   * (`forest_hidden_*`, now a Forest screen rather than its own scene) — routes to
   * the unified ForestScene, which selects the matching screen.
   */
  private static biomeSceneForAnchor(anchorId: string): string {
    if (anchorId.startsWith('swamp')) return 'SwampScene';
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

  /**
   * Inverse of `cameras.main.ignore(obj)` (#118). Phaser 4.1's `ignore()` only
   * sets `obj.cameraFilter |= camera.id` (a bit flag stored on the object — the
   * camera keeps no collection), so the clean undo is to clear that bit. Called
   * on transient UI objects just before they're destroyed so no stale main-camera
   * filter survives if the object is ever revived or its id reused. Ignoring a
   * container cascades to its children; clearing the parent's flag is enough for
   * the destroy path because the whole subtree is torn down with it.
   */
  private unignoreMain(obj: Phaser.GameObjects.GameObject): void {
    obj.cameraFilter &= ~this.cameras.main.id;
  }

  /**
   * Create a fresh modal overlay container: a dimmed full-screen backdrop fixed
   * to the camera, plus a titled panel. Returns the container; callers add panel
   * content into it. Closing destroys the container (and any non-adopted
   * children); adopted reusable panels are released via `overlayOnClose`.
   */
  private beginOverlay(name: string, title: string, onClose?: () => void): Phaser.GameObjects.Container {
    this.closeOverlay(); // never stack overlays
    // #118: the overlay container stays at the SCENE ROOT (not inside uiRoot) so
    // the existing E2E single-level flatMap traversals still reach its children.
    // To render it at 1:1 instead of the 2× world camera we tell cameras.main to
    // ignore the container; ignoring a container cascades to its whole subtree,
    // so children added later (panels, labels) are excluded automatically.
    const c = this.add.container(0, 0).setDepth(4000);
    const backdrop = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setInteractive(); // swallow clicks to the room behind
    const panel = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 760, 470, 0x161622)
      .setStrokeStyle(2, 0x6082aa);
    const titleText = this.add
      .text(CANVAS_W / 2, 60, title, { fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);
    const closeBtn = this.add
      .text(CANVAS_W / 2 + 360, 56, '[×]', { fontSize: '16px', color: '#ff8888' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeOverlay());
    c.add([backdrop, panel, titleText, closeBtn]);
    this.cameras.main.ignore(c);

    this.overlay = c;
    this.overlayName = name;
    this.overlayOnClose = onClose ?? null;
    window.__sanctumOverlayOpen = name;
    return c;
  }

  /** Close the open overlay, releasing any adopted panels first. */
  private closeOverlay(): void {
    if (!this.overlay) return;
    // Release adopted reusable panels back to the scene root (off-screen) so the
    // container destroy doesn't take them with it.
    this.overlayOnClose?.();
    // #118: the overlay container lives at the scene root. Clear its main-camera
    // ignore flag before destroying it (mirrors the ignore() in beginOverlay).
    this.unignoreMain(this.overlay);
    this.overlay.destroy(true);
    this.overlay = null;
    this.overlayName = null;
    this.overlayOnClose = null;
    window.__sanctumOverlayOpen = null;
    // #118: the FusionPanel's onClose callback clears its own container's
    // main-camera ignore flag before destroying it.
    if (this.fusionPanel.isOpen()) this.fusionPanel.close();
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
   * Ring-storage wall: inventory (At Sanctum + Loadout grids), carry move
   * buttons, the battle-hand panels, and a [Fuse Rings] button that opens the
   * existing FusionPanel. Reuses the exact panel instances parented into the
   * overlay container.
   */
  private openRingwallOverlay(): void {
    const c = this.beginOverlay('ringwall', 'RING STORAGE', () => {
      // #85 Fix 2A — tear down the wheel handler + scroll hooks/masks before the
      // grids are released back off-screen (a stale mask on a parked grid would
      // clip nothing but leak a Graphics object).
      this.input.off('wheel', this.onRingwallWheel, this);
      this.sanctumGrid.setVisibleRows(0);
      this.loadoutGrid.setVisibleRows(0);
      window.__campSanctumScroll = undefined;
      window.__campLoadoutScroll = undefined;
      this.releasePanel(c, this.sanctumGrid);
      this.releasePanel(c, this.loadoutGrid);
      this.releasePanel(c, this.stakePanel);
      this.releasePanel(c, this.loadoutPanel);
      // The strip lives inside the overlay container — the container destroy
      // reclaims it, so just drop the stale reference (#78 ④).
      this.passiveLabel = null;
      window.__campHitTestRing = undefined;
    });

    // #85 Fix 2B — column headers paired with their action buttons on one row
    // (y=96), above the grids, so the actions are never buried under an
    // overflowing inventory. Header text at its column x, then a bracket-style
    // action 12px + the header width to its right.
    this.addHeaderWithAction(
      c, 40, 96, 'At Sanctum', '[Add to Loadout]', '#aaffaa',
      () => void this.addSelectedToLoadout(),
    );
    this.addHeaderWithAction(
      c, 300, 96, this.loadoutHeaderText.text, '[Leave at Sanctum]', '#ffaaaa',
      () => void this.leaveSelectedAtSanctum(),
    );
    this.addHeaderWithAction(
      c, 580, 96, 'Battle Hand', '[Fuse Rings]', '#cc88ff',
      () => this.openFusionPanel(),
    );

    // Adopt the reusable grids/panels into the overlay.
    this.adoptPanel(c, this.sanctumGrid, 40, 120);
    this.adoptPanel(c, this.loadoutGrid, 300, 120);
    this.adoptPanel(c, this.stakePanel, 580, 120);
    this.adoptPanel(c, this.loadoutPanel, 670, 120);

    // #85 Fix 2A — cap both grids at RINGWALL_VISIBLE_ROWS visible rows now that
    // they are positioned in the overlay (the mask geometry needs the live world
    // position). Grids with ≤3 rows show no arrows and behave exactly as before.
    this.sanctumGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);
    this.loadoutGrid.setVisibleRows(RINGWALL_VISIBLE_ROWS);
    // Mouse wheel over a scrollable grid scrolls it; over a non-scrollable grid or
    // outside both is a no-op. Torn down in the overlay's onClose above.
    this.input.on('wheel', this.onRingwallWheel, this);

    // E2E scroll hooks — fire the same scrollBy path as the arrows/wheel. Cleared
    // in overlayOnClose. publishScrollState mirrors the live row state into
    // __campState so a test can assert before/after each scroll.
    window.__campSanctumScroll = (delta: number): void => {
      this.sanctumGrid.scrollBy(delta);
      this.publishScrollState();
    };
    window.__campLoadoutScroll = (delta: number): void => {
      this.loadoutGrid.scrollBy(delta);
      this.publishScrollState();
    };
    this.publishScrollState();

    // Live status echo (errors from carry / assign).
    c.add(this.add.text(40, 430, this.statusText.text, { fontSize: '12px', color: '#ff8888' }).setName('overlay-status').setScrollFactor(0));

    // #78 ④ — render the Thumb passive reminder now the overlay (and its adopted
    // stake card) exist. refreshPools may have already run while the overlay was
    // closed, so draw from the cached snapshot here.
    this.renderPassiveStrip();

    // #81 — necklace-slot display near the stake panel. Fetch the loadout and
    // render the equipped talisman + remaining charges (filled/empty dots). No
    // equip UI here — equipping happens via /api/talisman/equip elsewhere.
    const necklaceLabel = this.add
      .text(580, 470, 'Necklace: —', { fontSize: '12px', color: '#cfe3ff' })
      .setScrollFactor(0)
      .setName('necklace-slot');
    c.add(necklaceLabel);
    void this.loadTalismanLoadout(necklaceLabel);

    // #118 — hit-test probe switched to uiCam. Ring cards live under the overlay
    // container, which cameras.main ignores and uiCam renders. uiCam does not
    // follow or scroll, so the card's world-transform position (tx, ty) is its
    // exact render position in uiCam space — no scroll dance needed. The probe is
    // a straight uiCam hitTest at that position.
    window.__campHitTestRing = (ringId: string): { found: boolean; hit: boolean } => {
      const bg = this.sanctumGrid.getCardBg(ringId) ?? this.loadoutGrid.getCardBg(ringId);
      if (!bg) return { found: false, hit: false };
      const m = bg.getWorldTransformMatrix(); // render-space position
      const out: Phaser.GameObjects.GameObject[] = [];
      this.input.manager.hitTest(
        { x: m.tx, y: m.ty } as unknown as Phaser.Input.Pointer,
        [bg],
        this.uiCam,
        out,
      );
      return { found: true, hit: out.indexOf(bg) !== -1 };
    };
  }

  /**
   * #85 Fix 2B — add a column header at (x, y) paired with a bracket-style action
   * label 12px to its right. Both live on the overlay container (camera-pinned).
   * The action width is computed from the header text width so the gap is stable
   * across the three columns regardless of header length.
   */
  private addHeaderWithAction(
    c: Phaser.GameObjects.Container,
    x: number,
    y: number,
    headerText: string,
    actionText: string,
    actionColor: string,
    onClick: () => void,
  ): void {
    const header = this.add
      .text(x, y, headerText, { fontSize: '13px', color: '#cccccc' })
      .setScrollFactor(0);
    c.add(header);
    const action = this.add
      .text(x + header.width + 12, y, actionText, { fontSize: '13px', color: actionColor })
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
    c.add(action);
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
    for (const grid of [this.sanctumGrid, this.loadoutGrid]) {
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
    window.__campState.loadoutScrollRow = this.loadoutGrid.getScrollRow();
    window.__campState.loadoutTotalRows = this.loadoutGrid.getTotalRows();
    window.__campState.loadoutVisibleRows = this.loadoutGrid.getVisibleRows();
  }

  /**
   * #81 — fetch GET /api/talisman-loadout, publish it to window.__talismanLoadout
   * for E2E, and render the equipped necklace talisman + remaining charges into
   * the given label (e.g. "Sanctum Stone ●●○"). When nothing is equipped the label
   * shows "Necklace: (empty)". Display-only — no equip UI. Best-effort: a network
   * or auth failure leaves the placeholder label as-is.
   */
  private async loadTalismanLoadout(label: Phaser.GameObjects.Text): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    let payload: { necklaceId: string | null; necklaceCharges: number };
    try {
      const res = await fetch(`${API_BASE}/api/talisman-loadout`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    const filled = '●'.repeat(payload.necklaceCharges);
    const empty = '○'.repeat(Math.max(0, max - payload.necklaceCharges));
    label.setText(`${name} ${filled}${empty}`);
  }

  /**
   * Meditation circle: ring recharge ([Recharge] selected / [Recharge All]) and
   * a disabled "Teleport (8B)" label. Recharge targets the grid selection — the
   * carry/loadout grids are not shown here, so [Recharge] recharges the
   * currently selected ring if any, and [Recharge All] tops off all carried.
   */
  private openMeditationOverlay(): void {
    const c = this.beginOverlay('meditation', 'MEDITATION CIRCLE');
    c.add(
      this.add
        .text(CANVAS_W / 2, 150, 'Channel spirit to recharge your rings.', {
          fontSize: '13px',
          color: '#cccccc',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    c.add(
      this.add
        .text(CANVAS_W / 2 - 120, 220, '[Recharge]', { fontSize: '16px', color: '#ffcc44' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.doRechargeSelected()),
    );
    c.add(
      this.add
        .text(CANVAS_W / 2 + 60, 220, '[Recharge All]', { fontSize: '16px', color: '#ffcc44' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.doRechargeAll()),
    );
    // Teleport (8B.3): opens the waystone teleport modal (server-gated).
    c.add(
      this.add
        .text(CANVAS_W / 2, 300, '[Teleport]', { fontSize: '15px', color: '#ffcc44' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setName('teleport-btn')
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.openTeleportModal()),
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
    const token = localStorage.getItem('er_token');
    if (!token) return;
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
      const res = await fetch(`${API_BASE}/api/waystones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

    const c = this.beginOverlay('teleport', 'TELEPORT');
    let y = 150;
    for (const w of payload.waystones) {
      const isAnchor = w.id === payload.anchor;
      const suffix = isAnchor ? ' (anchored here)' : '';
      if (!w.attuned) {
        // Undiscovered — masked, non-actionable.
        c.add(
          this.add
            .text(CANVAS_W / 2, y, `??? — undiscovered${suffix}`, {
              fontSize: '14px',
              color: '#555555',
            })
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
      } else if (!w.meetsThreshold) {
        // #87 Part B — attuned but SPIRIT-locked: show the spirit gate, grey out,
        // no Travel button (the §10.8 gate is current spirit, not aggregate XP).
        c.add(
          this.add
            .text(CANVAS_W / 2, y, `${w.name}${suffix}`, { fontSize: '14px', color: '#888888' })
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
        c.add(
          this.add
            .text(
              CANVAS_W / 2,
              y + 20,
              `Requires ${w.spiritCost ?? 0} spirit (have ${payload.spiritCurrent ?? 0})`,
              { fontSize: '12px', color: '#666666' },
            )
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
        y += 20;
      } else {
        // Attuned + affordable — actionable [Travel] button labelled with the cost.
        c.add(
          this.add
            .text(CANVAS_W / 2 - 90, y, `${w.name}${suffix}`, { fontSize: '14px', color: '#cccccc' })
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
        c.add(
          this.add
            .text(CANVAS_W / 2 + 70, y, `[Travel — ${w.spiritCost ?? 0} spirit]`, {
              fontSize: '13px',
              color: '#ffcc44',
            })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setName(`travel-${w.id}`)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => void this.doTeleport(w.id, w.name)),
        );
      }
      y += 44;
    }
  }

  /**
   * POST /api/teleport to re-anchor the Sanctum. On success closes the modal and
   * shows a brief confirmation toast; on a 400 surfaces the server's error inline
   * in the open overlay. The anchor in window.__teleportState is updated so E2E
   * can read the new state without a re-fetch.
   */
  private async doTeleport(waystoneId: string, waystoneName: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId }),
      });
    } catch {
      this.showTeleportError('Network error during teleport');
      return;
    }
    if (res.ok) {
      this.closeOverlay();
      // #118: toast lives in uiRoot → renders at 1:1 through uiCam.
      const msg = this.add
        .text(CANVAS_W / 2, CANVAS_H / 2 - 50, `Sanctum re-anchored near ${waystoneName}`, {
          fontSize: '14px',
          color: '#aaffaa',
          backgroundColor: '#222222',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(600)
        .setName('teleport-confirm');
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
    const errText = this.add
      .text(CANVAS_W / 2, 420, message, { fontSize: '13px', color: '#ff6666' })
      .setOrigin(0.5)
      .setDepth(4001) // above the overlay container (depth 4000)
      .setName('teleport-error');
    // Exclude from the 2× world camera so the text renders at 1:1 via uiCam.
    this.cameras.main.ignore(errText);
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
    const c = this.beginOverlay('bed', 'REST');
    const food = window.__campState?.food_units ?? 0;
    c.add(
      this.add
        .text(CANVAS_W / 2, 170, `Sleep to fully restore spirit and advance a day. (Food: ${food})`, {
          fontSize: '13px',
          color: '#cccccc',
        })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    c.add(
      this.add
        .text(CANVAS_W / 2, 250, '[Sleep — 25 food]', { fontSize: '18px', color: '#88ccff' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setName('sleep-confirm')
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.confirmSleep()),
    );
  }

  /** Sleep, then close the bed overlay (state is reloaded by doSleep). */
  private async confirmSleep(): Promise<void> {
    await this.doSleep();
    if (this.overlayName === 'bed') this.closeOverlay();
  }

  /** Campfire: placeholder showing food count + "Cooking coming soon". */
  private openCampfireOverlay(): void {
    const c = this.beginOverlay('campfire', 'CAMPFIRE');
    const food = window.__campState?.food_units ?? 0;
    c.add(
      this.add
        .text(CANVAS_W / 2, 200, `Food stores: ${food} units`, { fontSize: '16px', color: '#ffdd88' })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    c.add(
      this.add
        .text(CANVAS_W / 2, 250, 'Cooking coming soon', { fontSize: '14px', color: '#888888' })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
  }

  // ── Reusable panels (parked off-screen; overlays use them in 8A.2) ────────

  /**
   * Create the inventory/loadout/fusion panel instances once. They are parked
   * off the visible canvas so `loadData()` can still populate them (and
   * `__campState`) while the spatial room is shown. 8A.2 re-parents them into
   * modal overlay containers when a zone is interacted with.
   */
  private buildPanels(): void {
    this.sanctumGrid = new InventoryGrid(this, OFFSCREEN_X, OFFSCREEN_Y, () =>
      this.loadoutGrid.clearSelection(),
    );
    this.loadoutGrid = new InventoryGrid(this, OFFSCREEN_X + 350, OFFSCREEN_Y, () =>
      this.sanctumGrid.clearSelection(),
    );
    this.stakePanel = new StakePanel(this, OFFSCREEN_X + 700, OFFSCREEN_Y, () =>
      this.assignSlot('thumb'),
    );
    this.loadoutPanel = new LoadoutPanel(this, OFFSCREEN_X + 790, OFFSCREEN_Y, (slot: LoadoutSlot) =>
      this.assignSlot(slot),
    );
    // #118 P2: parked panels are invisible so neither camera traverses them per
    // frame. adoptPanel re-shows them when an overlay opens; releasePanel hides
    // them again. They are still populated by loadData() while hidden.
    this.sanctumGrid.setVisible(false);
    this.loadoutGrid.setVisible(false);
    this.stakePanel.setVisible(false);
    this.loadoutPanel.setVisible(false);
    this.fusionPanel = new FusionPanel(
      this,
      (ringId1, ringId2) => this.doFuse(ringId1, ringId2),
      (container) => {
        // #118: clear the container's main-camera ignore flag before FusionPanel
        // destroys it (fires for both the panel's own [×] button and closeOverlay).
        if (container) this.unignoreMain(container);
      },
    );

    // Off-screen header/stat/status texts the panels & overlays update. These
    // mirror the old flat layout's labels but are not visible until an overlay
    // adopts them (8A.2 reads their text into overlay-local labels).
    this.statLineText = this.add
      .text(OFFSCREEN_X, OFFSCREEN_Y - 60, 'Day: — | Gold: — | Food: — | Spirit: —/—', {
        fontSize: '14px',
        color: '#ffdd66',
      })
      .setName('stat-line');
    this.loadoutHeaderText = this.add
      .text(OFFSCREEN_X + 350, OFFSCREEN_Y - 30, 'Loadout (0/10)', {
        fontSize: '14px',
        color: '#cccccc',
      })
      .setName('loadout-header');
    this.statusText = this.add
      .text(OFFSCREEN_X, OFFSCREEN_Y - 100, '', { fontSize: '13px', color: '#ff8888' })
      .setName('camp-status');
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /** Fetch /api/me and repopulate all three pools. */
  private async loadData(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    let data: { player: any; rings: RingData[]; loadout: Record<string, string | null> };
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    this.carryCap = player.carry_cap ?? 10;
    this.ringMap = new Map(rings.map((r) => [r.id, r]));

    this.refreshPools(player);
  }

  /** Split rings into the three pools and repopulate the UI from current state. */
  private refreshPools(player: any): void {
    this.statLineText.setText(
      `Day: ${player.game_day ?? 0} | Gold: ${player.gold ?? 0} | ` +
        `Food: ${player.food_units ?? 0} | ` +
        `Spirit: ${player.spirit_current ?? 0}/${player.spirit_max ?? 0} | ` +
        `XP: ${player.aggregate_xp ?? 0}`,
    );

    const battleHandIds = new Set(
      BATTLE_SLOTS.map((s) => this.loadout[s]).filter(Boolean) as string[],
    );
    const atSanctum = this.rings.filter((r) => r.in_carry === 0);
    const loadoutPool = this.rings.filter((r) => r.in_carry === 1 && !battleHandIds.has(r.id));
    const carriedCount = this.rings.filter((r) => r.in_carry === 1).length;

    this.sanctumGrid.populate(atSanctum);
    this.loadoutGrid.populate(loadoutPool);
    this.loadoutPanel.updateFromLoadout(this.loadout, this.ringMap);
    this.stakePanel.updateFromLoadout(this.loadout.thumb ?? null, this.ringMap);

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
    this.renderPassiveStrip();

    this.loadoutHeaderText.setText(`Loadout (${carriedCount}/${this.carryCap})`);

    window.__campState = {
      player,
      rings: this.rings,
      loadout: this.loadout,
      atSanctum,
      loadout_pool: loadoutPool,
      battleHand: BATTLE_SLOTS.map((s) => this.loadout[s])
        .filter(Boolean)
        .map((id) => this.ringMap.get(id as string))
        .filter(Boolean) as RingData[],
      carry_cap: this.carryCap,
      spirit_current: player.spirit_current ?? 0,
      spirit_max: player.spirit_max ?? 0,
      food_units: player.food_units ?? 0,
      aggregate_xp: player.aggregate_xp ?? 0,
      staked_passive: this.stakedPassive,
    };

    // #85 Fix 2A — refreshPools rebuilds __campState wholesale, which can happen
    // while the ring-storage overlay is open (after a carry move reloads). Re-mirror
    // the grids' live scroll state so the E2E scroll fields are never dropped.
    this.publishScrollState();
  }

  /**
   * Render the Thumb passive reminder inside the open ring-storage overlay (#78
   * ④). A no-op while the overlay is closed (the label lives in the overlay
   * container). When a passive is known, shows two lines beneath the Thumb card:
   * the passive name (or "No passive" for fusions) and its effect text. Recomputed
   * whenever refreshPools runs so it tracks live stake/loadout changes.
   */
  private renderPassiveStrip(): void {
    if (this.overlayName !== 'ringwall' || !this.overlay) return;
    const text = !this.stakedPassive
      ? ''
      : this.stakedPassive.name
      ? `${this.stakedPassive.name}\n${this.stakedPassive.effect}`
      : `No passive\n${this.stakedPassive.effect}`;
    if (!this.passiveLabel) {
      // Beneath the stake card (adopted at x=580, y=120; the StakePanel card bg is
      // 70px wide → spans x≈580–650, then the LoadoutPanel battle slots begin at
      // x=670). #85 Fix 1 — widen the strip to PASSIVE_STRIP_WIDTH (88px) and drop
      // the 6-line cap so the longest base passive (WATER/Wellspring) renders in
      // full. 88px still wraps within the Thumb column without reaching the battle
      // slots at x=670, and no maxLines means no clipping.
      this.passiveLabel = this.add
        .text(580, 230, text, {
          fontSize: '10px',
          color: '#ffcc88',
          wordWrap: { width: PASSIVE_STRIP_WIDTH },
          lineSpacing: 2,
        })
        .setFixedSize(PASSIVE_STRIP_WIDTH, 0)
        .setScrollFactor(0)
        .setDepth(4001) // above the overlay container (depth 4000)
        .setName('staked-passive-strip');
      this.overlay.add(this.passiveLabel);
    } else {
      this.passiveLabel.setText(text);
    }
  }

  // ── Carry moves (#40) ───────────────────────────────────────────────────

  /** Add the selected At-Sanctum ring to the loadout (carry), if there's room. */
  private async addSelectedToLoadout(): Promise<void> {
    const ring = this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring at the Sanctum first');
      return;
    }
    await this.moveToCarry(ring.id, true);
  }

  /** Leave the selected loadout ring at the Sanctum (clear in_carry). */
  private async leaveSelectedAtSanctum(): Promise<void> {
    const ring = this.loadoutGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a loadout ring first');
      return;
    }
    await this.moveToCarry(ring.id, false);
  }

  /**
   * Set a ring's carried state via PUT /api/carry. Computes the new carried set
   * from the cached snapshot and lets the server enforce the cap & ownership.
   */
  private async moveToCarry(ringId: string, inCarry: boolean): Promise<void> {
    const carried = new Set(this.rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    if (inCarry) {
      if (carried.size >= this.carryCap) {
        this.setStatus('Loadout is full — leave a ring at the Sanctum first');
        return;
      }
      carried.add(ringId);
    } else {
      carried.delete(ringId);
    }
    await this.putCarry(Array.from(carried));
  }

  /** PUT /api/carry with the full carried set, then reload. */
  private async putCarry(ringIds: string[]): Promise<boolean> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return false;
    }
    try {
      const res = await fetch(`${API_BASE}/api/carry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Carry update failed (${res.status})`);
        return false;
      }
    } catch {
      this.setStatus('Network error during carry update');
      return false;
    }
    this.sanctumGrid.clearSelection();
    this.loadoutGrid.clearSelection();
    await this.loadData();
    return true;
  }

  // ── Battle-slot assignment ─────────────────────────────────────────────────

  /**
   * Assign the currently selected ring to a battle slot. Battle slots only
   * accept carried (in_carry = 1) rings; selecting an At-Sanctum ring is
   * rejected with a hint.
   */
  private async assignSlot(slot: 'thumb' | LoadoutSlot): Promise<void> {
    const ring = this.loadoutGrid.getSelected() ?? this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a carried ring first');
      return;
    }
    if (ring.escrowed) {
      this.setStatus('Ring is locked in a duel');
      return;
    }
    if (ring.in_carry !== 1) {
      this.setStatus('Add the ring to your loadout before assigning a battle slot');
      return;
    }

    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [slot]: ring.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Assignment failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during assignment');
      return;
    }

    this.sanctumGrid.clearSelection();
    this.loadoutGrid.clearSelection();
    await this.loadData();
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────

  /** POST /api/camp/sleep — spend food, restore spirit, advance the day. */
  private async doSleep(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/camp/sleep`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Sleep failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during sleep');
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
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId }),
      });
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

  /** POST /api/spirit/recharge-all — fill carried rings in priority order. */
  async doRechargeAll(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
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

  // ── Fusion (#47) ─────────────────────────────────────────────────────────

  /** Open the fusion modal with the current ring inventory snapshot. */
  private openFusionPanel(): void {
    this.fusionPanel.open(this.rings);
    // #118: the FusionPanel container stays at the scene root (so its E2E
    // traversals are unchanged); tell cameras.main to ignore it so it renders
    // at 1:1 via uiCam instead of the 2× world camera. Ignoring the container
    // cascades to all its children.
    const fc = this.fusionPanel.getContainer();
    if (fc) this.cameras.main.ignore(fc);
  }

  /**
   * POST /api/fusion/combine with the chosen parent ring ids. On success,
   * reloads /api/me and reopens the fusion panel so the new ring is reflected
   * and the consumed parents disappear. Returns null on success or the server's
   * error message on a 400 (surfaced inline by the panel).
   */
  private async doFuse(ringId1: string, ringId2: string): Promise<string | null> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return 'Not authenticated';
    }
    try {
      const res = await fetch(`${API_BASE}/api/fusion/combine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId1, ringId2 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body?.error ?? `Fusion failed (${res.status})`;
      }
      const { ring } = (await res.json()) as { ring: RingData };
      this.setStatus(`Fusion complete! ${ELEMENT_NAMES[ring.element] ?? 'New'} ring added`);
      const wasOpen = this.fusionPanel.isOpen();
      await this.loadData();
      // #118: reopen via openFusionPanel() so the freshly-created container is
      // ignored by cameras.main and renders at 1:1 through uiCam.
      if (wasOpen) this.openFusionPanel();
      return null;
    } catch {
      return 'Network error during fusion';
    }
  }

  // ── Navigation / helpers ────────────────────────────────────────────────────

  private goToEncounter(): void {
    this.scene.start('EncounterScene');
  }

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.setText(msg);
  }
}
