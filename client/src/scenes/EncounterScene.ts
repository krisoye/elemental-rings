import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';
import type { AIPersonality } from '../../../shared/types';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';
import type { RingData } from '../objects/InventoryGrid';
import { BattleHandOverlay } from '../objects/BattleHandOverlay';
import { CHARSET_KEY, charsetFrame, preloadCharset } from '../objects/world/charset';

// One overworld sprite per element pool — each is a 72×96 strip (3 cols × 4 rows, 24×24 per frame).
const TRAINING_MONSTERS = [
  'assets/monsters/monster_fire_02_alt01_overworld.png',       // FIRE (0)
  'assets/monsters/monster_water_grass_19_alt01_overworld.png', // WATER (1)
  'assets/monsters/monster_electro_ghost_14_alt01_overworld.png', // EARTH (2)
  'assets/monsters/monster_water_fly_11_alt01_overworld.png',   // WIND (3)
  'assets/monsters/monster_water_grass_20_alt01_overworld.png', // WOOD (4)
] as const;

declare const __SERVER_URL__: string;
const _WS_ENC = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = _WS_ENC.replace(/^ws/, 'http');

type Choice = AIPersonality | 'PVP';

interface MarkerSpec {
  choice: Choice;
  label: string;
  fallbackColor: number;
}

/**
 * #196 — relative difficulty bucket comparing an NPC's effective XP to the
 * player's aggregate XP. Buckets are tuned so a 1:1 (DEFENSIVE) opponent reads
 * "Matched", AGGRESSIVE (×0.8) reads "Easier", and RESILIENT (×1.3) "Stronger".
 * A fresh player vs a fresh-floored opponent (both 0) reads "Fresh".
 */
function difficultyLabel(npcXp: number, playerXp: number): string {
  if (playerXp === 0 && npcXp === 0) return 'Fresh';
  const ratio = playerXp > 0 ? npcXp / playerXp : 1;
  if (ratio < 0.6) return 'Weaker';
  if (ratio < 0.9) return 'Easier';
  if (ratio < 1.2) return 'Matched';
  if (ratio < 1.8) return 'Stronger';
  return 'Much Stronger';
}

/** Hex color string for a difficulty label (green→white→orange→red). */
function difficultyColor(label: string): string {
  switch (label) {
    case 'Weaker':
    case 'Easier':
      return '#66dd66';
    case 'Stronger':
      return '#ffaa44';
    case 'Much Stronger':
      return '#ff5555';
    default: // Matched / Fresh
      return '#ffffff';
  }
}

const MARKERS: MarkerSpec[] = [
  { choice: 'AGGRESSIVE',    label: 'Aggressive',    fallbackColor: 0xff4400 },
  { choice: 'DEFENSIVE',     label: 'Defensive',     fallbackColor: 0x0088ff },
  { choice: 'STATUS_HUNTER', label: 'Status-hunter', fallbackColor: 0x44bb00 },
  { choice: 'RESILIENT',     label: 'Resilient',     fallbackColor: 0x886600 },
  { choice: 'PVP',           label: 'PvP',           fallbackColor: 0x999999 },
];

/**
 * Static overworld hub (§10.3 approach → agree → duel → return). Fetches
 * /api/encounter/preview on create to color each AI marker by their randomized
 * staked ring element. Selecting a marker connects to the appropriate room.
 *
 * E2E hook: window.__encounterSelect(choice) is the same code path as a click.
 */
export class EncounterScene extends Phaser.Scene {
  private busy = false;
  private statusText!: Phaser.GameObjects.Text;
  // #87 Part D — the Manage Battle-Hand modal cluster, extracted into a standalone
  // overlay (was inlined here, #40/#85). EncounterScene delegates to it; the same
  // class also powers the OverworldScene Tab overlay.
  private battleHand!: BattleHandOverlay;
  // aiSeed per personality — received from /api/encounter/preview and passed to
  // the BattleRoom so the actual loadout matches the stake shown in the preview.
  private aiSeeds: Map<Choice, number> = new Map();
  // Post-battle won-ring prompt (#40). Now fires here (not CampScene) because the
  // post-battle flow returns to EncounterScene — the player must resolve the won
  // ring before selecting another encounter.
  private wonRingModal: Phaser.GameObjects.Container | null = null;
  private wonRings: RingData[] = [];
  // #196 — the player's aggregate ring XP, resolved from the preview response
  // (server-authoritative). Threaded into each vsAI room join so the AI loadout
  // scales to the player's level. 0 until the preview fetch resolves.
  private playerAggregateXp = 0;

