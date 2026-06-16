import Phaser from 'phaser';
import type { AIPersonality } from '../../../shared/types';
import type { ScreenDef } from '../../../shared/world/forest';
import { BOSS_WARDENS } from '../../../shared/world/forest';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';
import { Campfire } from '../objects/world/Campfire';
import { CampfireModal } from '../objects/CampfireModal';
import { ForageNode } from '../objects/world/ForageNode';
import { MerchantNpc } from '../objects/world/MerchantNpc';
import { MerchantModal } from '../objects/MerchantModal';
import { Compass } from '../objects/world/Compass';
import { BlinkController } from '../objects/world/BlinkController';
import { BattleHandOverlay } from '../objects/BattleHandOverlay';
import { OverworldMapModal } from '../objects/OverworldMapModal';
import { placeDecoration, type DecorationHandle } from '../objects/world/Decoration';
import { MONSTER_OW_REGISTRY } from '../objects/world/NpcSpriteRegistry';
import { WanderingNpc } from '../objects/world/WanderingNpc';
import { RingManagementOverlay, type RingManagementOverlayOpts } from '../objects/ui/RingManagementOverlayClass';
import type { OverlayData } from '../objects/ui/RingManagementOverlayClass';
import type { RingData } from '../objects/InventoryGrid';
import { DiscardConfirm } from '../objects/ui/DiscardConfirm';
import type { ShrineZone } from '../objects/world/ShrineZone';
import { showTransientText } from '../objects/ui/toast';
import { addDomLabel, setDomLabelText } from '../objects/ui/DomLabel';
import { apiFetch, fetchMe, getToken } from '../net/api';
import { DualCameraScene } from './DualCameraScene';
import { withinRadius, nearest } from '../util/geometry';
import {
  COMPASS_RANGE,
  SANCTUM_Y_ABOVE,
  SANCTUM_SPAWN_Y_BELOW,
  SANCTUM_SPRITE_HALF_H,
  SANCTUM_ZONE_HALF,
  ANCHORAGE_GROUND_RADIUS,
  DETECTION_RADIUS,
  DOUBLE_CLICK_MS,
  ELEMENT_NAMES,
  CANVAS_W,
  CANVAS_H,
} from '../Constants';

/** One entry of the GET /api/overworld/npcs payload (server is the authority). */
interface NpcInfo {
  id: string;
  personality: string;
  type: 'monster' | 'duelist';
  element: number;
  /** Server-side sprite seed (0–4 = monster element; 5–11 = "7 human variants").
   *  The client maps duelist values onto a charset character; monsters use the
   *  per-element overworld registry. The legacy npc-overworld strip is no longer used. */
  spriteFrame: number;
  x: number;
  y: number;
  /** Stable loadout seed (= hashNpcId) so the battle-ai room reproduces the
   * same staked element shown on the overworld marker (#111). */
  aiSeed?: number;
  /** For monsters: canonical battle texture key matching the overworld sprite.
   *  When present, BattleScene uses it instead of a random variant (#158). */
  battleKey?: string;
  /** Pre-computed thumb (stake) XP the player would win — shown in the approach prompt. */
  stakeXp?: number;
  /** Pre-computed NPC spirit pool the player would face — shown in the approach prompt. */
  npcSpirit?: number;
  /** Boss display name (e.g. "Bogwood Warden") — present only for boss NPCs. */
  displayName?: string;
  /** Boss tier — present only for boss NPCs. */
  bossTier?: 'major' | 'gate' | 'sub';
}

/**
 * px from a map edge at which an edge transition fires (8E.1).
 * At 16px tiles this equals 1.5 tiles — enough to trigger reliably without the
 * player appearing to leave the perimeter road. Player body half-width is 10px;
 * 8px would be unreachable with world bounds, so EDGE must be > 10px.
 * Both 32px (0.75 tiles) and 16px (1.5 tiles) maps work correctly at this value
 * because the threshold is evaluated in world-space px, not tile units.
 */
const EDGE = 24;
/**
 * px inset from the spawn edge at which the player materialises after a transition.
 * At 16px tiles this equals 3 tiles — enough to clear the wall/border tiles at the
 * arriving edge before physics resolves the first frame. Works for both tile sizes
 * because it is a px measurement in world space.
 */
const SPAWN_INSET = 48;

/** One entry of the GET /api/waystones payload (server is the authority). */
interface WaystoneInfo {
  id: string;
  name: string;
  xpThreshold: number;
  spiritCost?: number;
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
export abstract class BaseBiomeScene extends DualCameraScene {
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
  /** #396 — the unified fusion overlay for the Fusion Shrine (lazy, per-open). */
  private shrineFusionOverlay: RingManagementOverlay | null = null;
  /** #431 — the unified merge overlay for shrine merge mode (lazy, per-open). */
  private shrineMergeOverlay: RingManagementOverlay | null = null;
  /** #431 — id of the shrine whose merge overlay is currently open (or null). */
  protected activeMergeShrineId: string | null = null;
  /**
   * #431 — the ShrineZone backing {@link activeMergeShrineId}, so the M-key
   * handler can gate on its live sealed/open state (isUnlocked) before opening
   * the merge overlay. Set by the concrete scene alongside activeMergeShrineId.
   */
  protected activeMergeShrineZone: ShrineZone | null = null;
  /** #423 — shared discard-confirm dialog for the shrine-fusion DISCARD slot. */
  private fusionDiscard_: DiscardConfirm | null = null;
  /** Centers of Anchorage locations (keyed by waystoneId), for compass + spawn logic. */
  private anchorageMarkers: Map<string, { center: { x: number; y: number } }> = new Map();
  /** Campfire graphics markers keyed by anchorage id (#191). */
  private campfires: Map<string, Campfire> = new Map();
  /** Open campfire modal singleton (#191); null when closed. */
  private campfireModal: CampfireModal | null = null;
  /** World-map overlay (M key); null when not open. */
  private overworldMap: OverworldMapModal | null = null;
  /** Anchorage ids already auto-attuned (or attuned on load) — fire onAttune once. */
  private anchorageAutoAttuned: Set<string> = new Set();
  /** Latest GET /api/waystones payload (mirrored to window.__waystones). */
  private waystonePayload: WaystonesPayload | null = null;
  /**
   * True while waiting for loadWaystones to reposition the player after entering
   * from CampScene. Suppresses checkEdgeTransition so a spawn point placed near
   * a map edge (e.g. forest_glade x=24 == EDGE) cannot push the player into an
   * adjacent screen before the sanctum door spawn overrides the position.
   */
  private suppressEdgeTransitions = false;
  /** Camera-pinned compass HUD (8B.2) pulling toward unattuned waystones. */
  private compass!: Compass;
  /** Sanctum exterior sprite, placed at the anchored anchorage. */
  private sanctumSprite: Phaser.GameObjects.Image | null = null;
  /** Sanctum return interaction zone — tracked separately so refreshSanctumZone can replace it. */
  private sanctumReturnZone: InteractionZone | null = null;
  /** #81 — equipped necklace talisman + remaining charges, fetched on create. */
  private talismanLoadout: { necklaceId: string | null; necklaceCharges: number } | null = null;
  /** The Anchorage zone (by waystone id) the player currently overlaps, or null. */
  private currentAnchorageId: string | null = null;
  /** #83 — the overworld NPC roster from GET /api/overworld/npcs, fetched on create. */
  private overworldNpcs: NpcInfo[] = [];
  /** Wandering NPC marker controllers (one per roster entry), tracked for
   *  re-render + shutdown teardown. Each owns its sprite, tweens, and pause timer. */
  private npcMarkers: WanderingNpc[] = [];
  /** The NPC currently within detectionRadius() (nearest), or null when none. */
  private detectedNpc: {
    id: string;
    personality: string;
    type: 'monster' | 'duelist';
    x: number;
    y: number;
    aiSeed?: number;
    spriteFrame: number;
    /** #199 — the NPC's staked element, threaded into the duel so the battle
     *  thumb matches the overworld sprite colour + approach warning. */
    element: number;
    /** Pre-computed thumb XP shown in the approach prompt so the player can decide. */
    stakeXp?: number;
  } | null = null;
  /** Camera-pinned Approach [E] detection prompt; created lazily, reused/hidden. */
  private npcPrompt: Phaser.GameObjects.DOMElement | null = null;
  /** #112 — camera-pinned persistent HUD (Day · Gold · Food · Spirit · XP). */
  private hudText: Phaser.GameObjects.DOMElement | null = null;
  /** #355 — two-row location label (biome / area). DOM-rendered for crispness (#362). */
  private biomeTitle: Phaser.GameObjects.DOMElement | null = null;
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
  /** #128 — forage node objects on this screen (keyed by node_id). */
  private forageNodes: Map<string, ForageNode> = new Map();
  /** #131 — merchant NPC objects on this screen. */
  private merchantNpcs: MerchantNpc[] = [];
  /** #131 — shop modal (singleton per scene; opens on merchant E press). */
  private merchantModal: MerchantModal | null = null;
  // #137 — the dual-camera split (uiCam + uiRoot) is provided by DualCameraScene.
  // cameras.main ignores `uiRoot` (the persistent HUD: resource HUD, compass) once
  // so the world can zoom (2× on forest_anchorage) while the HUD stays 1:1. Modal
  // overlays (BattleHand, MerchantModal, barrier/toast) stay at the scene root and
  // are routed to uiCam per-container via routeToUi() so single-level E2E flatMap
  // traversal still reaches their children. Same pattern as #118 (CampScene).

