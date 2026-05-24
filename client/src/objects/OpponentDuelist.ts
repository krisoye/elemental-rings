import Phaser from 'phaser';
import {
  ELEMENT_COLORS,
  GAUGE_THRESHOLD,
  GAUGE_ELEMENTS,
  GAUGE_KEYS,
  OPPONENT_X,
  OPPONENT_Y,
} from '../Constants';

// Combat slots whose remaining uses count toward the opponent's aggregate (the
// thumb is a passive staked ring and is excluded).
const COMBAT_SLOTS = ['a1', 'a2', 'd1', 'd2'] as const;

/**
 * Partial-information panel for the opponent. Shows hearts, aggregate remaining
 * uses across non-extinguished rings, and five element dots that light up only
 * for elements the opponent has revealed (by attacking or defending with them).
 * A colored overlay appears when any of the opponent's gauges reaches the status
 * threshold. The opponent's exact hand composition stays hidden.
 */
export class OpponentDuelist extends Phaser.GameObjects.Container {
  private readonly heartsText: Phaser.GameObjects.Text;
  private readonly usesText: Phaser.GameObjects.Text;
  private readonly elementDots: Phaser.GameObjects.Arc[] = [];
  private readonly statusOverlay: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    super(scene, OPPONENT_X, OPPONENT_Y);
    scene.add.rectangle(OPPONENT_X, OPPONENT_Y, 80, 120, 0x444444).setStrokeStyle(2, 0x888888);

    this.heartsText = scene.add.text(OPPONENT_X - 90, OPPONENT_Y - 55, '♥♥♥', {
      fontSize: '14px',
      color: '#ff4444',
    });
    this.usesText = scene.add.text(OPPONENT_X - 90, OPPONENT_Y - 35, 'Uses: ?', {
      fontSize: '12px',
      color: '#ffffff',
    });

    // Five element dots: gray = unrevealed, colored = revealed.
    for (let i = 0; i < 5; i++) {
      const dot = scene.add.circle(OPPONENT_X - 90 + i * 14, OPPONENT_Y - 10, 5, 0x555555);
      this.elementDots.push(dot);
    }

    this.statusOverlay = scene.add.rectangle(OPPONENT_X, OPPONENT_Y, 80, 120, 0xff0000, 0.3);
    this.statusOverlay.setVisible(false);

    scene.add.existing(this);
  }

  /**
   * Sync the opponent panel from broadcast state.
   * @param revealedElements element indices the opponent has shown this duel.
   */
  updateFromState(state: any, myId: string, revealedElements: Set<number>): void {
    const ids = Array.from(state.players.keys()).filter((id: any) => id !== myId) as string[];
    if (ids.length === 0) return;
    const opp = state.players.get(ids[0]);
    if (!opp) return;

    const hearts = opp.hearts ?? 0;
    this.heartsText.setText('♥'.repeat(hearts) + '♡'.repeat(Math.max(0, 3 - hearts)));

    // Aggregate remaining uses across the four non-extinguished combat slots.
    let totalUses = 0;
    for (const key of COMBAT_SLOTS) {
      const ring = opp[key];
      if (ring && !ring.isExtinguished) totalUses += ring.currentUses;
    }
    this.usesText.setText(`Uses: ${totalUses}`);

    // Element dots: only color base elements that have been revealed.
    for (let el = 0; el < 5; el++) {
      this.elementDots[el].setFillStyle(revealedElements.has(el) ? ELEMENT_COLORS[el] : 0x555555);
    }

    // Status overlay: first triangle gauge at/above threshold tints the panel.
    let activeEl = -1;
    for (let i = 0; i < GAUGE_KEYS.length; i++) {
      if ((opp[GAUGE_KEYS[i]] ?? 0) >= GAUGE_THRESHOLD) {
        activeEl = GAUGE_ELEMENTS[i];
        break;
      }
    }
    if (activeEl >= 0) {
      this.statusOverlay.setFillStyle(ELEMENT_COLORS[activeEl], 0.3);
      this.statusOverlay.setVisible(true);
    } else {
      this.statusOverlay.setVisible(false);
    }
  }
}
