import Phaser from 'phaser';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Waystone } from '../objects/world/Waystone';
import { Compass } from '../objects/world/Compass';
import {
  COMPASS_RANGE,
  SANCTUM_OFFSET,
  SANCTUM_DOOR_OFFSET,
  SANCTUM_ZONE_HALF,
  ANCHORAGE_GROUND_RADIUS,
} from '../Constants';

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
  /** Centers of Anchorage locations (keyed by waystoneId), for compass + spawn logic. */
  private anchorageMarkers: Map<string, { center: { x: number; y: number } }> = new Map();
  /**
   * Anchorage ids that have already auto-attuned (or were attuned on load), so the
   * per-frame walk-in check fires onAttune at most once per Anchorage (GDD §10.7:
   * "Discovery is automatic … the protagonist immediately and permanently attunes
   * to the Anchorage the moment they enter it").
   */
  private anchorageAutoAttuned: Set<string> = new Set();
  /** Latest GET /api/waystones payload (mirrored to window.__waystones). */
  private waystonePayload: WaystonesPayload | null = null;
  /** Camera-pinned compass HUD (8B.2) pulling toward unattuned waystones. */
  private compass!: Compass;
  /** Sanctum exterior placeholder (8B.4.1), drawn at the anchored waystone. */
  private sanctumGfx: Phaser.GameObjects.Graphics | null = null;
  private sanctumLabel: Phaser.GameObjects.Text | null = null;
  /** Anchorage ground treatment (8B.4.3), keyed by waystone id. */
  private anchorageRings: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private anchorageFires: Map<string, { gfx: Phaser.GameObjects.Graphics; x: number; y: number }> =
    new Map();

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
      window.__sanctumReturnCenter = undefined;
      this.zones.forEach((z) => z.destroy());
      this.waystones.forEach((w) => w.destroy());
      this.compass.destroy();
      this.sanctumGfx?.destroy();
      this.sanctumLabel?.destroy();
      this.sanctumGfx = null;
      this.sanctumLabel = null;
      this.anchorageRings.forEach((g) => g.destroy());
      this.anchorageFires.forEach((f) => f.gfx.destroy());
      this.anchorageRings.clear();
      this.anchorageFires.clear();
      this.zones = [];
      this.waystones.clear();
      this.anchorageMarkers.clear();
      this.anchorageAutoAttuned.clear();
    });

    // Load waystone state from the authoritative server and render the markers.
    void this.loadWaystones(map);
  }

  update(): void {
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
    this.updateCompass();
    this.checkAnchorageAutoAttune();
  }

  /**
   * Per-frame Anchorage auto-attune (GDD §10.7). Discovery is automatic: the
   * moment the player walks within ANCHORAGE_GROUND_RADIUS of an unattuned
   * Anchorage center, it permanently attunes (server POST). The guard set ensures
   * onAttune fires at most once per Anchorage; the E-press zone remains as a
   * harmless fallback. No-op until the markers (anchorageMarkers) exist.
   */
  private checkAnchorageAutoAttune(): void {
    const px = this.player.x;
    const py = this.player.y;
    for (const [id, anchorage] of this.anchorageMarkers) {
      if (this.anchorageAutoAttuned.has(id)) continue;
      const { x, y } = anchorage.center;
      if (Phaser.Math.Distance.Between(px, py, x, y) <= ANCHORAGE_GROUND_RADIUS) {
        this.anchorageAutoAttuned.add(id); // prevent repeated POSTs
        void this.onAttune(id);
      }
    }
  }

  /**
   * Per-frame compass pull (8B.2). Finds the nearest eligible UNATTUNED waystone
   * (from the cached server payload joined with the instantiated markers'
   * positions). When one is within COMPASS_RANGE the compass points at it with
   * intensity rising as distance shrinks; otherwise it hides. Publishes
   * window.__compass each frame.
   *
   * Eligibility: Anchorages (home base / teleport destinations, tracked in
   * anchorageMarkers) always pull while unattuned. Discovery Waystones — the
   * standing stones that reveal adjacent biomes (#79) — only pull once the player
   * meets their aggregate-XP threshold (GDD §10.7), so the compass doesn't drag a
   * fresh player toward a region they aren't ready for.
   */
  private updateCompass(): void {
    const px = this.player.x;
    const py = this.player.y;

    // Eligible-unattuned ids: unattuned, and (for non-Anchorage discovery
    // waystones) XP-threshold-met. Anchorages always qualify while unattuned.
    const unattuned = (this.waystonePayload?.waystones ?? []).filter((w) => {
      if (w.attuned) return false;
      const isAnchorage = this.anchorageMarkers.has(w.id);
      return isAnchorage || w.meetsThreshold;
    });

    let targetId: string | null = null;
    let bestDist = Infinity;
    let bestX = 0;
    let bestY = 0;
    for (const info of unattuned) {
      const center =
        this.waystones.get(info.id)?.center ?? this.anchorageMarkers.get(info.id)?.center;
      if (!center) continue;
      const d = Phaser.Math.Distance.Between(px, py, center.x, center.y);
      if (d < bestDist) {
        bestDist = d;
        targetId = info.id;
        bestX = center.x;
        bestY = center.y;
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

  /**
   * Build InteractionZones for named map rectangles. As of 8B.4.1 the
   * `sanctum_return` zone is built dynamically in {@link loadWaystones} at the
   * anchored waystone position (co-located with the visible Sanctum exterior),
   * so the fixed map rectangle is intentionally skipped here.
   */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    // sanctum_return is built dynamically in loadWaystones at the anchor position.
    // Skip it here so the fixed map position is never used.
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name === 'sanctum_return') continue;
      // (future: handle other named zones here)
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

    // Seed the auto-attune guard with already-attuned ids so walking back over an
    // Anchorage the player has already discovered doesn't re-POST an attune.
    for (const info of payload.waystones) {
      if (info.attuned) this.anchorageAutoAttuned.add(info.id);
    }

    const byId = new Map(payload.waystones.map((w) => [w.id, w]));
    const objs = map.getObjectLayer('objects')?.objects ?? [];

    // Loop A — Anchorage objects (home base / teleport destinations). These are
    // rendered as a campfire + worn-ground ring (NO standing stone) and wrapped
    // in an InteractionZone for attunement. Their centers feed the compass and
    // anchor-derived spawn logic via anchorageMarkers.
    for (const o of objs) {
      if (o.name !== 'anchorage') continue;
      const id = this.waystoneIdOf(o);
      if (!id) continue;
      const info = byId.get(id);
      const cx = (o.x ?? 0) + (o.width ?? 32) / 2;
      const cy = (o.y ?? 0) + (o.height ?? 32) / 2;
      this.anchorageMarkers.set(id, { center: { x: cx, y: cy } });

      // Interaction zone — same as Waystone: named by waystoneId so zone
      // machinery (window.__sanctumZones, nearest-zone selection) works unchanged.
      const zone = new InteractionZone(
        this,
        { ...o, name: id } as Phaser.Types.Tilemaps.TiledObject,
        () => void this.onAttune(id),
      );
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);

      // Anchorage ground treatment (8B.4.3, #73): a soft worn-ground ring beneath
      // the campfire and a flickering campfire SE of the center. Both are
      // recolored on attune via updateAnchorageVisuals (cold/blue → warm/orange).
      const ring = this.add.graphics().setDepth(1);
      ring.fillStyle(info?.attuned ? 0x3a5a2a : 0x2a3a1a, info?.attuned ? 0.45 : 0.3);
      ring.fillCircle(cx, cy, ANCHORAGE_GROUND_RADIUS);
      this.anchorageRings.set(id, ring);

      const fx = cx + 28;
      const fy = cy + 36;
      const fire = this.add
        .graphics()
        .setDepth(7)
        .setPosition(fx, fy)
        .setName(`anchorage-fire-${id}`);
      this.drawFlame(fire, 0, 0, info?.attuned ?? false);
      this.anchorageFires.set(id, { gfx: fire, x: 0, y: 0 });
      this.tweens.add({
        targets: fire,
        scaleY: { from: 0.9, to: 1.1 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Loop B — pure Waystone objects (discoverable markers scattered in the
    // world). These are standing stones (NO campfire). Visual-only waystones may
    // have no waystoneId / server record — they still render but don't attune.
    for (const o of objs) {
      if (o.name !== 'waystone') continue;
      const id = this.waystoneIdOf(o);
      // Visual-only waystones may have no waystoneId — synthesize one for tracking only.
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
        // Only register overlap + push to zones if it has a server record
        // (so E actually does something).
        this.physics.add.overlap(this.player, marker.interactionZone.overlapZone);
        this.zones.push(marker.interactionZone);
      }
      this.waystones.set(markerId, marker);
    }

    // Anchor-derived spawn (8B.3, #63) + Sanctum exterior (8B.4.1, #71): the
    // Sanctum structure and its re-entry door are placed at the anchored waystone
    // (toward map center) rather than the map's static `spawn`/`sanctum_return`.
    // Done AFTER the markers are built so the anchor marker (and its center)
    // exists. Physics + camera-follow are already wired in create().
    const anchorCenter = this.anchorageMarkers.get(payload.anchor);
    if (anchorCenter) {
      // Compute Anchorage-derived position (toward map center from anchor).
      const mapCx = map.widthInPixels / 2;
      const mapCy = map.heightInPixels / 2;
      const dx = mapCx - anchorCenter.center.x;
      const dy = mapCy - anchorCenter.center.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const dirX = dx / len;
      const dirY = dy / len;
      const sanctumX = anchorCenter.center.x + dirX * SANCTUM_OFFSET;
      const sanctumY = anchorCenter.center.y + dirY * SANCTUM_OFFSET;

      // Build the sanctum_return InteractionZone at the Sanctum door position.
      // InteractionZone only reads x/y/width/height/name; id/type are required by
      // the TiledObject type but unused here, so a synthetic object suffices.
      const sanctumObj: Phaser.Types.Tilemaps.TiledObject = {
        id: -1,
        type: 'sanctum_return',
        x: sanctumX - SANCTUM_ZONE_HALF,
        y: sanctumY - SANCTUM_ZONE_HALF,
        width: SANCTUM_ZONE_HALF * 2,
        height: SANCTUM_ZONE_HALF * 2,
        name: 'sanctum_return',
      };
      const returnZone = new InteractionZone(this, sanctumObj, () => this.scene.start('CampScene'));
      this.physics.add.overlap(this.player, returnZone.overlapZone);
      this.zones.push(returnZone);

      // Draw the Sanctum exterior placeholder.
      this.drawSanctumExterior(sanctumX, sanctumY);

      // Spawn player just outside the Sanctum door, further along the dir vector.
      this.player.setPosition(
        sanctumX + dirX * SANCTUM_DOOR_OFFSET,
        sanctumY + dirY * SANCTUM_DOOR_OFFSET,
      );

      // Expose for E2E.
      window.__sanctumReturnCenter = { x: sanctumX, y: sanctumY };
    }
  }

  /**
   * Draw the Sanctum exterior placeholder (8B.4.1) at the given world center:
   * a foundation slab, roof triangle, dark door opening, and a floating label.
   * The graphics + label are tracked so they are destroyed on scene shutdown.
   */
  private drawSanctumExterior(cx: number, cy: number): void {
    const g = this.add.graphics().setDepth(8);
    // Foundation slab
    g.fillStyle(0x2a2a3a);
    g.fillRect(cx - 40, cy - 24, 80, 48);
    // Roof triangle
    g.fillStyle(0x3a3a4a);
    g.fillTriangle(cx - 44, cy - 24, cx + 44, cy - 24, cx, cy - 60);
    // Door opening (south face, darker)
    g.fillStyle(0x0a0a14);
    g.fillRect(cx - 10, cy + 8, 20, 16);
    const label = this.add
      .text(cx, cy - 68, 'Sanctum', { fontSize: '12px', color: '#aabbcc' })
      .setOrigin(0.5, 1)
      .setDepth(9);
    this.sanctumGfx = g;
    this.sanctumLabel = label;
  }

  /**
   * Draw an Anchorage campfire (8B.4.3) into the given graphics object at world
   * (cx, cy): a rock base plus a warm orange flame when `attuned`, or a cold
   * blue flame when not. Clears first so it can be redrawn on attune. Note: the
   * flicker tween animates `scaleY` on the graphics — clear() does not reset that
   * transform, which is intended (the flicker continues across redraws).
   */
  private drawFlame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, attuned: boolean): void {
    g.clear();
    g.fillStyle(0x333333);
    g.fillEllipse(cx, cy + 4, 14, 6); // rock base
    if (attuned) {
      g.fillStyle(0xff6600);
      g.fillEllipse(cx, cy, 10, 14);
      g.fillStyle(0xff9900);
      g.fillEllipse(cx, cy - 4, 7, 9);
      g.fillStyle(0xffdd44);
      g.fillEllipse(cx, cy - 8, 4, 5);
    } else {
      g.fillStyle(0x4466aa);
      g.fillEllipse(cx, cy, 8, 10);
      g.fillStyle(0x7799cc);
      g.fillEllipse(cx, cy - 4, 5, 6);
    }
  }

  /**
   * Re-render the Anchorage ground rings + campfires (8B.4.3) for the given
   * waystone state. Called after each payload cache so attuning a waystone warms
   * its campfire and brightens its ground ring. Skips ids without a live marker.
   */
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
    // Refresh Anchorage ground treatment (8B.4.3) from the latest state. On the
    // first call (during loadWaystones, before markers are built) the guard in
    // updateAnchorageVisuals no-ops; on subsequent calls (onAttune) it warms the
    // attuned Anchorage's campfire + brightens its ring.
    this.updateAnchorageVisuals(payload.waystones);
  }

  /** Per-frame: show the prompt for the nearest overlapping zone. */
  private updateActiveZone(): void {
    const px = this.player.x;
    const py = this.player.y;
    const overlapping = this.zones.filter((z) => z.contains(px, py));
    // With SANCTUM_OFFSET=0 the sanctum_return door is co-located with its anchor
    // Anchorage zone (identical center → equal distance). The return door is the
    // actionable E target there (Anchorage discovery is automatic via auto-attune),
    // so it always wins selection when the player overlaps it.
    const ret = overlapping.find((z) => z.name === 'sanctum_return');
    let nearest: InteractionZone | null = ret ?? null;
    let best = ret ? -Infinity : Infinity;
    for (const z of overlapping) {
      if (z === ret) continue;
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
