import Phaser from 'phaser';
import {
  ELEMENT_COLORS,
  ELEMENT_NAMES,
  GAUGE_THRESHOLD,
  GAUGE_ELEMENTS,
  GAUGE_KEYS,
  PLAYER_X,
  PLAYER_Y,
} from '../Constants';

/**
 * Full-information panel for the local player: body, hearts, and the three
 * triangle-element gauges (Fire, Water, Wood) with their numeric values. A `!`
 * suffix marks a gauge that has reached the GDD §6.1 status threshold. Wind and
 * Earth have no gauge (GDD §7.1).
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

    GAUGE_ELEMENTS.forEach((el, i) => {
      const gt = scene.add.text(PLAYER_X + 50, PLAYER_Y - 35 + i * 18, `${ELEMENT_NAMES[el]}: 0`, {
        fontSize: '11px',
        color: `#${ELEMENT_COLORS[el].toString(16).padStart(6, '0')}`,
      });
      this.gaugeTexts.push(gt);
    });

    scene.add.existing(this);
  }

  /** Sync hearts and gauges to the local player's PlayerState. */
  updateFromState(playerState: any): void {
    if (!playerState) return;
    const hearts = playerState.hearts ?? 0;
    this.hearts.setText('♥'.repeat(hearts) + '♡'.repeat(Math.max(0, 3 - hearts)));

    GAUGE_KEYS.forEach((key, i) => {
      const val = playerState[key] ?? 0;
      const active = val >= GAUGE_THRESHOLD;
      const el = GAUGE_ELEMENTS[i];
      this.gaugeTexts[i].setText(`${ELEMENT_NAMES[el]}: ${val}${active ? '!' : ''}`);
    });
  }
}
