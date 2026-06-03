import Phaser from 'phaser';
import type { RingData } from './InventoryGrid';
import { RingCard } from './ui/RingCard';

const CARD_W = 70;
const CARD_H = 90;

/**
 * Displays the Thumb (staked) ring slot with escrow indicator. Clicking the
 * card fires `onAssign()` to trigger ring assignment. If the ring is escrowed,
 * `onEscrowed()` is called instead so the host can surface a status message.
 *
 * The shared card body (bg + fused fill + element/pips/xp/tier rows + selection
 * stroke) lives in {@link RingCard}; this panel adds the STATUS title (#347), the
 * escrow LOCKED label, and the "click to stake" hint.
 */
export class StakePanel extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly card: RingCard;
  private readonly titleLbl: Phaser.GameObjects.Text;
  private readonly lockLbl: Phaser.GameObjects.Text;
  private readonly hintLbl: Phaser.GameObjects.Text;

  private escrowed = false;
  // #154 — whether the Thumb is the active swap selection (yellow border). The
  // selection stroke overrides the normal/escrow stroke and survives refreshes.
  private selected = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onAssign: () => void,
    onEscrowed?: () => void,
  ) {
    super(scene, x, y);

    const cx = CARD_W / 2;
    const cy = CARD_H / 2;

    // Shared card body — camera-pinned (scrollFactor 0) so the hit area aligns
    // with the render position under camera scroll (#78 ①). Rows mirror the legacy
    // thumb layout: element (−22), use pips (−5), xp (12), tier (27).
    this.card = new RingCard(scene, 0, 0, {
      width: CARD_W,
      height: CARD_H,
      cx,
      cy,
      scrollFactor: 0,
      strokeColor: 0xaa8800,
      textColor: '#000000',
      fontSize: '9px',
      elementY: -22,
      pipsY: -5,
      xpY: 12,
      tierY: 27,
      xpPrefix: 'XP:',
    });
    this.add(this.card);
    this.bg = this.card.bg;

    // #347 — the Thumb slot is surfaced as STATUS across all screens for clarity.
    this.titleLbl = scene.add
      .text(cx, cy - 36, 'STATUS', { fontSize: '9px', color: '#ffcc44' })
      .setOrigin(0.5);

    this.lockLbl = scene.add
      .text(cx, cy + 41, '', { fontSize: '10px', color: '#ff6666' })
      .setOrigin(0.5);

    this.hintLbl = scene.add
      .text(cx, cy + 41, 'click to stake', { fontSize: '8px', color: '#666666' })
      .setOrigin(0.5);

    // The empty-slot element row is a dim em-dash until a ring is staked.
    this.card.setElementText('—', '#888888');

    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerdown', () => {
      if (this.escrowed) onEscrowed?.();
      else onAssign();
    });

    this.add([this.titleLbl, this.lockLbl, this.hintLbl]);
    scene.add.existing(this);
  }

  /**
   * EPIC #302 — the Thumb card's background rectangle (also its hit area). Exposed
   * so the host can attach a hover tooltip (the passive reminder) to it without
   * reaching into the private card body.
   */
  get thumbBg(): Phaser.GameObjects.Rectangle {
    return this.bg;
  }

  /**
   * Update the thumb card from the current loadout and ring map.
   * @param thumbRingId - the ring id assigned to thumb, or null
   * @param ringMap - ringId → RingData
   */
  updateFromLoadout(thumbRingId: string | null, ringMap: Map<string, RingData>): void {
    const ring = thumbRingId ? ringMap.get(thumbRingId) : null;

    if (ring) {
      this.card.setRing({
        element: ring.element,
        tier: ring.tier,
        xp: ring.xp,
        currentUses: ring.current_uses,
        maxUses: ring.max_uses,
        fusionParents: ring.fusionParents,
      });
      this.card.setTextColor('#000000');
      this.hintLbl.setText('');

      this.escrowed = ring.escrowed === 1;
      this.lockLbl.setText(this.escrowed ? 'LOCKED' : '');
    } else {
      this.escrowed = false;
      this.card.clear();
      this.card.setElementText('—', '#888888');
      this.lockLbl.setText('');
      this.hintLbl.setText('click to stake');
    }
    this.applyStroke();
  }

  /**
   * Highlight the Thumb card as the active swap selection (yellow border), or
   * clear it. The selection stroke overrides the normal/escrow stroke. #154.
   */
  setSelected(selected: boolean): void {
    this.selected = selected;
    this.applyStroke();
  }

  /** Draw the border: yellow when selected, red when escrowed, else gold. */
  private applyStroke(): void {
    if (this.selected) this.card.setStroke(3, 0xffff00);
    else if (this.escrowed) this.card.setStroke(2, 0xff6666);
    else this.card.setStroke(2, 0xaa8800);
  }
}