  // ── Subclass contract ───────────────────────────────────────────────────────

  /** Phaser texture key for the ground tileset (e.g. 'forest', 'swamp-tiles'). */
  abstract tilesetKey(): string;
  /** Phaser tilemap cache key for the given screen id. */
  abstract mapKeyForScreen(id: string): string;

  /**
   * Register the tileset(s) this screen's map uses and return them for createLayer.
   * Default: a single tileset keyed by `tilesetKey()` — covers every generated
   * screen and the Swamp, where Phaser resolves the lone tileset at firstgid 1
   * regardless of the map's tileset name. A subclass overrides this for maps that
   * compose several tilesets (each must be preloaded under a texture key equal to
   * its name in the map). See ForestScene for the multi-tileset Forest hub.
   */
  protected buildTilesets(map: Phaser.Tilemaps.Tilemap): Phaser.Tilemaps.Tileset[] {
    return [map.addTilesetImage(this.tilesetKey(), this.tilesetKey())!];
  }

  /**
   * Names of the tile layers to render, in draw order (first = ground). Default is
   * the single 'ground' layer every generated screen + Swamp ships. A subclass
   * overrides this for maps with extra layers (e.g. the Forest hub's 'above-ground'
   * structures). Layers named here that are absent from the map are skipped.
   */
  protected tileLayerNames(): string[] {
    return ['ground'];
  }

  /**
   * Collision mode per layer name. `'property'` (default) enables collision only on
   * tiles whose Tiled `collides` property is true. `'non-empty'` makes every
   * non-empty tile collideable — right for structure/canopy layers whose tileset
   * tiles have no per-tile collision properties (e.g. the Forest hub's above-ground).
   */
  protected tileLayerCollisionMode(_layerName: string): 'property' | 'non-empty' {
    return 'property';
  }

  /**
   * Render depth per layer name. Default 0 (ground-level). Layers that should
   * appear above the player (e.g. building roofs, tree canopies) should return a
   * value higher than the player's depth (5). NPC sprites sit at depth 6 so they
   * are not occluded by canopy layers at depth 5.
   */
  protected tileLayerDepth(_layerName: string): number {
    return 0;
  }

  /** Optional biome-specific visuals (fog/snow/tint), called after the tilemap is built. */
  biomeVisuals?(): void;
  /** Optional per-screen decoration placement, called during create(). */
  onEnterScreen?(): void;
  /** Accessor for the player sprite (for use in onEnterScreen overrides). */
  protected getPlayer(): Player { return this.player; }

  /**
   * #231 — Register an externally-built {@link InteractionZone} with the full
   * spatial wiring a `buildZones`-internal zone gets: a player↔zone overlap, entry
   * in the per-frame active-zone selection list (so E dispatches to it), the
   * double-click blink controller, and uiCam ignore for its display objects (plus
   * any extra world sprites the caller owns, e.g. a Shrine altar). For use by
   * `onEnterScreen()` overrides that add screen-specific zones (the Fusion Shrine).
   */
  protected registerInteractionZone(
    zone: InteractionZone,
    extraWorldObjects: Phaser.GameObjects.GameObject[] = [],
  ): void {
    this.physics.add.overlap(this.player, zone.overlapZone);
    this.zones.push(zone);
    this.blink?.register([zone]);
    this.ignoreWorldObjects([...zone.displayObjects, ...extraWorldObjects]);
  }

  /**
   * #396 — Open the unified fusion overlay (RingManagementOverlay in fusion mode)
   * pre-filtered to a single fusion element. Fetches the player's current /api/me
   * snapshot, then opens the overlay with `filterElement` restricting the FUSE column
   * to the recipe whose result matches. The server (POST /api/fusion/combine) remains
   * the sole authority on what fuses.
   */
  protected async openShrineFusion(filterElement: number): Promise<void> {
    // Close any existing overlay first.
    this.shrineFusionOverlay?.close();

    const meData = await this.fetchMeAsOverlayData();

    const overlayOpts: RingManagementOverlayOpts = {
      resolveMove: async () => { /* shrine fusion overlay does not use swap moves */ return true; },
      onRecharge: () => { /* no recharge action in shrine context */ },
      filterElement,
      onFuse: async (ringId1, ringId2, ov) => {
        const err = await this.doShrineFuse(ringId1, ringId2, filterElement, ov);
        if (err) ov.setStatusMessage(err);
      },
      // #423 — DISCARD slot in BHC is now available in fusion mode too.
      onDiscardSlotClick: (ov) => {
        const sel = ov.selection;
        if (!sel) return;
        // Look up the ring from the /api/me snapshot this overlay was opened with —
        // never window.__campState, which is CampScene-owned and stale in biome scenes.
        const ring: RingData | null =
          meData.rings.find((r: RingData) => r.id === sel.ringId) ?? null;
        // Single stored instance, routed to the UI camera like every other modal.
        if (!this.fusionDiscard_) {
          this.fusionDiscard_ = new DiscardConfirm(this, (c) => this.routeToUi(c));
        }
        this.fusionDiscard_.open(ring, sel.ringId,
          async () => {
            try {
              await apiFetch(`/api/rings/${sel.ringId}`, { method: 'DELETE' });
            } catch { /* surface nothing — the reopened overlay shows fresh state */ }
            ov.clearSelection();
            void this.openShrineFusion(filterElement);
          },
          () => { ov.clearSelection(); },
        );
      },
      onRender: (c) => {
        this.routeToUi(c);
      },
      onBeforeDestroy: (c) => {
        this.unignoreMain(c);
        // #423 — never leave an orphaned discard confirm (container + Y/N key
        // listeners) behind when the fusion overlay closes.
        this.fusionDiscard_?.dismiss();
        this.fusionDiscard_ = null;
      },
    };

    this.shrineFusionOverlay = new RingManagementOverlay(this, 'fusion', overlayOpts);
    this.shrineFusionOverlay.open(meData, () => {
      this.shrineFusionOverlay = null;
    });
  }

