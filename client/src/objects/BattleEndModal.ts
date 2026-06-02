import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../Constants';
import { createOverlay } from './ui/ModalShell';

/** The win/lose result + reward lines the modal renders (all server-authoritative). */
export interface BattleEndResult {
  won: boolean;
  /** Element of the ring won (WIN) or the forfeited staked thumb (LOSS); null when none. */
  ringElement: number | null;
  /** XP of the ring won or lost; null when ringElement is null. */
  ringXp: number | null;
  goldGained: number;
  xpGained: number;
  aggregateXp: number;
}

/** Which post-duel route the player chose. */
export type BattleEndChoice = 'managehand' | 'overworld';

/**
 * #212 — persistent end-of-battle modal. Replaces the old auto-route timer in
 * BattleScene.checkEnded: when a duel ENDS the modal shows the result + rewards
 * and NEVER auto-dismisses. The player reviews the outcome and explicitly chooses
 * where to go ([Manage Battle Hand] / [Return to Overworld]). A corner [X]
 * collapses the modal to a frozen final board with a small reopen pill (click or
 * SPACE/ESC re-shows it) — the modal is the ONLY way to leave the ENDED scene.
 *
 * Pure presentation: it adds no game logic. Both routes preserve the won-ring
 * carry prompt (the er_pending_ring localStorage key is untouched here — it is
 * surfaced later by EncounterScene/biome on arrival). The scene owns routing.
 */
export class BattleEndModal {
  private readonly scene: Phaser.Scene;
  private readonly result: BattleEndResult;
  private readonly onChoice: (choice: BattleEndChoice) => void;

