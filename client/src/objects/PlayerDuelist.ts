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
// GDD §7.2 status badges — one per triangle gauge. Derived from broadcast gauges
// (gauge ≥ GAUGE_THRESHOLD ⇒ status active). Order matches GAUGE_KEYS / GAUGE_ELEMENTS.
const STATUS_BADGES: { label: string; color: string }[] = [
  { label: '🔥 BURN', color: '#ff6644' }, // fireGauge → Burning
  { label: '💧 DROWN', color: '#44aaff' }, // waterGauge → Drowning
  { label: '🌿 TANGLE', color: '#55cc44' }, // woodGauge → Entangled
];

export class PlayerDuelist extends Phaser.GameObjects.Container {
  private readonly hearts: Phaser.GameObjects.Text;
  private readonly gaugeTexts: Phaser.GameObjects.Text[] = [];
  private readonly statusBadge: Phaser.GameObjects.Text;

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

    // Active-status badge line beneath the gauges (e.g. "🔥 BURN  💧 DROWN").
    // Stacks all active statuses; empty when none are active.
    this.statusBadge = scene.add.text(PLAYER_X + 50, PLAYER_Y + 22, '', {
      fontSize: '11px',
      color: '#ffaa44',
      fontStyle: 'bold',
    });

    scene.add.existing(this);
  }

  /** Sync hearts, gauges, and status badges to the local player's PlayerState. */
  updateFromState(playerState: any): void {
    if (!playerState) return;
    const hearts = playerState.hearts ?? 0;
    this.hearts.setText('♥'.repeat(hearts) + '♡'.repeat(Math.max(0, 3 - hearts)));

    const active: string[] = [];
    GAUGE_KEYS.forEach((key, i) => {
      const val = playerState[key] ?? 0;
      const isActive = val >= GAUGE_THRESHOLD;
      const el = GAUGE_ELEMENTS[i];
      this.gaugeTexts[i].setText(`${ELEMENT_NAMES[el]}: ${val}${isActive ? '!' : ''}`);
      if (isActive) active.push(STATUS_BADGES[i].label);
    });
    this.statusBadge.setText(active.join('  '));
  }
}