  /**
   * POST /api/fusion/combine for the shrine overlay; on success reopens with
   * the refreshed inventory (#231 / #396).
   */
  private async doShrineFuse(
    ringId1: string,
    ringId2: string,
    filterElement: number,
    _ov: RingManagementOverlay,
  ): Promise<string | null> {
    if (!getToken()) return 'Not authenticated';
    try {
      const res = await apiFetch('/api/fusion/combine', {
        method: 'POST',
        json: { ringId1, ringId2 },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return (body as { error?: string }).error ?? `Fusion failed (${res.status})`;
      }
      // Success: reopen the overlay with the refreshed inventory.
      void this.openShrineFusion(filterElement);
      return null;
    } catch {
      return 'Fusion failed (network error)';
    }
  }

  /**
   * #431 — Open the unified merge overlay (RingManagementOverlay in merge mode)
   * at an unsealed shrine. Fetches the player's current /api/me snapshot, then
   * opens the overlay with `onMerge` dispatching POST /api/rings/merge. The
   * server remains the sole authority on what merges. No `filterElement` — merge
   * is element-agnostic (any same-element pair is eligible).
   */
  protected async openShrineMerge(shrineId: string): Promise<void> {
    // Close any existing merge overlay first.
    this.shrineMergeOverlay?.close();

    const meData = await this.fetchMeAsOverlayData();

    const overlayOpts: RingManagementOverlayOpts = {
      resolveMove: async () => { /* shrine merge overlay does not use swap moves */ return true; },
      onRecharge: () => { /* no recharge action in shrine context */ },
      onMerge: async (ringId1, ringId2, ov) => {
        const err = await this.doShrineMerge(ringId1, ringId2, shrineId, ov);
        if (err) ov.setStatusMessage(err);
      },
      onRender: (c) => {
        this.routeToUi(c);
      },
      onBeforeDestroy: (c) => {
        this.unignoreMain(c);
      },
    };

    this.shrineMergeOverlay = new RingManagementOverlay(this, 'merge', overlayOpts);
    this.shrineMergeOverlay.open(meData, () => {
      this.shrineMergeOverlay = null;
    });
  }

  /**
   * POST /api/rings/merge for the shrine overlay; on success reopens with the
   * refreshed inventory (#431).
   */
  private async doShrineMerge(
    ringId1: string,
    ringId2: string,
    shrineId: string,
    ov: RingManagementOverlay,
  ): Promise<string | null> {
    if (!getToken()) return 'Not authenticated';
    try {
      const res = await apiFetch('/api/rings/merge', {
        method: 'POST',
        json: { ringId1, ringId2, shrineId },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return (body as { error?: string }).error ?? `Merge failed (${res.status})`;
      }
      // Success: clear selections and reopen with the refreshed inventory.
      ov.clearMergeParents();
      void this.openShrineMerge(shrineId);
      return null;
    } catch {
      return 'Merge failed (network error)';
    }
  }

  /** Fetch the full /api/me payload and return it as `OverlayData`. */
  private async fetchMeAsOverlayData(): Promise<OverlayData> {
    if (!getToken()) return { player: null, rings: [], loadout: {} };
    try {
      const body = await fetchMe<{ player: any; rings: RingData[]; loadout: Record<string, string | null> }>();
      return {
        player: body.player
          ? {
              spare_ring_max: body.player.spare_ring_max,
              pending_ring_id: body.player.pending_ring_id ?? null,
              heart_ring: body.player.heart_ring ?? null,
            }
          : null,
        rings: body.rings ?? [],
        loadout: body.loadout ?? {},
      };
    } catch {
      return { player: null, rings: [], loadout: {} };
    }
  }
  /** NPC detection radius (px). Subclasses may shrink it (e.g. the foggy Swamp). */
  protected detectionRadius(): number {
    return DETECTION_RADIUS;
  }

  /**
   * Whether this screen uses 16px tiles rendered at 2× world zoom (the rich path).
   * Default returns false (32px / 1× for all generated screens and the Swamp).
   * A subclass overrides this to return true for screens flagged as 16px in the
   * manifest, so every rendering branch (tilesets, layers, zoom, Sanctum) consults
   * a single predicate rather than re-checking the id literal.
   */
  protected is16pxScreen(): boolean {
    return false;
  }

  /**
   * World-camera zoom factor for this screen. Returns 2 when is16pxScreen() is
   * true (16px tiles need 2× to fill the same apparent space as 32px at 1×),
   * otherwise 1. Applied in create() on cameras.main; the uiCam always stays 1:1.
   */
  protected worldZoom(): number {
    return this.is16pxScreen() ? 2 : 1;
  }

  /**
   * Whether walking into a screen edge fade-transitions to the neighbour. Defaults
   * to true for the generated per-screen maps (all carry open perimeter gaps at
   * their exits); a subclass may return false for a single-screen biome whose
   * tilemap has solid, walled perimeter edges so a test-driven out-of-bounds
   * setPosition never triggers a spurious transition.
   */
  protected edgeTransitionsEnabled(): boolean {
    return true;
  }

  /**
   * Load the shared decoration/structure atlases used across biomes. Subclasses
   * call this from their own preload() alongside the biome tileset + map JSON.
   */
  protected loadCommonAssets(): void {
    Player.preload(this);
    if (!this.textures.exists('forest-decoration')) {
      this.load.spritesheet('forest-decoration', 'assets/sprites/sprite_forest_decor.png', {
        frameWidth: 32,
        frameHeight: 32,
      });
    }
    if (!this.textures.exists('structures')) {
      this.load.image('structures', 'assets/structures/structure_misc.png');
    }
    if (!this.textures.exists('sanctum-exterior')) {
      this.load.image('sanctum-exterior', 'assets/structures/structure_sanctum_exterior.png');
    }
    // Duelists draw from the shared RPG-Maker charset (loaded via Player.preload
    // above); the legacy `sprite_npc_overworld.png` strip (24×32 head-tops) was
    // unusable and is no longer loaded or referenced.
    // Per-element monster overworld sprites (#158) — each sheet is an RPG Maker-style
    // walk cycle with per-monster frame dimensions stored in MONSTER_OW_REGISTRY.
    for (const entry of Object.values(MONSTER_OW_REGISTRY)) {
      if (!this.textures.exists(entry.key)) {
        this.load.spritesheet(entry.key, entry.path, { frameWidth: entry.frameWidth, frameHeight: entry.frameHeight });
      }
    }
    // #195 — forage-node plants are tilemap tiles (behind/in-front layers via the
    // `berry_and_trees` Tiled tileset), not a standalone sprite. ForageNode toggles
    // those tiles, so no `berry-nodes` spritesheet load is needed here anymore.
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    window.__scene = this;
    window.__activeScene = this.scene.key;
    // The scene instance is reused across re-entries; reset per-create flags.
    this.returnedFromDuel = false;
    this.isTransitioning = false;
    // Suppress edge transitions when entering from CampScene so the default
    // spawn position (which may be at the edge band) cannot fire a screen
    // transition before loadWaystones repositions the player at the sanctum door.
    {
      const sd = this.scene.settings.data as { fromSanctum?: boolean } | undefined;
      this.suppressEdgeTransitions = sd?.fromSanctum === true;
    }

    const map = this.make.tilemap({ key: this.mapKeyForScreen(this.screenId) });
    this.map = map;
    // Register the screen's tileset(s) and render its tile layer(s). The defaults
    // (single tileset, single 'ground' layer) cover every generated screen + Swamp;
    // a subclass overrides buildTilesets()/tileLayerNames() for richer maps (e.g.
    // the Forest hub's multi-tileset ground + above-ground composition).
    const tilesets = this.buildTilesets(map);
    const tileLayers: Array<Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer> = [];
    for (const name of this.tileLayerNames()) {
      const layer = map.createLayer(name, tilesets, 0, 0);
      if (!layer) continue;
      if (this.tileLayerCollisionMode(name) === 'non-empty') {
        layer.setCollisionByExclusion([-1]); // every non-empty tile blocks movement
      } else {
        layer.setCollisionByProperty({ collides: true });
      }
      layer.setDepth(this.tileLayerDepth(name));
      tileLayers.push(layer);
    }

    const spawn = map.getObjectLayer('objects')?.objects.find((o) => o.name === 'spawn');
    this.player = new Player(this, spawn?.x ?? 64, spawn?.y ?? 64);
    this.player.setDepth(3); // above ground tiles (depth 0), below above-ground canopy (depth 5)
    tileLayers.forEach((layer) => this.physics.add.collider(this.player, layer));

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

    // ── Dual-camera split (#137) + world zoom (#150) ──────────────────────
    // worldZoom() returns 2 for 16px screens (is16pxScreen() = true), else 1; the
    // uiCam always stays at 1:1 so the HUD/overlays are unaffected by the zoom. The
    // uiCam/uiRoot setup is hoisted into DualCameraScene.initDualCamera(): it
    // builds uiRoot (the persistent HUD + compass) ignored by cameras.main once,
    // and adds uiCam AFTER main so it draws on top. Modal overlays (BattleHand,
    // MerchantModal, toasts) stay at the scene root and are routed per-container so
    // single-level E2E flatMap traversal still reaches them.
    this.cameras.main.setZoom(this.worldZoom());
    this.initDualCamera();
    // uiCam ignores world objects; the synchronous ones are collected after
    // buildZones() below, and the async ones (waystones, NPCs) are routed as they
    // are created (loadWaystones / renderNpcs call ignoreWorldObjects).

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
    // Decoration group for screen-specific solid props (trees, rocks, etc.).
    // Populated by onEnterScreen() overrides in subclasses; empty by default so
    // screens that don't override it incur no physics cost.
    this.decorationGroup = this.physics.add.staticGroup();
    this.decorHandle = placeDecoration(this, this.decorationGroup, []);
    this.physics.add.collider(this.player, this.decorationGroup);
    window.__decorationCount = 0;

    // Biome title (pinned to the camera). #362 — DOM element layered over the
    // canvas (no longer in uiRoot): DOM composites at 1:1 physical resolution.
    const biomeName = this.scene.key === 'SwampScene' ? 'Swamp' : this.scene.key === 'SnowScene' ? 'Snow' : 'Forest';
    const areaName = this.screenDef?.name;
    // #362 — DOM-rendered for crisp HiDPI text. Top-left anchored (origin 0,0),
    // two rows via '\n' + white-space:pre + lineHeight; preserves the #355 format
    // (biome on line 1, area on line 2) and the prior color/background/padding.
    this.biomeTitle = addDomLabel(
      this,
      16,
      16,
      areaName ? `${biomeName}\n${areaName}` : biomeName,
      {
        fontPx: 14,
        color: '#ddeeff',
        align: 'left',
        lineHeight: 19,
        background: '#00000099',
        padding: '5px 8px',
        id: 'biome-title',
      },
    ).setOrigin(0, 0);

    // #112 — persistent resource HUD pinned to the top-right corner. Sits below
    // the compass (depth 500) and above the world; right-aligned 12px from the
    // edge. Populated immediately and refreshed on every relevant server event.
    // #362 — DOM-rendered for crisp HiDPI text. Top-right anchored (origin 1,0),
    // right-aligned 12px from the edge; preserves prior color/background/padding.
    this.hudText = addDomLabel(this, this.scale.width - 12, 10, '', {
      fontPx: 13,
      color: '#e8e0d0',
      align: 'right',
      background: '#00000088',
      padding: '4px 8px',
      id: 'overworld-hud',
    }).setOrigin(1, 0);
    void this.refreshHud();

    // Compass HUD (8B.2) — hidden until the first update() finds a target.
    // #137 — re-parent its container into uiRoot so it renders at 1:1 through uiCam.
    this.compass = new Compass(this);
    this.uiRoot.add(this.compass.getContainer());
    window.__compass = { visible: false, targetId: null, angle: null, intensity: null };

    // Interaction zones: sanctum_return / biome_exit / forage_node / merchant.
    this.buildZones(map);

    // ── Route the synchronous world objects to uiCam.ignore (#137) ─────────
    // After buildZones, every zone built so far (biome_exit, forage_node, merchant)
    // is in this.zones, and the ForageNode/MerchantNpc sprites are placed. Collect
    // the ground layer, player, decorations, and all zone/forage/merchant display
    // objects so they render only through the world (main) camera. Waystones and
    // NPCs load async and are routed as they are created (loadWaystones/renderNpcs).
    {
      const worldObjects: Phaser.GameObjects.GameObject[] = [...tileLayers, this.player];
      this.zones.forEach((z) => worldObjects.push(...z.displayObjects));
      this.forageNodes.forEach((n) => worldObjects.push(...n.displayObjects));
      this.merchantNpcs.forEach((m) => worldObjects.push(...m.displayObjects));
      // All decoration sprites (solid AND non-solid) must be ignored by uiCam.
      // Collecting only decorationGroup.getChildren() misses non-solid sprites:
      // they live in the scene but not in the physics group, and a sprite not
      // ignored by uiCam gets double-rendered — world cam in world-space AND
      // uiCam at a fixed screen position on top of all world content.
      if (this.decorHandle) worldObjects.push(...this.decorHandle.sprites);
      this.ignoreWorldObjects(worldObjects);
    }

    // Input.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.keyboard!.on('keydown-E', () => this.handleInteract());
    window.__sanctumInteract = (): void => this.handleInteract();

    // #87 Part D — Tab toggles the battle-hand overlay; Escape closes it.
    // #137 — the overlay's modal container is built lazily on open; route it to the
    // 1:1 UI camera (cameras.main.ignore) each time it renders so it never zooms.
    this.battleHand = new BattleHandOverlay(
      this,
      undefined,
      (container) => this.routeToUi(container),
      // #460 — field-modal recharge spends spirit server-side; repaint the
      // overworld resource HUD so it doesn't show a stale spirit value.
      () => void this.refreshHud(),
    );
    this.input.keyboard!.on('keydown-TAB', (e: KeyboardEvent) => {
      e?.preventDefault?.();
      this.toggleBattleHand();
    });
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.merchantModal?.isOpen()) {
        this.merchantModal.close();
      } else if (this.campfireModal?.isOpen()) {
        this.campfireModal.close();
      } else if (this.overworldMap?.isOpen()) {
        this.overworldMap.hide();
        this.overworldMap = null;
      } else if (this.overlayOpen) {
        this.closeBattleHand();
      }
    });
    // #431 — M dispatches to shrine merge when a merge shrine is active; falls
    // back to the overworld map in all other contexts. A sealed shrine blocks
    // the merge (the shrine must be unsealed first — same gate the server
    // enforces on POST /api/rings/merge).
    this.input.keyboard!.on('keydown-M', () => {
      if (this.activeMergeShrineId) {
        if (this.activeMergeShrineZone && !this.activeMergeShrineZone.isUnlocked()) {
          this.showToast('The shrine is sealed.', '#ff8888');
          return;
        }
        void this.openShrineMerge(this.activeMergeShrineId);
      } else {
        this.toggleOverworldMap();
      }
    });
    window.__overworldBattleHandOpen = false;
    window.__overworldToggleBattleHand = (): void => this.toggleBattleHand();