  constructor() {
    super({ key: 'EncounterScene' });
  }

  preload(): void {
    preloadCharset(this);
    TRAINING_MONSTERS.forEach((path, i) => {
      const key = `enc-mon-${i}`;
      if (!this.textures.exists(key))
        this.load.spritesheet(key, path, { frameWidth: 24, frameHeight: 24 });
    });
  }

  // #83 — when entered from an overworld NPC (OverworldScene/SwampScene start this
  // scene with { npcId, personality }), skip the marker hub and launch the duel
  // directly against that NPC. null on the normal hub entry path. #87 Part C —
  // `ambush` is true when launched by a double-click on the NPC sprite: it pays
  // AMBUSH_SPIRIT_COST (server-side) to grant the player the opening attack.
  private npcDuel: {
    npcId?: string;
    personality: AIPersonality;
    ambush: boolean;
    // #111 — the overworld NPC's stable loadout seed (= hashNpcId), threaded into
    // the battle-ai room so its staked element matches the overworld marker.
    aiSeed?: number;
    /** Frame index from the overworld NPC roster — determines the battle sprite. */
    spriteFrame?: number;
    /** Canonical battler key matching the overworld monster sprite (#158). */
    battleKey?: string;
    // #199 — the overworld NPC's staked element, threaded into the battle-ai room
    // so generateAILoadout filters to a thumb-matching variant and the duel's
    // stake element equals the overworld sprite colour + approach warning.
    thumbElement?: number;
  } | null = null;

  private openBattleHandOnCreate = false;

  init(data?: {
    npcId?: string;
    personality?: AIPersonality;
    ambush?: boolean;
    aiSeed?: number;
    openBattleHand?: boolean;
    spriteFrame?: number;
    battleKey?: string;
    thumbElement?: number;
  }): void {
    this.busy = false;
    this.wonRingModal = null;
    this.openBattleHandOnCreate = data?.openBattleHand === true;
    this.npcDuel =
      data?.personality !== undefined
        ? {
            npcId: data.npcId,
            personality: data.personality,
            ambush: data.ambush === true,
            aiSeed: data.aiSeed,
            spriteFrame: data.spriteFrame,
            battleKey: data.battleKey,
            thumbElement: data.thumbElement,
          }
        : null;
  }

