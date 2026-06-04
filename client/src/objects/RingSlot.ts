import Phaser from 'phaser';
import { RingCard, usePips } from './ui/RingCard';

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
 *
 * The shared card body (bg + fused fill + element/pips/xp/tier rows + selection
 * stroke) lives in {@link RingCard}; this slot adds its slot label, dim overlay,
 * Blinded `?` substitution, and the double-attack combo glow.
 */
export class RingSlot extends Phaser.GameObjects.Container {
  public readonly bg: Phaser.GameObjects.Rectangle;
  private readonly card: RingCard;
  private readonly slotLabel: Phaser.GameObjects.Text;
  private readonly dimOverlay: Phaser.GameObjects.Rectangle;
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
    // Shared card body. Rows: element (−20), xp (8), use pips (26, yellow). #389
    // dropped the Tier row from RingCard. The slot label + dim overlay are added
    // on top below.
    this.card = new RingCard(scene, 0, 0, {
      width: CARD_W,
      height: CARD_H,
      textColor: '#ffffff',
      pipsColor: '#ffff88',
      pipsFontSize: '12px',
      elementY: -20,
      xpY: 8,
      pipsY: 26,
      xpPrefix: 'Xp: ',
    });
    this.add(this.card);
    this.bg = this.card.bg;
    // Five stacked rows within the −45..+45 card range; the slot label is the
    // top row above the shared card body.
    this.slotLabel = scene.add
      .text(0, -36, slotName, { fontSize: '9px', color: '#cccccc' })
      .setOrigin(0.5);
    this.dimOverlay = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x000000, 0.6);
    this.dimOverlay.setVisible(false);
    this.add([this.slotLabel, this.dimOverlay]);
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
    this.card.setRing({
      element: ring.element,
      tier: ring.tier,
      xp: ring.xp,
      currentUses: ring.currentUses,
      maxUses: ring.maxUses,
      fusionParents: ordered,
    });
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
      this.card.setPipsText('?');
      return;
    }
    const r = this._lastRing;
    if (!r) return;
    this.card.setPipsText(usePips(r.currentUses, r.maxUses));
  }

  /** Highlight (or dim) this slot depending on whether its group is active. */
  setActiveGroup(active: boolean): void {
    this.card.setStroke(active ? 3 : 2, active ? 0xffff66 : 0x888888);
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
    return this.card.pipsText;
  }

  get element(): number {
    return this._element;
  }

  get isExtinguished(): boolean {
    return this._isExtinguished;
  }
}
