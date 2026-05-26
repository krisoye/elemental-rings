import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LoginScene } from './scenes/LoginScene';
import { CampScene } from './scenes/CampScene';
import { OverworldScene } from './scenes/OverworldScene';
import { EncounterScene } from './scenes/EncounterScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BattleScene } from './scenes/BattleScene';
import type {
  ExchangeResultPayload,
  AIPersonality,
  BattleRoomOptions,
  BattleSummaryPayload,
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
      anchor: string;
      waystones: Array<{
        id: string;
        name: string;
        xpThreshold: number;
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
    __slotPositions: { x: number; y: number }[];
    __orbLaunchCount: number;
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
    // #63 teleport hooks — open the teleport modal / travel to a waystone.
    __campOpenTeleport?: () => Promise<void>;
    __campTeleport?: (waystoneId: string) => Promise<void>;
    // Teleport modal snapshot (set by CampScene.openTeleportModal before render).
    __teleportState?: {
      anchor: string;
      rows: Array<{
        id: string;
        name: string;
        attuned: boolean;
        meetsThreshold: boolean;
        xpThreshold: number;
      }>;
    };
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
      loadout: any;
      // Carry pool separation for #40 assertions.
      atSanctum: any[];
      loadout_pool: any[];
      battleHand: any[];
      carry_cap: number;
      // #41 spirit/food snapshot.
      spirit_current: number;
      spirit_max: number;
      food_units: number;
      // XP-derived spirit: aggregate ring XP (spirit_max = SPIRIT_BASE + this).
      aggregate_xp: number;
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
  }
}

// Expose globals BEFORE any scene runs so the E2E harness has stable hooks.
window.__room = null;
window.__scene = null;
window.__lastExchangeResult = null;
window.__lastBattleSummary = null;
window.__slotPositions = [];
window.__orbLaunchCount = 0;
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
  // BootScene must stay first (it routes by auth state). LoginScene/CampScene
  // are the new auth flow; Encounter/Lobby/Battle are unchanged.
  // OverworldScene follows CampScene and does NOT auto-start (reached via the
  // Sanctum exit door / scene.start). BootScene stays first (routes by auth).
  scene: [BootScene, LoginScene, CampScene, OverworldScene, EncounterScene, LobbyScene, BattleScene],
});

window.__game = game;