    // #87 Part A — double-click an interaction zone within range to blink onto it.
    // #112 — refresh the HUD after a blink so the spirit readout reflects the spend.
    this.blink = new BlinkController(this, this.player, () => this.overlayOpen, () =>
      void this.refreshHud(),
    );
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
      window.__zoneCenters = undefined;
      window.__campfireModal = null;
      window.__campfireRest = undefined;
      window.__campfireSummon = undefined;
      this.decorHandle?.destroy();
      this.decorHandle = null;
      this.decorationGroup?.destroy(true);
      this.decorationGroup = null;
      this.blink?.destroy();
      this.blink = null;
      this.battleHand?.destroy();
      this.battleHand = null;
      this.overworldMap?.hide();
      this.overworldMap = null;
      this.overlayOpen = false;
      this.npcLastClick.clear();
      this.npcMarkers.forEach((m) => m.destroy());
      this.npcMarkers = [];
      this.npcPrompt?.destroy();
      this.npcPrompt = null;
      this.hudText?.destroy();
      this.hudText = null;
      // #362 — biomeTitle is now a DOM element (not parented into uiRoot), so it
      // must be destroyed explicitly to avoid a stale node lingering after shutdown.
      this.biomeTitle?.destroy();
      this.biomeTitle = null;
      this.zones.forEach((z) => z.destroy());
      this.forageNodes.forEach((n) => n.destroy());
      this.forageNodes.clear();
      window.__forageNodeForaged = undefined;
      this.merchantNpcs.forEach((m) => m.destroy());
      this.merchantNpcs = [];
      this.merchantModal?.close();
      this.merchantModal = null;
      this.campfireModal?.close();
      this.campfireModal = null;
      this.shrineMergeOverlay?.close();
      this.shrineMergeOverlay = null;
      this.activeMergeShrineId = null;
      this.activeMergeShrineZone = null;
      this.campfires.forEach((cf) => cf.destroy());
      this.campfires.clear();
      this.compass.destroy();
      this.sanctumSprite?.destroy();
      this.sanctumSprite = null;
      this.sanctumReturnZone = null; // destroyed as part of this.zones above
      this.zones = [];
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
    // #128 — set initial forage node visual states from the server status endpoint.
    void this.loadForageNodeStatus();

    // After returning from a battle, automatically open the battle-hand manager
    // so the player can reassign slots before moving on (GDD §6.8).
    const sceneData = this.scene.settings.data as
      { openBattleHand?: boolean; hint?: string } | undefined;
    if (sceneData?.openBattleHand) {
      this.openBattleHand();
    }

    // EPIC #319 (A2) — when EncounterScene catches a server rejection (e.g.
    // ServerError 4000/4001) it routes back here via scene.start with a `hint`
    // string. Flash it briefly so the player understands why the duel was blocked.
    if (sceneData?.hint) {
      const hintText = sceneData.hint;
      this.time.delayedCall(200, () => {
        this.showNpcPrompt(hintText);
        this.time.delayedCall(2500, () => this.hideNpcPrompt());
      });
    }
  }

