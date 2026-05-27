import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';
import type { AIPersonality } from '../../../shared/types';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES, THUMB_PASSIVE_INFO } from '../Constants';
import type { RingData } from '../objects/InventoryGrid';

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
type BattleSlot = (typeof BATTLE_SLOTS)[number];

declare const __SERVER_URL__: string;
const _WS_ENC = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = _WS_ENC.replace(/^ws/, 'http');

type Choice = AIPersonality | 'PVP';

interface MarkerSpec {
  choice: Choice;
  label: string;
  fallbackColor: number;
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
  // Battle-hand management modal state (#40). Holds the carried rings, the
  // current loadout, and the open modal container.
  private manageModal: Phaser.GameObjects.Container | null = null;
  private manageSelectedRingId: string | null = null;
  private manageRings: RingData[] = [];
  private manageLoadout: Record<string, string | null> = {};
  // aiSeed per personality — received from /api/encounter/preview and passed to
  // the BattleRoom so the actual loadout matches the stake shown in the preview.
  private aiSeeds: Map<Choice, number> = new Map();
  // Post-battle won-ring prompt (#40). Now fires here (not CampScene) because the
  // post-battle flow returns to EncounterScene — the player must resolve the won
  // ring before selecting another encounter.
  private wonRingModal: Phaser.GameObjects.Container | null = null;
  private wonRings: RingData[] = [];
  // Most recent full /api/me ring list (all owned rings, carried or not). Used by
  // the Manage Battle Hand modal to display a pending won ring, which is not yet
  // carried and so absent from manageRings.
  private allRings: RingData[] = [];
  private managePlayer: any = null;
  private manageStatusText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'EncounterScene' });
  }

  // #83 — when entered from an overworld NPC (OverworldScene/SwampScene start this
  // scene with { npcId, personality }), skip the marker hub and launch the duel
  // directly against that NPC. null on the normal hub entry path.
  private npcDuel: { npcId?: string; personality: AIPersonality } | null = null;

  init(data?: { npcId?: string; personality?: AIPersonality }): void {
    this.busy = false;
    this.manageModal = null;
    this.manageSelectedRingId = null;
    this.wonRingModal = null;
    this.npcDuel =
      data?.personality !== undefined
        ? { npcId: data.npcId, personality: data.personality }
        : null;
  }

  create(): void {
    // #83 — overworld NPC path: bypass the marker hub entirely and go straight into
    // the duel against the detected NPC (scoped by npcId so a win records the
    // defeat server-side). The hub UI/hooks below are skipped on this path.
    if (this.npcDuel) {
      const { npcId, personality } = this.npcDuel;
      // #88 — defensively consume the launch data so it can never be reused. Phaser
      // retains settings.data across a no-data scene.start, so without this a later
      // re-entry of EncounterScene (e.g. a hub return that forgot explicit `{}`)
      // could see the stale { npcId, personality } and auto-relaunch this duel in a
      // loop. Clearing it here means init() reads undefined → npcDuel=null → hub.
      this.scene.settings.data = {};
      this.npcDuel = null;
      void this.startAIDuel(personality, undefined, npcId);
      return;
    }

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

    // Build markers at fixed positions; fill with fallback colors immediately,
    // then update colors + stake labels once the preview fetch resolves.
    const spacing = CANVAS_W / (MARKERS.length + 1);
    const markerY = 170;

    const rects: Map<Choice, Phaser.GameObjects.Rectangle> = new Map();
    const stakeLabels: Map<Choice, Phaser.GameObjects.Text> = new Map();

    MARKERS.forEach((m, i) => {
      const x = spacing * (i + 1);

      const rect = this.add
        .rectangle(x, markerY, 90, 110, m.fallbackColor, 0.85)
        .setStrokeStyle(2, 0xffffff)
        .setInteractive({ useHandCursor: true });
      rects.set(m.choice, rect);

      // Personality label. #85 Fix 4 — 11px + wordWrap(86) + center so longer
      // labels (e.g. "Status-hunter") fit within the 90px card instead of
      // overflowing its edges.
      this.add
        .text(x, markerY - 40, m.label, {
          fontSize: '11px',
          color: '#ffffff',
          align: 'center',
          wordWrap: { width: 86 },
        })
        .setOrigin(0.5);

      // Stake element label (filled in after preview fetch). #85 Fix 4 — set
      // wordWrap(86) at construction (not only when the preview arrives) so the
      // multi-line stake text wraps within the 90px card from the first render.
      const stakeLabel = this.add
        .text(x, markerY + 30, m.choice === 'PVP' ? '' : '…', {
          fontSize: '11px',
          color: '#ffffffaa',
          align: 'center',
          wordWrap: { width: 86 },
        })
        .setOrigin(0.5);
      stakeLabels.set(m.choice, stakeLabel);

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
    // Discard a carried ring (Manage Battle Hand path) — frees a slot and
    // auto-carries any pending won ring. Same code path as the per-ring [×].
    window.__encounterDiscardRing = (ringId: string): void =>
      void this.discardCarriedRing(ringId);
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
    });

    // Fetch stake preview and update marker colors + labels.
    void this.loadPreview(rects, stakeLabels);

    // Post-battle won-ring prompt: if the just-finished duel granted a ring,
    // resolve it here before the player can pick another encounter (#40).
    if (localStorage.getItem('er_pending_ring')) void this.checkPendingWonRing();
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
  ): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/encounter/preview`);
      if (!res.ok) return;
      const preview: Record<
        string,
        { element: number; aiSeed: number; stakeTier: number; stakeXp: number; totalXp: number }
      > = await res.json();

      const published: Record<
        string,
        { element: number; stakeTier: number; stakeXp: number; totalXp: number }
      > = {};

      for (const [personality, entry] of Object.entries(preview)) {
        const { element, aiSeed, stakeTier, stakeXp, totalXp } = entry;
        this.aiSeeds.set(personality as Choice, aiSeed);
        published[personality] = { element, stakeTier, stakeXp, totalXp };

        const rect = rects.get(personality as Choice);
        const label = stakeLabels.get(personality as Choice);
        if (!rect || !label) continue;
        const color = ELEMENT_COLORS[element] ?? 0x888888;
        rect.setFillStyle(color, 0.85);
        // Three lines: stake element · tier · XP, then the loadout's total XP.
        const elementName = ELEMENT_NAMES[element] ?? '?';
        label.setText(
          `Stakes: ${elementName} · T${stakeTier} · ${stakeXp}xp\nTotal XP: ${totalXp}`,
        );
        label.setAlign('center');
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
   */
  private async startAIDuel(
    personality: AIPersonality,
    aiOverrides?: { aiHearts?: number; aiUses?: number },
    npcId?: string,
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
      aiSeed: this.aiSeeds.get(personality),
      npcId,
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
        this.scene.start('BattleScene');
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
    if (!ringId || this.wonRingModal || this.manageModal) return;
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
      // ring to make room (then auto-carries the pending ring).
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

  // ── Manage Battle Hand modal (#40) ─────────────────────────────────────────

  /**
   * Fetch /api/me and open the battle-hand reassignment modal. Only carried
   * rings (in_carry = 1) are offered; selecting one then clicking a slot PUTs
   * /api/loadout. No Sleep/Recharge here — purely loadout-slot editing.
   */
  private async openManageBattleHand(): Promise<void> {
    if (this.manageModal) return;
    const token = localStorage.getItem('er_token');
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: {
        player: any;
        rings: RingData[];
        loadout: Record<string, string | null>;
      } = await res.json();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.manageLoadout = data.loadout ?? {};
    } catch {
      return;
    }
    this.renderManageModal();
  }

  /** Render (or re-render) the manage-battle-hand modal from cached state. */
  private renderManageModal(): void {
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }

    const container = this.add.container(0, 0).setDepth(2000);
    const overlay = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setInteractive();
    const panel = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 640, 520, 0x222233)
      .setStrokeStyle(2, 0xffcc88);
    const title = this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 245, 'Manage Battle Hand', {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const close = this.add
      .text(CANVAS_W / 2 + 290, CANVAS_H / 2 - 245, '✕', { fontSize: '18px', color: '#ff8888' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeManageModal());
    container.add([overlay, panel, title, close]);

    // Player status line — mirrors the Sanctum screen stat bar.
    const p = this.managePlayer;
    const statLine = this.add
      .text(
        CANVAS_W / 2,
        CANVAS_H / 2 - 228,
        p
          ? `Day: ${p.game_day ?? 0} | Gold: ${p.gold ?? 0} | Food: ${p.food_units ?? 0} | Spirit: ${p.spirit_current ?? 0}/${p.spirit_max ?? 0} | XP: ${p.aggregate_xp ?? 0}`
          : '',
        { fontSize: '12px', color: '#ffdd66' },
      )
      .setOrigin(0.5);
    container.add(statLine);

    // Pending won ring (top section). The won ring is not yet carried, so it
    // lives in allRings (full /api/me list), not manageRings. The player frees a
    // carried slot (discard) to make room; tryAutoCarryPending then carries it.
    const pendingId = localStorage.getItem('er_pending_ring');
    const pendingRing = pendingId ? this.allRings.find((r) => r.id === pendingId) : undefined;
    if (pendingRing) {
      const py = CANVAS_H / 2 - 168;
      // Pending-ring tile (left) with the same 4-line info as every other tile.
      const pRect = this.add
        .rectangle(CANVAS_W / 2 - 250, py, 72, 80, ELEMENT_COLORS[pendingRing.element] ?? 0x444444)
        .setStrokeStyle(3, 0xffcc44);
      container.add(pRect);
      this.addRingInfo(container, CANVAS_W / 2 - 250, py, pendingRing);
      const pLbl = this.add
        .text(
          CANVAS_W / 2 - 200,
          py,
          `WON: ${ELEMENT_NAMES[pendingRing.element] ?? '?'} ring — discard a carried ring to keep it`,
          { fontSize: '11px', color: '#ffdd66' },
        )
        .setOrigin(0, 0.5);
      const pDiscard = this.add
        .text(CANVAS_W / 2 + 250, py, '[× Discard]', { fontSize: '11px', color: '#ff8888' })
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          void (async () => {
            await this.resolveWonRing('discard');
            this.renderManageModal();
          })();
        });
      container.add([pLbl, pDiscard]);
      if (window.__encounterState) {
        window.__encounterState.pendingWonRing = { ringId: pendingRing.id, element: pendingRing.element };
      }
    }

    // Battle slots row (top). Filled slots show the same 4-line info as the
    // Sanctum and get a small [×] discard button.
    const slotY = CANVAS_H / 2 - 70;
    BATTLE_SLOTS.forEach((slot, i) => {
      const sx = CANVAS_W / 2 - 240 + i * 120;
      const ringId = this.manageLoadout[slot] ?? null;
      const ring = ringId ? this.manageRings.find((r) => r.id === ringId) : null;
      const color = ring ? ELEMENT_COLORS[ring.element] ?? 0x333333 : 0x333333;
      const slotRect = this.add
        .rectangle(sx, slotY, 92, 80, color)
        .setStrokeStyle(2, 0x888888)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.assignManageSlot(slot));
      const slotLbl = this.add
        .text(sx, slotY - 34, slot.toUpperCase(), { fontSize: '11px', color: '#cccccc' })
        .setOrigin(0.5);
      container.add([slotRect, slotLbl]);
      if (ring) {
        this.addRingInfo(container, sx, slotY, ring);
        const slotX = this.add
          .text(sx + 38, slotY - 32, '×', { fontSize: '13px', color: '#ff3333' })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', (_p: unknown, _x: number, _y: number, evt: { stopPropagation?: () => void }) => {
            evt?.stopPropagation?.();
            void this.discardCarriedRing(ring.id);
          });
        container.add(slotX);
      } else {
        const dash = this.add
          .text(sx, slotY, '—', { fontSize: '11px', color: '#888888' })
          .setOrigin(0.5);
        container.add(dash);
      }
    });

    // #78 ④ — Thumb passive reminder. Mirrors the Sanctum ring-storage overlay so
    // the same staked-passive hint is visible while editing the battle hand before
    // a duel. Derived from loadout.thumb: a base element (0–4) → its named passive;
    // a fusion (5–14, no entry) → an explicit "no passive" note; no Thumb → blank.
    this.renderManagePassive(container, slotY);

    // Carried rings row (selectable) — exclude rings already in a battle slot so
    // the player only sees spare carried rings available for assignment.
    const slottedIds = new Set(Object.values(this.manageLoadout).filter(Boolean) as string[]);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    // #85 Fix 3 — push the carried-rings section down 49px so the label + row clear
    // the (now uncapped) Thumb passive strip below the battle slots. ringY 45→94,
    // carriedLbl y CANVAS_H/2-5 → CANVAS_H/2+44. The 520px panel (y=28–548) still
    // contains the shifted rows.
    const ringY = CANVAS_H / 2 + 94;
    const carriedLbl = this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 44, 'Carried rings (select one, then a slot):', {
        fontSize: '12px',
        color: '#aaccff',
      })
      .setOrigin(0.5);
    container.add(carriedLbl);
    availableRings.forEach((ring, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const rx = CANVAS_W / 2 - 250 + col * 90;
      const ry = ringY + row * 90;
      const selected = this.manageSelectedRingId === ring.id;
      const rect = this.add
        .rectangle(rx, ry, 72, 80, ELEMENT_COLORS[ring.element] ?? 0x444444)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0xffff00 : 0x888888)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.manageSelectedRingId = selected ? null : ring.id;
          this.renderManageModal();
        });
      container.add(rect);
      // 4-line ring info (matches InventoryGrid in the Sanctum).
      this.addRingInfo(container, rx, ry, ring);
      // Per-ring discard button (top-right corner).
      const x = this.add
        .text(rx + 30, ry - 32, '×', { fontSize: '13px', color: '#ff3333' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', (_p: unknown, _x: number, _y: number, evt: { stopPropagation?: () => void }) => {
          evt?.stopPropagation?.();
          void this.discardCarriedRing(ring.id);
        });
      container.add(x);
    });

    // ── Recharge controls (spirit-powered, mirrors Sanctum) ───────────────
    // #85 Fix 3 — shifted 35px down (185→220) to follow the lowered carried-rings
    // row; at y≈508 it stays within the 520px panel (y=28–548).
    const rechargeY = CANVAS_H / 2 + 220;
    const rechargeBtn = this.add
      .text(CANVAS_W / 2 - 100, rechargeY, '[Recharge]', { fontSize: '13px', color: '#ffcc44' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeSelected());
    const rechargeAllBtn = this.add
      .text(CANVAS_W / 2 + 60, rechargeY, '[Recharge All]', { fontSize: '13px', color: '#ffcc44' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeAll());
    this.manageStatusText = this.add
      .text(CANVAS_W / 2, rechargeY + 22, '', { fontSize: '11px', color: '#ff8888' })
      .setOrigin(0.5);
    container.add([rechargeBtn, rechargeAllBtn, this.manageStatusText]);

    this.manageModal = container;
  }

  /**
   * Render the Thumb passive reminder beneath the Thumb battle slot (#78 ④),
   * matching the Sanctum ring-storage overlay's strip. Reads the staked Thumb ring
   * (loadout.thumb) and resolves its passive via THUMB_PASSIVE_INFO — display-only;
   * the server owns the real passive resolution at duel start. The text is
   * constrained to the Thumb slot's column width so it never overlaps the A1/A2/
   * D1/D2 slots to its right. Added to `container` so the modal destroy reclaims it.
   *
   * @param container - the manage-modal container to parent the strip into
   * @param slotY - the y-center of the battle-slots row (Thumb is the first slot)
   */
  private renderManagePassive(container: Phaser.GameObjects.Container, slotY: number): void {
    // Thumb is BATTLE_SLOTS[0]; its slot center matches the slots-row layout
    // (sx = CANVAS_W/2 - 240 + 0 * 120). The 92px-wide slot card bounds the strip.
    const thumbX = CANVAS_W / 2 - 240;
    const thumbRingId = this.manageLoadout.thumb ?? null;
    const thumbRing = thumbRingId ? this.manageRings.find((r) => r.id === thumbRingId) : undefined;
    if (!thumbRing) return; // no Thumb staked → no reminder
    const info = THUMB_PASSIVE_INFO[thumbRing.element];
    const text = info ? `${info.name}\n${info.effect}` : `No passive\nFused rings grant no passive`;
    // #85 Fix 3 — drop the 6-line cap so the longest base passive (WATER/Wellspring,
    // ~65 chars) renders in full. The carried-rings section below was shifted down
    // 49px (renderManageModal) so the now-taller strip never overlaps it.
    const strip = this.add
      .text(thumbX, slotY + 46, text, {
        fontSize: '9px',
        color: '#ffcc88',
        align: 'center',
        wordWrap: { width: 100 },
        lineSpacing: 1,
      })
      .setOrigin(0.5, 0)
      .setName('manage-staked-passive');
    container.add(strip);
  }

  /**
   * Render the 4-line ring info (element name, use pips, XP, tier) centred at
   * (cx, cy) and add the labels to `container`. Mirrors the Sanctum's
   * InventoryGrid tile so stats read identically across screens.
   */
  private addRingInfo(
    container: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    ring: RingData,
  ): void {
    const used = ring.max_uses - ring.current_uses;
    const pips = '●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used));
    const nameLbl = this.add
      .text(cx, cy - 22, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' })
      .setOrigin(0.5);
    const pipsLbl = this.add
      .text(cx, cy - 6, pips, { fontSize: '10px', color: '#000000' })
      .setOrigin(0.5);
    const xpLbl = this.add
      .text(cx, cy + 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' })
      .setOrigin(0.5);
    const tierLbl = this.add
      .text(cx, cy + 24, `T${ring.tier}`, { fontSize: '9px', color: '#000000' })
      .setOrigin(0.5);
    container.add([nameLbl, pipsLbl, xpLbl, tierLbl]);
  }

  /** Assign the selected carried ring to a battle slot via PUT /api/loadout. */
  private async assignManageSlot(slot: BattleSlot): Promise<void> {
    if (!this.manageSelectedRingId) {
      this.statusText.setText('Select a carried ring first');
      return;
    }
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [slot]: this.manageSelectedRingId }),
      });
      if (!res.ok) return;
      // Refresh loadout from the response so the modal re-renders accurately.
      const meRes = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meRes.ok) {
        const data: { player: any; rings: RingData[]; loadout: Record<string, string | null> } =
          await meRes.json();
        this.managePlayer = data.player;
        this.manageRings = data.rings.filter((r) => r.in_carry === 1);
        this.manageLoadout = data.loadout ?? {};
      }
    } catch {
      return;
    }
    this.manageSelectedRingId = null;
    this.renderManageModal();
  }

  private closeManageModal(): void {
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    this.manageSelectedRingId = null;
    this.manageStatusText = null;
  }

  /** Recharge the currently selected ring using spirit. */
  private async doManageRechargeSelected(): Promise<void> {
    if (!this.manageSelectedRingId) {
      this.setManageStatus('Select a ring to recharge');
      return;
    }
    await this.doManageRechargeById(this.manageSelectedRingId);
  }

  /** POST /api/spirit/recharge for a specific ring id. */
  private async doManageRechargeById(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId }),
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        this.setManageStatus(body?.error ?? 'Recharge not available');
        return;
      }
      if (!res.ok) {
        this.setManageStatus(`Recharge failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge');
      return;
    }
    await this.refreshManageData();
  }

  /** POST /api/spirit/recharge-all — fill carried rings in priority order. */
  private async doManageRechargeAll(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.setManageStatus(`Recharge-all failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge-all');
      return;
    }
    await this.refreshManageData();
  }

  /** Re-fetch /api/me and re-render the manage modal with fresh data. */
  private async refreshManageData(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: {
        player: any;
        rings: RingData[];
        loadout: Record<string, string | null>;
      } = await res.json();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.manageLoadout = data.loadout ?? {};
    } catch {
      return;
    }
    this.renderManageModal();
  }

  private setManageStatus(msg: string): void {
    if (this.manageStatusText) this.manageStatusText.setText(msg);
  }

  /**
   * Permanently discard a carried ring (DELETE /api/rings/:id), then reload the
   * Manage Battle Hand data. If a won ring is pending, discarding frees a carry
   * slot, so try to auto-carry it afterward.
   */
  private async discardCarriedRing(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token') ?? '';
    try {
      await fetch(`${API_BASE}/api/rings/${ringId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.statusText.setText('Network error during discard');
      return;
    }
    // Re-open (refetch + re-render) the modal with current data, then attempt to
    // place the pending won ring now that a slot may be free.
    this.closeManageModal();
    await this.openManageBattleHand();
    await this.tryAutoCarryPending();
  }

  /**
   * If a won ring is pending and carry now has room, carry it: PUT /api/carry
   * with the current carried set plus the pending ring, clear er_pending_ring,
   * and re-render the modal so the ring shows as carried.
   */
  private async tryAutoCarryPending(): Promise<void> {
    const pendingId = localStorage.getItem('er_pending_ring');
    if (!pendingId) return;
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

    // The pending ring may have been discarded itself; bail if it's gone.
    if (!rings.some((r) => r.id === pendingId)) {
      localStorage.removeItem('er_pending_ring');
      return;
    }

    const carriedCount = rings.filter((r) => r.in_carry === 1).length;
    if (carriedCount >= carryCap) return; // still full — wait for another discard

    const carried = new Set(rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    carried.add(pendingId);
    await this.putCarry(Array.from(carried));

    localStorage.removeItem('er_pending_ring');
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;

    // Re-render with the pending ring now carried (and no longer "pending").
    this.closeManageModal();
    await this.openManageBattleHand();
  }
}
