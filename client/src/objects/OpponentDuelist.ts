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
// thumb is a passive staked ring and is excluded from ATK/DEF totals).
const ATTACK_SLOTS = ['a1', 'a2'] as const;
const DEFENSE_SLOTS = ['d1', 'd2'] as const;

// GDD §7.2 status badges — index-aligned with GAUGE_KEYS / GAUGE_ELEMENTS.
const STATUS_BADGES = ['🔥 BURN', '💧 DROWN', '🌿 TANGLE'];

/**
 * Partial-information panel for the opponent. Shows hearts, ATK and DEF
 * totals across non-extinguished rings, and five element dots that light up
 * only for elements the opponent has revealed (by attacking or defending).
 * A colored overlay appears when any of the opponent's gauges reaches the
 * status threshold. A thumb card (always visible element per GDD §9) shows
 * the staked ring's element and dims when passively exhausted.
 */
export class OpponentDuelist extends Phaser.GameObjects.Container {
  private readonly heartsText: Phaser.GameObjects.Text;
  private readonly atkText: Phaser.GameObjects.Text;
  private readonly defText: Phaser.GameObjects.Text;
  private readonly elementDots: Phaser.GameObjects.Arc[] = [];
  private readonly statusOverlay: Phaser.GameObjects.Rectangle;
  private readonly statusBadge: Phaser.GameObjects.Text;
  private readonly thumbCard: Phaser.GameObjects.Rectangle;
  private readonly thumbDimOverlay: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    super(scene, OPPONENT_X, OPPONENT_Y);

    // All children use container-local coordinates relative to the container
    // origin at (OPPONENT_X, OPPONENT_Y), so scene offsets become local offsets.
    const panel = scene.add.rectangle(0, 0, 80, 120, 0x444444).setStrokeStyle(2, 0x888888);

    this.heartsText = scene.add.text(-90, -55, '♥♥♥', {
      fontSize: '14px',
      color: '#ff4444',
    });
    this.atkText = scene.add.text(-90, -35, 'ATK: ?', {
      fontSize: '12px',
      color: '#ff8888',
    });
    this.defText = scene.add.text(-90, -20, 'DEF: ?', {
      fontSize: '12px',
      color: '#88aaff',
    });

    // Five element dots: gray = unrevealed, colored = revealed.
    for (let i = 0; i < 5; i++) {
      const dot = scene.add.circle(-90 + i * 14, -2, 5, 0x555555);
      this.elementDots.push(dot);
    }

    this.statusOverlay = scene.add.rectangle(0, 0, 80, 120, 0xff0000, 0.3);
    this.statusOverlay.setVisible(false);

    // Active-status badge line — lists the opponent's active statuses by name.
    this.statusBadge = scene.add.text(-90, 8, '', {
      fontSize: '11px',
      color: '#ffaa44',
      fontStyle: 'bold',
    });

    // Thumb card — element always visible per GDD §9 (staked ring shows its
    // jewelry position). Dim overlay signals passive exhaustion.
    this.thumbCard = scene.add.rectangle(-90, 20, 40, 56, 0x555555);
    this.thumbCard.setStrokeStyle(1, 0xaa8800);
    const thumbLbl = scene.add
      .text(-90, 45, 'THUMB', { fontSize: '8px', color: '#ffcc44' })
      .setOrigin(0.5);

    this.thumbDimOverlay = scene.add.rectangle(-90, 20, 40, 56, 0x000000, 0.6);
    this.thumbDimOverlay.setVisible(false);

    // Parent every child to the container so the whole panel moves/depth-sorts
    // as one unit. statusOverlay is added after the panel/labels so it tints on
    // top, and the thumb dim overlay sits above the thumb card.
    this.add([
      panel,
      this.heartsText,
      this.atkText,
      this.defText,
      ...this.elementDots,
      this.statusOverlay,
      this.statusBadge,
      this.thumbCard,
      thumbLbl,
      this.thumbDimOverlay,
    ]);

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

    // ATK total = sum of non-extinguished attack slot uses.
    let atkTotal = 0;
    for (const key of ATTACK_SLOTS) {
      const ring = opp[key];
      if (ring && !ring.isExtinguished) atkTotal += ring.currentUses;
    }
    this.atkText.setText(`ATK: ${atkTotal}`);

    // DEF total = sum of non-extinguished defense slot uses.
    let defTotal = 0;
    for (const key of DEFENSE_SLOTS) {
      const ring = opp[key];
      if (ring && !ring.isExtinguished) defTotal += ring.currentUses;
    }
    this.defText.setText(`DEF: ${defTotal}`);

    // Element dots: only color base elements that have been revealed.
    for (let el = 0; el < 5; el++) {
      this.elementDots[el].setFillStyle(revealedElements.has(el) ? ELEMENT_COLORS[el] : 0x555555);
    }

    // Status overlay: first triangle gauge at/above threshold tints the panel.
    // The badge line names every active status (a player can stack multiple).
    let activeEl = -1;
    const activeBadges: string[] = [];
    for (let i = 0; i < GAUGE_KEYS.length; i++) {
      if ((opp[GAUGE_KEYS[i]] ?? 0) >= GAUGE_THRESHOLD) {
        if (activeEl < 0) activeEl = GAUGE_ELEMENTS[i];
        activeBadges.push(STATUS_BADGES[i]);
      }
    }
    if (activeEl >= 0) {
      this.statusOverlay.setFillStyle(ELEMENT_COLORS[activeEl], 0.3);
      this.statusOverlay.setVisible(true);
    } else {
      this.statusOverlay.setVisible(false);
    }
    this.statusBadge.setText(activeBadges.join('  '));

    // Thumb card: element always visible (per GDD §9). Dim when extinguished.
    const thumb = opp.thumb;
    if (thumb) {
      this.thumbCard.setFillStyle(ELEMENT_COLORS[thumb.element] ?? 0x555555);
      this.thumbDimOverlay.setVisible(!!thumb.isExtinguished);
    }
  }
}
