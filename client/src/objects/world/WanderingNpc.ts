import Phaser from 'phaser';
import {
  CHARSET_KEY,
  CHARSET_IDLE_COL,
  charsetFrame,
  type Facing,
} from './charset';
import { MONSTER_OW_REGISTRY, NPC_OW_DISPLAY_SIZE } from './NpcSpriteRegistry';

/**
 * The minimal slice of the overworld roster ({@link NpcInfo}) a wandering marker
 * needs: a stable id and its authored spawn (`x`/`y`). The controller writes the
 * sprite's live position back into `x`/`y` every step so the scene's radius-based
 * detection, the Approach [E] prompt, the duel-origin record, and the double-click
 * ambush all track the *visible* creature rather than the static spawn point.
 */
export interface WanderTarget {
  id: string;
  type: 'monster' | 'duelist';
  element: number;
  /** Direct frame index into the legacy strip (5–11 for duelists); mapped to a
   *  charset character so adjacent duelists look different. */
  spriteFrame: number;
  /** Live position — mutated in place as the sprite wanders. */
  x: number;
  y: number;
}

/** Walk-cycle playback rate (frames/sec) — matches Player.ts. */
const WALK_FPS = 8;
/** Max distance (world px) a marker may drift from its authored spawn (~1.5 tiles
 *  at 16px). Keeps wandering NPCs near their intended spot and out of walls. */
const WANDER_RADIUS = 24;
/** Wander travel speed in px/s — a slow amble, well below PLAYER_SPEED (160). */
const WANDER_SPEED = 18;
/** Randomised pause range (ms) between wander legs. */
const PAUSE_MIN_MS = 700;
const PAUSE_MAX_MS = 2200;
/** Monster idle-bob amplitude (px) and period (ms) — a gentle vertical sine hop. */
const BOB_AMPLITUDE = 2.5;
const BOB_PERIOD_MS = 1400;
/** Duelist depth, matching the existing NPC-marker depth (renderNpcs / merchants). */
const NPC_DEPTH = 6;

/** Map a server `spriteFrame` (5–11 = "7 human variants") onto a charset character
 *  in 1–7 (skip 0 = player) so the on-screen duelist matches the server's intent
 *  and adjacent duelists differ. */
function duelistChar(spriteFrame: number): number {
  return ((spriteFrame - 5) % 7) + 1;
}

/** Register the four directional walk animations for one charset character once on
 *  the game-level anim manager (shared across scenes). Mirrors Player.ensureAnims:
 *  the cycle steps left-foot → idle → right-foot → idle. */
function ensureDuelistAnims(scene: Phaser.Scene, char: number): void {
  for (const dir of ['down', 'left', 'right', 'up'] as Facing[]) {
    const key = `duelist${char}-walk-${dir}`;
    if (scene.anims.exists(key)) continue;
    const cols = [0, 1, 2, 1];
    scene.anims.create({
      key,
      frames: cols.map((col) => ({ key: CHARSET_KEY, frame: charsetFrame(char, dir, col) })),
      frameRate: WALK_FPS,
      repeat: -1,
    });
  }
}

/**
 * One overworld NPC marker that cosmetically wanders around its authored spawn.
 *
 * Purely presentational (the Colyseus server stays authoritative on which NPCs
 * exist and where they spawn). Because positions are not server-authoritative,
 * two clients may briefly see the same NPC at slightly different spots — that's
 * acceptable flavour. The controller owns one sprite + its {@link WanderTarget}:
 *
 *  - **Duelists** draw from the shared RPG-Maker charset and play the same
 *    directional walk-cycle the player uses; they hold the idle pose while paused.
 *  - **Monsters** render the static frame-0 creature art (their sheets are
 *    non-uniform single-creature art, not clean walk strips) and feel alive via a
 *    continuous vertical idle-bob plus a horizontal `setFlipX` toward travel.
 *
 * Each wander leg picks a random target within {@link WANDER_RADIUS} of the spawn,
 * tweens to it at {@link WANDER_SPEED}, pauses a randomised beat, then repeats —
 * writing the live position back into `npc.x`/`.y` every frame so detection stays
 * aligned with the moving sprite.
 */
export class WanderingNpc {
  /** The world-space marker sprite (interactive; zooms with the main camera). */
  readonly sprite: Phaser.GameObjects.Sprite;

