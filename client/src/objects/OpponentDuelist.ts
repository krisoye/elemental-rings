import Phaser from 'phaser';
import {
  ELEMENT_COLORS,
  GAUGE_THRESHOLD,
  GAUGE_ELEMENTS,
  GAUGE_KEYS,
  OPPONENT_X,
  OPPONENT_Y,
} from '../Constants';
import { charsetFrame } from './world/charset';
import { FusedCardFill } from './fusedFill';
import { STATUS_BADGES, heartsString } from './ui/format';

// Combat slots whose remaining uses count toward the opponent's aggregate (the
// thumb is a passive staked ring and is excluded from ATK/DEF totals).
const ATTACK_SLOTS = ['a1', 'a2'] as const;
const DEFENSE_SLOTS = ['d1', 'd2'] as const;

// GDD §7.2 status badges (STATUS_BADGES) are shared with PlayerDuelist via
// ui/format.ts — the canonical {label,color}[] table. This panel uses only `.label`.

/**
 * Partial-information panel for the opponent. Shows hearts, ATK and DEF
 * totals across non-extinguished rings, and five element dots that light up
 * only for elements the opponent has revealed (by attacking or defending).
 * A colored overlay appears when any of the opponent's gauges reaches the
 * status threshold. A thumb card (always visible element per GDD §9) shows
 * the staked ring's element and dims when passively exhausted.
 */
/**
 * Maps the overworld spriteFrame index (0–4 = elements, 5–11 = human duelists)
 * to a Phaser texture key pre-loaded in BattleScene.preload().
 * Frames 0–4 use the element-matched monster battler_front sprites; frames 5–11
 * use the charset_a1 spritesheet at the character index for that duelist slot.
 */
function battleTextureKey(spriteFrame: number, monsterTexKey?: string): string {
  // 0=FIRE, 1=WATER, 2=EARTH, 3=WIND, 4=WOOD — caller passes the pre-resolved
  // variant key (e.g. "battle-monster-0-3"); fall back to index-0 if absent.
  if (spriteFrame <= 4) return monsterTexKey ?? `battle-monster-${spriteFrame}-0`;
  // Frames 5–11 are human charset duelists — use charset character index (spriteFrame-5).
  return 'battle-charset';
}

export class OpponentDuelist extends Phaser.GameObjects.Container {
  private readonly heartsText: Phaser.GameObjects.Text;
  private readonly atkText: Phaser.GameObjects.Text;
  private readonly defText: Phaser.GameObjects.Text;
  // #313 — opponent spirit (recharge fuel) readout. Shown only for AI duels
  // (broadcast spiritMax > 0); PvP human opponents broadcast spiritMax === 0 so
  // this stays hidden, preserving PvP recharge-fuel privacy.
  private readonly spiritText: Phaser.GameObjects.Text;
  private readonly elementDots: Phaser.GameObjects.Arc[] = [];
  private readonly statusOverlay: Phaser.GameObjects.Rectangle;
  private readonly statusBadge: Phaser.GameObjects.Text;
  private readonly thumbCard: Phaser.GameObjects.Rectangle;
  // #263 — two-tone fused fill for the opponent's staked thumb card.
  private readonly thumbFill: FusedCardFill;
  private readonly thumbDimOverlay: Phaser.GameObjects.Rectangle;
  // #259 — the opponent battle sprite, tinted red + pulsed once on boss enrage.
  private readonly spriteImg: Phaser.GameObjects.Image;
  /** #259 — true once the enrage tint/pulse has been applied (one-shot). */
  private enrageShown = false;

