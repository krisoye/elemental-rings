import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BattleScene } from './scenes/BattleScene';
import type { ExchangeResultPayload } from '../../shared/types';
import { CANVAS_W, CANVAS_H } from './Constants';

declare global {
  interface Window {
    __game: Phaser.Game;
    __room: import('@colyseus/sdk').Room<any> | null;
    __scene: BattleScene | null;
    __lastExchangeResult: ExchangeResultPayload | null;
    __slotPositions: { x: number; y: number }[];
    __orbLaunchCount: number;
    connectToRoom: () => Promise<void>;
  }
}

// Expose globals BEFORE any scene runs so the E2E harness has stable hooks.
window.__room = null;
window.__scene = null;
window.__lastExchangeResult = null;
window.__slotPositions = [];
window.__orbLaunchCount = 0;
window.connectToRoom = async () => {
  const { joinOrCreate } = await import('./net/Connection');
  await joinOrCreate();
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: CANVAS_W,
  height: CANVAS_H,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  scene: [BootScene, LobbyScene, BattleScene],
});

window.__game = game;
