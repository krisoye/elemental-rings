import Phaser from 'phaser';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Waystone } from '../objects/world/Waystone';
import { Compass } from '../objects/world/Compass';
import { COMPASS_RANGE } from '../Constants';

declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = WS.replace(/^ws/, 'http');

/** One entry of the GET /api/waystones payload (server is the authority). */
interface WaystoneInfo {
  id: string;
  name: string;
  xpThreshold: number;
  attuned: boolean;
  meetsThreshold: boolean;
}
interface WaystonesPayload {
  aggregateXp: number;
  waystones: WaystoneInfo[];
}

/**
 * The Forest biome overworld (GDD §10, Phase 8B). Reached from the Sanctum's
 * exit door (8A.3). It reuses the spatial-engine pattern: tilemap → collision
 * layer → Player at spawn → collider → camera follow + bounds, plus a
 * `sanctum_return` zone that walks the player back into the Sanctum.
 *
 * Phase 8B.1 adds waystones (GDD §10.7): permanent standing stones the player
 * walks onto and attunes with E. Attunement is server-enforced (the overworld
 * itself is per-player/client-side, but the attunement RECORD is a rule). The
 * scene GETs /api/waystones on create and POSTs /api/waystones/attune on E.
 *
 * Phase 8B.2 adds the Compass HUD: a camera-pinned arrow that pulls toward the
 * nearest UNATTUNED waystone within COMPASS_RANGE, brightening as the player
 * approaches and hiding when none is in range (or all are attuned). No teleport
 * yet — that is 8B.3. The scene does not auto-start; it is reached via the
 * Sanctum door.
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  /** Waystone markers keyed by waystone id (for recolor on attune). */
  private waystones: Map<string, Waystone> = new Map();
  /** Latest GET /api/waystones payload (mirrored to window.__waystones). */
  private waystonePayload: WaystonesPayload | null = null;
  /** Camera-pinned compass HUD (8B.2) pulling toward unattuned waystones. */
  private compass!: Compass;

  constructor() {
    super({ key: 'OverworldScene' });
  }

  preload(): void {
    // `tiles` is cached if the Sanctum loaded first, but reload defensively in
    // case the overworld is the first spatial scene (e.g. a direct deep-link).
    if (!this.textures.exists('tiles')) {
      this.load.image('tiles', 'assets/tiles/placeholder.png');
    }
    this.load.tilemapTiledJSON('overworld', 'assets/maps/overworld.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'OverworldScene';

    const map = this.make.tilemap({ key: 'overworld' });
    const tileset = map.addTilesetImage('placeholder', 'tiles')!;
    const groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    groundLayer.setCollisionByProperty({ collides: true });

    const spawn = map.getObjectLayer('objects')?.objects.find((o) => o.name === 'spawn');
    this.player = new Player(this, spawn?.x ?? 64, spawn?.y ?? 64);
    this.physics.add.collider(this.player, groundLayer);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Biome title (pinned to the camera).
    this.add
      .text(16, 16, 'FOREST', { fontSize: '16px', color: '#cfe3ff' })
      .setScrollFactor(0)
      .setDepth(500);

    // Compass HUD (8B.2) — hidden until the first update() finds a target.
    this.compass = new Compass(this);
    window.__compass = { visible: false, targetId: null, angle: null, intensity: null };

    // Interaction zones: sanctum_return → back to the Sanctum.
    this.buildZones(map);

    // Input.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.keyboard!.on('keydown-E', () => this.activeZone?.interact());
    window.__sanctumInteract = (): void => this.activeZone?.interact();

    window.__player = this.player;
    this.events.once('shutdown', () => {
      window.__player = null;
      window.__scene = null;
      window.__sanctumInteract = undefined;
      window.__sanctumZones = undefined;
      window.__waystones = undefined;
      window.__compass = undefined;
      this.zones.forEach((z) => z.destroy());
      this.waystones.forEach((w) => w.destroy());
      this.compass.destroy();
      this.zones = [];
      this.waystones.clear();
    });

    // Load waystone state from the authoritative server and render the markers.
    void this.loadWaystones(map);
  }

  update(): void {
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
    this.updateCompass();
  }

  /**
   * Per-frame compass pull (8B.2). Finds the nearest UNATTUNED waystone (from the
   * cached server payload joined with the instantiated markers' positions). When
   * one is within COMPASS_RANGE the compass points at it with intensity rising as
   * distance shrinks; otherwise it hides. Publishes window.__compass each frame.
   */
  private updateCompass(): void {
    const px = this.player.x;
    const py = this.player.y;

    // Unattuned waystone ids that have a live marker (and thus a position).
    const unattuned = (this.waystonePayload?.waystones ?? []).filter((w) => !w.attuned);

    let targetId: string | null = null;
    let bestDist = Infinity;
    let bestX = 0;
    let bestY = 0;
    for (const info of unattuned) {
      const marker = this.waystones.get(info.id);
      if (!marker) continue;
      const d = Phaser.Math.Distance.Between(px, py, marker.center.x, marker.center.y);
      if (d < bestDist) {
        bestDist = d;
        targetId = info.id;
        bestX = marker.center.x;
        bestY = marker.center.y;
      }
    }

    if (targetId === null || bestDist > COMPASS_RANGE) {
      this.compass.hide();
      window.__compass = { visible: false, targetId: null, angle: null, intensity: null };
      return;
    }

    const angle = Phaser.Math.Angle.Between(px, py, bestX, bestY);
    const intensity = 1 - bestDist / COMPASS_RANGE;
    this.compass.point(angle, intensity);
    window.__compass = { visible: true, targetId, angle, intensity };
  }

  /** Build an InteractionZone for each named rectangle (sanctum_return here). */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name !== 'sanctum_return') continue;
      const zone = new InteractionZone(this, o, () => this.scene.start('CampScene'));
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }
  }

  /**
   * Fetch GET /api/waystones, then instantiate a Waystone marker for every
   * `waystone` object on the map, colored by the matching `attuned` flag. The
   * waystone's wrapped InteractionZone is registered into the shared zone list
   * so the existing overlap / nearest-zone / E machinery drives it.
   */
  private async loadWaystones(map: Phaser.Tilemaps.Tilemap): Promise<void> {
    const payload = await this.fetchWaystones();
    if (!payload) return; // unauthenticated → already routed to LoginScene
    this.cachePayload(payload);

    const byId = new Map(payload.waystones.map((w) => [w.id, w]));
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name !== 'waystone') continue;
      const id = this.waystoneIdOf(o);
      if (!id) continue;
      const info = byId.get(id);
      const marker = new Waystone(this, o, id, info?.name ?? id, info?.attuned ?? false, () =>
        void this.onAttune(id),
      );
      this.physics.add.overlap(this.player, marker.interactionZone.overlapZone);
      this.zones.push(marker.interactionZone);
      this.waystones.set(id, marker);
    }
  }

  /** Read the `waystoneId` custom property off a Tiled object, if present. */
  private waystoneIdOf(obj: Phaser.Types.Tilemaps.TiledObject): string | null {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'waystoneId');
    return typeof prop?.value === 'string' ? prop.value : null;
  }

  /** GET /api/waystones with the stored Bearer token. Null on auth failure. */
  private async fetchWaystones(): Promise<WaystonesPayload | null> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return null;
    }
    try {
      const res = await fetch(`${API_BASE}/api/waystones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('er_token');
        this.scene.start('LoginScene');
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as WaystonesPayload;
    } catch {
      return null;
    }
  }

  /**
   * Attune the given waystone: POST /api/waystones/attune, then recolor the
   * marker attuned and cache the refreshed payload. The server is authoritative;
   * the client only reflects the returned state.
   */
  private async onAttune(waystoneId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/waystones/attune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId }),
      });
      if (!res.ok) return;
      const payload = (await res.json()) as WaystonesPayload;
      this.cachePayload(payload);
      for (const info of payload.waystones) {
        this.waystones.get(info.id)?.setAttuned(info.attuned);
      }
    } catch {
      // Network error — leave the marker unchanged; the next GET will reconcile.
    }
  }

  /** Store the latest payload and mirror it to window.__waystones for E2E. */
  private cachePayload(payload: WaystonesPayload): void {
    this.waystonePayload = payload;
    window.__waystones = payload;
  }

  /** Per-frame: show the prompt for the nearest overlapping zone. */
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
}