  constructor(scene: Phaser.Scene, spriteFrame = 0, monsterTexKey?: string) {
    super(scene, OPPONENT_X, OPPONENT_Y);

    // ── Sprite area (top of panel) ──────────────────────────────────────────
    // Monster battler sprites are 80×80 px — displayed at native size.
    // Human duelist sprites use the charset_a1 sheet (16×32 px per frame)
    // scaled 3× so they read clearly at battle zoom.
    const texKey = battleTextureKey(spriteFrame, monsterTexKey);
    let spriteImg: Phaser.GameObjects.Image;
    if (spriteFrame <= 4) {
      // Monster: 80×80 battler_front at native size, centered above stats.
      spriteImg = scene.add.image(0, -80, texKey).setOrigin(0.5, 0.5);
    } else {
      // Human duelist: charset front-facing idle frame (col 1, direction down),
      // character index = spriteFrame - 5 (maps 5→0, 6→1, … 11→6).
      const charIdx = spriteFrame - 5;
      const idleFrame = charsetFrame(charIdx, 'down', 1);
      spriteImg = scene.add
        .image(0, -72, texKey, idleFrame)
        .setScale(2)
        .setOrigin(0.5, 0.5);
    }
    this.spriteImg = spriteImg;

    // Semi-transparent panel behind the stats text (shrunken to stats area only)
    const panel = scene.add.rectangle(0, 0, 80, 40, 0x444444, 0.8).setStrokeStyle(1, 0x888888);

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
    // #313 — opponent spirit readout (⚡ current/max), mirroring the local Hud
    // gauge format/colors. Placed in the right column of the stats panel; hidden
    // until updateFromState() confirms spiritMax > 0 (AI duels only).
    this.spiritText = scene.add
      .text(10, -55, '', {
        fontSize: '12px',
        color: '#ffffff',
      })
      .setVisible(false);

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
      spriteImg,
      panel,
      this.heartsText,
      this.atkText,
      this.defText,
      this.spiritText,
      ...this.elementDots,
      this.statusOverlay,
      this.statusBadge,
      this.thumbCard,
    ]);
    // #263 — two-tone fill above thumbCard (which keeps the stroke), below the
    // THUMB label + dim overlay so both render on top.
    this.thumbFill = new FusedCardFill(this.scene, this, -90, 20, 40, 56);
    this.add([thumbLbl, this.thumbDimOverlay]);

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
    this.heartsText.setText(heartsString(hearts));

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

    // #313 — opponent spirit (recharge fuel). Shown only when spiritMax > 0,
    // which holds for AI duels (the server seeds the AI seat's finite pool) and
    // never for PvP humans (their broadcast spiritMax stays 0). Mirrors the local
    // Hud gauge: red when fully depleted, white otherwise.
    const spiritMax = (opp.spiritMax as number) ?? 0;
    if (spiritMax > 0) {
      const spiritCurrent = (opp.spiritCurrent as number) ?? 0;
      this.spiritText.setText(`⚡ ${spiritCurrent}/${spiritMax}`);
      this.spiritText.setColor(spiritCurrent === 0 ? '#ff4444' : '#ffffff');
      this.spiritText.setVisible(true);
    } else {
      this.spiritText.setVisible(false);
    }

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
        activeBadges.push(STATUS_BADGES[i].label);
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
      // #263 — two-tone fill from the broadcast dominant-first fusionParents
      // (index 0 = top/left). Boss fused thumbs have no parent XP, so the server
      // pushes the static componentsOf order; base thumbs render a single fill.
      this.thumbCard.setFillStyle(0x555555);
      const ordered = thumb.fusionParents
        ? Array.from(thumb.fusionParents as ArrayLike<number>)
        : undefined;
      this.thumbFill.paint(thumb.element, ordered);
      this.thumbDimOverlay.setVisible(!!thumb.isExtinguished);
    }

    // #259 — boss enrage (phase-2): the first time the broadcast `enraged` flag is
    // true, red-tint the opponent sprite and pulse it once. One-shot — guarded by
    // enrageShown so repeated patches do not re-pulse. Presentation only; the
    // server owns the actual difficulty change.
    if (opp.enraged && !this.enrageShown) {
      this.enrageShown = true;
      this.spriteImg.setTint(0xff5555);
      this.scene.tweens.add({
        targets: this.spriteImg,
        scale: this.spriteImg.scale * 1.25,
        duration: 180,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
    }
  }

  /**
   * #313 — the RENDERED opponent spirit readout (current/max, without the ⚡
   * prefix), or undefined when the readout is hidden (PvP / non-finite pool).
   * Mirrors Hud.displayedSpirit so BattleScene.publishHudView can surface it for
   * E2E without reading pixels.
   */
  get displayedSpirit(): string | undefined {
    return this.spiritText.visible ? this.spiritText.text.replace('⚡ ', '') : undefined;
  }
}
