import Phaser from 'phaser';

/** Entry scene. No assets to preload (Phase 2+ uses primitive shapes), so it
 *  immediately hands off to the EncounterScene hub. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.scene.start('EncounterScene');
  }
}
