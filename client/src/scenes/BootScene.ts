import Phaser from 'phaser';

/** Entry scene. No assets to preload (Phase 2+ uses primitive shapes), so it
 *  immediately routes by auth state: a stored token skips straight to CampScene,
 *  otherwise the player must authenticate via LoginScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    const token = localStorage.getItem('er_token');
    if (token) this.scene.start('CampScene');
    else this.scene.start('LoginScene');
  }
}
