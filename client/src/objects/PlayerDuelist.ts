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
import { STATUS_BADGES, heartsString, cssColor } from './ui/format';

/**
 * Full-information panel for the local player: body, hearts, and the three
 * triangle-element gauges (Fire, Water, Wood) with their numeric values. A `!`
 * suffix marks a gauge that has reached the GDD §6.1 status threshold. Wind and
 * Earth have no gauge (GDD §7.1).
 */
// GDD §7.2 status badges (STATUS_BADGES) now live in ui/format.ts so the player
// and opponent panels share one canonical {label,color}[] table.

// SHADOW element index + its dark-purple swatch (mirrors server ElementEnum.SHADOW).
const SHADOW_ELEMENT = 15;
// #135 — Blinded hides own-HUD elements progressively by shadowGauge stack:
//   ≥1 A1, ≥2 A2, ≥3 D1, ≥4 D2, ≥5 hearts (GDD §7.2). Hearts handled here; the
//   four use counts are hidden in Hand/RingSlot keyed off the same gauge.
const BLINDED_HEARTS_AT = 5;

export class PlayerDuelist extends Phaser.GameObjects.Container {
  private readonly hearts: Phaser.GameObjects.Text;
  private readonly gaugeTexts: Phaser.GameObjects.Text[] = [];
  private readonly shadowGaugeText: Phaser.GameObjects.Text;
  private readonly statusBadge: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, PLAYER_X, PLAYER_Y);
    // Player battle sprite: character 0 (red-haired protagonist), front-facing
    // idle frame (row 0, col 1 in the 12-col charset sheet), scaled 4×.
    if (scene.textures.exists('battle-charset')) {
      scene.add.image(PLAYER_X, PLAYER_Y - 80, 'battle-charset', 1).setScale(4).setOrigin(0.5, 0.5);
    }
    // Compact stats panel beneath the sprite (height trimmed from 120 to 40).
    scene.add.rectangle(PLAYER_X, PLAYER_Y, 80, 40, 0x444444, 0.8).setStrokeStyle(1, 0x888888);

    this.hearts = scene.add.text(PLAYER_X + 50, PLAYER_Y - 55, '♥♥♥', {
      fontSize: '14px',
      color: '#ff4444',
    });

    GAUGE_ELEMENTS.forEach((el, i) => {
      const gt = scene.add.text(PLAYER_X + 50, PLAYER_Y - 35 + i * 18, `${ELEMENT_NAMES[el]}: 0`, {
        fontSize: '11px',
        color: cssColor(ELEMENT_COLORS[el]),
      });
      this.gaugeTexts.push(gt);
    });

    // #135 — the 4th (shadow) gauge bar, dark-purple, beneath the triangle three.
    // Hidden at shadowGauge 0; shown 1–5 when Shadow has been inflicted.
    this.shadowGaugeText = scene.add
      .text(PLAYER_X + 50, PLAYER_Y - 35 + GAUGE_ELEMENTS.length * 18, '', {
        fontSize: '11px',
        color: cssColor(ELEMENT_COLORS[SHADOW_ELEMENT]),
        fontStyle: 'bold',
      })
      .setVisible(false);

    // Active-status badge line beneath the gauges (e.g. "🔥 BURN  💧 DROWN").
    // Stacks all active statuses; empty when none are active.
    this.statusBadge = scene.add.text(PLAYER_X + 50, PLAYER_Y + 40, '', {
      fontSize: '11px',
      color: '#ffaa44',
      fontStyle: 'bold',
    });

    scene.add.existing(this);
  }

  /** Sync hearts, gauges, shadow gauge, and status badges to the local PlayerState. */
  updateFromState(playerState: any): void {
    if (!playerState) return;
    const hearts = playerState.hearts ?? 0;
    const shadowGauge = playerState.shadowGauge ?? 0;

    // #135 Blinded — at shadowGauge ≥ 5 the local player can no longer read their
    // own hearts (shown as `?`). Restores immediately when the gauge drops (e.g.
    // a parry clears it).
    if (shadowGauge >= BLINDED_HEARTS_AT) {
      this.hearts.setText('?');
    } else {
      this.hearts.setText(heartsString(hearts));
    }

    const active: string[] = [];
    GAUGE_KEYS.forEach((key, i) => {
      const val = playerState[key] ?? 0;
      // Status activates on the raw accumulated float (gauges are float32 since
      // #179); the HUD floors only for the integer display so fractional
      // tier-reduced deltas (e.g. 0.25 per Tier-2 block) never leak digits.
      const isActive = val >= GAUGE_THRESHOLD;
      const el = GAUGE_ELEMENTS[i];
      this.gaugeTexts[i].setText(`${ELEMENT_NAMES[el]}: ${Math.floor(val)}${isActive ? '!' : ''}`);
      if (isActive) active.push(STATUS_BADGES[i].label);
    });

    // Shadow gauge bar — visible only when inflicted (> 0). Blinded triggers at any
    // stack, so a `!` marks it active whenever shown.
    if (shadowGauge > 0) {
      this.shadowGaugeText.setText(`SHADOW: ${shadowGauge}!`).setVisible(true);
      active.push('🌑 BLIND');
    } else {
      this.shadowGaugeText.setVisible(false);
    }

    this.statusBadge.setText(active.join('  '));
  }

  /** The rendered hearts string (`?` when Blinded at shadowGauge ≥ 5). For E2E/#135. */
  get displayedHearts(): string {
    return this.hearts.text;
  }
}
