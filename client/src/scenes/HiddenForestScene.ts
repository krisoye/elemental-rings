import Phaser from 'phaser';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Waystone } from '../objects/world/Waystone';
import { ANCHORAGE_GROUND_RADIUS } from '../Constants';

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
  anchor: string;
  waystones: WaystoneInfo[];
}

/**
 * The hidden Forest alcove (GDD §10, Phase 8C.2, #82). A tiny secret clearing
 * reachable ONLY by teleporting to `forest_hidden_anchor` (revealed by attuning
 * the Swamp's Ironbark Rune, `swamp_secret_forest`). This closes the Swamp
 * discovery loop: explore Swamp → find rune → unlock this hidden Forest area.
 *
 * A minimal MVP clone of {@link OverworldScene}: tilemap → collision → Player →
 * camera follow, plus the Anchorage auto-attune + discovery-Waystone machinery so
 * the hidden Anchorage attunes on arrival and the hidden glade can be attuned. It
 * reuses the shared `forest` tileset texture (forest.png). A `return_exit`
 * zone walks the player back to the Forest (OverworldScene).
 */
export class HiddenForestScene extends Phaser.Scene {
  private player!: Player;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  private waystones: Map<string, Waystone> = new Map();
  private anchorageMarkers: Map<string, { center: { x: number; y: number } }> = new Map();
  private anchorageAutoAttuned: Set<string> = new Set();
  private anchorageRings: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private anchorageFires: Map<string, { gfx: Phaser.GameObjects.Graphics; x: number; y: number }> =
    new Map();

  constructor() {
    super({ key: 'HiddenForestScene' });
  }

  preload(): void {
    // Reuse the shared forest tileset (cached if the Forest loaded first; reload
    // defensively for a direct teleport-in).
    if (!this.textures.exists('forest')) {
      this.load.image('forest', 'assets/tiles/forest.png');
    }
    this.load.tilemapTiledJSON('forest_hidden', 'assets/maps/forest_hidden.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'HiddenForestScene';

    const map = this.make.tilemap({ key: 'forest_hidden' });
    const tileset = map.addTilesetImage('forest', 'forest')!;
    const groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    groundLayer.setCollisionByProperty({ collides: true });

    // Spawn at the hidden Anchorage (the teleport-in destination).
    const anchor = map
      .getObjectLayer('objects')
      ?.objects.find((o) =>
        ((o.properties ?? []) as Array<{ name: string; value: unknown }>).some(
          (p) => p.name === 'waystoneId' && p.value === 'forest_hidden_anchor',
        ),
      );
    const spawnX = (anchor?.x ?? 224) + (anchor?.width ?? 32) / 2;
    const spawnY = (anchor?.y ?? 192) + (anchor?.height ?? 32) / 2;
    this.player = new Player(this, spawnX, spawnY);
    this.physics.add.collider(this.player, groundLayer);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.add
      .text(16, 16, 'HIDDEN GLADE', { fontSize: '16px', color: '#cfe3ff' })
      .setScrollFactor(0)
      .setDepth(500);

    // return_exit → back to the Forest.
    this.buildZones(map);

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
      this.zones.forEach((z) => z.destroy());
      this.waystones.forEach((w) => w.destroy());
      this.anchorageRings.forEach((g) => g.destroy());
      this.anchorageFires.forEach((f) => f.gfx.destroy());
      this.anchorageRings.clear();
      this.anchorageFires.clear();
      this.zones = [];
      this.waystones.clear();
      this.anchorageMarkers.clear();
      this.anchorageAutoAttuned.clear();
    });

