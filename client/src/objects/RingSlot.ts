import Phaser from 'phaser';
import { ELEMENT_NAMES } from '../Constants';
import { FusedCardFill } from './fusedFill';

// Card dimensions. Height raised to 90px to fit five rows (slot label /
// element name / tier / xp / use pips) without overlap.
const CARD_W = 58;
const CARD_H = 90;

/**
 * One named ring-slot card (Thumb / A1 / A2 / D1 / D2). Renders the slot label,
 * the equipped ring's element color + name, tier, XP, use pips, a dim overlay
 * when the ring is extinguished, and an active highlight when its group is live
 * for the phase. Purely presentational — driven by the server's Ring schema.
 * Stat layout mirrors the Sanctum InventoryGrid / Manage Battle Hand tiles so a
 * ring card looks identical across BattleScene, CampScene, and the modal.
 */
export class RingSlot extends Phaser.GameObjects.Container {
  public readonly bg: Phaser.GameObjects.Rectangle;
  private readonly slotLabel: Phaser.GameObjects.Text;
  private readonly elementLabel: Phaser.GameObjects.Text;
  private readonly tierText: Phaser.GameObjects.Text;
  private readonly xpText: Phaser.GameObjects.Text;
  private readonly usesText: Phaser.GameObjects.Text;
  private readonly dimOverlay: Phaser.GameObjects.Rectangle;
  private readonly fusedFill: FusedCardFill;
  private _element = 0;
  private _isExtinguished = false;
  // #135 Blinded — when true, the use-count row renders `?` instead of pips (the
  // local Blinded player can no longer read this ring's remaining uses).
  private _usesHidden = false;
  private _lastRing: { currentUses: number; maxUses: number } | null = null;
  // EPIC #264 / #266 — double-attack eligibility cue. A soft glow outline shown on
  // A1/A2 when the local hand satisfies canDoubleAttack, signalling the hold-cross
  // -tap combo is available. Presentational only; the server is authoritative.
  private comboGlow: Phaser.GameObjects.Rectangle | null = null;
  private comboGlowTween: Phaser.Tweens.Tween | null = null;
  private _comboEligible = false;

  constructor(scene: Phaser.Scene, x: number, y: number, slotName: string) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x333333).setStrokeStyle(2, 0x888888);
    this.add(this.bg);
    // #263 — two-tone fill sits ON TOP of bg (which keeps the stroke/hit area)
    // and BELOW the labels added next. Centered on the card origin (0,0).
    this.fusedFill = new FusedCardFill(scene, this, 0, 0, CARD_W, CARD_H);
    // Five stacked rows within the −45..+45 card range.
    this.slotLabel = scene.add
      .text(0, -36, slotName, { fontSize: '9px', color: '#cccccc' })
      .setOrigin(0.5);
    this.elementLabel = scene.add
      .text(0, -20, '', { fontSize: '9px', color: '#ffffff' })
      .setOrigin(0.5);
    this.tierText = scene.add
      .text(0, -6, '', { fontSize: '9px', color: '#ffffff' })
      .setOrigin(0.5);
    this.xpText = scene.add
      .text(0, 8, '', { fontSize: '9px', color: '#ffffff' })
      .setOrigin(0.5);
    this.usesText = scene.add
      .text(0, 26, '', { fontSize: '12px', color: '#ffff88' })
      .setOrigin(0.5);
    this.dimOverlay = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x000000, 0.6);
    this.dimOverlay.setVisible(false);
    this.add([
      this.slotLabel,
      this.elementLabel,
      this.tierText,
      this.xpText,
      this.usesText,
      this.dimOverlay,
    ]);
    scene.add.existing(this);
  }

  /** Sync the card to a server-side Ring schema object. */
  updateFromRing(ring: any): void {
    this._element = ring.element;
    this._isExtinguished = ring.isExtinguished;
    this._lastRing = { currentUses: ring.currentUses, maxUses: ring.maxUses };
    // #263 — two-tone fill from the ring's dominant-first fusionParents (the
    // server's broadcast ArraySchema, index 0 = top/left). A base ring renders a
    // single fill; a fusion with no broadcast order falls back to static order.
    const ordered = ring.fusionParents
      ? Array.from(ring.fusionParents as ArrayLike<number>)
      : undefined;
    this.fusedFill.paint(ring.element, ordered);
    this.elementLabel.setText(ELEMENT_NAMES[ring.element] ?? '?');
    this.tierText.setText(`T${ring.tier}`);
    this.xpText.setText(`Xp: ${ring.xp}`);
    this.renderUses();
    this.dimOverlay.setVisible(ring.isExtinguished);
  }

  /**
   * #135 Blinded — hide or reveal this slot's use count. When hidden the row shows
   * `?`; when revealed it restores the real pips from the last known ring state.
   * Idempotent; safe to call every state render.
   */
  setUsesHidden(hidden: boolean): void {
    if (this._usesHidden === hidden) return;
    this._usesHidden = hidden;
    this.renderUses();
  }

  /** Render the use-count row, honoring the Blinded `?` substitution. */
  private renderUses(): void {
    if (this._usesHidden) {
      this.usesText.setText('?');
      return;
    }
    const r = this._lastRing;
    if (!r) return;
    const used = r.maxUses - r.currentUses;
    this.usesText.setText('●'.repeat(r.currentUses) + '○'.repeat(Math.max(0, used)));
  }

  /** Highlight (or dim) this slot depending on whether its group is active. */
  setActiveGroup(active: boolean): void {
    this.bg.setStrokeStyle(active ? 3 : 2, active ? 0xffff66 : 0x888888);
  }

  /**
   * EPIC #264 / #266 — toggle the double-attack eligibility glow on this slot.
   * When eligible, a cyan outline pulses behind the card so the player sees the
   * hold-cross-tap combo is available; when not, it is torn down. Idempotent.
   */
  setComboEligible(eligible: boolean): void {
    if (this._comboEligible === eligible) return;
    this._comboEligible = eligible;
    if (eligible) {
      if (!this.comboGlow) {
        this.comboGlow = this.scene.add
          .rectangle(0, 0, CARD_W + 8, CARD_H + 8)
          .setStrokeStyle(3, 0x44eeff, 0.9);
        // Behind the card body but inside this container.
        this.addAt(this.comboGlow, 0);
        this.comboGlowTween = this.scene.tweens.add({
          targets: this.comboGlow,
          alpha: { from: 0.35, to: 1 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      this.comboGlow.setVisible(true);
    } else {
      this.comboGlowTween?.remove();
      this.comboGlowTween = null;
      this.comboGlow?.destroy();
      this.comboGlow = null;
    }
  }

  /** Whether the double-attack eligibility cue is currently shown (for E2E). */
  get comboEligible(): boolean {
    return this._comboEligible;
  }

  /** The currently-rendered use-count string (`?` when Blinded). For E2E. */
  get displayedUses(): string {
    return this.usesText.text;
  }

  get element(): number {
    return this._element;
  }

  get isExtinguished(): boolean {
    return this._isExtinguished;
  }
}
