import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';

// Placeholder — full inventory/loadout/stake UI is issue 4+5.2.
//
// This scene only exists so post-login routing (LoginScene / BootScene) and the
// auth E2E suite have a stable target. It optionally fetches /api/me to show the
// player's gold, but renders fine even if that call fails.
declare const __SERVER_URL__: string;

export class CampScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CampScene' });
  }

  create(): void {
    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 60, 'CAMP', { fontSize: '48px', color: '#ffffff' })
      .setOrigin(0.5);

    const goldText = this.add
      .text(CANVAS_W / 2, CANVAS_H / 2, '', { fontSize: '20px', color: '#ffdd66' })
      .setOrigin(0.5);

    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 80, '▶ Go to Encounter', {
        fontSize: '24px',
        color: '#aaffaa',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToEncounter());

    // E2E hook — analogous to __encounterSelect in EncounterScene.
    window.__campGoEncounter = (): void => this.goToEncounter();
    this.events.once('shutdown', () => {
      window.__campGoEncounter = undefined;
    });

    void this.loadGold(goldText);
  }

  private goToEncounter(): void {
    this.scene.start('EncounterScene');
  }

  /** Optional: fetch the player's gold from /api/me for display. Best-effort. */
  private async loadGold(target: Phaser.GameObjects.Text): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    const ws = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
    const api = ws.replace(/^ws/, 'http');
    try {
      const res = await fetch(`${api}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      target.setText(`Gold: ${data?.player?.gold ?? '?'}`);
    } catch {
      // Network failure is non-fatal for the placeholder.
    }
  }
}
