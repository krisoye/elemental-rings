import Phaser from 'phaser';
import type { AIPersonality } from '../../../shared/types';
import type { ScreenDef } from '../../../shared/world/forest';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Waystone } from '../objects/world/Waystone';
import { Compass } from '../objects/world/Compass';
import { BlinkController } from '../objects/world/BlinkController';
import { BattleHandOverlay } from '../objects/BattleHandOverlay';
import { placeDecoration, type DecorationHandle } from '../objects/world/Decoration';
import {
  COMPASS_RANGE,
  SANCTUM_OFFSET,
  SANCTUM_DOOR_OFFSET,
  SANCTUM_ZONE_HALF,
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

/** px from a map edge at which an edge transition fires (8E.1). */
const EDGE = 8;
/** px inset from the spawn edge at which the player materialises after a transition. */
const SPAWN_INSET = 48;

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

type Dir = 'north' | 'south' | 'east' | 'west';

/**
 * BaseBiomeScene — the shared spatial-biome engine (GDD §10, Phase 8E.1). Extracted
 * verbatim from the original OverworldScene so every biome (Forest, Swamp, …) is a
 * thin subclass that only supplies its tileset/map keys and optional biome-specific
 * hooks. The base owns the full spatial pattern:
 *   - tilemap → collision layer → Player at spawn → camera follow + bounds,
 *   - server-driven waystone/anchorage markers (GET/POST /api/waystones), the
 *     compass HUD, Anchorage auto-attune, and the anchor-derived Sanctum exterior,
 *   - the talisman loadout fetch + Sanctum Stone E dispatcher (#81),
 *   - the overworld NPC roster + detection + E/double-click duel launch (#83/#87),
 *   - the double-click blink controller + Tab battle-hand overlay (#87),
 *   - the new multi-screen edge-transition system (8E.1): walking into a screen
 *     edge with a defined exit fade-transitions to the neighbouring screen.
 *
 * Architecture: purely presentational. Every game rule (attunement record, spirit
 * cost, NPC presence) is enforced by the server; the scene only reflects state and
 * issues the authoritative POSTs. Every `window.__*` E2E hook is preserved.
 *
 * Subclass contract:
 *   - set `this.screenId` (and optionally `this.screenDef`) in `init()` before
 *     create() runs,
 *   - implement `tilesetKey()` + `mapKeyForScreen(id)`,
 *   - implement `preload()` (load the tileset image + this screen's map JSON; call
 *     `loadCommonAssets()` for the shared decoration/structure atlases),
 *   - optionally override `biomeVisuals()` (fog/snow/tint) and `onEnterScreen()`
 *     (per-screen decoration placement) and `detectionRadius()`.
 */
export abstract class BaseBiomeScene extends Phaser.Scene {
  // ── Subclass-supplied identity (set in init() before create()) ─────────────
  /** The current screen id; set by the subclass init() before create() runs. */
  protected screenId!: string;
  /** The current screen's manifest entry; set by the subclass init(), or undefined. */
  protected screenDef?: ScreenDef;

  // ── Spatial engine state (moved verbatim from OverworldScene) ───────────────
  private player!: Player;
  private map!: Phaser.Tilemaps.Tilemap;
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
  /** Camera-pinned compass HUD (8B.2) pulling toward unattuned waystones. */
  private compass!: Compass;
  /** Sanctum exterior placeholder (8B.4.1), drawn at the anchored waystone. */
  private sanctumGfx: Phaser.GameObjects.Graphics | null = null;
  private sanctumLabel: Phaser.GameObjects.Text | null = null;
  /** Anchorage ground treatment (8B.4.3), keyed by waystone id. */
  private anchorageRings: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private anchorageFires: Map<string, { gfx: Phaser.GameObjects.Graphics; x: number; y: number }> =
    new Map();
  /** #81 — equipped necklace talisman + remaining charges, fetched on create. */
  private talismanLoadout: { necklaceId: string | null; necklaceCharges: number } | null = null;
  /** The Anchorage zone (by waystone id) the player currently overlaps, or null. */
  private currentAnchorageId: string | null = null;
  /** #83 — the overworld NPC roster from GET /api/overworld/npcs, fetched on create. */
  private overworldNpcs: NpcInfo[] = [];
  /** NPC marker graphics (ellipse + label), tracked for shutdown removal. */
  private npcGraphics: Phaser.GameObjects.GameObject[] = [];
  /** The NPC currently within detectionRadius() (nearest), or null when none. */
  private detectedNpc: { id: string; personality: string; x: number; y: number } | null = null;
  /** Camera-pinned Approach [E] detection prompt; created lazily, reused/hidden. */
  private npcPrompt: Phaser.GameObjects.Text | null = null;
  /** #88 — true when this create() restored the player from window.__duelOrigin. */
  private returnedFromDuel = false;
  /** #87 Part A — double-click-to-blink controller (onto interaction zones). */
  private blink: BlinkController | null = null;
  /** #87 Part D — Tab-opened battle-hand overlay (standalone in the overworld). */
  private battleHand: BattleHandOverlay | null = null;
  /** #87 Part D — true while the Tab battle-hand overlay is open. */
  private overlayOpen = false;
  /** #87 Part C — last pointerdown time (ms) per NPC id, for double-click ambush. */
  private npcLastClick = new Map<string, number>();
  /** 8D.4 — static physics group holding solid decorations (trees/rocks). */
  private decorationGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  /** 8D.4 — handle to the placed proof decorations, destroyed on shutdown. */
  private decorHandle: DecorationHandle | null = null;
  /** 8E.1 — guards a screen edge transition so it fires once per departure. */
  private isTransitioning = false;

  // ── Subclass contract ───────────────────────────────────────────────────────

  /** Phaser texture key for the ground tileset (e.g. 'forest', 'swamp-tiles'). */
  abstract tilesetKey(): string;
  /** Phaser tilemap cache key for the given screen id. */
  abstract mapKeyForScreen(id: string): string;

  /** Optional biome-specific visuals (fog/snow/tint), called after the tilemap is built. */
  biomeVisuals?(): void;
  /** Optional per-screen decoration placement, called during create(). */
  onEnterScreen?(): void;
  /** NPC detection radius (px). Subclasses may shrink it (e.g. the foggy Swamp). */
  protected detectionRadius(): number {
    return DETECTION_RADIUS;
  }

  /**
   * Whether walking into a screen edge fade-transitions to the neighbour. Defaults
   * to true for the generated per-screen maps; a subclass returns false for a
   * hand-authored hub screen whose tilemap has solid, walled perimeter edges (e.g.
   * the Forest's `forest_anchorage`, which retains overworld.json) so a test-driven
   * out-of-bounds setPosition never triggers a spurious transition.
   */
  protected edgeTransitionsEnabled(): boolean {
    return true;
  }

  /**
   * Load the shared decoration/structure atlases used across biomes. Subclasses
   * call this from their own preload() alongside the biome tileset + map JSON.
   */
  protected loadCommonAssets(): void {
    if (!this.textures.exists('forest-decoration')) {
      this.load.image('forest-decoration', 'assets/sprites/forest-decoration.png');
    }
    if (!this.textures.exists('structures')) {
      this.load.image('structures', 'assets/sprites/structures.png');
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    window.__scene = this;
    window.__activeScene = this.scene.key;
    // The scene instance is reused across re-entries; reset per-create flags.
    this.returnedFromDuel = false;
    this.isTransitioning = false;

    const map = this.make.tilemap({ key: this.mapKeyForScreen(this.screenId) });
    this.map = map;
    const tileset = map.addTilesetImage(this.tilesetKey(), this.tilesetKey())!;
    const groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    groundLayer.setCollisionByProperty({ collides: true });

    const spawn = map.getObjectLayer('objects')?.objects.find((o) => o.name === 'spawn');
    this.player = new Player(this, spawn?.x ?? 64, spawn?.y ?? 64);
    this.physics.add.collider(this.player, groundLayer);

    // #88 — returning from an overworld NPC duel: restore the player to where they
    // left (recorded in window.__duelOrigin before the duel). This scene was shut
    // down on duel entry, so the position is carried out-of-band. When set, suppress
    // the anchor-derived Sanctum-door spawn (loadWaystones) so it doesn't override
    // the restored position. Consume the global immediately so it never re-applies.
    const origin = window.__duelOrigin;
    if (origin && origin.scene === this.scene.key && typeof origin.x === 'number') {
      this.player.setPosition(origin.x, origin.y);
      this.returnedFromDuel = true;
    }
    window.__duelOrigin = null;

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // 8E.1 — edge-transition spawn: when this create() follows an edge transition
    // (init data carries a spawnEdge), drop the player just inside the arrival edge.
    // Done before loadWaystones so the anchor-derived spawn (forest_anchorage) only
    // applies on a fresh CampScene entry, never on a screen-to-screen step.
    const spawnEdge = (this.scene.settings.data as { spawnEdge?: Dir } | undefined)?.spawnEdge;
    if (spawnEdge) {
      this.placeAtSpawnEdge(spawnEdge);
      this.returnedFromDuel = true; // suppress the anchor-derived Sanctum-door spawn
    }

    // 8D.4 — minimal proof placement of decorations over the ground layer. Two
    // sprites in the clearing (walkable floor): one solid (trunk-collision, inset
    // body) and one non-solid (walk-through bush). The collider lets the player bump
    // the solid one. window.__decorationCount lets E2E assert placement.
    this.decorationGroup = this.physics.add.staticGroup();
    const proofSpecs = [
      { atlasKey: 'forest-decoration', x: 200, y: 200, solid: true, bodyInset: 8 },
      { atlasKey: 'forest-decoration', x: 300, y: 200, solid: false },
    ];
    this.decorHandle = placeDecoration(this, this.decorationGroup, proofSpecs);
    this.physics.add.collider(this.player, this.decorationGroup);
    window.__decorationCount = proofSpecs.length;

    // Biome title (pinned to the camera).
    this.add
      .text(16, 16, this.scene.key === 'SwampScene' ? 'SWAMP' : 'FOREST', {
        fontSize: '16px',
        color: '#cfe3ff',
      })
      .setScrollFactor(0)
      .setDepth(500);

    // Compass HUD (8B.2) — hidden until the first update() finds a target.
    this.compass = new Compass(this);
    window.__compass = { visible: false, targetId: null, angle: null, intensity: null };

    // Interaction zones: sanctum_return / biome_exit.
    this.buildZones(map);

    // Input.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.keyboard!.on('keydown-E', () => this.handleInteract());
    window.__sanctumInteract = (): void => this.handleInteract();

    // #87 Part D — Tab toggles the battle-hand overlay; Escape closes it.
    this.battleHand = new BattleHandOverlay(this);
    this.input.keyboard!.on('keydown-TAB', (e: KeyboardEvent) => {
      e?.preventDefault?.();
      this.toggleBattleHand();
    });
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.overlayOpen) this.closeBattleHand();
    });
    window.__overworldBattleHandOpen = false;
    window.__overworldToggleBattleHand = (): void => this.toggleBattleHand();

    // #87 Part A — double-click an interaction zone within range to blink onto it.
    this.blink = new BlinkController(this, this.player, () => this.overlayOpen);
    this.blink.register(this.zones);

    window.__player = this.player;
    this.events.once('shutdown', () => {
      window.__player = null;
      window.__scene = null;
      window.__sanctumInteract = undefined;
      window.__sanctumZones = undefined;
      window.__waystones = undefined;
      window.__compass = undefined;
      window.__sanctumReturnCenter = undefined;
      window.__talismanLoadout = undefined;
      window.__overworldNpcs = undefined;
      window.__detectedNpc = undefined;
      window.__overworldBattleHandOpen = undefined;
      window.__overworldToggleBattleHand = undefined;
      window.__decorationCount = undefined;
      window.__forestScreenId = undefined;
      this.decorHandle?.destroy();
      this.decorHandle = null;
      this.decorationGroup?.destroy(true);
      this.decorationGroup = null;
      this.blink?.destroy();
      this.blink = null;
      this.battleHand?.destroy();
      this.battleHand = null;
      this.overlayOpen = false;
      this.npcLastClick.clear();
      this.npcGraphics.forEach((g) => g.destroy());
      this.npcGraphics = [];
      this.npcPrompt?.destroy();
      this.npcPrompt = null;
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

    // Biome-specific visuals (fog/snow/tint) over the freshly-built tilemap.
    this.biomeVisuals?.();
    // Per-screen decoration placement hook.
    this.onEnterScreen?.();

    // Load waystone state from the authoritative server and render the markers.
    void this.loadWaystones(map);
    // #81 — fetch the talisman loadout so E knows whether the Sanctum Stone is equipped.
    void this.loadTalismanLoadout();
    // #83 — fetch the NPC roster + render the markers.
    void this.loadOverworldNpcs();
  }

  update(): void {
    // #87 Part D — while the Tab battle-hand overlay is open, freeze the player.
    if (this.overlayOpen) {
      this.player.halt();
      return;
    }
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
    this.updateCompass();
    this.checkAnchorageAutoAttune();
    this.updateCurrentAnchorage();
    this.checkNpcDetection();
    // 8E.1 — last: walking into a screen edge with a defined exit transitions.
    this.checkEdgeTransition();
  }

  // ── 8E.1 — multi-screen edge transitions ────────────────────────────────────

  /**
   * Per-frame edge check: if the player has walked within EDGE px of a map edge
   * that has a defined exit in the screen manifest, fade-transition to the
   * neighbouring screen, spawning the player at the opposite edge. A biome_exit is
   * handled separately (its overlap zone fires tryBiomeExit). No-op without a
   * screenDef (the single-screen swamp.json still relies on its biome_exit zone).
   */
  private checkEdgeTransition(): void {
    if (!this.map || !this.screenDef || this.isTransitioning) return;
    if (!this.edgeTransitionsEnabled()) return;
    const px = this.player.x;
    const py = this.player.y;
    const mapW = this.map.widthInPixels;
    const mapH = this.map.heightInPixels;

    const dirs: Array<{ dir: Dir; condition: boolean }> = [
      { dir: 'north', condition: py <= EDGE },
      { dir: 'south', condition: py >= mapH - EDGE },
      { dir: 'west', condition: px <= EDGE },
      { dir: 'east', condition: px >= mapW - EDGE },
    ];

    for (const { dir, condition } of dirs) {
      if (!condition) continue;
      const exit = this.screenDef.exits[dir];
      if (exit) {
        this.edgeFadeTransition(exit, this.oppositeDir(dir));
        return;
      }
      // biomeExit is handled by the overlap zone (tryBiomeExit), not the edge.
    }
  }

  /** Fade out, then restart this scene on the next screen, spawning at spawnEdge. */
  private edgeFadeTransition(nextScreenId: string, spawnEdge: Dir): void {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    this.cameras.main.fade(
      250,
      0,
      0,
      0,
      false,
      (_cam: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1) {
          this.scene.start(this.scene.key, { screenId: nextScreenId, spawnEdge });
        }
      },
    );
  }

  private oppositeDir(dir: Dir): Dir {
    return ({ north: 'south', south: 'north', east: 'west', west: 'east' } as Record<Dir, Dir>)[dir];
  }

  /** Drop the player just inside the named arrival edge (mid-edge, SPAWN_INSET in). */
  private placeAtSpawnEdge(spawnEdge: Dir): void {
    const mapW = this.map.widthInPixels;
    const mapH = this.map.heightInPixels;
    const midX = mapW / 2;
    const midY = mapH / 2;
    const positions: Record<Dir, [number, number]> = {
      north: [midX, SPAWN_INSET],
      south: [midX, mapH - SPAWN_INSET],
      east: [mapW - SPAWN_INSET, midY],
      west: [SPAWN_INSET, midY],
    };
    const [sx, sy] = positions[spawnEdge];
    this.player.setPosition(sx, sy);
  }

  // ── #87 Part D — battle-hand overlay ────────────────────────────────────────

  private toggleBattleHand(): void {
    if (this.overlayOpen) {
      this.closeBattleHand();
    } else {
      this.openBattleHand();
    }
  }

  private openBattleHand(): void {
    if (this.overlayOpen || !this.battleHand) return;
    this.overlayOpen = true;
    window.__overworldBattleHandOpen = true;
    this.player.halt();
    void this.battleHand.open(() => {
      this.overlayOpen = false;
      window.__overworldBattleHandOpen = false;
    });
  }

  private closeBattleHand(): void {
    if (!this.battleHand) return;
    this.battleHand.close();
    this.overlayOpen = false;
    window.__overworldBattleHandOpen = false;
  }

  // ── Anchorage / interact dispatch ───────────────────────────────────────────

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
   * #81 — E / interact dispatcher. A detected NPC takes priority (launches the duel
   * via the EncounterScene NPC path). Otherwise, standing in an Anchorage with the
   * Sanctum Stone equipped + charges activates the Stone; else the default active
   * zone fires (waystone attune / biome exit / sanctum return).
   */
  private handleInteract(): void {
    if (this.detectedNpc) {
      // #88 — record the biome origin + the player's world position so BattleScene
      // returns to this scene when the duel ends, and create() restores the player.
      window.__duelOrigin = {
        scene: this.scene.key as 'ForestScene' | 'SwampScene',
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
   * Per-frame compass pull (8B.2). Finds the nearest eligible UNATTUNED waystone and
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

  // ── Zones ────────────────────────────────────────────────────────────────────

  /**
   * Build InteractionZones for named map rectangles. `sanctum_return` is built
   * dynamically in loadWaystones at the anchored waystone position, so it is
   * skipped here. A `biome_exit` object transitions to an adjacent biome, gated on
   * its attunement waystone where applicable.
   */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name === 'sanctum_return') continue;
      if (o.name === 'biome_exit') {
        const target = this.targetSceneOf(o) ?? 'SwampScene';
        // The attunement gate comes from the map object's `gate` property (the
        // hand-authored hub map) or the screen manifest's biomeExit.gate (the
        // generated screens). An ungated exit (e.g. the Swamp's return) always opens.
        const gate = this.gateOf(o) ?? this.screenDef?.biomeExit?.gate;
        const zone = new InteractionZone(this, o, () => this.tryBiomeExit(target, gate));
        this.physics.add.overlap(this.player, zone.overlapZone);
        this.zones.push(zone);
        continue;
      }
      // (future: handle other named zones here)
    }
  }

  /**
   * Attempt a biome transition through a biome_exit zone. When a gate waystone is
   * given, the transition is barred until that waystone is attuned (the gate reads
   * the cached server payload). An ungated exit (the Swamp's return) always opens;
   * Forest→Swamp is gated on forest_sw_stone.
   */
  private tryBiomeExit(target: string, gate?: string): void {
    if (gate) {
      const stone = this.waystonePayload?.waystones?.find((w) => w.id === gate);
      if (!stone?.attuned) {
        this.showBarrierMessage('You sense a barrier — something blocks the way');
        return;
      }
    }
    this.scene.start(target);
  }

  /** Read the `gate` (attunement waystoneId) custom property off a Tiled object. */
  private gateOf(obj: Phaser.Types.Tilemaps.TiledObject): string | undefined {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'gate');
    return typeof prop?.value === 'string' ? prop.value : undefined;
  }

  /** Show a brief, camera-pinned barrier message that fades out. */
  private showBarrierMessage(text: string): void {
    const existing = this.children.getByName('biome-barrier') as Phaser.GameObjects.Text | null;
    existing?.destroy();
    const msg = this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height - 80, text, {
        fontSize: '14px',
        color: '#ffdddd',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1000)
      .setName('biome-barrier');
    this.tweens.add({
      targets: msg,
      alpha: { from: 1, to: 0 },
      delay: 1200,
      duration: 600,
      onComplete: () => msg.destroy(),
    });
  }

  /** Read the `target` (destination scene key) custom property off a Tiled object. */
  private targetSceneOf(obj: Phaser.Types.Tilemaps.TiledObject): string | null {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'target');
    return typeof prop?.value === 'string' ? prop.value : null;
  }

  // ── Waystones ──────────────────────────────────────────────────────────────

  /**
   * Fetch GET /api/waystones, then instantiate a marker for every `anchorage`
   * (campfire + ground ring) and `waystone` (standing stone) object on the map,
   * colored by its `attuned` flag, wrapped in an InteractionZone. Finally places the
   * anchor-derived Sanctum exterior + spawn (skipped on edge / duel-return entries).
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

    // Anchor-derived spawn (8B.3) + Sanctum exterior (8B.4.1): placed at the anchored
    // waystone toward map center. Done AFTER markers are built so the anchor center
    // exists. Skipped on a re-entry that already restored the player (edge step or
    // post-duel) so it doesn't snap them back to the Sanctum door.
    const anchorCenter = this.anchorageMarkers.get(payload.anchor);
    if (anchorCenter) {
      const mapCx = map.widthInPixels / 2;
      const mapCy = map.heightInPixels / 2;
      const dx = mapCx - anchorCenter.center.x;
      const dy = mapCy - anchorCenter.center.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const dirX = dx / len;
      const dirY = dy / len;
      const sanctumX = anchorCenter.center.x + dirX * SANCTUM_OFFSET;
      const sanctumY = anchorCenter.center.y + dirY * SANCTUM_OFFSET;

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

      this.drawSanctumExterior(sanctumX, sanctumY);

      if (!this.returnedFromDuel) {
        this.player.setPosition(
          sanctumX + dirX * SANCTUM_DOOR_OFFSET,
          sanctumY + dirY * SANCTUM_DOOR_OFFSET,
        );
      }

      window.__sanctumReturnCenter = { x: sanctumX, y: sanctumY };
    }
  }

  /**
   * Draw the Sanctum exterior placeholder (8B.4.1) at the given world center:
   * a foundation slab, roof triangle, dark door opening, and a floating label.
   */
  private drawSanctumExterior(cx: number, cy: number): void {
    const g = this.add.graphics().setDepth(8);
    g.fillStyle(0x2a2a3a);
    g.fillRect(cx - 40, cy - 24, 80, 48);
    g.fillStyle(0x3a3a4a);
    g.fillTriangle(cx - 44, cy - 24, cx + 44, cy - 24, cx, cy - 60);
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
   * Draw an Anchorage campfire (8B.4.3) into the given graphics object: a rock base
   * plus a warm orange flame when `attuned`, or a cold blue flame when not.
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

  /** Re-render the Anchorage ground rings + campfires for the given waystone state. */
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

  /** #81 — GET /api/talisman-loadout and cache it (also published for E2E). */
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
   * /api/talisman/activate. On success the server spends a charge and re-anchors the
   * Sanctum; the cached loadout is refreshed and the scene transitions into the
   * (relocated) Sanctum (CampScene). A 400 is left silent.
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

  // ── NPCs (#83/#87/#88) ──────────────────────────────────────────────────────

  /**
   * #83 / #99 — GET /api/overworld/npcs?biome=<biome>&screen=<screenId>, render each
   * NPC as a colored ellipse (element hue) + a personality label, and publish
   * window.__overworldNpcs for the E2E harness. Best-effort: a network/auth failure
   * leaves the roster empty. The server is the authority on which NPCs are present.
   */
  private async loadOverworldNpcs(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    const biome = this.scene.key === 'SwampScene' ? 'swamp' : 'forest';
    try {
      const res = await fetch(
        `${API_BASE}/api/overworld/npcs?biome=${biome}&screen=${this.screenId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      this.overworldNpcs = (await res.json()) as NpcInfo[];
    } catch {
      return; // leave the roster empty
    }
    this.renderNpcs();
    window.__overworldNpcs = this.overworldNpcs;
  }

  /** Render an ellipse + label for each NPC in the roster (depth 6). */
  private renderNpcs(): void {
    this.npcGraphics.forEach((g) => g.destroy());
    this.npcGraphics = [];
    for (const npc of this.overworldNpcs) {
      const color = ELEMENT_COLORS[npc.element] ?? 0x888888;
      const body = this.add
        .ellipse(npc.x, npc.y, 28, 40, color)
        .setDepth(6)
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
   * DOUBLE_CLICK_MS launch an ambush duel (records the duel origin, starts
   * EncounterScene with ambush:true). Suppressed while the Tab overlay is open. A
   * single click is a no-op (the E-key approach still works).
   */
  private onNpcClick(npc: NpcInfo): void {
    if (this.overlayOpen) return;
    const now = this.time.now;
    const prev = this.npcLastClick.get(npc.id) ?? -Infinity;
    this.npcLastClick.set(npc.id, now);
    if (now - prev > DOUBLE_CLICK_MS) return; // first click of a potential double
    this.npcLastClick.delete(npc.id); // consume the gesture
    window.__duelOrigin = {
      scene: this.scene.key as 'ForestScene' | 'SwampScene',
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
   * detectionRadius(); set this.detectedNpc to it (or null when none in range).
   * Show/hide a camera-pinned Approach [E] prompt and publish window.__detectedNpc.
   */
  private checkNpcDetection(): void {
    const px = this.player.x;
    const py = this.player.y;
    const radius = this.detectionRadius();
    let nearest: NpcInfo | null = null;
    let bestDist = Infinity;
    for (const npc of this.overworldNpcs) {
      const d = Phaser.Math.Distance.Between(px, py, npc.x, npc.y);
      if (d <= radius && d < bestDist) {
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
    // With SANCTUM_OFFSET=0 the sanctum_return door is co-located with its anchor
    // Anchorage zone; the return door is the actionable E target there, so it wins.
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