  update(): void {
    // #87 Part D — while the Tab battle-hand overlay is open, freeze the player.
    // #438 — also freeze while the world-map modal is open (arrow keys must pan
    // the map, not walk the player; the map does not set overlayOpen so we check
    // isOpen() directly).
    if (this.overlayOpen || this.overworldMap?.isOpen()) {
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
    if (this.suppressEdgeTransitions) return;
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

  /** Toggle the M-key world-map overlay. Blocked while any other overlay is open. */
  private toggleOverworldMap(): void {
    if (this.overworldMap?.isOpen()) {
      this.overworldMap.hide();
      this.overworldMap = null;
      return;
    }
    if (this.overlayOpen) return; // battle hand, merchant, etc. takes priority
    const attuned = new Set(
      (this.waystonePayload?.waystones ?? [])
        .filter((w) => w.attuned)
        .map((w) => w.id),
    );
    this.overworldMap = new OverworldMapModal(this, () => {
      this.overworldMap = null;
    });
    this.overworldMap.show(this.screenId, attuned, (c) => this.routeToUi(c));
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
      if (withinRadius({ x: px, y: py }, anchorage.center, ANCHORAGE_GROUND_RADIUS)) {
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
      // #88 — record the biome origin + screen + the player's world position so
      // BattleScene returns to the correct screen when the duel ends, and create()
      // restores the player near the NPC.
      window.__duelOrigin = {
        scene: this.scene.key as 'ForestScene' | 'SwampScene' | 'SnowScene',
        x: this.player.x,
        y: this.player.y,
        screenId: this.screenId,
      };
      // #313 — mirror onNpcClick(): resolve the canonical per-element registry
      // entry so the duel battler matches the overworld marker. Without this,
      // BattleScene.create() rolls a random per-element variant on the E-key path.
      const detectedOwEntry =
        this.detectedNpc.type === 'monster'
          ? MONSTER_OW_REGISTRY[this.detectedNpc.element]
          : undefined;
      this.scene.start('EncounterScene', {
        npcId: this.detectedNpc.id,
        personality: this.detectedNpc.personality as AIPersonality,
        aiSeed: this.detectedNpc.aiSeed,
        spriteFrame: this.detectedNpc.spriteFrame,
        battleKey: detectedOwEntry?.battleKey,
        // #199 — thread the NPC's staked element so the battle thumb matches the
        // overworld sprite colour + approach warning.
        thumbElement: this.detectedNpc.element,
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
      if (withinRadius({ x: px, y: py }, anchorage.center, ANCHORAGE_GROUND_RADIUS)) {
        this.anchorageAutoAttuned.add(id); // prevent repeated POSTs
        void this.onAttune(id);
      }
    }
  }

  /**
   * Per-frame compass pull (8B.2). Finds the nearest eligible UNATTUNED waystone and
   * points the compass at it (intensity rising as distance shrinks), or hides when
   * none is within COMPASS_RANGE. Points only toward unattuned anchorages on the
   * current screen (discovery waystones have been removed).
   */
  private updateCompass(): void {
    const px = this.player.x;
    const py = this.player.y;

    // Candidate centers for each unattuned waystone that has a placed marker.
    const candidates = (this.waystonePayload?.waystones ?? [])
      .filter((w) => !w.attuned)
      .map((info) => {
        const center = this.anchorageMarkers.get(info.id)?.center;
        return center ? { id: info.id, x: center.x, y: center.y } : null;
      })
      .filter((c): c is { id: string; x: number; y: number } => c !== null);

    // Unconditional nearest (radius Infinity), then range-gate by COMPASS_RANGE.
    const target = nearest({ x: px, y: py }, candidates, Infinity);
    if (!target) {
      this.compass.hide();
      window.__compass = { visible: false, targetId: null, angle: null, intensity: null };
      return;
    }
    const bestDist = Math.hypot(target.x - px, target.y - py);
    if (bestDist > COMPASS_RANGE) {
      this.compass.hide();
      window.__compass = { visible: false, targetId: null, angle: null, intensity: null };
      return;
    }

    const targetId = target.id;
    const angle = Phaser.Math.Angle.Between(px, py, target.x, target.y);
    const intensity = 1 - bestDist / COMPASS_RANGE;
    this.compass.point(angle, intensity);
    window.__compass = { visible: true, targetId, angle, intensity };
  }

  // ── Zones ────────────────────────────────────────────────────────────────────

  /**
   * Build InteractionZones for named map rectangles. `sanctum_return` is built
   * dynamically in loadWaystones at the anchored waystone position, so it is
   * skipped here. A `biome_exit` object transitions to an adjacent biome via the
   * roster-authoritative boss-defeat gate in tryBiomeExit.
   *
   * #344 — Edge-placement detection: a biome_exit zone whose rect touches a map
   * edge (within 16px of y=0, x=0, y=mapH, or x=mapW) is treated as an EDGE exit
   * and fires tryBiomeExit on contact (matching checkEdgeTransition's model).
   * Interior biome_exit zones (e.g. forest_swamp_gate's south exit at row 16)
   * still require an E press so the player can read the prompt and choose to engage.
   */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    const mapW = map.widthInPixels;
    const mapH = map.heightInPixels;
    const EDGE_THRESHOLD = 16; // 1 tile — zone rect must touch within this px of an edge
    for (const o of objs) {
      if (o.name === 'sanctum_return') continue;
      if (o.name === 'biome_exit') {
        const target = this.targetSceneOf(o) ?? 'SwampScene';
        const targetScreen = this.stringPropOf(o, 'targetScreen');
        const spawnEdge = this.stringPropOf(o, 'spawnEdge') as 'north'|'south'|'east'|'west'|undefined;
        const gate = this.gateOf(o);
        // Determine whether this zone sits on a map edge (auto-fire) or interior (E-press).
        // The discriminator checks the zone rect's ORIGIN (top-left corner) against the
        // map edge. This mirrors the issue spec: treat as edge-placed when origin is
        // within EDGE_THRESHOLD px of y=0, x=0, y=mapH, or x=mapW. Interior exits like
        // forest_swamp_gate's south exit (oy=256 in a 288px-tall map, 32px from bottom)
        // are NOT caught by this check and keep their E-press interaction.
        const ox = o.x ?? 0;
        const oy = o.y ?? 0;
        const isEdgePlaced =
          oy <= EDGE_THRESHOLD ||
          ox <= EDGE_THRESHOLD ||
          oy >= mapH - EDGE_THRESHOLD ||
          ox >= mapW - EDGE_THRESHOLD;
        if (isEdgePlaced) {
          // Auto-fire on contact: suppress the E prompt, trigger via overlap callback.
          const zone = new InteractionZone(this, o, () => this.tryBiomeExit(target, gate, targetScreen, spawnEdge), null);
          this.physics.add.overlap(
            this.player,
            zone.overlapZone,
            () => this.tryBiomeExit(target, gate, targetScreen, spawnEdge),
          );
          this.zones.push(zone);
        } else {
          // Interior exit: E-press required (player chooses to enter).
          const zone = new InteractionZone(this, o, () => this.tryBiomeExit(target, gate, targetScreen, spawnEdge));
          this.physics.add.overlap(this.player, zone.overlapZone);
          this.zones.push(zone);
        }
        continue;
      }
      if (o.name === 'forage_node') {
        const nodeId = this.stringPropOf(o, 'node_id');
        if (!nodeId) continue;
        const node = new ForageNode(
          this,
          this.map,
          o,
          nodeId,
          (food_units) => {
            this.refreshHud();
            window.__forageNodeForaged = { nodeId, food_units };
          },
          (msg, color) => this.showToast(msg, color),
        );
        this.forageNodes.set(nodeId, node);
        this.physics.add.overlap(this.player, node.interactionZone.overlapZone);
        this.zones.push(node.interactionZone);
        continue;
      }
      if (o.name === 'merchant') {
        if (!this.merchantModal) {
          this.merchantModal = new MerchantModal(
            this,
            () => void this.refreshHud(),
            () => { this.overlayOpen = false; },
            // #137 — route the shop container to the 1:1 UI camera (NOT uiRoot, so
            // E2E single-level flatMap traversal still reaches its children).
            (container) => this.routeToUi(container),
          );
        }
        const modal = this.merchantModal;
        const npc = new MerchantNpc(
          this,
          o,
          () => {
            this.overlayOpen = true;
            void modal.open();
          },
          this.merchantNpcs.length, // ordinal → distinct charset character per merchant
        );
        this.merchantNpcs.push(npc);
        this.physics.add.overlap(this.player, npc.interactionZone.overlapZone);
        this.zones.push(npc.interactionZone);
        continue;
      }
      // (future: handle other named zones here)
    }
  }

  /**
   * Attempt a biome transition through a biome_exit zone. Roster-authoritative
   * boss-defeat gate: if the warden for this screen is still present in
   * this.overworldNpcs (server-owned), the transition is blocked and a barrier
   * message is shown. Once the warden is absent from the roster (permanent defeat
   * drops it server-side), the transition proceeds.
   *
   * Guards isTransitioning so the auto-fire physics overlap callback cannot fire
   * scene.start() multiple times per frame.
   */
  private tryBiomeExit(
    target: string,
    gate?: string,
    targetScreen?: string,
    spawnEdge?: 'north' | 'south' | 'east' | 'west',
  ): void {
    if (this.isTransitioning) return;
    void gate; // formerly a waystone attunement gate; superseded by roster-authoritative boss gate below
    // #344 — roster-authoritative boss-defeat gate. BOSS_WARDENS maps each gated
    // screen to the warden NPC id (server/src/persistence/NpcSpawns.ts). The
    // server is the authority: when the warden is alive it stays in the roster
    // (GET /api/overworld/npcs); when defeated (respawnDays=0) the server drops
    // it permanently, clearing the way.
    const wardenId = BOSS_WARDENS[this.screenId];
    if (wardenId) {
      const wardenAlive = this.overworldNpcs.some((npc) => npc.id === wardenId);
      if (wardenAlive) {
        const npc = this.overworldNpcs.find((n) => n.id === wardenId);
        const name = npc?.displayName ?? 'The warden';
        this.showBarrierMessage(`${name} blocks the way.`);
        return;
      }
    }
    // #438 — Sealed exit guard: if the target scene is not yet registered (unbuilt
    // region), show a stub message rather than crashing Phaser with an unknown key.
    // GDD §10.13: unbuilt regions show "the path is sealed" instead of throwing.
    const targetScene = this.scene.manager.getScene(target);
    if (!targetScene) {
      this.showSealedExitMessage();
      return;
    }
    this.isTransitioning = true;
    const data: Record<string, string> = {};
    if (targetScreen) data.screenId = targetScreen;
    if (spawnEdge) data.spawnEdge = spawnEdge;
    this.scene.start(target, Object.keys(data).length ? data : undefined);
  }

  /** Read the `gate` (attunement waystoneId) custom property off a Tiled object. */
  private gateOf(obj: Phaser.Types.Tilemaps.TiledObject): string | undefined {
    return this.stringPropOf(obj, 'gate');
  }

  /** Read any named string custom property off a Tiled object. */
  private stringPropOf(obj: Phaser.Types.Tilemaps.TiledObject, name: string): string | undefined {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === name);
    return typeof prop?.value === 'string' ? prop.value : undefined;
  }

  /** Show a brief, camera-pinned barrier message that fades out. */
  private showBarrierMessage(text: string): void {
    this.showFadingMessage('biome-barrier', text, CANVAS_H - 80, '#ffdddd');
  }

  /**
   * #438 — Show a "the path is sealed" toast when navigating to an unregistered
   * scene key. Reuses the boss-gate barrier message pattern so no new UI component
   * is needed (same toast style, same DOM element name, same fade behaviour).
   */
  private showSealedExitMessage(): void {
    this.showBarrierMessage('The path forward is sealed.');
  }

  /**
   * Show a brief camera-pinned toast message that fades out. `color` defaults to
   * white; pass '#aaffaa' for success or '#ff8888' for error. Reuses the same
   * name as showBarrierMessage so concurrent toasts replace each other (one at
   * a time) without stacking.
   */
  private showToast(text: string, color = '#ffffff'): void {
    this.showFadingMessage('biome-toast', text, CANVAS_H - 110, color);
  }

  /**
   * Shared body for {@link showBarrierMessage} and {@link showToast}: a
   * camera-pinned, named, single-at-a-time label that fades out and destroys
   * itself. Concurrent calls with the same `name` replace each other (no
   * stacking). Routing to the 1:1 UI camera and the pre-destroy main-camera
   * un-ignore are wired through {@link showTransientText}'s setup/destroy hooks so
   * the fade/teardown logic lives in one place (EPIC #291 / WS D).
   */
  private showFadingMessage(name: string, text: string, y: number, color: string): void {
    const existing = this.children.getByName(name) as Phaser.GameObjects.Text | null;
    if (existing) {
      this.unignoreMain(existing);
      existing.destroy();
    }
    showTransientText(this, {
      x: CANVAS_W / 2,
      y,
      text,
      color,
      backgroundColor: '#000000aa',
      padding: { x: 8, y: 4 },
      originX: 0.5,
      originY: 1,
      depth: 1000,
      name,
      // #137 — render at 1:1 through uiCam (kept at scene root for E2E traversal).
      onSetup: (msg) => this.routeToUi(msg),
      onDestroy: (msg) => this.unignoreMain(msg),
    });
  }

  // #137 — ignoreWorldObjects() (uiCam ignores world objects so they render only
  // through the zooming world camera) and unignoreMain() (clear a stale
  // main-camera ignore bit before destroy) are provided by DualCameraScene.

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

    // Loop A — Anchorage objects: register center, campfire graphic, and campfire modal zone.
    for (const o of objs) {
      if (o.name !== 'anchorage') continue;
      const id = this.waystoneIdOf(o);
      if (!id) continue;
      const cx = (o.x ?? 0) + (o.width ?? 32) / 2;
      const cy = (o.y ?? 0) + (o.height ?? 32) / 2;
      this.anchorageMarkers.set(id, { center: { x: cx, y: cy } });

      // Campfire graphic offset south-east of the anchorage center (#191).
      const campfire = new Campfire(this, { x: cx, y: cy });
      this.campfires.set(id, campfire);

      // InteractionZone must be co-located with the campfire graphic, which
      // draws at (cx+24, cy+24). Shift the object origin so the zone center
      // lands on the visible fire rather than the invisible anchorage center.
      const zw = o.width ?? 32;
      const zh = o.height ?? 32;
      const campfireZoneObj = {
        ...o,
        name: id,
        x: cx + 24 - zw / 2,
        y: cy + 24 - zh / 2,
      } as Phaser.Types.Tilemaps.TiledObject;
      const zone = new InteractionZone(
        this,
        campfireZoneObj,
        () => this.openCampfireModal(id),
      );
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }


    // Anchor-derived spawn (8B.3) + Sanctum exterior (8B.4.1): sprite bottom edge
    // flush with the anchorage bottom edge; player spawns in the tile below.
    // Done AFTER markers are built so the anchor center exists. Skipped on a
    // re-entry that already restored the player (edge step or post-duel).
    const anchorCenter = this.anchorageMarkers.get(payload.anchor);
    if (anchorCenter) {
      // Sprite center is SANCTUM_Y_ABOVE above the anchorage center so the bottom
      // of the scaled sprite aligns with the bottom of the anchorage object.
      const sanctumX = anchorCenter.center.x;
      const sanctumY = anchorCenter.center.y - SANCTUM_Y_ABOVE;

      // Interaction zone centered on the door (sprite bottom edge).
      this.refreshSanctumZone(sanctumX, sanctumY + SANCTUM_SPRITE_HALF_H);
      this.drawSanctumExterior(sanctumX, sanctumY);

      if (!this.returnedFromDuel) {
        // Spawn in the tile directly below the anchorage (one 16px tile down).
        this.player.setPosition(
          anchorCenter.center.x,
          anchorCenter.center.y + SANCTUM_SPAWN_Y_BELOW,
        );
      }

      window.__sanctumReturnCenter = { x: sanctumX, y: sanctumY };
    }

    // #137 — anchorage/sanctum world objects created async must be routed to
    // uiCam.ignore so the world camera renders them (not uiCam at 1:1).
    {
      const worldObjects: Phaser.GameObjects.GameObject[] = [];
      this.zones.forEach((z) => worldObjects.push(...z.displayObjects));
      this.campfires.forEach((cf) => worldObjects.push(...cf.displayObjects));
      if (this.sanctumSprite) worldObjects.push(this.sanctumSprite);
      this.ignoreWorldObjects(worldObjects);
    }

    // 8E (#107) — publish every interaction zone's world center so E2E can read
    // positions dynamically per-screen.
    this.publishZoneCenters();

    // Player has been (re)positioned — safe to allow edge transitions again.
    this.suppressEdgeTransitions = false;
  }

  /** Mirror each interaction zone's center to window.__zoneCenters for E2E (#107). */
  private publishZoneCenters(): void {
    window.__zoneCenters = Object.fromEntries(
      this.zones.map((z) => [z.name, { x: z.centerX, y: z.centerY }]),
    );
  }

  /**
   * Whether to render the `sanctum-exterior` image sprite at the Sanctum's world
   * position. Returns false when the map already contains a hand-authored building
   * that represents the Sanctum (e.g. `forest_anchorage`), preventing a double-render.
   * Subclasses override this for screens where the Tiled map includes the Sanctum
   * building in its tile layers.
   */
  protected shouldDrawSanctumExterior(): boolean {
    return true;
  }

  /**
   * Create (or replace) the sanctum_return interaction zone at the given world
   * center. Called both from loadWaystones (initial placement) and from
   * refreshSanctumPosition (after a summon moves the anchor). Destroying the old
   * zone and re-creating it keeps the overlap active and publishes the new center
   * to window.__zoneCenters for E2E.
   */
  private refreshSanctumZone(cx: number, cy: number): void {
    // Remove and destroy the previous zone so the player can't interact with the
    // old anchor position after the Sanctum is moved.
    if (this.sanctumReturnZone) {
      const idx = this.zones.indexOf(this.sanctumReturnZone);
      if (idx !== -1) this.zones.splice(idx, 1);
      this.sanctumReturnZone.destroy();
      this.sanctumReturnZone = null;
    }

    const sanctumObj: Phaser.Types.Tilemaps.TiledObject = {
      id: -1,
      type: 'sanctum_return',
      x: cx - SANCTUM_ZONE_HALF,
      y: cy - SANCTUM_ZONE_HALF,
      width: SANCTUM_ZONE_HALF * 2,
      height: SANCTUM_ZONE_HALF * 2,
      name: 'sanctum_return',
    };
    const returnZone = new InteractionZone(this, sanctumObj, () => this.scene.start('CampScene'));
    this.physics.add.overlap(this.player, returnZone.overlapZone);
    this.zones.push(returnZone);
    this.sanctumReturnZone = returnZone;

    // Route the new zone's display objects through the world camera only.
    this.ignoreWorldObjects(returnZone.displayObjects);
    this.publishZoneCenters();
  }

  /**
   * Draw the Sanctum exterior sprite (8B.4.1) at the given world center and add a
   * static physics body so the player cannot walk through it.
   *
   * On 16px / 2× zoom screens (Swamp, generated Forest) the sprite is scaled
   * down by 1/worldZoom() so it appears the same on-screen size as it does at
   * 1× zoom. Physics body dimensions use displayWidth/displayHeight so they
   * match the visually rendered size rather than the raw texture dimensions.
   */
  private drawSanctumExterior(cx: number, cy: number): void {
    if (!this.shouldDrawSanctumExterior()) return;
    const img = this.add.image(cx, cy, 'sanctum-exterior').setDepth(8);
    // Scale the sprite so it renders at the same screen size regardless of zoom.
    img.setScale(1 / this.worldZoom());
    this.sanctumSprite = img;
    // Static physics body sized to the building's lower half (walls + door) so the
    // player cannot walk through the structure. Use displayWidth/displayHeight
    // (= texture size × scale) so the body matches the scaled visual, not the
    // raw 128×160 texture size.
    this.physics.add.existing(img, true /* isStatic */);
    const body = img.body as Phaser.Physics.Arcade.StaticBody;
    const bw = img.displayWidth * 0.8;
    const bh = img.displayHeight * 0.5;
    body.setSize(bw, bh);
    body.setOffset((img.displayWidth - bw) / 2, img.displayHeight * 0.45);
    this.physics.add.collider(this.player, img);
  }

  /** Read the `waystoneId` custom property off a Tiled object, if present. */
  private waystoneIdOf(obj: Phaser.Types.Tilemaps.TiledObject): string | null {
    const props = (obj.properties ?? []) as Array<{ name: string; value: unknown }>;
    const prop = props.find((p) => p.name === 'waystoneId');
    return typeof prop?.value === 'string' ? prop.value : null;
  }

  /** GET /api/waystones with the stored Bearer token. Null on auth failure. */
  private async fetchWaystones(): Promise<WaystonesPayload | null> {
    if (!getToken()) {
      this.scene.start('LoginScene');
      return null;
    }
    try {
      const res = await apiFetch('/api/waystones');
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
    if (!getToken()) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await apiFetch('/api/waystones/attune', {
        method: 'POST',
        json: { waystoneId },
      });
      if (!res.ok) return;
      const payload = (await res.json()) as WaystonesPayload;
      this.cachePayload(payload);
      const attuned = payload.waystones.find((w) => w.id === waystoneId);
      if (attuned) this.showToast(`${attuned.name} attuned!`, '#49d3e0');
    } catch {
      // Network error — leave the marker unchanged; the next GET will reconcile.
    }
  }

  // ── Campfire overlay (#191) ─────────────────────────────────────────────────

  /**
   * Open the campfire Rest + Summon overlay for the given Anchorage. Called when
   * the player presses E on an Anchorage zone. Auto-attunement still fires via
   * checkAnchorageAutoAttune on proximity, so the player is already attuned before
   * they can press E.
   */
  private openCampfireModal(anchorageId: string): void {
    if (this.campfireModal?.isOpen()) return;
    const info = this.waystonePayload?.waystones.find((w) => w.id === anchorageId);
    const anchorageName = info?.name ?? anchorageId;
    // Read current food/spirit from the HUD text or fall back to a live fetch.
    const food = 0;   // will be refreshed after action; shown as placeholder
    const spirit = 0; // same
    const spiritCost = info?.spiritCost ?? 0;

    this.overlayOpen = true;
    this.campfireModal = new CampfireModal(
      this,
      anchorageId,
      anchorageName,
      food,
      spirit,
      spiritCost,
      () => void this.refreshHud(),
      () => {
        this.campfireModal = null;
        this.overlayOpen = false;
        window.__campfireModal = null;
        window.__campfireRest = undefined;
        window.__campfireSummon = undefined;
      },
      (newAnchor) => void this.refreshSanctumPosition(newAnchor),
      (container) => this.routeToUi(container),
    );
    // Fetch live values and re-open with accurate numbers.
    void this.fetchAndReopenCampfireModal(anchorageId, anchorageName, spiritCost);
  }

  /** Fetch live food/spirit and reopen the campfire modal with accurate values. */
  private async fetchAndReopenCampfireModal(
    anchorageId: string,
    anchorageName: string,
    spiritCost: number,
  ): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/me');
      if (!res.ok || !this.campfireModal?.isOpen()) return;
      const data = (await res.json()) as {
        player: { food_units: number; spirit_current: number };
      };
      // Destroy placeholder modal and rebuild with real values.
      // Don't use overlayOpen to guard here: close() fires onClose which sets
      // overlayOpen=false, so the check would always bail. User-close was already
      // caught by the !campfireModal?.isOpen() guard above.
      this.campfireModal.close();
      this.overlayOpen = true;
      this.campfireModal = new CampfireModal(
        this,
        anchorageId,
        anchorageName,
        data.player.food_units,
        data.player.spirit_current,
        spiritCost,
        () => void this.refreshHud(),
        () => {
          this.campfireModal = null;
          this.overlayOpen = false;
          window.__campfireModal = null;
          window.__campfireRest = undefined;
          window.__campfireSummon = undefined;
        },
        (newAnchor) => void this.refreshSanctumPosition(newAnchor),
        (container) => this.routeToUi(container),
      );
    } catch {
      // Leave the placeholder modal open.
    }
  }

  /**
   * After a successful Summon, re-fetch /api/waystones to get the updated anchor,
   * then move the Sanctum exterior sprite to the new position.
   */
  private async refreshSanctumPosition(newAnchor: string): Promise<void> {
    const payload = await this.fetchWaystones();
    if (!payload) return;
    this.cachePayload(payload);
    // Move the Sanctum exterior to the new anchor.
    const anchorCenter = this.anchorageMarkers.get(newAnchor ?? payload.anchor);
    if (!anchorCenter) return;
    const sanctumX = anchorCenter.center.x;
    const sanctumY = anchorCenter.center.y - SANCTUM_Y_ABOVE;
    if (this.sanctumSprite) {
      this.sanctumSprite.setPosition(sanctumX, sanctumY);
    } else {
      this.drawSanctumExterior(sanctumX, sanctumY);
    }
    // Always refresh the interaction zone to match the new anchor position — the
    // zone was created at the OLD anchor in loadWaystones and must be relocated
    // so the player can actually enter the summoned Sanctum.
    this.refreshSanctumZone(sanctumX, sanctumY + SANCTUM_SPRITE_HALF_H);
    window.__sanctumReturnCenter = { x: sanctumX, y: sanctumY };
  }

  /** #81 — GET /api/talisman-loadout and cache it (also published for E2E). */
  private async loadTalismanLoadout(): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/talisman-loadout');
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
    if (!getToken()) return;
    let res: Response;
    try {
      res = await apiFetch('/api/talisman/activate', {
        method: 'POST',
        json: { talismanlId: 'sanctum_stone', anchorageId },
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
    if (!getToken()) return;
    const biome = this.scene.key === 'SwampScene' ? 'swamp' : this.scene.key === 'SnowScene' ? 'snow' : 'forest';
    try {
      const res = await apiFetch(
        `/api/overworld/npcs?biome=${biome}&screen=${this.screenId}`,
      );
      if (!res.ok) return;
      this.overworldNpcs = (await res.json()) as NpcInfo[];
    } catch {
      return; // leave the roster empty
    }
    this.renderNpcs();
    window.__overworldNpcs = this.overworldNpcs;
  }

  /** Render each NPC marker (depth 6) as a {@link WanderingNpc}: monsters use a
   *  per-element overworld sprite matching the battler (#158) and idle-bob in place;
   *  duelists use the shared charset and play the walk-cycle as they wander. Each
   *  controller writes its live position back into the roster entry so detection +
   *  the approach prompt + the click handler track the moving creature. */
  private renderNpcs(): void {
    this.npcMarkers.forEach((m) => m.destroy());
    this.npcMarkers = [];
    // #229/#230 — the boss warden (if any) guarding this screen's gated exit. When
    // the server still lists it in the roster the warden is alive: render it
    // stationary + immovable and block the player from reaching the gated exit.
    const wardenId = BOSS_WARDENS[this.screenId];
    for (const npc of this.overworldNpcs) {
      const isWarden = npc.id === wardenId;
      const marker = new WanderingNpc(this, npc, () => this.onNpcClick(npc), isWarden);
      this.npcMarkers.push(marker);
      // The warden's immovable body physically gates the exit until it is beaten;
      // once defeated the server drops it from the roster, this collider is never
      // added on the next render, and the exit becomes reachable.
      if (isWarden) this.physics.add.collider(this.player, marker.sprite);
    }
    // #137 — NPC sprites load async (after the create() world collection), so route
    // them to uiCam.ignore now: they are WORLD objects that zoom with the main camera.
    this.ignoreWorldObjects(this.npcMarkers.map((m) => m.sprite));
  }

  /**
   * #87 Part C — NPC sprite pointerdown. Two clicks on the same NPC within
   * DOUBLE_CLICK_MS launch an ambush duel (records the duel origin, starts
   * EncounterScene with ambush:true). Suppressed while the Tab overlay is open. A
   * single click is a no-op (the E-key approach still works).
   */
  private onNpcClick(npc: NpcInfo): void {
    if (this.overlayOpen) return;
    // EPIC #319 (A2) — mirror the same pre-flight gate as checkNpcDetection() so
    // double-clicking a blocked NPC is a no-op (no duel launch, no scene transition).
    const campState = window.__campState;
    const heartOk = !!(campState?.heart_ring) && (campState.heart_ring.current_uses ?? 0) > 0;
    const thumbOk = campState?.loadout?.thumb != null;
    if (!heartOk || !thumbOk) {
      // Show the same hint that checkNpcDetection() would display for the current
      // blocking condition, so double-clicking a gated NPC gives visible feedback.
      if (!heartOk) {
        this.showNpcPrompt(
          campState?.heart_ring
            ? 'Recharge your heart ring to fight'
            : 'Equip a heart ring to fight',
        );
      } else {
        this.showNpcPrompt('Stake a ring to fight');
      }
      return;
    }
    const now = this.time.now;
    const prev = this.npcLastClick.get(npc.id) ?? -Infinity;
    this.npcLastClick.set(npc.id, now);
    if (now - prev > DOUBLE_CLICK_MS) return; // first click of a potential double
    this.npcLastClick.delete(npc.id); // consume the gesture
    window.__duelOrigin = {
      scene: this.scene.key as 'ForestScene' | 'SwampScene' | 'SnowScene',
      x: this.player.x,
      y: this.player.y,
      screenId: this.screenId,
    };
    const owEntry = npc.type === 'monster' ? MONSTER_OW_REGISTRY[npc.element] : undefined;
    this.scene.start('EncounterScene', {
      npcId: npc.id,
      personality: npc.personality as AIPersonality,
      aiSeed: npc.aiSeed,
      ambush: true,
      spriteFrame: npc.spriteFrame,
      battleKey: owEntry?.battleKey,
      // #199 — thread the NPC's staked element so the battle thumb matches the
      // overworld sprite colour + approach warning.
      thumbElement: npc.element,
    });
  }

  /**
   * #83 — per-frame detection (GDD §10.3). Find the nearest NPC within
   * detectionRadius(); set this.detectedNpc to it (or null when none in range).
   * Show/hide a camera-pinned Approach [E] prompt and publish window.__detectedNpc.
   *
   * EPIC #319 (A2) — Discovery finding: in all production code paths the player
   * must pass through CampScene before entering any BaseBiomeScene (BootScene →
   * CampScene → ForestScene/SwampScene; BattleScene returns to the biome with the
   * global still set). window.__campState is therefore always populated at biome
   * entry in production. E2E tests that navigate directly to a biome scene without
   * CampScene will see campState as undefined; the gate predicates below handle
   * that safely via optional-chaining (undefined → blocked). No fallback fetch is
   * needed for production correctness, but E2E harness setup must set __campState.
   */
  private checkNpcDetection(): void {
    const px = this.player.x;
    const py = this.player.y;
    const radius = this.detectionRadius();
    const found = nearest({ x: px, y: py }, this.overworldNpcs, radius);

    if (found) {
      // EPIC #319 (A2) — pre-flight battle-entry gate.
      // Heart: must be assigned AND have uses remaining (drained = blocked).
      // Thumb: must be assigned — any uses value, including 0, is allowed.
      const campState = window.__campState;
      const heartOk =
        !!(campState?.heart_ring) && (campState.heart_ring.current_uses ?? 0) > 0;
      const thumbOk = campState?.loadout?.thumb != null;

      if (!heartOk) {
        // Leave detectedNpc null so handleInteract() and onNpcClick() are no-ops.
        this.detectedNpc = null;
        this.showNpcPrompt(
          campState?.heart_ring
            ? 'Recharge your heart ring to fight'
            : 'Equip a heart ring to fight',
        );
        window.__detectedNpc = null;
        return;
      }
      if (!thumbOk) {
        this.detectedNpc = null;
        this.showNpcPrompt('Stake a ring to fight');
        window.__detectedNpc = null;
        return;
      }

      // Both preconditions met — show the normal approach prompt.
      this.detectedNpc = {
        id: found.id,
        personality: found.personality,
        type: found.type,
        x: found.x,
        y: found.y,
        aiSeed: found.aiSeed,
        spriteFrame: found.spriteFrame,
        element: found.element,
        stakeXp: found.stakeXp,
      };
      const isBoss = !!found.bossTier;
      const tierLabel = found.bossTier === 'major' ? 'Major Boss' : found.bossTier === 'gate' ? 'Gate Boss' : found.bossTier === 'sub' ? 'Boss' : '';
      const label = found.displayName
        ? `${found.displayName}${tierLabel ? `  ·  ${tierLabel}` : ''}`
        : `${ELEMENT_NAMES[found.element] ?? '?'} ${found.type === 'monster' ? 'monster' : 'duelist'}`;
      const xpPart = found.stakeXp !== undefined ? `  ${found.stakeXp.toLocaleString()} XP` : '';
      const spPart = found.npcSpirit !== undefined && found.npcSpirit > 0 ? ` / ${found.npcSpirit} SP` : '';
      this.showNpcPrompt(`${label}${xpPart}${spPart}  —  Approach [E]`, isBoss);
      window.__detectedNpc = { id: found.id, personality: found.personality };
    } else {
      this.detectedNpc = null;
      this.hideNpcPrompt();
      window.__detectedNpc = null;
    }
  }

  /** Show (or update) the camera-pinned detection prompt. Created lazily. */
  private showNpcPrompt(text: string, isBoss = false): void {
    if (!this.npcPrompt) {
      // #362 — DOM-rendered for crisp HiDPI text. Top-center anchored (origin 0.5,0);
      // color/background are set per-call below to reflect the boss vs normal state.
      this.npcPrompt = addDomLabel(this, CANVAS_W / 2, 80, '', {
        fontPx: 14,
        color: '#ffeeaa',
        align: 'center',
        background: '#000000aa',
        padding: '4px 8px',
        id: 'npc-prompt',
      }).setOrigin(0.5, 0);
    }
    // Reflect the boss vs normal palette directly on the DOM node's style. Guard
    // the cast: if the DOM container was never created or has been torn down,
    // `.node` can be undefined — skip the style mutation rather than crash.
    const promptNode = this.npcPrompt?.node as HTMLElement | null;
    if (promptNode) {
      promptNode.style.color = isBoss ? '#ff8844' : '#ffeeaa';
      promptNode.style.background = isBoss ? '#550000cc' : '#000000aa';
    }
    setDomLabelText(this.npcPrompt, text);
    this.npcPrompt.setVisible(true);
  }

  /** Hide the detection prompt without destroying it (reused next detection). */
  private hideNpcPrompt(): void {
    this.npcPrompt?.setVisible(false);
  }

  /** Store the latest payload and mirror it to window.__waystones for E2E. */
  private cachePayload(payload: WaystonesPayload): void {
    this.waystonePayload = payload;
    window.__waystones = payload;
    // #112 — the waystone payload updates on most state-changing server
    // interactions (initial load, attune, teleport, sleep, recharge), so refresh
    // the resource HUD here to keep Day/Gold/Food/Spirit/XP current.
    void this.refreshHud();
  }

  /**
   * #128 — fetch GET /api/overworld/forage-status?screen= and set the initial
   * available/depleted visual for every forage_node on this screen. Nodes that
   * have never been foraged are not returned (implicitly available). Runs once
   * on scene create, after buildZones has instantiated the ForageNode objects.
   * On any network / auth failure the nodes remain in the default available state.
   */
  private async loadForageNodeStatus(): Promise<void> {
    if (this.forageNodes.size === 0) return;
    if (!getToken()) return;
    try {
      const res = await apiFetch(
        `/api/overworld/forage-status?screen=${this.screenId}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        nodes: Array<{ node_id: string; depleted: boolean }>;
      };
      for (const entry of data.nodes) {
        const node = this.forageNodes.get(entry.node_id);
        if (node && entry.depleted) node.setDepleted(true);
      }
      // Publish to E2E hook.
      window.__forageStatus = data.nodes;
    } catch {
      // Network failure — leave nodes in default available state.
    }
  }

  /**
   * #112 — fetch the authoritative player state from GET /api/me and repaint the
   * persistent resource HUD (Day · Gold · Food · Spirit · ♥ · XP · Avg XP). The server is the
   * source of truth; on any network/auth failure the HUD is left as-is.
   * NOTE: called by name (`scene?.refreshHud?.()`) in tests/e2e/overworld-hud-stats.spec.ts — propagate any rename there.
   */
  private async refreshHud(): Promise<void> {
    if (!getToken() || !this.hudText) return;
    try {
      const res = await apiFetch('/api/me');
      // The scene may have shut down during the await; bail if the text is gone.
      if (!res.ok || !this.hudText) return;
      const data: {
        player: {
          game_day?: number;
          gold?: number;
          food_units?: number;
          spirit_current?: number;
          spirit_max?: number;
          heart_ring?: { current_uses: number; max_uses: number } | null;
          total_xp?: number;
          battle_hand_avg_xp?: number;
        };
      } = await res.json();
      // The scene may have shut down during the JSON parse; bail if the HUD is gone.
      if (!this.hudText) return;
      const p = data.player;
      const spiritStr = `${p.spirit_current ?? 0}/${p.spirit_max ?? 0}`;
      const heart = p.heart_ring;
      const heartStr = heart ? `${heart.current_uses}/${heart.max_uses}` : '0/0';
      const totalXpStr = (p.total_xp ?? 0).toLocaleString();
      const avgXpStr = Math.round(p.battle_hand_avg_xp ?? 0).toLocaleString();
      setDomLabelText(
        this.hudText,
        `Day ${p.game_day ?? 1}  ·  Gold ${p.gold ?? 0}  ·  Food ${p.food_units ?? 0}` +
          `  ·  Spirit ${spiritStr}  ·  ♥ ${heartStr}  ·  XP ${totalXpStr}` +
          `  ·  Avg XP ${avgXpStr}`,
      );
    } catch {
      // Network failure — leave the HUD showing its last good value.
    }
  }

  /** Per-frame: show the prompt for the nearest overlapping zone. */
  private updateActiveZone(): void {
    // Use the physics body center rather than the game-object origin. The body
    // is offset 18px below the sprite origin (feet-position hitbox), so at the
    // top world boundary player.y goes negative while the body stays at y≥0.
    // Using the origin caused the north biome_exit zone (y=0) to never fire.
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const px = body.center.x;
    const py = body.center.y;
    const overlapping = this.zones.filter((z) => z.contains(px, py));
    // Priority (highest first):
    //   1. Campfire zone — the 16×16 campfire zone sits inside the 64×64
    //      sanctum_return rectangle, so campfire must win to let E open the
    //      campfire modal (#417 live regression fix).
    //   2. sanctum_return — wins over every other zone when no campfire overlaps
    //      (original intent: the door is the actionable E target at an anchorage).
    //   3. Nearest of remaining zones.
    const campfire = overlapping.find((z) => this.campfires.has(z.name));
    const ret = campfire ? undefined : overlapping.find((z) => z.name === 'sanctum_return');
    const priority = campfire ?? ret ?? null;
    let nearest: InteractionZone | null = priority;
    let best = priority ? -Infinity : Infinity;
    for (const z of overlapping) {
      if (z === priority) continue;
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