  create(): void {
    // #87 Part D — own a battle-hand overlay instance (replaces the inlined modal).
    // Constructed before the npcDuel early-return so checkPendingWonRing()'s
    // this.battleHand.isOpen() never dereferences an unassigned field on the NPC
    // path. The constructor is non-destructive (no scene objects), and its onStatus
    // callback uses optional chaining on statusText (created later), so an early
    // build is safe.
    this.battleHand = new BattleHandOverlay(this, (msg) => this.statusText?.setText(msg));

    // #83 — overworld NPC path: bypass the marker hub entirely and go straight into
    // the duel against the detected NPC (scoped by npcId so a win records the
    // defeat server-side). The hub UI/hooks below are skipped on this path.
    if (this.npcDuel) {
      const { npcId, personality, ambush, aiSeed, spriteFrame, battleKey, thumbElement } =
        this.npcDuel;
      // #88 — defensively consume the launch data so it can never be reused. Phaser
      // retains settings.data across a no-data scene.start, so without this a later
      // re-entry of EncounterScene (e.g. a hub return that forgot explicit `{}`)
      // could see the stale { npcId, personality } and auto-relaunch this duel in a
      // loop. Clearing it here means init() reads undefined → npcDuel=null → hub.
      this.scene.settings.data = {};
      this.npcDuel = null;
      // #87 Part C — a double-click NPC launch (ambush) pays for first strike.
      void this.startAIDuel(
        personality,
        undefined,
        npcId,
        ambush,
        aiSeed,
        spriteFrame,
        battleKey,
        thumbElement,
      );
      return;
    }

    this.add
      .text(CANVAS_W / 2, 40, 'TRAINING — choose a challenger', {
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Player avatar placeholder (center).
    this.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, 70, 110, 0x335577).setStrokeStyle(2, 0xaaccee);
    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 70, 'YOU', { fontSize: '16px', color: '#aaccee' })
      .setOrigin(0.5);

    // Build markers at fixed positions; fill with fallback colors immediately,
    // then update colors + stake labels once the preview fetch resolves.
    const spacing = CANVAS_W / (MARKERS.length + 1);
    const markerY = 170;

    const rects: Map<Choice, Phaser.GameObjects.Rectangle> = new Map();
    const stakeLabels: Map<Choice, Phaser.GameObjects.Text> = new Map();
    // #196 — one color-coded difficulty label per AI marker, rendered below the
    // stake line. Populated once the preview fetch resolves (npcEffectiveXp +
    // playerAggregateXp). PVP markers get no difficulty label.
    const diffLabels: Map<Choice, Phaser.GameObjects.Text> = new Map();

    MARKERS.forEach((m, i) => {
      const x = spacing * (i + 1);

      // PVP keeps a plain rectangle; AI trainers get an animated sprite card.
      const cardAlpha = m.choice === 'PVP' ? 0.85 : 0.35;
      const rect = this.add
        .rectangle(x, markerY, 90, 110, m.fallbackColor, cardAlpha)
        .setStrokeStyle(2, 0xffffff)
        .setInteractive({ useHandCursor: true });
      rects.set(m.choice, rect);

      // Personality label.
      this.add
        .text(x, markerY - 40, m.label, {
          fontSize: '11px',
          color: '#ffffff',
          align: 'center',
          wordWrap: { width: 86 },
        })
        .setOrigin(0.5);

      const stakeLabel = this.add
        .text(x, markerY + 30, m.choice === 'PVP' ? '' : '…', {
          fontSize: '11px',
          color: '#ffffffaa',
          align: 'center',
          wordWrap: { width: 86 },
        })
        .setOrigin(0.5);
      stakeLabels.set(m.choice, stakeLabel);

      // #196 — difficulty label below the stake line (AI markers only). Empty
      // until loadPreview() fills it from the scaled npcEffectiveXp.
      if (m.choice !== 'PVP') {
        const diffLabel = this.add
          .text(x, markerY + 62, '', {
            fontSize: '12px',
            color: '#ffffff',
            align: 'center',
            fontStyle: 'bold',
            wordWrap: { width: 86 },
          })
          .setOrigin(0.5);
        diffLabels.set(m.choice, diffLabel);
      }

      if (m.choice !== 'PVP') {
        const sprite = this.buildTrainerSprite(x, markerY - 5);
        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', () => this.select(m.choice));
      }

      rect.on('pointerdown', () => this.select(m.choice));
    });

    this.add
      .text(20, 20, '◀ Sanctum', { fontSize: '16px', color: '#aaffaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('CampScene'));

    // Manage Battle Hand — reassign carried rings to battle slots without
    // returning to camp. Modal has NO Sleep/Recharge actions (#40).
    this.add
      .text(CANVAS_W - 200, 20, '⚔ Manage Battle Hand', { fontSize: '14px', color: '#ffcc88' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.openManageBattleHand());

    this.statusText = this.add
      .text(CANVAS_W / 2, CANVAS_H - 40, '', { fontSize: '16px', color: '#ffff88' })
      .setOrigin(0.5);

    // Deterministic E2E hook — identical code path to a marker click.
    window.__encounterSelect = (choice: Choice): void => {
      this.select(choice);
    };
    // Same path, plus AI-strength overrides so a test can force the outcome
    // (aiHearts:1 → guaranteed win; aiHearts:99 → guaranteed loss).
    window.__encounterSelectWithOverrides = (
      choice: Choice,
      aiOverrides?: { aiHearts?: number; aiUses?: number },
    ): void => {
      this.select(choice, aiOverrides);
    };
    // Deterministic E2E PvP hook (#67): start the PvP path with an explicit
    // keyed room id so two parallel contexts pair into their own isolated room.
    window.__encounterSelectPvP = (e2eRoomId: string): void => {
      this.select('PVP', undefined, e2eRoomId);
    };
    window.__encounterManageBattleHand = (): void => void this.openManageBattleHand();
    window.__encounterResolveWonRing = (choice: 'carry' | 'discard'): void =>
      void this.resolveWonRing(choice);
    window.__encounterState = { pendingWonRing: null };
    this.events.once('shutdown', () => {
      window.__encounterSelect = undefined;
      window.__encounterSelectWithOverrides = undefined;
      window.__encounterSelectPvP = undefined;
      window.__encounterManageBattleHand = undefined;
      window.__encounterResolveWonRing = undefined;
      window.__encounterDiscardRing = undefined;
      window.__encounterState = undefined;
      window.__encounterPreview = undefined;
      this.battleHand?.destroy();
    });

    // Fetch stake preview and update marker colors + labels.
    void this.loadPreview(rects, stakeLabels, diffLabels);

    // Post-battle won-ring prompt: if the just-finished duel granted a ring,
    // resolve it here before the player can pick another encounter (#40).
    if (localStorage.getItem('er_pending_ring')) void this.checkPendingWonRing();

    // After returning from a battle, automatically open the battle-hand manager
    // so the player can reassign slots before their next encounter (GDD §6.8).
    if (this.openBattleHandOnCreate) {
      this.openBattleHandOnCreate = false;
      void this.openManageBattleHand();
    }
  }

  /**
   * Fetch /api/encounter/preview, recolor AI markers by stake element, and show
   * the opponent's staked-ring tier/XP and total XP per marker (#78 ③). All
   * values are server-authoritative; the scene only renders what it receives.
   * Publishes window.__encounterPreview (AI keys only) for the E2E harness.
   */
  private async loadPreview(
    rects: Map<Choice, Phaser.GameObjects.Rectangle>,
    stakeLabels: Map<Choice, Phaser.GameObjects.Text>,
    diffLabels: Map<Choice, Phaser.GameObjects.Text>,
  ): Promise<void> {
    try {
      // #196 — send the auth token so the server scales each opponent to this
      // player's aggregate XP. Anonymous fetches (no token) fall back to 0.
      const token = localStorage.getItem('er_token') ?? '';
      const res = await fetch(`${API_BASE}/api/encounter/preview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      // The response carries a top-level numeric `playerAggregateXp` alongside the
      // per-personality preview objects (#196), so the value type is a union.
      const preview: Record<
        string,
        | number
        | {
            element: number;
            aiSeed: number;
            stakeTier: number;
            stakeXp: number;
            totalXp: number;
            npcEffectiveXp: number;
          }
      > = await res.json();

      const rawPlayerXp = preview.playerAggregateXp;
      this.playerAggregateXp = typeof rawPlayerXp === 'number' ? rawPlayerXp : 0;

      const published: Record<
        string,
        {
          element: number;
          stakeTier: number;
          stakeXp: number;
          totalXp: number;
          npcEffectiveXp: number;
        }
      > = {};

      for (const [personality, entry] of Object.entries(preview)) {
        // Skip the top-level playerAggregateXp scalar — only personality objects.
        if (typeof entry !== 'object') continue;
        const { element, aiSeed, stakeTier, stakeXp, totalXp, npcEffectiveXp } = entry;
        this.aiSeeds.set(personality as Choice, aiSeed);
        published[personality] = { element, stakeTier, stakeXp, totalXp, npcEffectiveXp };

        const rect = rects.get(personality as Choice);
        const label = stakeLabels.get(personality as Choice);
        if (!rect || !label) continue;
        const color = ELEMENT_COLORS[element] ?? 0x888888;
        rect.setFillStyle(color, 0.85);
        // Two lines: stake element · tier · XP, then the loadout's total XP.
        const elementName = ELEMENT_NAMES[element] ?? '?';
        label.setText(
          `Stakes: ${elementName} · T${stakeTier} · ${stakeXp}xp\nTotal XP: ${totalXp}`,
        );
        label.setAlign('center');

        // #196 — color-coded relative difficulty label below the stake line.
        const diffLabel = diffLabels.get(personality as Choice);
        if (diffLabel) {
          const diff = difficultyLabel(npcEffectiveXp, this.playerAggregateXp);
          diffLabel.setText(diff);
          diffLabel.setColor(difficultyColor(diff));
        }
      }

      // The preview response only contains AI personalities (no PVP key); publish
      // the rendered subset so E2E can assert opponent stats deterministically.
      window.__encounterPreview = published;
    } catch {
      // Non-fatal — markers keep their fallback colors.
    }
  }

  /**
   * Single entry point for both real marker clicks and the E2E hooks.
   * `e2eRoomId` (PvP path only, set by the E2E harness via __encounterSelectPvP)
   * is forwarded to LobbyScene so the keyed-room matchmaking isolates the duel;
   * it is undefined for real PvP clicks, leaving the global-pool behavior intact.
   */
  private select(
    choice: Choice,
    aiOverrides?: { aiHearts?: number; aiUses?: number },
    e2eRoomId?: string,
  ): void {
    if (this.busy) return;
    this.busy = true;

    if (choice === 'PVP') {
      this.scene.start('LobbyScene', { e2eRoomId });
      return;
    }

    this.statusText.setText(`Approaching ${choice}...`);
    void this.startAIDuel(choice, aiOverrides);
  }

  /**
   * Connect to a fresh vsAI room, then hand off to the BattleScene. `aiOverrides`
   * (deterministic E2E only — see BattleRoomOptions) forces the duel's outcome by
   * weakening or hardening the AI; production marker clicks never pass them.
   * `npcId` (#83) scopes the duel to an overworld NPC so a human win is recorded
   * as that NPC's defeat server-side; undefined on the encounter-hub marker path.
   * `aiSeedOverride` (#111) is the overworld NPC's stable loadout seed; when given
   * it forces the room to reproduce the element shown on the overworld marker.
   * Undefined on the hub path, where the per-personality preview seed is used.
   */
  private async startAIDuel(
    personality: AIPersonality,
    aiOverrides?: { aiHearts?: number; aiUses?: number },
    npcId?: string,
    ambush?: boolean,
    aiSeedOverride?: number,
    opponentSpriteFrame?: number,
    battleKey?: string,
    thumbElement?: number,
  ): Promise<void> {
    const token = localStorage.getItem('er_token') ?? '';
    try {
      await fetch(`${API_BASE}/api/stake/lock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-fatal */ }
    const room = await connectToRoom('battle-ai', {
      vsAI: true,
      personality,
      token,
      aiSeed: aiSeedOverride ?? this.aiSeeds.get(personality),
      npcId,
      // #87 Part C — ambush first-strike. The server spends AMBUSH_SPIRIT_COST and
      // grants the opening attack when affordable; ignored otherwise (server guard).
      firstStrike: ambush === true,
      // #199 — the overworld NPC's staked element; the server filters the AI's
      // loadout variant pool to a thumb-matching template so the duel stake equals
      // the overworld sprite colour + approach warning.
      thumbElement,
      // #196 — the player's aggregate XP (from the preview response) so the AI
      // loadout scales to the player's level. Only sent when known (> 0); when
      // omitted (e.g. the NPC-duel path that skips the preview), the server
      // re-resolves it from the token as the authority. Sending 0 would suppress
      // that lookup (nullish-coalescing treats 0 as present), so it is left off.
      ...(this.playerAggregateXp > 0 ? { playerAggregateXp: this.playerAggregateXp } : {}),
      ...aiOverrides,
    });

    let transitioned = false;
    const onState = (state: any): void => {
      // Hand off to BattleScene once the duel is live (ATTACK_SELECT) — or if it
      // already ENDED before we saw ATTACK_SELECT (e.g. an instant forfeit by a
      // depleted AI), so BattleScene can still show the result and return to camp.
      if ((state.phase === 'ATTACK_SELECT' || state.phase === 'ENDED') && !transitioned) {
        transitioned = true;
        room.onStateChange.remove(onState);
        this.scene.start('BattleScene', { opponentSpriteFrame, battleKey });
      }
    };
    room.onStateChange(onState);
  }

  // ── Post-battle won-ring prompt (#40) ───────────────────────────────────────

  /**
   * Fetch fresh inventory and open the won-ring prompt for the id stashed in
   * er_pending_ring (set by connectToRoom on the server's `wonRing` message).
   * If the ring is no longer in inventory (edge case), clear the flag and bail.
   */
  private async checkPendingWonRing(): Promise<void> {
    const ringId = localStorage.getItem('er_pending_ring');
    if (!ringId || this.wonRingModal || this.battleHand.isOpen()) return;
    const token = localStorage.getItem('er_token');
    if (!token) return;

    let rings: RingData[];
    let carryCap: number;
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: { player: { carry_cap?: number }; rings: RingData[] } = await res.json();
      rings = data.rings;
      carryCap = data.player.carry_cap ?? 10;
    } catch {
      return;
    }

    if (!rings.some((r) => r.id === ringId)) {
      // Ring not in our inventory (shouldn't happen) — clear and bail.
      localStorage.removeItem('er_pending_ring');
      return;
    }

    const carriedCount = rings.filter((r) => r.in_carry === 1).length;
    if (carriedCount >= carryCap) {
      // Carry is full — skip the modal and route straight to Manage Battle Hand,
      // which renders the pending won ring and lets the player discard a carried
      // ring to make room (then auto-carries the pending ring). #110 — the jump
      // to the Manage screen is otherwise unexplained, so flash a banner naming
      // the reason (carry full) and the required action (discard to make room).
      const wonRing = rings.find((r) => r.id === ringId);
      const wonRingEl = wonRing ? (ELEMENT_NAMES[wonRing.element] ?? '?') : 'won';
      const notice = this.add
        .text(
          CANVAS_W / 2,
          80,
          `Carry full (${carriedCount}/${carryCap}) — discard a ring to make room for your ${wonRingEl} ring`,
          {
            fontSize: '15px',
            color: '#ffcc44',
            backgroundColor: '#000000bb',
            padding: { x: 10, y: 6 },
            align: 'center',
            wordWrap: { width: CANVAS_W - 40 },
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(3000);
      this.tweens.add({
        targets: notice,
        alpha: 0,
        delay: 3000,
        duration: 500,
        onComplete: () => notice.destroy(),
      });
      void this.openManageBattleHand();
      return;
    }

    // Carry has room — simple Carry / Discard modal.
    this.showWonRingModal(ringId, rings);
  }

  /**
   * Render the won-ring modal (room case only). Carry is known to have room when
   * this is called — the full-carry path routes to Manage Battle Hand instead.
   * Options: "Carry it" (add to loadout) or "Discard".
   */
  private showWonRingModal(ringId: string, rings: RingData[]): void {
    const ring = rings.find((r) => r.id === ringId);
    if (!ring) {
      localStorage.removeItem('er_pending_ring');
      return;
    }
    this.wonRings = rings;

    const elementName = ELEMENT_NAMES[ring.element] ?? '?';

    const container = this.add.container(0, 0).setDepth(2000);
    const overlay = this.add
      .rectangle(CANVAS_W / 2, 288, CANVAS_W, 576, 0x000000, 0.7)
      .setInteractive();
    const panel = this.add
      .rectangle(CANVAS_W / 2, 288, 460, 200, 0x222233)
      .setStrokeStyle(2, 0xffcc44);
    const title = this.add
      .text(CANVAS_W / 2, 230, `You won a ${elementName} ring!`, {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    container.add([overlay, panel, title]);

    container.add(
      this.wonModalButton(CANVAS_W / 2, 290, '[Carry it]', '#aaffaa', () =>
        void this.resolveWonRing('carry'),
      ),
    );
    container.add(
      this.wonModalButton(CANVAS_W / 2, 330, '[Discard]', '#ff8888', () =>
        void this.resolveWonRing('discard'),
      ),
    );

    this.wonRingModal = container;
    if (window.__encounterState) {
      window.__encounterState.pendingWonRing = { ringId, element: ring.element };
    }
  }

  private wonModalButton(
    x: number,
    y: number,
    label: string,
    color: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, label, { fontSize: '14px', color })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
  }

  /**
   * Resolve the won-ring prompt. Always clears er_pending_ring afterward.
   *   - carry:   add the won ring to the carried loadout.
   *   - discard: permanently delete the won ring.
   */
  private async resolveWonRing(choice: 'carry' | 'discard'): Promise<void> {
    const ringId = localStorage.getItem('er_pending_ring');
    if (!ringId) {
      this.dismissWonModal();
      return;
    }

    if (choice === 'discard') {
      await this.discardWonRing(ringId);
    } else {
      // carry: add the won ring to the current carried set.
      const carried = new Set(this.wonRings.filter((r) => r.in_carry === 1).map((r) => r.id));
      carried.add(ringId);
      await this.putCarry(Array.from(carried));
    }

    localStorage.removeItem('er_pending_ring');
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    this.dismissWonModal();
  }

  /** PUT /api/carry with the full carried set. */
  private async putCarry(ringIds: string[]): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/carry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringIds }),
      });
    } catch {
      this.statusText.setText('Network error during carry update');
    }
  }

