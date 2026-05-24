import Phaser from 'phaser';

/**
 * Top-center banner showing the current phase / whose turn it is, and the
 * win/lose result when the duel ends. Driven entirely by the broadcast phase.
 */
export class Hud extends Phaser.GameObjects.Container {
  private readonly banner: Phaser.GameObjects.Text;
  private readonly opponentName: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.banner = scene.add
      .text(512, 30, 'WAITING...', {
        fontSize: '24px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5);
    // Opponent label (top-left); blank for human opponents, personality for AI.
    this.opponentName = scene.add.text(16, 16, '', {
      fontSize: '16px',
      color: '#ffcc66',
    });
    scene.add.existing(this);
  }

  updateFromState(state: any, myId: string): void {
    // Show the opponent's displayName (set only for AI opponents).
    const oppId = Array.from(state.players.keys()).find((id: any) => id !== myId) as
      | string
      | undefined;
    const opp = oppId ? state.players.get(oppId) : undefined;
    this.opponentName.setText(opp?.displayName ? `VS ${opp.displayName}` : '');

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
    this.banner.setColor('#ffffff');
  }
}
