import Phaser from 'phaser';
import type { AIPersonality } from '../../../shared/types';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Waystone } from '../objects/world/Waystone';
import { Compass } from '../objects/world/Compass';
import {
  COMPASS_RANGE,
  ANCHORAGE_GROUND_RADIUS,
  DETECTION_RADIUS,
  DOUBLE_CLICK_MS,
  ELEMENT_COLORS,
  ELEMENT_NAMES,
} from '../Constants';

/** One entry of the GET /api/overworld/npcs payload (server is the authority). */
interface NpcInfo {
  id: string;
  personality: string;
  x: number;
  y: number;
  element: number;
}

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
 * The Swamp biome (GDD §10, Phase 8C.2, #82). Reached on foot from the Forest's
 * southwest biome_exit once `forest_sw_stone` (Bogwood Sentinel) is attuned.
 *
 * This is an MVP CLONE of {@link OverworldScene}: the BiomeScene abstraction is
 * deferred (GDD §10 EPIC 8C: "A BiomeScene abstraction is deferred until a third
 * biome justifies the refactor"). It reuses the exact spatial pattern — tilemap →
 * collision layer → Player → camera follow — plus the Anchorage auto-attune,
 * discovery-Waystone, and Compass machinery. The only structural differences from
 * the Forest overworld are:
 *   - it loads the dedicated `swamp` tilemap + `swamp-tiles` texture,
 *   - it has NO anchor-derived Sanctum exterior (the Sanctum lives in the Forest);
 *     the player spawns at the swamp entry near the Forest exit instead,
 *   - it has a `biome_exit` zone that transitions back to the Forest (OverworldScene).
 *
 * The Swamp's `swamp_secret_forest` (Ironbark Rune) Waystone, when attuned, reveals
 * the hidden Forest alcove Anchorage (`forest_hidden_anchor`) — attunement is a
 * server rule (GET/POST /api/waystones), exactly as in the Forest.
 *
 * #81 — the talisman loadout fetch + E dispatcher are integrated so new Swamp
 * Anchorages also support Sanctum Stone activation.
 */
export class SwampScene extends Phaser.Scene {
  private player!: Player;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;
  /** Waystone markers keyed by waystone id (for recolor on attune). */
  private waystones: Map<string, Waystone> = new Map();
  /** Centers of Anchorage locations (keyed by waystoneId), for compass + spawn logic. */
  private anchorageMarkers: Map<string, { center: { x: number; y: number } }> = new Map();
  /** Anchorage ids already auto-attuned (or attuned on load) — fire onAttune once. */
  private anchorageAutoAttuned: Set<string> = new Set();
  /** Latest GET /api/waystones payload (mirrored to window.__waystones). */
  private waystonePayload: WaystonesPayload | null = null;
  /** Camera-pinned compass HUD pulling toward unattuned waystones. */
  private compass!: Compass;
  /** Anchorage ground treatment, keyed by waystone id. */
  private anchorageRings: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private anchorageFires: Map<string, { gfx: Phaser.GameObjects.Graphics; x: number; y: number }> =
    new Map();
  /**
   * #81 — equipped necklace talisman + remaining charges, fetched on create. Drives
   * Sanctum Stone activation when standing in a Swamp Anchorage. null until the GET
   * resolves (or on auth failure).
   */
  private talismanLoadout: { necklaceId: string | null; necklaceCharges: number } | null = null;
  /** The Anchorage zone (by waystone id) the player currently overlaps, or null. */
  private currentAnchorageId: string | null = null;
  /**
   * #83 — the Swamp NPC roster from GET /api/overworld/npcs?biome=swamp, fetched on
   * create. Drives the colored ellipse markers + the detection check. Empty until
   * the GET resolves (or on auth failure).
   */
  private overworldNpcs: NpcInfo[] = [];
  /** NPC marker graphics (ellipse + label), tracked for shutdown removal. */
  private npcGraphics: Phaser.GameObjects.GameObject[] = [];
  /** The NPC currently within DETECTION_RADIUS (nearest), or null when none. */
  private detectedNpc: { id: string; personality: string; x: number; y: number } | null = null;
  /** Camera-pinned Approach [E] detection prompt; created lazily, reused/hidden. */
  private npcPrompt: Phaser.GameObjects.Text | null = null;
  /** #87 Part C — last pointerdown time (ms) per NPC id, for double-click ambush. */
  private npcLastClick = new Map<string, number>();

  constructor() {
    super({ key: 'SwampScene' });
  }

  preload(): void {
    // The swamp uses a dedicated tileset; load it (and the map) defensively in
    // case the Swamp is entered before any other spatial scene caches them.
    if (!this.textures.exists('swamp-tiles')) {
      this.load.image('swamp-tiles', 'assets/tiles/swamp.png');
    }
    this.load.tilemapTiledJSON('swamp', 'assets/maps/swamp.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'SwampScene';

    const map = this.make.tilemap({ key: 'swamp' });
    const tileset = map.addTilesetImage('swamp', 'swamp-tiles')!;
    const groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    groundLayer.setCollisionByProperty({ collides: true });

    // Spawn at the swamp entry waystone (where the player arrives from the Forest).
    const entry = map
      .getObjectLayer('objects')
      ?.objects.find((o) =>
        ((o.properties ?? []) as Array<{ name: string; value: unknown }>).some(
          (p) => p.name === 'waystoneId' && p.value === 'swamp_entry',
        ),
      );
    const spawnX = (entry?.x ?? 384) + (entry?.width ?? 32) / 2;
    const spawnY = (entry?.y ?? 256) + (entry?.height ?? 32) / 2 + 40; // just south of the stone
    this.player = new Player(this, spawnX, spawnY);
    this.physics.add.collider(this.player, groundLayer);

    // #88 — returning from an overworld NPC duel: restore the player to where they
    // left (recorded in window.__duelOrigin before the duel) instead of the swamp
    // entry. This scene was shut down on duel entry, so the position is carried
    // out-of-band. Consume the global immediately so it never re-applies.
    const origin = window.__duelOrigin;
    if (origin && origin.scene === 'SwampScene' && typeof origin.x === 'number') {
      this.player.setPosition(origin.x, origin.y);
    }
    window.__duelOrigin = null;

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Biome title (pinned to the camera).
    this.add
      .text(16, 16, 'SWAMP', { fontSize: '16px', color: '#cfe3ff' })
      .setScrollFactor(0)
      .setDepth(500);

    // Compass HUD — hidden until the first update() finds a target.
    this.compass = new Compass(this);
    window.__compass = { visible: false, targetId: null, angle: null, intensity: null };

    // Interaction zones: biome_exit → back to the Forest.
    this.buildZones(map);

    // Input.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.keyboard!.on('keydown-E', () => this.handleInteract());
    window.__sanctumInteract = (): void => this.handleInteract();

    window.__player = this.player;
    this.events.once('shutdown', () => {
      window.__player = null;
      window.__scene = null;
      window.__sanctumInteract = undefined;
      window.__sanctumZones = undefined;
      window.__waystones = undefined;
      window.__compass = undefined;
      window.__talismanLoadout = undefined;
      window.__overworldNpcs = undefined;
      window.__detectedNpc = undefined;
      this.npcLastClick.clear();
      this.npcGraphics.forEach((g) => g.destroy());
      this.npcGraphics = [];
      this.npcPrompt?.destroy();
      this.npcPrompt = null;
      this.zones.forEach((z) => z.destroy());
      this.waystones.forEach((w) => w.destroy());
      this.compass.destroy();
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
    // #81 — fetch the talisman loadout so E knows whether the Sanctum Stone is
    // equipped (and how many charges remain) when standing on a Swamp Anchorage.
    void this.loadTalismanLoadout();
    // #83 — fetch the Swamp NPC roster + render the markers.
    void this.loadOverworldNpcs();
  }

  update(): void {
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
    this.updateCompass();
    this.checkAnchorageAutoAttune();
    this.updateCurrentAnchorage();
    this.checkNpcDetection();
  }

  /**
   * #81 — per-frame: record which Anchorage zone (if any) the player currently
   * stands inside, so E can activate the Sanctum Stone there.
   */
  private updateCurrentAnchorage(): void {
    const px = this.player.x;
    const py = this.player.y;
    let inside: string | null = null;
    for (const [id, anchorage] of this.anchorageMarkers) {
      const { x, y } = anchorage.center;
      if (Phaser.Math.Distance.Between(px, py, x, y) <= ANCHORAGE_GROUND_RADIUS) {
        inside = id;
        break;
      }
    }
    this.currentAnchorageId = inside;
  }

  /**
   * #81 — E / interact dispatcher. When the player stands in an Anchorage with the
   * Sanctum Stone equipped and charges remaining, E activates the Stone; otherwise
   * it falls through to the default active-zone interaction (waystone attune /
   * biome exit), preserving existing E behavior.
   */
  private handleInteract(): void {
    // #83 — a detected NPC takes priority: E approaches and launches the duel via
    // the EncounterScene NPC path (battle-ai room, scoped to this NPC's id).
    if (this.detectedNpc) {
      // #88 — record the biome origin + player world position so BattleScene returns
      // to the Swamp (not the hub) when the duel ends, and create() restores the
      // player near where they left. Carried out-of-band: the scene is shut down on
      // duel entry.
      window.__duelOrigin = {
        scene: 'SwampScene',
        x: this.player.x,
        y: this.player.y,
      };
      this.scene.start('EncounterScene', {
        npcId: this.detectedNpc.id,
        personality: this.detectedNpc.personality as AIPersonality,
      });
      return;
    }
    const tl = this.talismanLoadout;
    if (
      this.currentAnchorageId &&
      tl &&
      tl.necklaceId === 'sanctum_stone' &&
      tl.necklaceCharges > 0
    ) {
      void this.activateSanctumStone(this.currentAnchorageId);
      return;
    }
    this.activeZone?.interact();
  }

  /**
   * Per-frame Anchorage auto-attune (GDD §10.7). The moment the player walks within
   * ANCHORAGE_GROUND_RADIUS of an unattuned Anchorage center, it permanently
   * attunes (server POST). The guard set ensures onAttune fires at most once.
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
   * Per-frame compass pull. Finds the nearest eligible UNATTUNED waystone and
   * points the compass at it (intensity rising as distance shrinks), or hides when
   * none is within COMPASS_RANGE. Anchorages always pull while unattuned; discovery
   * waystones only pull once their aggregate-XP threshold is met.
   */
  private updateCompass(): void {
    const px = this.player.x;
    const py = this.player.y;

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
   * Build InteractionZones for named map rectangles. The `biome_exit` object
   * transitions back to the Forest (its `target` scene-key property, defaulting to
   * OverworldScene). Anchorage / waystone zones are built in {@link loadWaystones}.
   */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name !== 'biome_exit') continue;
      const target = this.targetSceneOf(o) ?? 'OverworldScene';
      const zone = new InteractionZone(this, o, () => this.scene.start(target));
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }
  }

  /**
   * Fetch GET /api/waystones, then instantiate a marker for every `anchorage`
   * (campfire + ground ring) and `waystone` (standing stone) object on the map,
   * colored by its `attuned` flag, wrapped in an InteractionZone.
   */
  private async loadWaystones(map: Phaser.Tilemaps.Tilemap): Promise<void> {
    const payload = await this.fetchWaystones();
    if (!payload) return; // unauthenticated → already routed to LoginScene
    this.cachePayload(payload);

    // Seed the auto-attune guard with already-attuned ids.
    for (const info of payload.waystones) {
      if (info.attuned) this.anchorageAutoAttuned.add(info.id);
    }

    const byId = new Map(payload.waystones.map((w) => [w.id, w]));
    const objs = map.getObjectLayer('objects')?.objects ?? [];

    // Loop A — Anchorage objects (campfire + worn-ground ring, NO standing stone).
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

    // Loop B — pure Waystone objects (discoverable standing stones, NO campfire).
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

  /**
   * Draw an Anchorage campfire into the given graphics object: a rock base plus a
   * warm orange flame when `attuned`, or a cold blue flame when not.
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
   * Re-render the Anchorage ground rings + campfires for the given waystone state.
   * Called after each payload cache so attuning warms the campfire + brightens the
   * ring. Skips ids without a live marker.
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

  /**
   * Attune the given waystone: POST /api/waystones/attune, then recolor the marker
   * attuned and cache the refreshed payload. The server is authoritative.
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

  /**
   * #81 — GET /api/talisman-loadout and cache it (also published to
   * window.__talismanLoadout for E2E). Best-effort: a failure leaves the loadout
   * null, which simply disables Sanctum Stone activation.
   */
  private async loadTalismanLoadout(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/talisman-loadout`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { necklaceId: string | null; necklaceCharges: number };
      this.talismanLoadout = payload;
      window.__talismanLoadout = payload;
    } catch {
      // Leave the loadout null — activation stays disabled.
    }
  }

  /**
   * #81 — activate the Sanctum Stone at the given Anchorage: POST
   * /api/talisman/activate. On success the server spends a charge and re-anchors
   * the Sanctum; the cached loadout is refreshed and the scene transitions into
   * the (now-relocated) Sanctum (CampScene). A 400 is left silent.
   */
  private async activateSanctumStone(anchorageId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/talisman/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ talismanlId: 'sanctum_stone', anchorageId }),
      });
    } catch {
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { anchor: string; necklaceCharges: number };
    const updated = { necklaceId: 'sanctum_stone', necklaceCharges: body.necklaceCharges };
    this.talismanLoadout = updated;
    window.__talismanLoadout = updated;
    this.scene.start('CampScene');
  }

  /**
   * #83 / #99 — GET /api/overworld/npcs?biome=swamp&screen=swamp_entry, render
   * each NPC as a colored ellipse (element hue) + a personality label, and publish
   * window.__overworldNpcs for the E2E harness. The `screen` is required by the
   * server (8E.3); the Swamp map is its entry screen. Best-effort: a network/auth
   * failure leaves the roster empty. The server is the authority on which NPCs are
   * present.
   */
  private async loadOverworldNpcs(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/overworld/npcs?biome=swamp&screen=swamp_entry`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      this.overworldNpcs = (await res.json()) as NpcInfo[];
    } catch {
      return; // leave the roster empty
    }
    this.renderNpcs();
    window.__overworldNpcs = this.overworldNpcs;
  }

  /**
   * Render an ellipse + label for each NPC (depth 6). Clears prior markers first
   * so a re-render never stacks. Colored by the NPC's previewed stake element.
   */
  private renderNpcs(): void {
    this.npcGraphics.forEach((g) => g.destroy());
    this.npcGraphics = [];
    for (const npc of this.overworldNpcs) {
      const color = ELEMENT_COLORS[npc.element] ?? 0x888888;
      const body = this.add
        .ellipse(npc.x, npc.y, 28, 40, color)
        .setDepth(6)
        // #87 Part C — double-click → ambush duel (pays AMBUSH_SPIRIT_COST for the
        // opening attack, server-side). Single click is a no-op; E-key still works.
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.onNpcClick(npc));
      const label = this.add
        .text(npc.x, npc.y - 28, ELEMENT_NAMES[npc.element] ?? '?', {
          fontSize: '10px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(6);
      this.npcGraphics.push(body, label);
    }
  }

  /**
   * #87 Part C — NPC sprite pointerdown. Two clicks on the same NPC within
   * DOUBLE_CLICK_MS launch an ambush duel: record the Swamp duel origin (so
   * BattleScene returns here, mirroring the E-key path) and start EncounterScene
   * with ambush:true, which sets firstStrike on the room join. A single click is a
   * no-op (the existing E-key approach still works).
   */
  private onNpcClick(npc: NpcInfo): void {
    const now = this.time.now;
    const prev = this.npcLastClick.get(npc.id) ?? -Infinity;
    this.npcLastClick.set(npc.id, now);
    if (now - prev > DOUBLE_CLICK_MS) return; // first click of a potential double
    this.npcLastClick.delete(npc.id); // consume the gesture
    window.__duelOrigin = {
      scene: 'SwampScene',
      x: this.player.x,
      y: this.player.y,
    };
    this.scene.start('EncounterScene', {
      npcId: npc.id,
      personality: npc.personality as AIPersonality,
      ambush: true,
    });
  }

  /**
   * #83 — per-frame detection (GDD §10.3). Find the nearest NPC within
   * DETECTION_RADIUS; set this.detectedNpc to it (or null when none is in range).
   * Show/hide a camera-pinned Approach [E] prompt and publish window.__detectedNpc.
   */
  private checkNpcDetection(): void {
    const px = this.player.x;
    const py = this.player.y;
    let nearest: NpcInfo | null = null;
    let bestDist = Infinity;
    for (const npc of this.overworldNpcs) {
      const d = Phaser.Math.Distance.Between(px, py, npc.x, npc.y);
      if (d <= DETECTION_RADIUS && d < bestDist) {
        bestDist = d;
        nearest = npc;
      }
    }

    if (nearest) {
      this.detectedNpc = { id: nearest.id, personality: nearest.personality, x: nearest.x, y: nearest.y };
      const elementName = ELEMENT_NAMES[nearest.element] ?? '?';
      this.showNpcPrompt(`${elementName} duelist — Approach [E]`);
      window.__detectedNpc = { id: nearest.id, personality: nearest.personality };
    } else {
      this.detectedNpc = null;
      this.hideNpcPrompt();
      window.__detectedNpc = null;
    }
  }

  /** Show (or update) the camera-pinned detection prompt. Created lazily. */
  private showNpcPrompt(text: string): void {
    if (!this.npcPrompt) {
      this.npcPrompt = this.add
        .text(this.cameras.main.width / 2, 80, '', {
          fontSize: '14px',
          color: '#ffeeaa',
          backgroundColor: '#000000aa',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(1000);
    }
    this.npcPrompt.setText(text).setVisible(true);
  }

  /** Hide the detection prompt without destroying it (reused next detection). */
  private hideNpcPrompt(): void {
    this.npcPrompt?.setVisible(false);
  }

  /** Store the latest payload and mirror it to window.__waystones for E2E. */
  private cachePayload(payload: WaystonesPayload): void {
    this.waystonePayload = payload;
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
