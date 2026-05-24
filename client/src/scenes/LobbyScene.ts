import Phaser from 'phaser';
import { joinOrCreate } from '../net/Connection';

/**
 * Connects to the Colyseus `battle` room and waits for a second player. Once the
 * server moves the room into the ATTACK_SELECT phase (both duelists joined), it
 * transitions to the BattleScene exactly once. The server is the source of truth
 * for when the battle begins — the client only reacts to the broadcast phase.
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

    // Rebind the global hook so the connection runs in this scene's context and
    // can drive the scene transition once the battle starts.
    window.connectToRoom = async (): Promise<void> => {
      const room = await joinOrCreate();
      this.statusText.setText('Waiting for opponent...');

      const onState = (state: any): void => {
        if (state.phase === 'ATTACK_SELECT' && !this.transitioned) {
          this.transitioned = true;
          // Stop reacting to further diffs from this scene before handing off.
          room.onStateChange.remove(onState);
          this.scene.start('BattleScene');
        }
      };
      room.onStateChange(onState);
    };

    void window.connectToRoom();
  }
}
