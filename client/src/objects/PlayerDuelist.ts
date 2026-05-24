import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES, GAUGE_THRESHOLD, PLAYER_X, PLAYER_Y } from '../Constants';

/**
 * Full-information panel for the local player: body, hearts, and the five
 * elemental gauges with their numeric values. A `!` suffix marks a gauge that
 * has reached the GDD §6.1 status threshold.
 */
export class PlayerDuelist extends Phaser.GameObjects.Container {
  private readonly hearts: Phaser.GameObjects.Text;
  private readonly gaugeTexts: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, PLAYER_X, PLAYER_Y);
    scene.add.rectangle(PLAYER_X, PLAYER_Y, 80, 120, 0x444444).setStrokeStyle(2, 0x888888);

    this.hearts = scene.add.text(PLAYER_X + 50, PLAYER_Y - 55, '♥♥♥', {
      fontSize: '14px',
      color: '#ff4444',
    });

    for (let i = 0; i < 5; i++) {
      const gt = scene.add.text(PLAYER_X + 50, PLAYER_Y - 35 + i * 18, `${ELEMENT_NAMES[i]}: 0`, {
        fontSize: '11px',
        color: `#${ELEMENT_COLORS[i].toString(16).padStart(6, '0')}`,
      });
      this.gaugeTexts.push(gt);
    }

    scene.add.existing(this);
  }

  /** Sync hearts and gauges to the local player's PlayerState. */
  updateFromState(playerState: any): void {
    if (!playerState) return;
    const hearts = playerState.hearts ?? 0;
    this.hearts.setText('♥'.repeat(hearts) + '♡'.repeat(Math.max(0, 3 - hearts)));

    const gaugeKeys = ['fireGauge', 'waterGauge', 'earthGauge', 'windGauge', 'woodGauge'];
    gaugeKeys.forEach((key, i) => {
      const val = playerState[key] ?? 0;
      const active = val >= GAUGE_THRESHOLD;
      this.gaugeTexts[i].setText(`${ELEMENT_NAMES[i]}: ${val}${active ? '!' : ''}`);
    });
  }
}