  /** The modal container (null while collapsed via [X]). */
  private modal: Phaser.GameObjects.Container | null = null;
  /** The reopen pill shown after [X] (null until X is pressed, then persistent). */
  private reopenPill: Phaser.GameObjects.Container | null = null;
  /** SPACE/ESC keys that re-show the modal while collapsed. */
  private reopenKeys: Phaser.Input.Keyboard.Key[] = [];
  private reopenKeyHandler: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    result: BattleEndResult,
    onChoice: (choice: BattleEndChoice) => void,
  ) {
    this.scene = scene;
    this.result = result;
    this.onChoice = onChoice;
  }

  /** Build and show the modal, and register the E2E hooks. Call once on ENDED. */
  show(): void {
    this.renderModal();
    window.__battleEndModalOpen = true;
    window.__battleEndChoice = (choice: BattleEndChoice): void => this.choose(choice);
    window.__reopenBattleEnd = (): void => this.reopen();
  }

  /** Build the modal container (banner, result lines, two buttons, corner [X]). */
  private renderModal(): void {
    const { won } = this.result;
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;

    // Shared modal scaffold (backdrop + panel). The title is suppressed (the
    // banner below is the heading) and the panel stroke is recolored win/lose. The
    // corner ✕ collapses the modal to the frozen board rather than closing it.
    const { container, panel } = createOverlay(this.scene, {
      width: 520,
      height: 320,
      title: '',
      onClose: () => this.collapse(),
      depth: 2000,
      backdropAlpha: 0.7,
      panelColor: 0x1a1a2e,
      strokeColor: won ? 0x44ff44 : 0xff4444,
      strokeWidth: 3,
    });

    // Banner — same colors as the old inline WIN/LOSE text.
    const banner = this.scene.add
      .text(cx, cy - 110, won ? 'YOU WIN!' : 'YOU LOSE!', {
        fontSize: '44px',
        fontStyle: 'bold',
        color: won ? '#44ff44' : '#ff4444',
      })
      .setOrigin(0.5);
    container.add(banner);

    // Result lines (won/lost ring + rewards).
    const lines = this.resultLines();
    lines.forEach((line, i) => {
      container.add(
        this.scene.add
          .text(cx, cy - 50 + i * 28, line.text, { fontSize: '18px', color: line.color })
          .setOrigin(0.5),
      );
    });

    // Two action buttons.
    container.add(this.button(cx, cy + 70, '[ Manage Battle Hand ]', '#ffcc88', () =>
      this.choose('managehand'),
    ));
    container.add(this.button(cx, cy + 110, '[ Return to Overworld ]', '#aaffaa', () =>
      this.choose('overworld'),
    ));

    // The corner ✕ (collapse-to-frozen-board) is provided by the shared shell.
    this.modal = container;
  }

  /** The reward lines, win/loss-specific (GDD §6.4). */
  private resultLines(): Array<{ text: string; color: string }> {
    const { won, ringElement, ringXp, goldGained, xpGained, aggregateXp } = this.result;
    const lines: Array<{ text: string; color: string }> = [];
    if (ringElement !== null) {
      const name = ELEMENT_NAMES[ringElement] ?? '?';
      const xpStr = ringXp !== null ? ` (${ringXp} XP)` : '';
      lines.push(
        won
          ? { text: `Won: ${name} Ring${xpStr}`, color: '#ffd700' }
          : { text: `Lost: ${name} Ring${xpStr}`, color: '#ff8888' },
      );
    }
    lines.push({ text: `+${goldGained} gold`, color: '#ffd700' });
    lines.push({ text: `+${xpGained} XP  (total ${aggregateXp})`, color: '#88ffaa' });
    return lines;
  }

  /** A pointer-interactive label with hover highlight, used for both action buttons. */
  private button(
    x: number,
    y: number,
    label: string,
    color: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(x, y, label, { fontSize: '18px', fontStyle: 'bold', color })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick)
      .on('pointerover', () => t.setColor('#ffffff'))
      .on('pointerout', () => t.setColor(color));
    return t;
  }

  /**
   * Commit a route choice. Tears the modal + reopen pill down, clears the E2E
   * hooks, and hands the choice to the scene (which performs the scene.start). The
   * won-ring key is left intact by both routes (handled by the scene).
   */
  private choose(choice: BattleEndChoice): void {
    this.destroy();
    this.onChoice(choice);
  }

  /** [X] — hide the modal, leaving the frozen board, and show the reopen pill. */
  private collapse(): void {
    if (this.modal) {
      this.modal.destroy(true);
      this.modal = null;
    }
    window.__battleEndModalOpen = false;
    this.showReopenPill();
  }

  /** Re-show the modal after a collapse (pill click or SPACE/ESC). */
  private reopen(): void {
    if (this.modal) return; // already open
    this.hideReopenPill();
    this.renderModal();
    window.__battleEndModalOpen = true;
  }

  /**
   * The persistent reopen affordance: a small bottom-center pill. Once shown it
   * stays until a route is chosen, so the modal is always reachable. Reacts to a
   * click or to SPACE/ESC.
   */
  private showReopenPill(): void {
    if (this.reopenPill) return;
    const cx = CANVAS_W / 2;
    const y = CANVAS_H - 30;
    const pill = this.scene.add.container(0, 0).setDepth(1500);
    const bg = this.scene.add
      .rectangle(cx, y, 240, 36, 0x000000, 0.85)
      .setStrokeStyle(2, 0xffcc88)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.reopen());
    const label = this.scene.add
      .text(cx, y, '▸ Battle Over — options', { fontSize: '15px', color: '#ffcc88' })
      .setOrigin(0.5);
    pill.add([bg, label]);
    this.reopenPill = pill;

    const KC = Phaser.Input.Keyboard.KeyCodes;
    const space = this.scene.input.keyboard!.addKey(KC.SPACE);
    const esc = this.scene.input.keyboard!.addKey(KC.ESC);
    this.reopenKeys = [space, esc];
    this.reopenKeyHandler = (): void => this.reopen();
    space.on('down', this.reopenKeyHandler);
    esc.on('down', this.reopenKeyHandler);
  }

  /** Tear down the reopen pill + its SPACE/ESC listeners. */
  private hideReopenPill(): void {
    if (this.reopenKeyHandler) {
      this.reopenKeys.forEach((k) => k.off('down', this.reopenKeyHandler!));
      this.reopenKeyHandler = null;
    }
    this.reopenKeys = [];
    if (this.reopenPill) {
      this.reopenPill.destroy(true);
      this.reopenPill = null;
    }
  }

  /** Fully tear down the modal, the reopen pill, and the E2E hooks. */
  destroy(): void {
    if (this.modal) {
      this.modal.destroy(true);
      this.modal = null;
    }
    this.hideReopenPill();
    window.__battleEndModalOpen = false;
    window.__battleEndChoice = undefined;
    window.__reopenBattleEnd = undefined;
  }
}
