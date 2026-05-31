import Phaser from 'phaser';

/**
 * Top-center phase banner — the most visually prominent UI moment in a battle
 * (GDD §6.3). Shows the current phase / whose turn it is, plus the win/lose
 * result when the duel ends. Driven entirely by the broadcast phase. (Element
 * gauges are rendered by the PlayerDuelist / OpponentDuelist panels.)
 */
export class Hud extends Phaser.GameObjects.Container {
  private readonly banner: Phaser.GameObjects.Text;
  private readonly opponentName: Phaser.GameObjects.Text;
  // #211 — bottom-left ⚡ current/max spirit readout for the LOCAL player only.
  // Spirit is the local player's private info; the opponent's is never rendered.
  private readonly spirit: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.banner = scene.add
      .text(512, 40, 'WAITING...', {
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#00000099',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(500);
    // Opponent label (top-left); blank for human opponents, personality for AI.
    this.opponentName = scene.add.text(16, 16, '', {
      fontSize: '16px',
      color: '#ffcc66',
    });
    // #211 — spirit readout, bottom-left. Hidden until updateFromState confirms a
    // non-zero spiritMax (AI / no-token sessions have spiritMax 0 → no DB balance).
    this.spirit = scene.add
      .text(16, 564, '', {
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#00000099',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0, 1)
      .setDepth(500)
      .setVisible(false);
    scene.add.existing(this);
  }

  updateFromState(state: any, myId: string): void {
    const oppId = Array.from(state.players.keys()).find((id: any) => id !== myId) as
      | string
      | undefined;
    const opp = oppId ? state.players.get(oppId) : undefined;
    this.opponentName.setText(opp?.displayName ? `VS ${opp.displayName}` : '');

    // #211 — spirit gauge for the LOCAL player. Hidden when spiritMax is 0 (AI /
    // no-token local session). White by default; RED when fully depleted.
    const me = state.players.get(myId);
    const spiritMax = (me?.spiritMax as number) ?? 0;
    if (spiritMax > 0) {
      const spiritCurrent = (me?.spiritCurrent as number) ?? 0;
      this.spirit.setText(`⚡ ${spiritCurrent}/${spiritMax}`);
      this.spirit.setColor(spiritCurrent === 0 ? '#ff4444' : '#ffffff');
      this.spirit.setVisible(true);
    } else {
      this.spirit.setVisible(false);
    }

    if (state.phase === 'ENDED') {
      const won = state.winnerId === myId;
      this.banner.setText(won ? 'YOU WIN!' : 'YOU LOSE!');
      this.banner.setColor(won ? '#44ff44' : '#ff4444');
      return;
    }

    const imAttacker = state.currentAttackerId === myId;
    const text =
      (
        {
          ATTACK_SELECT: imAttacker ? 'YOUR TURN — ATTACK' : "OPPONENT'S TURN",
          DEFEND_WINDOW: imAttacker ? 'WAITING...' : 'DEFEND!',
          RESOLVE: 'RESOLVING...',
          WAITING: 'WAITING...',
        } as Record<string, string>
      )[state.phase as string] ?? 'WAITING...';

    this.banner.setText(text);
    // Highlight the actionable phases for the local player.
    const actionable =
      (state.phase === 'ATTACK_SELECT' && imAttacker) ||
      (state.phase === 'DEFEND_WINDOW' && !imAttacker);
    this.banner.setColor(actionable ? '#ffff66' : '#ffffff');
  }

  /**
   * #211 — the rendered spirit readout as 'current/max', or undefined when the
   * readout is hidden (AI / no-token local session, spiritMax 0). Used by
   * BattleScene.publishHudView so E2E can assert the readout without reading pixels.
   */
  get displayedSpirit(): string | undefined {
    return this.spirit.visible ? this.spirit.text.replace('⚡ ', '') : undefined;
  }
}
