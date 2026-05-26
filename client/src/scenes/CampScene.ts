import Phaser from 'phaser';
import { InventoryGrid, type RingData } from '../objects/InventoryGrid';
import { LoadoutPanel, type LoadoutSlot } from '../objects/LoadoutPanel';
import { StakePanel } from '../objects/StakePanel';
import { FusionPanel } from '../objects/FusionPanel';
import { ELEMENT_NAMES, CANVAS_W, CANVAS_H, THUMB_PASSIVE_INFO } from '../Constants';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';

declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = WS.replace(/^ws/, 'http');

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;

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

  // ── Interaction zones + modal overlays (8A.2) ─────────────────────────────
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  /** The currently-open modal overlay container, or null. */
  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayName: string | null = null;
  /** Callback run when the overlay closes (re-parks adopted panels off-screen). */
  private overlayOnClose: (() => void) | null = null;

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
    this.load.image('tiles', 'assets/tiles/placeholder.png');
    this.load.tilemapTiledJSON('sanctum', 'assets/maps/sanctum.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'CampScene';

    // ── Build the Sanctum room from the Tiled map ─────────────────────────
    const map = this.make.tilemap({ key: 'sanctum' });
    const tileset = map.addTilesetImage('placeholder', 'tiles')!;
    this.groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    this.groundLayer.setCollisionByProperty({ collides: true });

    // ── Spawn the player at the `spawn` object ────────────────────────────
    const spawn = this.findObject(map, 'spawn');
    this.player = new Player(this, spawn?.x ?? map.widthInPixels / 2, spawn?.y ?? map.heightInPixels / 2);
    this.physics.add.collider(this.player, this.groundLayer);

    // ── Camera follows the player, clamped to map bounds ──────────────────
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // ── Zone markers + labels ─────────────────────────────────────────────
    this.renderZoneMarkers(map);

    // ── Dev/test shortcut: "Set Out →" HUD button → EncounterScene ────────
    // Survives the spatial transform per the 8A.3 product decision; pinned to
    // the camera so it stays visible while the room scrolls.
    this.add
      .text(CANVAS_W - 120, 16, 'Set Out →', { fontSize: '16px', color: '#aaffaa' })
      .setScrollFactor(0)
      .setDepth(500)
      .setName('set-out-btn')
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToEncounter());

    // ── Reusable inventory panels (parked off-screen) ─────────────────────
    this.buildPanels();

    // ── Interaction zones (8A.2) ──────────────────────────────────────────
    this.buildZones(map);

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
      window.__teleportState = undefined;
      window.__campState = undefined;
      window.__fusionState = undefined;
      window.__player = null;
      window.__scene = null;
      window.__sanctumZones = undefined;
      window.__sanctumInteract = undefined;
      window.__sanctumOverlayOpen = undefined;
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

  /** Build an InteractionZone per named rectangle on the `objects` layer. */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      const cb = this.zoneCallback(o.name ?? '');
      if (!cb) continue;
      const zone = new InteractionZone(this, o, cb);
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

    window.__sanctumZones = overlapping.map((z) => z.name);
  }

  /** Fire the active zone's interaction (E key or __sanctumInteract hook). */
  private fireActiveZone(): void {
    if (this.overlay) return; // an overlay is already open
    this.activeZone?.interact();
  }

  /**
   * Door zone → leave the Sanctum. Wired to OverworldScene in 8A.3; guarded so
   * it is a safe no-op until that scene is registered.
   */
  private onDoorInteract(): void {
    if (this.scene.manager.keys['OverworldScene']) {
      this.scene.start('OverworldScene');
    }
  }

  // ── Tiled object helpers ────────────────────────────────────────────────

  /** Find a named object on the `objects` object layer (point or rectangle). */
  private findObject(
    map: Phaser.Tilemaps.Tilemap,
    name: string,
  ): Phaser.Types.Tilemaps.TiledObject | undefined {
    return map.getObjectLayer('objects')?.objects.find((o) => o.name === name);
  }

  /**
   * Draw a labelled accent marker over each zone rectangle so the room's points
   * of interest are visible. In 8A.1 these are non-interactive (8A.2 attaches
   * InteractionZones at the same coordinates).
   */
  private renderZoneMarkers(map: Phaser.Tilemaps.Tilemap): void {
    const labels: Record<string, string> = {
      bed: 'Bed',
      meditation: 'Meditation',
      campfire: 'Campfire',
      ringwall: 'Ring Storage',
      door: 'Exit',
    };
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name === 'spawn' || !labels[o.name]) continue;
      const cx = (o.x ?? 0) + (o.width ?? 0) / 2;
      const cy = (o.y ?? 0) + (o.height ?? 0) / 2;
      this.add
        .rectangle(cx, cy, o.width ?? 32, o.height ?? 32, 0x3c4e60, 0.35)
        .setStrokeStyle(1, 0x6082aa)
        .setName(`zone-marker-${o.name}`);
      this.add
        .text(cx, cy - (o.height ?? 32) / 2 - 12, labels[o.name], {
          fontSize: '11px',
          color: '#cfe3ff',
        })
        .setOrigin(0.5)
        .setName(`zone-label-${o.name}`);
    }
  }

  // ── Modal overlays (8A.2) ─────────────────────────────────────────────────

  /**
   * Create a fresh modal overlay container: a dimmed full-screen backdrop fixed
   * to the camera, plus a titled panel. Returns the container; callers add panel
   * content into it. Closing destroys the container (and any non-adopted
   * children); adopted reusable panels are released via `overlayOnClose`.
   */
  private beginOverlay(name: string, title: string, onClose?: () => void): Phaser.GameObjects.Container {
    this.closeOverlay(); // never stack overlays
    const c = this.add.container(0, 0).setDepth(4000).setScrollFactor(0);
    const backdrop = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setScrollFactor(0)
      .setInteractive(); // swallow clicks to the room behind
    const panel = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 760, 470, 0x161622)
      .setStrokeStyle(2, 0x6082aa)
      .setScrollFactor(0);
    const titleText = this.add
      .text(CANVAS_W / 2, 60, title, { fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const closeBtn = this.add
      .text(CANVAS_W / 2 + 360, 56, '[×]', { fontSize: '16px', color: '#ff8888' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeOverlay());
    c.add([backdrop, panel, titleText, closeBtn]);

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
    this.overlay.destroy(true);
    this.overlay = null;
    this.overlayName = null;
    this.overlayOnClose = null;
    window.__sanctumOverlayOpen = null;
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
  }

  /** Return an adopted panel to the scene root, parked off-screen. */
  private releasePanel(container: Phaser.GameObjects.Container, panel: Phaser.GameObjects.Container): void {
    container.remove(panel); // re-parents to the scene display list
    panel.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
  }

  /**
   * Ring-storage wall: inventory (At Sanctum + Loadout grids), carry move
   * buttons, the battle-hand panels, and a [Fuse Rings] button that opens the
   * existing FusionPanel. Reuses the exact panel instances parented into the
   * overlay container.
   */
  private openRingwallOverlay(): void {
    const c = this.beginOverlay('ringwall', 'RING STORAGE', () => {
      this.releasePanel(c, this.sanctumGrid);
      this.releasePanel(c, this.loadoutGrid);
      this.releasePanel(c, this.stakePanel);
      this.releasePanel(c, this.loadoutPanel);
      // The strip lives inside the overlay container — the container destroy
      // reclaims it, so just drop the stale reference (#78 ④).
      this.passiveLabel = null;
      window.__campHitTestRing = undefined;
    });

    // Column headers.
    c.add(this.add.text(40, 96, 'At Sanctum', { fontSize: '13px', color: '#cccccc' }).setScrollFactor(0));
    const loadoutHdr = this.add.text(300, 96, this.loadoutHeaderText.text, { fontSize: '13px', color: '#cccccc' }).setScrollFactor(0);
    c.add(loadoutHdr);
    c.add(this.add.text(580, 96, 'Battle Hand', { fontSize: '13px', color: '#cccccc' }).setScrollFactor(0));

    // Adopt the reusable grids/panels into the overlay.
    this.adoptPanel(c, this.sanctumGrid, 40, 120);
    this.adoptPanel(c, this.loadoutGrid, 300, 120);
    this.adoptPanel(c, this.stakePanel, 580, 120);
    this.adoptPanel(c, this.loadoutPanel, 670, 120);

    // Carry move buttons.
    c.add(
      this.add
        .text(40, 400, '[Add to Loadout]', { fontSize: '13px', color: '#aaffaa' })
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.addSelectedToLoadout()),
    );
    c.add(
      this.add
        .text(300, 400, '[Leave at Sanctum]', { fontSize: '13px', color: '#ffaaaa' })
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.leaveSelectedAtSanctum()),
    );
    c.add(
      this.add
        .text(580, 400, '[Fuse Rings]', { fontSize: '13px', color: '#cc88ff' })
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.openFusionPanel()),
    );
    // Live status echo (errors from carry / assign).
    c.add(this.add.text(40, 430, this.statusText.text, { fontSize: '12px', color: '#ff8888' }).setName('overlay-status').setScrollFactor(0));

    // #78 ④ — render the Thumb passive reminder now the overlay (and its adopted
    // stake card) exist. refreshPools may have already run while the overlay was
    // closed, so draw from the cached snapshot here.
    this.renderPassiveStrip();

    // #78 ① — hit-test probe. Scrolls the camera past a card's half-size, then
    // hit-tests the card's bg at its (scroll-independent) render position. With
    // the scrollFactor(0) fix applied the hit area tracks the render, so the test
    // still hits; an unfixed (scrollFactor 1) bg would miss. Registered only
    // while this overlay is open; cleared in the overlay's onClose above.
    //
    // The follow camera lerps its scroll back toward the player inside its own
    // preRender, so we stopFollow → setScroll → preRender (now no re-lerp; this
    // also rebuilds matrixCombined that hitTest's getWorldPoint reads) → hitTest,
    // then restore scroll + follow synchronously before the next render frame.
    // useBounds is disabled during the probe so the +200 scroll is never clamped
    // to a no-op (the ringwall sits at the map edge, where bounds would otherwise
    // pin one axis and mask the bug).
    window.__campHitTestRing = (ringId: string): { found: boolean; hit: boolean } => {
      const cam = this.cameras.main;
      const bg = this.sanctumGrid.getCardBg(ringId) ?? this.loadoutGrid.getCardBg(ringId);
      if (!bg) return { found: false, hit: false };
      const m = bg.getWorldTransformMatrix(); // render-space (scroll-independent)
      const prevX = cam.scrollX;
      const prevY = cam.scrollY;
      const prevBounds = cam.useBounds;
      cam.stopFollow();
      cam.useBounds = false;
      cam.setScroll(prevX + 200, prevY + 200);
      cam.preRender(); // rebuild matrixCombined at the scrolled position
      const out: Phaser.GameObjects.GameObject[] = [];
      this.input.manager.hitTest(
        { x: m.tx, y: m.ty } as unknown as Phaser.Input.Pointer,
        [bg],
        cam,
        out,
      );
      cam.useBounds = prevBounds;
      cam.setScroll(prevX, prevY);
      cam.startFollow(this.player, true, 0.1, 0.1);
      return { found: true, hit: out.indexOf(bg) !== -1 };
    };
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
      anchor: string;
      waystones: Array<{
        id: string;
        name: string;
        xpThreshold: number;
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

    // Publish for E2E before rendering.
    window.__teleportState = {
      anchor: payload.anchor,
      rows: payload.waystones.map((w) => ({
        id: w.id,
        name: w.name,
        attuned: w.attuned,
        meetsThreshold: w.meetsThreshold,
        xpThreshold: w.xpThreshold,
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
        // Attuned but XP-locked — show the gate, no Travel button.
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
              `Requires ${w.xpThreshold} aggregate XP (have ${payload.aggregateXp})`,
              { fontSize: '12px', color: '#666666' },
            )
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
        y += 20;
      } else {
        // Attuned + unlocked — actionable [Travel] button.
        c.add(
          this.add
            .text(CANVAS_W / 2 - 60, y, `${w.name}${suffix}`, { fontSize: '14px', color: '#cccccc' })
            .setOrigin(0.5)
            .setScrollFactor(0),
        );
        c.add(
          this.add
            .text(CANVAS_W / 2 + 80, y, '[Travel]', { fontSize: '14px', color: '#ffcc44' })
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
      const msg = this.add
        .text(CANVAS_W / 2, CANVAS_H / 2 - 50, `Sanctum re-anchored near ${waystoneName}`, {
          fontSize: '14px',
          color: '#aaffaa',
          backgroundColor: '#222222',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(600)
        .setName('teleport-confirm');
      this.time.delayedCall(2000, () => msg.destroy());
      if (window.__teleportState) {
        window.__teleportState.anchor = waystoneId;
      }
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      this.showTeleportError(body?.error ?? 'Teleport failed');
    }
  }

  /** Show a teleport error — kept in the scene display list (not the overlay container)
   *  so E2E can locate it via scene.children.getByName('teleport-error'). */
  private showTeleportError(message: string): void {
    const errText = this.add
      .text(CANVAS_W / 2, 420, message, { fontSize: '13px', color: '#ff6666' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(4001) // above the overlay container (depth 4000)
      .setName('teleport-error');
    this.time.delayedCall(8000, () => { if (errText.active) errText.destroy(); });
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
    this.fusionPanel = new FusionPanel(
      this,
      (ringId1, ringId2) => this.doFuse(ringId1, ringId2),
      () => {
        /* closed — no extra cleanup needed */
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
      // Beneath the stake card (adopted at x=580, y=120; card is ~90px tall).
      this.passiveLabel = this.add
        .text(580, 230, text, {
          fontSize: '11px',
          color: '#ffcc88',
          wordWrap: { width: 200 },
          lineSpacing: 2,
        })
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
      if (wasOpen) this.fusionPanel.open(this.rings);
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
