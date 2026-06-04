import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LoginScene } from './scenes/LoginScene';
import { CampScene } from './scenes/CampScene';
import { ForestScene } from './scenes/ForestScene';
import { SwampScene } from './scenes/SwampScene';
import { SnowScene } from './scenes/SnowScene';
import { EncounterScene } from './scenes/EncounterScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BattleScene } from './scenes/BattleScene';
import type {
  ExchangeResultPayload,
  RechargeResultPayload,
  AIPersonality,
  BattleRoomOptions,
  BattleSummaryPayload,
  DifficultyTier,
} from '../../shared/types';
import { CANVAS_W, CANVAS_H } from './Constants';

declare global {
  interface Window {
    __game: Phaser.Game;
    __room: import('@colyseus/sdk').Room<any> | null;
    __scene: Phaser.Scene | null;
    // ── Phase 8A spatial hooks ────────────────────────────────────────────
    // The current spatial scene key ('CampScene' for the Sanctum room,
    // 'OverworldScene' for the overworld). Set on create, used by E2E to assert
    // scene transitions deterministically.
    __activeScene?: string;
    // The active top-down player avatar (Sanctum or Overworld). Cleared on
    // scene shutdown so tests can read live position only while a scene runs.
    __player?: import('./objects/world/Player').Player | null;
    // Names of the interaction zones the player currently overlaps (8A.2).
    __sanctumZones?: string[];
    // Fire the active (nearest overlapping) zone's interaction — same as E (8A.2).
    __sanctumInteract?: () => void;
    // Which Sanctum overlay is open ('ringwall'/'bed'/'meditation'/'campfire')
    // or null when none. (8A.2)
    __sanctumOverlayOpen?: string | null;
    // ── Phase 8B overworld hooks ──────────────────────────────────────────
    // Latest GET /api/waystones payload, published by OverworldScene on load and
    // after each attune. Read by E2E to assert real server-backed attunement
    // state. Cleared on scene shutdown.
    __waystones?: {
      aggregateXp: number;
      // #87 Part B — current spirit (the §10.8 teleport gate is spirit, not XP).
      spiritCurrent?: number;
      anchor: string;
      waystones: Array<{
        id: string;
        name: string;
        xpThreshold: number;
        // #87 Part B — spirit spent to teleport here; meetsThreshold = can afford.
        spiritCost?: number;
        attuned: boolean;
        meetsThreshold: boolean;
      }>;
    };
    // Compass HUD state (8B.2), published every OverworldScene update frame.
    // `visible` is false when no unattuned waystone is within COMPASS_RANGE (or
    // all are attuned); otherwise it points at `targetId` with a math-angle
    // `angle` (rad) and `intensity` ∈ [0,1] rising as the player approaches.
    // Cleared on scene shutdown.
    __compass?: {
      visible: boolean;
      targetId: string | null;
      angle: number | null;
      intensity: number | null;
    };
    // World-space center of the dynamically-placed Sanctum exterior + its
    // sanctum_return zone (8B.4.1). Published after loadWaystones positions the
    // Sanctum at the anchored waystone; cleared on scene shutdown. E2E reads it
    // to find the (now anchor-derived) re-entry door rather than a fixed point.
    __sanctumReturnCenter?: { x: number; y: number };
    __lastExchangeResult: ExchangeResultPayload | null;
    // Latest post-battle reward summary (#78 ②), captured at the connection level
    // (Connection.ts) since the server sends it after the ENDED state patch and a
    // duel can end before BattleScene mounts. Read by E2E to assert gold/XP.
    __lastBattleSummary: BattleSummaryPayload | null;
    // Latest /api/encounter/preview snapshot per AI personality (#78 ③),
    // published by EncounterScene after the fetch resolves. AI keys only (no PVP).
    // Cleared on EncounterScene shutdown. Read by E2E to assert opponent stats.
    __encounterPreview?: Record<
      string,
      { element: number; stakeTier: number; stakeXp: number; totalXp: number }
    >;
    // #262 — defeated bosses shown in the TRAINING rematch row, and the hook to
    // launch a practice rematch by boss id (same path as a rematch-card click).
    __encounterBosses?: Array<{
      id: string;
      name: string;
      tier: string;
      personality: AIPersonality;
      element: number;
      aiSeed: number;
      spriteFrame: number;
      spriteElement: number;
    }>;
    __encounterRematchBoss?: (bossId: string) => void;
    __slotPositions: { x: number; y: number }[];
    __orbLaunchCount: number;
    // EPIC #264 / #267 — dual-orb telegraph E2E hooks. __lastOrbOutcome records the
    // most recent per-orb combo result (which orb a press answered + its label),
    // null outside a combo. __orbDispersed counts parry-disperse VFX plays (orb 2
    // scattered instead of impacting). Read by E2E to assert per-orb attribution
    // and the parry-disperse without reading pixels.
    __lastOrbOutcome?: { orb: number; label: string } | null;
    // Durable log of every per-orb combo outcome (orb + label), so a test can read
    // both orbs' results even when two arrive in rapid succession. Reset per battle.
    __orbOutcomeLog?: { orb: number; label: string }[];
    __orbDispersed?: number;
    // EPIC #264 / #266 — true while A1/A2 show the double-attack eligibility cue
    // (canDoubleAttack on the local hand during the player's attack phase). Read by
    // E2E to assert the cue toggles with eligibility.
    __comboEligible?: boolean;
    // #125 — true while the BattleScene forfeit confirm prompt is open. E2E reads
    // this to assert the Z+C (a1+a2) / 3+4 (d1+d2) chord raised the prompt.
    __forfeitPromptOpen?: boolean;
    // #348 — true while the BattleHandOverlay discard-confirm modal is open. Mirrors
    // __forfeitPromptOpen so E2E can assert the safe 3-step discard without pixels.
    __discardConfirmOpen?: boolean;
    // #135 — the LOCAL player's rendered HUD (Blinded `?` substitution applied).
    // E2E asserts own-HUD hiding against this without reading pixels.
    // #211 — `spirit` is the rendered ⚡ readout as 'current/max' (or undefined
    // when hidden: AI / no-token local sessions with spiritMax 0).
    __hudView?: {
      a1: string;
      a2: string;
      d1: string;
      d2: string;
      hearts: string;
      spirit?: string;
      // #313 — the rendered opponent spirit readout (current/max), or undefined
      // when hidden (PvP / non-finite AI pool). For E2E privacy + decrement asserts.
      oppSpirit?: string;
    };
    // #211 — the latest per-client recharge result, published by BattleScene so
    // E2E can assert partial/insufficient feedback without reading pixels.
    __lastRechargeResult?: RechargeResultPayload | null;
    // #212 — won-ring payload captured at the connection level (Connection.ts),
    // carrying the element so the end-of-battle modal can name the ring
    // ("Won: FIRE Ring"). null when the just-finished duel granted no ring.
    // EPIC #378: er_pending_ring localStorage replaced by server pending_ring_id.
    __lastWonRing?: { ringId: string; element: number; xp: number } | null;
    // #212 — persistent end-of-battle modal hooks. __battleEndModalOpen is true
    // while the modal is shown (false while collapsed via [X]). __battleEndChoice
    // fires the same handler as a button press (route + close). __reopenBattleEnd
    // re-shows the modal after [X]. Set by BattleEndModal.show, cleared on destroy.
    __battleEndModalOpen?: boolean;
    __battleEndChoice?: (choice: 'managehand' | 'overworld') => void;
    __reopenBattleEnd?: () => void;
    // #212 — true while the Manage Battle-Hand overlay is open, regardless of host
    // scene (EncounterScene or a biome). Set/cleared by BattleHandOverlay so E2E
    // can assert which post-duel route opened the overlay. (Distinct from the
    // legacy __overworldBattleHandOpen, which is biome-scene-specific.)
    __battleHandOpen?: boolean;
    // #389 — converged ring-management structure reporter. Published per render by
    // whichever overlay is open (field BattleHandOverlay or Sanctum reliquary), so
    // the cross-mode E2E assertions can verify the BENCH/HEALTH/COMBAT columns are
    // the same structure in both modes, read the Spirit/Bench counters (n/max), and
    // confirm no card carries a Tier row. Cleared (undefined) when both are closed.
    __ringMgmtState?: {
      mode: 'sanctum' | 'field';
      columns: string[];
      counters: {
        spirit?: { n: number; max: number };
        bench: { n: number; max: number };
      };
      anyCardHasTierRow: boolean;
    };
    connectToRoom: (roomName: string, opts?: BattleRoomOptions) => Promise<void>;
    // Deterministic E2E hook: triggers the same code path as clicking an
    // EncounterScene marker. Set by EncounterScene.create(). 'PVP' starts the
    // LobbyScene; a personality starts a vsAI duel.
    __encounterSelect?: (choice: AIPersonality | 'PVP') => void;
    // Deterministic E2E: start a vsAI duel with AI-strength overrides so the
    // outcome is forced (aiHearts:1 → win, aiHearts:99 → loss, aiUses:0 → AI
    // forfeits). Same code path as __encounterSelect otherwise.
    __encounterSelectWithOverrides?: (
      choice: AIPersonality | 'PVP',
      aiOverrides?: { aiHearts?: number; aiUses?: number },
    ) => void;
    // Deterministic E2E PvP hook (#67): start the PvP path bound to a unique
    // keyed room id so two parallel browser contexts pair into one isolated
    // room (never cross-pairing under parallel workers). Set by EncounterScene.
    __encounterSelectPvP?: (e2eRoomId: string) => void;
    __campGoEncounter?: () => void;
    __campSleep?: () => void;
    __campRecharge?: (ringId: string) => Promise<void>;
    __campRechargeAll?: () => Promise<void>;
    // #40 carry hooks — deterministic code paths for E2E.
    __campAddToLoadout?: (ringId: string) => Promise<void>;
    __campLeaveAtSanctum?: (ringId: string) => Promise<void>;
    // #47 fusion hooks — open the fusion modal / fuse two parents directly.
    __campOpenFusion?: () => void;
    __campFuse?: (ringId1: string, ringId2: string) => Promise<string | null>;
    // EPIC #279 — open the difficulty selector (same path as the Settings button).
    __campOpenSettings?: () => void;
    // EPIC #279 — difficulty modal snapshot: the current tier + tier order.
    // Set by DifficultyModal.open; cleared on close. E2E reads it to assert which
    // tier is highlighted without pixel hit-testing.
    __difficultyState?: { current: DifficultyTier; tiers: DifficultyTier[] };
    // #263 — rendered two-tone fill order per ring id across the camp grids
    // ([dominant, other] for a fusion, [element] for a base ring). For E2E.
    __campFusedFills?: Record<string, number[]>;
    // #63 teleport hooks — open the teleport modal / travel to a waystone.
    __campOpenTeleport?: () => Promise<void>;
    __campTeleport?: (waystoneId: string) => Promise<void>;
    // #78 ① hit-test probe — scrolls the camera, then hit-tests a ring card bg at
    // its render position to prove the (scrollFactor-fixed) hit area tracks the
    // render, not the world. Registered while the ring-storage overlay is open.
    __campHitTestRing?: (ringId: string) => { found: boolean; hit: boolean };
    // #85 Fix 2A — scroll a Ring Storage inventory grid by `delta` rows (positive
    // = down), clamped to the valid range. Registered only while the ring-storage
    // overlay is open; cleared in overlayOnClose. Same code path as the ▲/▼
    // buttons and the mouse wheel.
    __campSanctumScroll?: (delta: number) => void;
    __campLoadoutScroll?: (delta: number) => void;
    // #154 Reliquary modal — click-then-click move hooks (no pixel hit-testing).
    // __reliquarySelect picks up a ring from a section ('reliquary' = not-carried,
    // 'spare' = carried-unslotted, 'battle' = assigned to a battle slot).
    // __reliquaryMove performs a full move to a target section/slot and resolves
    // once the authoritative reload has rebuilt __campState. __reliquaryLocked is
    // true while the carry cap is full (Reliquary cards are inert). All registered
    // only while the Reliquary modal is open; cleared on close.
    __reliquarySelect?: (
      ringId: string,
      source: 'reliquary' | 'spare' | 'battle',
    ) => void;
    __reliquaryMove?: (
      ringId: string,
      target: 'reliquary' | 'spare' | 'thumb' | 'a1' | 'a2' | 'd1' | 'd2' | 'heart',
    ) => Promise<void>;
    __reliquaryLocked?: boolean;
    // #182 — true when the Reliquary is at its cap (reliquaryCount >= reliquaryCap).
    // Distinct from __reliquaryLocked which guards carry-cap. Set by applyReliquaryLockState.
    __reliquaryFull?: boolean;
    // #81 — talisman loadout snapshot (the GET /api/talisman-loadout payload).
    // Published by CampScene (on ring-wall overlay open) and OverworldScene (on
    // create) so E2E can assert the equipped necklace + remaining charges. null
    // when the fetch has not yet resolved; the object form once loaded.
    __talismanLoadout?: { necklaceId: string | null; necklaceCharges: number } | null;
    // #83 — overworld NPC roster (the GET /api/overworld/npcs payload), published
    // by OverworldScene/SwampScene on create. Each entry has the stable previewed
    // stake element + world-pixel position. Cleared on scene shutdown.
    __overworldNpcs?: Array<{
      id: string;
      personality: string;
      x: number;
      y: number;
      element: number;
    }>;
    // #83 — the NPC currently within DETECTION_RADIUS (nearest), or null when none
    // is in range. Published every update frame; drives the Approach [E] prompt and
    // the E → duel launch. Cleared on scene shutdown.
    __detectedNpc?: { id: string; personality: string } | null;
    // #88 — post-duel return origin. An overworld NPC duel (OverworldScene/
    // SwampScene) sets this to its biome scene key + the player's world position
    // BEFORE launching the duel; BattleScene.checkEnded returns to that biome scene
    // (instead of the EncounterScene hub) and the biome scene's create() restores
    // the player near {x,y}, then clears it. null/unset for hub/marker duels (which
    // return to the EncounterScene hub) and after consumption.
    __duelOrigin?: { scene: 'ForestScene' | 'SwampScene' | 'SnowScene'; x: number; y: number; screenId?: string } | null;
    // Teleport modal snapshot (set by CampScene.openTeleportModal before render).
    __teleportState?: {
      anchor: string;
      // #87 Part B — current spirit, so E2E can assert affordability gating.
      spiritCurrent?: number;
      rows: Array<{
        id: string;
        name: string;
        attuned: boolean;
        meetsThreshold: boolean;
        xpThreshold: number;
        // #87 Part B — spirit spent to teleport to this destination.
        spiritCost?: number;
      }>;
    };
    // #231 — Fusion Shrine altar state (set by ShrineZone): the shrine id and
    // whether it is currently unsealed for this player. Drives E2E assertions on
    // the seal flow.
    __shrineState?: { id: string; unlocked: boolean };
    // #231 — Fusion Shrine confirmation/hint overlay snapshot (set by ShrineZone
    // while a prompt is up; cleared on dismiss). `confirm` distinguishes the Y/N
    // unseal prompt from a dismissible hint.
    __shrinePrompt?: { id: string; confirm: boolean; text: string };
    // Fusion modal availability snapshot (set by FusionPanel.open).
    __fusionState?: {
      recipes: Array<{
        parents: [number, number];
        result: number;
        ready: boolean;
        parentAId: string | null;
        parentBId: string | null;
      }>;
    };
    __campState?: {
      player: any;
      rings: any[];
      loadout: { thumb?: string | null; [key: string]: unknown };
      // Carry pool separation for #40 assertions.
      atSanctum: any[];
      loadout_pool: any[];
      battleHand: any[];
      carry_cap: number;
      // #41 spirit/food snapshot.
      spirit_current: number;
      spirit_max: number;
      food_units: number;
      // Aggregate XP across the player's Reliquary rings (server-computed).
      aggregate_xp: number;
      // EPIC #302 — the ring equipped in the dedicated Heart slot (in_carry = 0,
      // heart_slot = 1), or null when the slot is empty. From /api/me.
      heart_ring?: any | null;
      // EPIC #302 — SUM(xp) across ALL owned rings (no in_carry / heart_slot
      // filter); the spirit pool driver shown in the header.
      total_xp?: number;
      // EPIC #302 — weighted average XP of the five battle-hand rings.
      battle_hand_avg_xp?: number;
      // EPIC #279 — player's difficulty tier (from /api/me). Drives the spirit_max
      // multiplier server-side; shown as a bracketed label in the stats header.
      difficulty?: DifficultyTier;
      // #182 — Reliquary cap fields, read from /api/me player sub-object.
      reliquaryCap?: number;
      reliquaryShards?: number;
      reliquaryCount?: number;
      // EPIC #378/#388 — spare-grid cap from /api/me (server-computed). Drives the
      // Reliquary SPIRIT-grid lock; replaces the dead `spareCapacity` alias (#383).
      spare_ring_max?: number;
      // #78 ④ — Thumb passive reminder. null when no Thumb ring is staked; a base
      // element yields { name, effect }; a fusion yields { name: null, effect: '…
      // no passive' }.
      staked_passive?: { name: string | null; effect: string } | null;
      // #85 Fix 2A — Ring Storage inventory grid scroll state, mirrored from the
      // live InventoryGrids only while the ring-storage overlay is open. Each grid
      // exposes its current top row, total rows, and visible-row cap so E2E can
      // assert scroll position before/after a scroll. Absent (undefined) when the
      // overlay is closed or the grids are not masked.
      sanctumScrollRow?: number;
      sanctumTotalRows?: number;
      sanctumVisibleRows?: number;
      loadoutScrollRow?: number;
      loadoutTotalRows?: number;
      loadoutVisibleRows?: number;
    };
    // #40 encounter modal hooks.
    __encounterManageBattleHand?: () => void;
    // Post-battle won-ring prompt lives in EncounterScene. When carry has room a
    // simple modal offers 'carry' or 'discard'; when carry is full there is no
    // modal — the player is routed to Manage Battle Hand to free a slot.
    __encounterResolveWonRing?: (choice: 'carry' | 'discard') => void;
    // Discard a carried ring from Manage Battle Hand (frees a slot; auto-carries
    // any pending won ring). Same path as the per-ring [×] button.
    __encounterDiscardRing?: (ringId: string) => void;
    // Set while the won-ring modal is open in EncounterScene.
    __encounterState?: {
      pendingWonRing: { ringId: string; element: number } | null;
    };
    // #87 Part A — deterministic blink hook. Calling __blink(zoneName) runs the
    // exact same code path as a double-click on that interaction zone: POST
    // /api/spirit/blink, then (on 200) snap the player onto the zone + fire its
    // interact(). Registered by BlinkController while a spatial scene is live;
    // resolves to true when the blink succeeded, false on no-op / insufficient
    // spirit. Cleared on scene shutdown.
    __blink?: (zoneName: string) => Promise<boolean>;
    // #87 Part D — true while the OverworldScene Tab battle-hand overlay is open.
    // Read by E2E to assert the overlay opened (Tab) and closed (Escape). Also the
    // movement-suppression flag BlinkController's getModalOpen lambda reads.
    __overworldBattleHandOpen?: boolean;
    // #87 Part D — toggle the OverworldScene battle-hand overlay (same path as Tab).
    __overworldToggleBattleHand?: () => void;
    // 8D.4 — number of decorations placed by the OverworldScene proof pass. Lets
    // E2E assert decorations were placed. Cleared on scene shutdown.
    __decorationCount?: number;
    // 8E.1 — the current Forest screen id (BaseBiomeScene multi-screen layout).
    // Published by ForestScene on create and cleared on shutdown so E2E can assert
    // which screen of the Forest region is live after an edge transition.
    __forestScreenId?: string;
    // 8E (#107) — world centers of the current screen's interaction zones, keyed by
    // zone name (anchorage/waystone ids, 'biome_exit', 'sanctum_return'). Published
    // by BaseBiomeScene after loadWaystones builds every zone; cleared on shutdown.
    // E2E reads it to find per-screen positions dynamically instead of hardcoding
    // pixel coordinates that move between the generated Forest screens.
    __zoneCenters?: Record<string, { x: number; y: number }>;
    // #128 — last successful forage event: the node_id foraged and the resulting
    // food_units balance. Set by ForageNode.interact on a 200 response; cleared
    // on scene shutdown. E2E reads it to assert food credits without a /api/me call.
    __forageNodeForaged?: { nodeId: string; food_units: number } | undefined;
    // #128 — forage-status snapshot from GET /api/overworld/forage-status, published
    // by BaseBiomeScene.loadForageNodeStatus on scene load. E2E reads it to assert
    // which nodes are depleted on load without additional HTTP calls.
    __forageStatus?: Array<{ node_id: string; depleted: boolean }> | undefined;
    // #131 — merchant modal state: set when MerchantModal opens, cleared on close.
    __merchantModalOpen?: boolean | undefined;
    // #191 — overworld anchorage campfire modal state and direct-action hooks.
    __campfireModal?: { anchorageId: string; summonCost: number } | null;
    __campfireRest?: () => void;
    __campfireSummon?: () => void;
  }
}