  /** DELETE /api/rings/:id — permanently discard a won ring. */
  private async discardWonRing(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/rings/${ringId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.statusText.setText('Network error during discard');
    }
  }

  private dismissWonModal(): void {
    if (this.wonRingModal) {
      this.wonRingModal.destroy(true);
      this.wonRingModal = null;
    }
  }

  // ── Trainer sprite builder ───────────────────────────────────────────────────

  /**
   * Create a randomly-assigned animated trainer sprite (monster overworld OR
   * human charset character). Called once per non-PVP marker on each scene entry
   * so the lineup varies every visit. Monster walk cycle uses the down-facing
   * row (frames 0–2 of the 24×24 overworld strip). Charset walk cycle uses the
   * down-facing frames from charsetFrame() at 2× scale.
   */
  private buildTrainerSprite(x: number, y: number): Phaser.GameObjects.Sprite {
    const isMonster = Math.random() < 0.5;

    if (isMonster) {
      const element = Math.floor(Math.random() * TRAINING_MONSTERS.length);
      const texKey = `enc-mon-${element}`;
      const animKey = `enc-mon-walk-${element}`;
      if (!this.anims.exists(animKey)) {
        this.anims.create({
          key: animKey,
          frames: this.anims.generateFrameNumbers(texKey, { start: 0, end: 2 }),
          frameRate: 6,
          repeat: -1,
        });
      }
      return (this.add.sprite(x, y, texKey, 0) as Phaser.GameObjects.Sprite)
        .setScale(2)
        .play(animKey);
    }

    // Human charset: pick a random character (skip 0 = player avatar).
    const charIdx = 1 + Math.floor(Math.random() * 7);
    const animKey = `enc-charset-walk-${charIdx}`;
    if (!this.anims.exists(animKey)) {
      this.anims.create({
        key: animKey,
        frames: [0, 1, 2, 1].map((col) => ({
          key: CHARSET_KEY,
          frame: charsetFrame(charIdx, 'down', col),
        })),
        frameRate: 6,
        repeat: -1,
      });
    }
    return (this.add.sprite(x, y, CHARSET_KEY, charsetFrame(charIdx, 'down', 1)) as Phaser.GameObjects.Sprite)
      .setScale(2)
      .play(animKey);
  }

  // ── Manage Battle Hand modal (#87 Part D — delegated to BattleHandOverlay) ──

  /**
   * Open the Manage Battle-Hand overlay. The modal cluster (#40/#85) was extracted
   * into the standalone BattleHandOverlay (#87 Part D), which now powers both this
   * scene and the OverworldScene Tab overlay. Preserves the window.__encounter\
   * ManageBattleHand hook (tests depend on the exact name) and the auto-open path.
   */
  private async openManageBattleHand(): Promise<void> {
    await this.battleHand.open();
  }
}
