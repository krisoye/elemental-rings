import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';

/**
 * PvP lobby. Connects to the `battle` room and waits for a second human player.
 * Once the server moves the room into ATTACK_SELECT (both duelists joined), it
 * transitions to the BattleScene exactly once. The server is the source of truth
 * for when the battle begins — the client only reacts to the broadcast phase.
 * PvP duels return here (not to the Encounter hub) when they end.
 */
export class LobbyScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private transitioned = false;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(): void {
    this.transitioned = false;
  }

  create(): void {
    this.statusText = this.add
      .text(512, 288, 'Connecting...', { fontSize: '32px', color: '#ffffff' })
      .setOrigin(0.5);

    void this.connect();
  }

  private async connect(): Promise<void> {
    const room = await connectToRoom('battle');
    this.statusText.setText('Waiting for opponent...');

    const onState = (state: any): void => {
      if (state.phase === 'ATTACK_SELECT' && !this.transitioned) {
        this.transitioned = true;
        // Stop reacting to further diffs from this scene before handing off.
        room.onStateChange.remove(onState);
        this.scene.start('BattleScene', { returnScene: 'LobbyScene' });
      }
    };
    room.onStateChange(onState);
  }
}
