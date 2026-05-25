import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';
import type { AIPersonality } from '../../../shared/types';
import { CANVAS_W, CANVAS_H } from '../Constants';

declare const __SERVER_URL__: string;
const _WS_ENC = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = _WS_ENC.replace(/^ws/, 'http');

type Choice = AIPersonality | 'PVP';

interface MarkerSpec {
  choice: Choice;
  label: string;
  color: number;
}

/**
 * Static overworld hub (§10.3 approach → agree → duel → return). No tilemap,
 * collision, or camera — those are Phase 8. The player avatar sits center; four
 * NPC markers (one per §10.5 personality) and a PvP marker ring it. Selecting a
 * marker connects to the appropriate room and starts the BattleScene; PvP starts
 * the LobbyScene instead.
 *
 * Markers are genuinely interactive, but exact-pixel canvas clicks are flaky
 * under Playwright, so the same selection path is also exposed deterministically
 * via `window.__encounterSelect(choice)` for the E2E suite.
 */
export class EncounterScene extends Phaser.Scene {
  private busy = false;
  private statusText!: Phaser.GameObjects.Text;

  private static readonly MARKERS: MarkerSpec[] = [
    { choice: 'AGGRESSIVE', label: 'Aggressive', color: 0xff4400 },
    { choice: 'DEFENSIVE', label: 'Defensive', color: 0x0088ff },
    { choice: 'STATUS_HUNTER', label: 'Status-hunter', color: 0x44bb00 },
    { choice: 'RESILIENT', label: 'Resilient', color: 0x886600 },
    { choice: 'PVP', label: 'PvP', color: 0x999999 },
  ];

  constructor() {
    super({ key: 'EncounterScene' });
  }

  init(): void {
    this.busy = false;
  }

  create(): void {
    this.add
      .text(CANVAS_W / 2, 40, 'ENCOUNTER — choose an opponent', {
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Player avatar placeholder (center).
    this.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, 70, 110, 0x335577).setStrokeStyle(2, 0xaaccee);
    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 70, 'YOU', { fontSize: '16px', color: '#aaccee' })
      .setOrigin(0.5);

    // Lay the five markers out in a horizontal row above the avatar.
    const markers = EncounterScene.MARKERS;
    const spacing = CANVAS_W / (markers.length + 1);
    const y = 170;
    markers.forEach((m, i) => {
      const x = spacing * (i + 1);
      const rect = this.add
        .rectangle(x, y, 80, 90, m.color, 0.85)
        .setStrokeStyle(2, 0xffffff)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(x, y + 60, m.label, { fontSize: '14px', color: '#ffffff' })
        .setOrigin(0.5);
      rect.on('pointerdown', () => this.select(m.choice));
    });

    this.statusText = this.add
      .text(CANVAS_W / 2, CANVAS_H - 40, '', { fontSize: '16px', color: '#ffff88' })
      .setOrigin(0.5);

    // Deterministic E2E hook — identical code path to a marker click.
    window.__encounterSelect = (choice: Choice): void => {
      this.select(choice);
    };

    this.events.once('shutdown', () => {
      window.__encounterSelect = undefined;
    });
  }

  /** Single entry point for both real marker clicks and the E2E hook. */
  private select(choice: Choice): void {
    if (this.busy) return;
    this.busy = true;

    if (choice === 'PVP') {
      // PvP path goes through the Lobby (waits for a second human).
      this.scene.start('LobbyScene');
      return;
    }

    this.statusText.setText(`Approaching ${choice}...`);
    void this.startAIDuel(choice);
  }

  /** Connect to a fresh vsAI room, then hand off to the BattleScene. */
  private async startAIDuel(personality: AIPersonality): Promise<void> {
    const token = localStorage.getItem('er_token') ?? '';
    // Best-effort stake lock before connecting (non-fatal if it fails).
    try {
      await fetch(`${API_BASE}/api/stake/lock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-fatal */ }
    const room = await connectToRoom('battle-ai', { vsAI: true, personality, token });

    // The server seats the AI on create and the human on join, then opens
    // ATTACK_SELECT once both are present. Hand off as soon as that happens.
    let transitioned = false;
    const onState = (state: any): void => {
      if (state.phase === 'ATTACK_SELECT' && !transitioned) {
        transitioned = true;
        room.onStateChange.remove(onState);
        this.scene.start('BattleScene', { returnScene: 'EncounterScene' });
      }
    };
    room.onStateChange(onState);
  }
}