  private readonly scene: Phaser.Scene;
  private readonly npc: WanderTarget;
  /** Authored spawn — the centre the wander stays within WANDER_RADIUS of. */
  private readonly spawnX: number;
  private readonly spawnY: number;
  /** Duelist charset character (1–7), or undefined for monsters. */
  private readonly char?: number;
  /** Duelist current facing; persists when paused so it holds its last heading. */
  private facing: Facing = 'down';
  /** Active wander tween (the leg in progress), or null while paused/idle. */
  private moveTween: Phaser.Tweens.Tween | null = null;
  /** Pending pause timer between legs, or null. */
  private pauseTimer: Phaser.Time.TimerEvent | null = null;
  /** Monster idle-bob tween (persistent, yoyo), or null for duelists. */
  private bobTween: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  /**
   * @param scene owning spatial biome scene
   * @param npc the roster entry; its `x`/`y` are mutated in place as it wanders
   * @param onClick fired on the sprite's pointerdown (the scene's ambush handler)
   */
  constructor(scene: Phaser.Scene, npc: WanderTarget, onClick: () => void) {
    this.scene = scene;
    this.npc = npc;
    this.spawnX = npc.x;
    this.spawnY = npc.y;

    if (npc.type === 'monster' && npc.element <= 4 && MONSTER_OW_REGISTRY[npc.element]) {
      // Static frame-0 creature art (#192): the sheets are non-uniform single-
      // creature images, so we never frame-animate them — we bob + flip instead.
      this.sprite = scene.add
        .sprite(npc.x, npc.y, MONSTER_OW_REGISTRY[npc.element].key, 0)
        .setDisplaySize(NPC_OW_DISPLAY_SIZE, NPC_OW_DISPLAY_SIZE);
      this.startBob();
    } else {
      // Duelist: shared charset walker, idle/facing-down to start.
      this.char = duelistChar(npc.spriteFrame);
      ensureDuelistAnims(scene, this.char);
      this.sprite = scene.add.sprite(
        npc.x,
        npc.y,
        CHARSET_KEY,
        charsetFrame(this.char, 'down', CHARSET_IDLE_COL),
      );
    }

    this.sprite
      .setDepth(NPC_DEPTH)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);

    this.scheduleNextLeg(0);
  }

  /** Monster-only: a gentle continuous vertical sine hop so it reads as alive. */
  private startBob(): void {
    this.bobTween = this.scene.tweens.add({
      targets: this.sprite,
      y: `-=${BOB_AMPLITUDE}`,
      duration: BOB_PERIOD_MS / 2,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  /** Pick a random reachable target within WANDER_RADIUS of the spawn. */
  private pickTarget(): { x: number; y: number } {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Phaser.Math.FloatBetween(WANDER_RADIUS * 0.4, WANDER_RADIUS);
    // Clamp into the disc so the marker never drifts past WANDER_RADIUS.
    let tx = this.spawnX + Math.cos(angle) * dist;
    let ty = this.spawnY + Math.sin(angle) * dist;
    const dx = tx - this.spawnX;
    const dy = ty - this.spawnY;
    const len = Math.hypot(dx, dy);
    if (len > WANDER_RADIUS) {
      tx = this.spawnX + (dx / len) * WANDER_RADIUS;
      ty = this.spawnY + (dy / len) * WANDER_RADIUS;
    }
    return { x: tx, y: ty };
  }

  /** Schedule the next wander leg after a (possibly zero) pause. */
  private scheduleNextLeg(delayMs: number): void {
    if (this.destroyed) return;
    this.pauseTimer = this.scene.time.delayedCall(delayMs, () => this.startLeg());
  }

  /** Tween the marker to a fresh nearby target, animating the walk while moving. */
  private startLeg(): void {
    if (this.destroyed) return;
    const target = this.pickTarget();
    const dx = target.x - this.sprite.x;
    // Monsters: only drift horizontally so the persistent bob tween owns y
    // exclusively — two tweens targeting the same property simultaneously fight.
    const dy = this.char !== undefined ? target.y - this.sprite.y : 0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      this.scheduleNextLeg(Phaser.Math.Between(PAUSE_MIN_MS, PAUSE_MAX_MS));
      return;
    }
    const duration = (dist / WANDER_SPEED) * 1000;
    this.applyFacing(dx, dy, true);

    const tweenProps: Record<string, number> = { x: target.x };
    if (this.char !== undefined) tweenProps.y = target.y;

    this.moveTween = this.scene.tweens.add({
      targets: this.sprite,
      ...tweenProps,
      duration,
      ease: 'Linear',
      onUpdate: () => this.syncRosterPosition(),
      onComplete: () => {
        this.moveTween = null;
        this.syncRosterPosition();
        this.applyFacing(0, 0, false); // pause → idle pose
        this.scheduleNextLeg(Phaser.Math.Between(PAUSE_MIN_MS, PAUSE_MAX_MS));
      },
    });
  }

  /**
   * Drive the visible facing for a travel vector. Duelists play their directional
   * walk-cycle (or hold the idle frame when `moving` is false); monsters can't be
   * frame-walked, so they only flip horizontally toward travel.
   */
  private applyFacing(dx: number, dy: number, moving: boolean): void {
    if (this.char !== undefined) {
      if (!moving) {
        // Paused: hold the standing/idle frame, facing the last-travelled direction.
        this.sprite.anims.stop();
        this.sprite.setFrame(charsetFrame(this.char, this.facing, CHARSET_IDLE_COL));
        return;
      }
      this.facing =
        Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
      this.sprite.anims.play(`duelist${this.char}-walk-${this.facing}`, true);
    } else {
      // Monster: only horizontal flip toward travel (keep vertical bob untouched).
      if (moving && Math.abs(dx) > 0.5) this.sprite.setFlipX(dx < 0);
    }
  }

  /** Write the marker's live position back into the roster entry so the scene's
   *  detection radius, prompt, and click handler track the visible creature. */
  private syncRosterPosition(): void {
    this.npc.x = this.sprite.x;
    this.npc.y = this.sprite.y;
  }

  /** Tear down the sprite, its tweens, and the pause timer (on re-render/shutdown). */
  destroy(): void {
    this.destroyed = true;
    this.pauseTimer?.remove(false);
    this.pauseTimer = null;
    this.moveTween?.remove();
    this.moveTween = null;
    this.bobTween?.remove();
    this.bobTween = null;
    this.sprite.destroy();
  }
}
