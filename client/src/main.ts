import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LoginScene } from './scenes/LoginScene';
import { CampScene } from './scenes/CampScene';
import { EncounterScene } from './scenes/EncounterScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BattleScene } from './scenes/BattleScene';
import type { ExchangeResultPayload, AIPersonality, BattleRoomOptions } from '../../shared/types';
import { CANVAS_W, CANVAS_H } from './Constants';

declare global {
  interface Window {
    __game: Phaser.Game;
    __room: import('@colyseus/sdk').Room<any> | null;
    __scene: Phaser.Scene | null;
    __lastExchangeResult: ExchangeResultPayload | null;
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
    __campGoEncounter?: () => void;
    __campSleep?: () => void;
    __campRecharge?: (ringId: string) => Promise<void>;
    __campRechargeAll?: () => Promise<void>;
    // #40 carry hooks — deterministic code paths for E2E.
    __campAddToLoadout?: (ringId: string) => Promise<void>;
    __campLeaveAtSanctum?: (ringId: string) => Promise<void>;
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
    // Post-battle won-ring prompt now lives in EncounterScene (the post-battle
    // destination). Resolve via 'add' | 'leave' | 'discard', with an optional
    // ring id to displace when carry is full ('add' swap case).
    __encounterResolveWonRing?: (
      choice: 'add' | 'leave' | 'discard',
      displaceRingId?: string,
    ) => void;
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
  // BootScene must stay first (it routes by auth state). LoginScene/CampScene
  // are the new auth flow; Encounter/Lobby/Battle are unchanged.
  scene: [BootScene, LoginScene, CampScene, EncounterScene, LobbyScene, BattleScene],
});

window.__game = game;