// Expose globals BEFORE any scene runs so the E2E harness has stable hooks.
window.__room = null;
window.__scene = null;
window.__lastExchangeResult = null;
window.__lastRechargeResult = null;
window.__lastBattleSummary = null;
window.__slotPositions = [];
window.__orbLaunchCount = 0;
window.__lastOrbOutcome = null;
window.__orbOutcomeLog = [];
window.__orbDispersed = 0;
window.connectToRoom = async (roomName: string, opts?: BattleRoomOptions): Promise<void> => {
  const { connectToRoom } = await import('./net/Connection');
  await connectToRoom(roomName, opts);
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: CANVAS_W,
  height: CANVAS_H,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  // LoginScene renders real <input> elements through a Phaser DOM container.
  dom: { createContainer: true },
  // Phase 8A: top-down spatial scenes (Sanctum / Overworld) use Arcade Physics
  // with zero gravity for movement + tile-wall collision. Battle scenes ignore it.
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  // Disable bilinear interpolation so pixel-art sprites stay crisp at any integer scale.
  render: { pixelArt: true },
  // EPIC #264 / #266 — the hold-cross-tap double-attack gesture needs two
  // SIMULTANEOUS touch points (hold one A-card, tap the other), so reserve enough
  // active pointers for genuine two-finger multitouch (default is 1 touch pointer).
  input: { activePointers: 3 },
  // BootScene must stay first (it routes by auth state). LoginScene/CampScene
  // are the new auth flow; Encounter/Lobby/Battle are unchanged.
  // ForestScene (8E.1, the BaseBiomeScene-driven multi-screen Forest region,
  // formerly OverworldScene + HiddenForestScene) follows CampScene and does NOT
  // auto-start (reached via the Sanctum exit door / scene.start). SwampScene
  // (8E.4) is also a BaseBiomeScene subclass, reached via the Forest biome_exit /
  // teleport, and never auto-starts. BootScene stays first (routes by auth).
  scene: [
    BootScene,
    LoginScene,
    CampScene,
    ForestScene,
    SwampScene,
    SnowScene,
    EncounterScene,
    LobbyScene,
    BattleScene,
  ],
});

window.__game = game;
