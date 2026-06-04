import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';
import type { AIPersonality } from '../../../shared/types';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';
import type { RingData } from '../objects/InventoryGrid';
import { BattleHandOverlay } from '../objects/BattleHandOverlay';
import { CHARSET_KEY, charsetFrame, preloadCharset } from '../objects/world/charset';
import { FusedCardFill } from '../objects/fusedFill';
import { MONSTER_OW_REGISTRY } from '../objects/world/NpcSpriteRegistry';
import { apiFetch, fetchMe, getToken } from '../net/api';

/**
 * #262 — a defeated boss eligible for a TRAINING-screen rematch (practice). Served
 * by GET /api/encounter/bosses; mirrors that response shape.
 */
interface RematchBoss {
  id: string;
  name: string;
  tier: string;
  personality: AIPersonality;
  /** The boss's thematic FUSION (staked on the thumb in the rematch). */
  element: number;
  aiSeed: number;
  /** Overworld monster frame (no fusion frame exists). */
  spriteFrame: number;
  /** The boss's triangle element — keys MONSTER_OW_REGISTRY for the battle sprite. */
  spriteElement: number;
}

// One overworld sprite per element pool — each is a 72×96 strip (3 cols × 4 rows, 24×24 per frame).
const TRAINING_MONSTERS = [
  'assets/monsters/monster_fire_02_alt01_overworld.png',       // FIRE (0)
  'assets/monsters/monster_water_grass_19_alt01_overworld.png', // WATER (1)
  'assets/monsters/monster_electro_ghost_14_alt01_overworld.png', // EARTH (2)
  'assets/monsters/monster_water_fly_11_alt01_overworld.png',   // WIND (3)
  'assets/monsters/monster_water_grass_20_alt01_overworld.png', // WOOD (4)
] as const;

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
  // EPIC #378 — wonRingModal is kept for modal open/dismiss; wonRings is removed
  // (the WON ring is now in carry already; we no longer build a dedicated modal).
  private wonRingModal: Phaser.GameObjects.Container | null = null;
  // #244 — the player's battle-hand weighted-average ring XP, resolved from the
  // preview response (server-authoritative). Threaded into each vsAI room join so
  // the AI loadout scales to the rings the player brings. 0 until the preview
  // fetch resolves.
  private playerBattleHandAvgXp = 0;
  // #262 — defeated bosses available for a practice rematch, fetched on create.
  private rematchBosses: RematchBoss[] = [];

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
      // EPIC #319 (A2) — catch any server rejection (e.g. ServerError 4000/4001)
      // so the player is returned to the overworld rather than seeing a dark screen.
      void this.startAIDuel(
        personality,
        undefined,
        npcId,
        ambush,
        aiSeed,
        spriteFrame,
        battleKey,
        thumbElement,
      ).catch((err: unknown) => {
        const code = (err as any)?.code as number | undefined;
        const hint =
          code === 4000 ? 'Equip & recharge a heart ring to fight' :
          code === 4001 ? 'Stake a ring to fight' :
          'Could not start battle — try again';
        const origin = window.__duelOrigin;
        if (origin) {
          this.scene.start(origin.scene, {
            returnX: origin.x,
            returnY: origin.y,
            screenId: origin.screenId,
            hint,
          });
        } else {
          // No origin: fall back to the EncounterScene hub (not CampScene — the hub
          // is the logical parent of an NPC duel and is closer to what the player
          // expects). Known limitation: the hint string cannot be shown here because
          // statusText is only created on the hub path (after the npcDuel early-return)
          // and scene.start() triggers a fresh create() cycle where the stale hint is
          // no longer available. The player sees the hub without feedback in this case.
          this.scene.start('EncounterScene', {});
        }
      });
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
    // playerBattleHandAvgXp). PVP markers get no difficulty label.
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
    // #262 — launch a practice rematch by boss id (same code path as a card click).
    window.__encounterRematchBoss = (bossId: string): void => this.rematchBoss(bossId);
    // Published once the boss list resolves so E2E can assert the rematch row.
    window.__encounterBosses = [];
    this.events.once('shutdown', () => {
      window.__encounterSelect = undefined;
      window.__encounterSelectWithOverrides = undefined;
      window.__encounterSelectPvP = undefined;
      window.__encounterManageBattleHand = undefined;
      window.__encounterResolveWonRing = undefined;
      window.__encounterDiscardRing = undefined;
      window.__encounterState = undefined;
      window.__encounterPreview = undefined;
      window.__encounterRematchBoss = undefined;
      window.__encounterBosses = undefined;
      this.battleHand?.destroy();
    });

    // Fetch stake preview and update marker colors + labels.
    void this.loadPreview(rects, stakeLabels, diffLabels);

    // #262 — fetch defeated bosses and render the rematch row below the markers.
    void this.loadRematchBosses();

    // Post-battle won-ring prompt: if the just-finished duel granted a ring,
    // resolve it here before the player can pick another encounter (#40).
    // EPIC #378 — pending state is now server-authoritative; always check /api/me.
    void this.checkPendingWonRing();

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
      // #196 — apiFetch sends the auth token so the server scales each opponent to
      // this player's aggregate XP. Anonymous (no token) requests fall back to 0.
      const res = await apiFetch('/api/encounter/preview');
      if (!res.ok) return;
      // The response carries a top-level numeric `playerBattleHandAvgXp` alongside
      // the per-personality preview objects (#244), so the value type is a union.
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

      const rawPlayerXp = preview.playerBattleHandAvgXp;
      this.playerBattleHandAvgXp = typeof rawPlayerXp === 'number' ? rawPlayerXp : 0;

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
        // Skip the top-level playerBattleHandAvgXp scalar — only personality objects.
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
          const diff = difficultyLabel(npcEffectiveXp, this.playerBattleHandAvgXp);
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
   * #262 — fetch the bosses this player has defeated and render a "Rematch" row of
   * practice cards below the 5 training markers. Empty/failed fetch → no row.
   * Publishes window.__encounterBosses for the E2E harness.
   */
  private async loadRematchBosses(): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/encounter/bosses');
      if (!res.ok) return;
      const { bosses } = (await res.json()) as { bosses: RematchBoss[] };
      this.rematchBosses = bosses ?? [];
      window.__encounterBosses = this.rematchBosses;
      if (this.rematchBosses.length > 0) this.renderRematchRow();
    } catch {
      // Non-fatal — the rematch row simply does not appear.
    }
  }

  /**
   * Render one practice-rematch card per defeated boss below the training markers.
   * Each card shows the boss name, tier, and its fused thumb element (two-tone via
   * #263). Click/tap launches a no-npcId practice duel against that boss.
   */
  private renderRematchRow(): void {
    const rowY = 380;
    this.add
      .text(CANVAS_W / 2, rowY - 80, 'Rematch (practice)', {
        fontSize: '16px',
        color: '#ffcc88',
      })
      .setOrigin(0.5);

    const spacing = CANVAS_W / (this.rematchBosses.length + 1);
    const CARD_W = 90;
    const CARD_H = 96;

    this.rematchBosses.forEach((boss, i) => {
      const x = spacing * (i + 1);
      const card = this.add.container(x, rowY);

      const bg = this.add
        .rectangle(0, 0, CARD_W, CARD_H, 0x333333)
        .setStrokeStyle(2, 0xffaa44)
        .setInteractive({ useHandCursor: true });
      card.add(bg);

      // #263 — two-tone fused-thumb swatch (boss.element is the fusion). No parent
      // XP on a boss thumb → static componentsOf order, matching the duel thumb.
      const fill = new FusedCardFill(this, card, 0, -10, 60, 40);
      fill.paint(boss.element);

      this.add
        .text(x, rowY - 38, boss.name, {
          fontSize: '10px',
          color: '#ffffff',
          align: 'center',
          wordWrap: { width: CARD_W - 6 },
        })
        .setOrigin(0.5);
      this.add
        .text(x, rowY + 30, `${boss.tier} · ${ELEMENT_NAMES[boss.element] ?? '?'}`, {
          fontSize: '9px',
          color: '#ffddaa',
          align: 'center',
        })
        .setOrigin(0.5);

      bg.on('pointerdown', () => this.rematchBoss(boss.id));
    });
  }

  /**
   * #262 — launch a practice rematch against a defeated boss. Pure practice: NO
   * npcId (so no defeat-state change, no won-ring grant, no gold penalty — all
   * gated on the npcId path server-side), the boss's fused thumb + stable aiSeed,
   * and the boss's overworld battle sprite. No-op if the boss id is unknown or a
   * duel is already starting.
   */
  private rematchBoss(bossId: string): void {
    if (this.busy) return;
    const boss = this.rematchBosses.find((b) => b.id === bossId);
    if (!boss) return;
    this.busy = true;
    this.statusText.setText(`Rematch vs ${boss.name}...`);
    const battleKey = MONSTER_OW_REGISTRY[boss.spriteElement]?.battleKey;
    void this.startAIDuel(
      boss.personality,
      undefined,  // no aiOverrides
      undefined,  // NO npcId
      false,      // no ambush
      boss.aiSeed,
      boss.spriteFrame,
      battleKey,
      boss.element, // fused thumb
      true,         // isPracticeRematch → server skips all economy
    );
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
    isPracticeRematch?: boolean,
  ): Promise<void> {
    const token = getToken() ?? '';
    if (!isPracticeRematch) {
      try {
        await apiFetch('/api/stake/lock', { method: 'POST' });
      } catch { /* non-fatal */ }
    }
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
      // #244 — the player's battle-hand average XP (from the preview response) so
      // the AI loadout scales to the rings the player brings. Only sent when known
      // (> 0); when omitted (e.g. the NPC-duel path that skips the preview), the
      // server re-resolves it from the token as the authority. Sending 0 would
      // suppress that lookup (nullish-coalescing treats 0 as present), so it is
      // left off.
      ...(this.playerBattleHandAvgXp > 0
        ? { playerBattleHandAvgXp: this.playerBattleHandAvgXp }
        : {}),
      ...aiOverrides,
      ...(isPracticeRematch ? { isPracticeRematch: true } : {}),
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
   * EPIC #378 — Fetch fresh inventory and open the won-ring prompt if
   * `pending_ring_id` is set on the server. The WON ring is already `in_carry=1`
   * (spare overflow) — no explicit carry step is needed. The Manage Battle Hand
   * overlay resolves the overflow (assign to slot, accept as spare, or discard).
   *
   * Old flow: read `er_pending_ring` localStorage key (fragile).
   * New flow: read `pending_ring_id` from `/api/me` (server-authoritative).
   */
  private async checkPendingWonRing(): Promise<void> {
    // Guard against concurrent dispatch: openBattleHandOnCreate and checkPendingWonRing may both fire in create()
    if (this.wonRingModal || this.battleHand.isOpen()) return;
    if (!getToken()) return;

    let rings: RingData[];
    let pendingRingId: string | null;
    try {
      const data = await fetchMe<{
        player: { carry_cap?: number; spare_ring_max?: number; pending_ring_id?: string | null };
        rings: RingData[];
      }>();
      rings = data.rings;
      pendingRingId = data.player.pending_ring_id ?? null;
    } catch {
      return;
    }

    if (!pendingRingId) return; // no pending WON ring

    const ringId = pendingRingId;
    if (!rings.some((r) => r.id === ringId)) {
      // Ring not in our inventory (edge case: already resolved). No-op.
      return;
    }

    // EPIC #378 — the WON ring is already in_carry=1 (spare overflow). The Manage
    // Battle Hand overlay is the resolution surface. Route there with a banner
    // naming the won ring and instructing the player to resolve the overflow.
    const wonRing = rings.find((r) => r.id === ringId);
    const wonRingEl = wonRing ? (ELEMENT_NAMES[wonRing.element] ?? '?') : 'won';
    const notice = this.add
      .text(
        CANVAS_W / 2,
        80,
        `You won a ${wonRingEl} ring! Manage your rings to resolve it`,
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
    if (window.__encounterState) {
      window.__encounterState.pendingWonRing = { ringId, element: wonRing?.element ?? 0 };
    }
    void this.openManageBattleHand();
  }

  /**
   * EPIC #378 — resolve the won-ring prompt via the server-authoritative pending
   * ring id. The WON ring is already `in_carry=1`:
   *  - 'carry' (accept as spare): PUT /api/rings/:id/accept — clears `pending` on
   *    the server. Only succeeds when spare ≤ spare_ring_max.
   *  - 'discard': DELETE /api/rings/:id — server clears `pending` via discardRing.
   *
   * Exposed on `window.__encounterResolveWonRing` for E2E tests.
   */
  private async resolveWonRing(choice: 'carry' | 'discard'): Promise<void> {
    if (!getToken()) return;
    let ringId: string | null;
    try {
      const data = await fetchMe<{ player: { pending_ring_id?: string | null } }>();
      ringId = data.player.pending_ring_id ?? null;
    } catch {
      return;
    }
    if (!ringId) {
      this.dismissWonModal();
      return;
    }

    try {
      if (choice === 'discard') {
        const res = await apiFetch(`/api/rings/${ringId}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          this.statusText?.setText((body as { error?: string }).error ?? 'Something went wrong');
          return; // do NOT dismiss modal or clear pendingWonRing
        }
      } else {
        // 'carry': accept the WON ring as a regular spare (clears pending server-side).
        const res = await apiFetch(`/api/rings/${ringId}/accept`, { method: 'PUT' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          this.statusText?.setText((body as { error?: string }).error ?? 'Something went wrong');
          return; // do NOT dismiss modal or clear pendingWonRing
        }
      }
    } catch {
      this.statusText?.setText('Network error during ring resolution');
      return;
    }

    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    this.dismissWonModal();
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
