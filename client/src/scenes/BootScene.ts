import Phaser from 'phaser';
import { getToken } from '../net/api';

/** Entry scene. No assets to preload (Phase 2+ uses primitive shapes), so it
 *  immediately routes by auth state: a stored token skips straight to CampScene,
 *  otherwise the player must authenticate via LoginScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    const token = getToken();
    if (token) this.scene.start('CampScene');
    else this.scene.start('LoginScene');
  }
}