    void this.loadWaystones(map);
  }

  update(): void {
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
    this.checkAnchorageAutoAttune();
  }

  /** The moment the player walks within range of an unattuned Anchorage, attune it. */
  private checkAnchorageAutoAttune(): void {
    const px = this.player.x;
    const py = this.player.y;
    for (const [id, anchorage] of this.anchorageMarkers) {
      if (this.anchorageAutoAttuned.has(id)) continue;
      const { x, y } = anchorage.center;
      if (Phaser.Math.Distance.Between(px, py, x, y) <= ANCHORAGE_GROUND_RADIUS) {
        this.anchorageAutoAttuned.add(id);
        void this.onAttune(id);
      }
    }
  }

  /** Build the `return_exit` InteractionZone (target=OverworldScene). */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name !== 'return_exit') continue;
      const target = this.targetSceneOf(o) ?? 'OverworldScene';
      const zone = new InteractionZone(this, o, () => this.scene.start(target));
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }
  }

  /** Instantiate the Anchorage + Waystone markers from the map, colored by attune state. */
  private async loadWaystones(map: Phaser.Tilemaps.Tilemap): Promise<void> {
    const payload = await this.fetchWaystones();
    if (!payload) return;
    this.cachePayload(payload);

    for (const info of payload.waystones) {
      if (info.attuned) this.anchorageAutoAttuned.add(info.id);
    }

    const byId = new Map(payload.waystones.map((w) => [w.id, w]));
    const objs = map.getObjectLayer('objects')?.objects ?? [];

    for (const o of objs) {
      if (o.name !== 'anchorage') continue;
      const id = this.waystoneIdOf(o);
      if (!id) continue;
      const info = byId.get(id);
      const cx = (o.x ?? 0) + (o.width ?? 32) / 2;
      const cy = (o.y ?? 0) + (o.height ?? 32) / 2;
      this.anchorageMarkers.set(id, { center: { x: cx, y: cy } });

      const zone = new InteractionZone(
        this,
        { ...o, name: id } as Phaser.Types.Tilemaps.TiledObject,
        () => void this.onAttune(id),
      );
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);

      const ring = this.add.graphics().setDepth(1);
      ring.fillStyle(info?.attuned ? 0x3a5a2a : 0x2a3a1a, info?.attuned ? 0.45 : 0.3);
      ring.fillCircle(cx, cy, ANCHORAGE_GROUND_RADIUS);
      this.anchorageRings.set(id, ring);

      const fire = this.add
        .graphics()
        .setDepth(7)
        .setPosition(cx + 28, cy + 36)
        .setName(`anchorage-fire-${id}`);
      this.drawFlame(fire, 0, 0, info?.attuned ?? false);
      this.anchorageFires.set(id, { gfx: fire, x: 0, y: 0 });
    }

    for (const o of objs) {
      if (o.name !== 'waystone') continue;
      const id = this.waystoneIdOf(o);
      const markerId = id ?? `visual_${o.id ?? o.x}_${o.y}`;
      const info = id ? byId.get(id) : undefined;
      const marker = new Waystone(
        this,
        o,
        markerId,
        info?.name ?? markerId,
        info?.attuned ?? false,
        id ? () => void this.onAttune(id) : () => {},
      );
      if (id) {
        this.physics.add.overlap(this.player, marker.interactionZone.overlapZone);
        this.zones.push(marker.interactionZone);
      }
      this.waystones.set(markerId, marker);
    }
  }

  /** Draw an Anchorage campfire (rock base + warm/cold flame by attune state). */
  private drawFlame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, attuned: boolean): void {
    g.clear();
    g.fillStyle(0x333333);
    g.fillEllipse(cx, cy + 4, 14, 6);
    if (attuned) {
      g.fillStyle(0xff6600);
      g.fillEllipse(cx, cy, 10, 14);
      g.fillStyle(0xff9900);
      g.fillEllipse(cx, cy - 4, 7, 9);
    } else {
      g.fillStyle(0x4466aa);
      g.fillEllipse(cx, cy, 8, 10);
    }
  }

  /** Re-render the Anchorage rings + campfires for the given state. */
  private updateAnchorageVisuals(waystones: WaystoneInfo[]): void {
    for (const info of waystones) {
      const anchorage = this.anchorageMarkers.get(info.id);
      if (!anchorage) continue;
      const ring = this.anchorageRings.get(info.id);
      if (ring) {
        ring.clear();
        ring.fillStyle(info.attuned ? 0x3a5a2a : 0x2a3a1a, info.attuned ? 0.45 : 0.3);
        ring.fillCircle(anchorage.center.x, anchorage.center.y, ANCHORAGE_GROUND_RADIUS);
      }
      const fire = this.anchorageFires.get(info.id);
      if (fire) this.drawFlame(fire.gfx, fire.x, fire.y, info.attuned);
    }
  }

  /** Read the `waystoneId` custom property off a Tiled object, if present. */
  private waystoneIdOf(obj: Phaser.Types.Tilemaps.TiledObject): string | null {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'waystoneId');
    return typeof prop?.value === 'string' ? prop.value : null;
  }

  /** Read the `target` (destination scene key) custom property off a Tiled object. */
  private targetSceneOf(obj: Phaser.Types.Tilemaps.TiledObject): string | null {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'target');
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

  /** Attune the given waystone server-side, then recolor + cache the result. */
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
      // Network error — the next GET reconciles.
    }
  }

  /** Store the latest payload and mirror it to window.__waystones for E2E. */
  private cachePayload(payload: WaystonesPayload): void {
    window.__waystones = payload;
    this.updateAnchorageVisuals(payload.waystones);
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
