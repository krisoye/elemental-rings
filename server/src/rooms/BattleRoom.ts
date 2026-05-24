import { Room, Client } from 'colyseus';
import { BattleState } from '../schemas/BattleState';
import { PlayerState } from '../schemas/PlayerState';
import { Ring } from '../schemas/Ring';
import { ArraySchema } from '@colyseus/schema';
import { relationship } from '../game/ElementSystem';
import { classifyTiming, resolveBlock } from '../game/BlockResolver';
import {
  TELEGRAPH_MS,
  DEFEND_WINDOW_MS,
  STARTING_HEARTS,
  STARTING_USES,
} from '../game/constants';
import {
  SelectAttackPayload,
  SubmitDefensePayload,
  ExchangeResultPayload,
} from '../../../shared/types';

export class BattleRoom extends Room<{ state: BattleState }> {
  private impactTime: number = 0;
  private defenseSubmitted: boolean = false;
  private defenseSlot: number = -1;
  private defensePressTime: number = 0;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;

  onCreate() {
    this.setState(new BattleState());
    this.maxClients = 2;

    this.onMessage('selectAttack', (client, payload: SelectAttackPayload) => {
      const state = this.state;
      if (state.phase !== 'ATTACK_SELECT') return;
      if (client.sessionId !== state.currentAttackerId) return;

      const attacker = state.players.get(client.sessionId)!;
      const slot = payload.slot;
      if (slot < 0 || slot >= attacker.hand.length) return;

      const ring = attacker.hand[slot];
      if (ring.isExtinguished) return;

      // Attacker pays 1 use to throw
      ring.currentUses = Math.max(0, ring.currentUses - 1);
      ring.isExtinguished = ring.currentUses === 0;

      state.attackerSelectedSlot = slot;
      state.phase = 'DEFEND_WINDOW';

      this.impactTime = Date.now() + TELEGRAPH_MS;
      this.defenseSubmitted = false;
      this.defenseSlot = -1;
      this.defensePressTime = 0;

      this.windowTimer = setTimeout(() => this._resolveExchange(), DEFEND_WINDOW_MS);
    });

    this.onMessage('submitDefense', (client, payload: SubmitDefensePayload) => {
      const state = this.state;
      if (state.phase !== 'DEFEND_WINDOW') return;
      if (client.sessionId === state.currentAttackerId) return;

      if (!this.defenseSubmitted) {
        this.defenseSubmitted = true;
        this.defenseSlot = payload.slot;
        // Server-authoritative timing: timestamp on message ARRIVAL, ignoring
        // the client-supplied payload.pressTime (retained for future lag comp).
        this.defensePressTime = Date.now();
      }
    });
  }

  onJoin(client: Client) {
    const ps = new PlayerState();
    ps.playerId = client.sessionId;
    ps.hearts = STARTING_HEARTS;
    ps.hand = new ArraySchema<Ring>();

    // Give each player 5 rings, one per element
    for (let el = 0; el < 5; el++) {
      const ring = new Ring();
      ring.element = el;
      ring.currentUses = STARTING_USES;
      ring.maxUses = STARTING_USES;
      ps.hand.push(ring);
    }

    this.state.players.set(client.sessionId, ps);

    if (this.state.players.size === 2) {
      const ids = Array.from(this.state.players.keys());
      this.state.currentAttackerId = ids[0];
      this.state.phase = 'ATTACK_SELECT';
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  private _resolveExchange() {
    if (this.windowTimer) { clearTimeout(this.windowTimer); this.windowTimer = null; }
    const state = this.state;
    state.phase = 'RESOLVE';

    const attackerId = state.currentAttackerId;
    const ids = Array.from(state.players.keys());
    const defenderId = ids.find(id => id !== attackerId)!;

    const attackerPlayer = state.players.get(attackerId)!;
    const defenderPlayer = state.players.get(defenderId)!;

    const attackerRing = attackerPlayer.hand[state.attackerSelectedSlot];
    const defenderRing = this.defenseSubmitted && this.defenseSlot >= 0
      ? defenderPlayer.hand[this.defenseSlot]
      : null;

    const offsetMs = this.defensePressTime - this.impactTime;
    const timing = classifyTiming(offsetMs, this.defenseSubmitted);
    const rel = defenderRing
      ? relationship(attackerRing.element, defenderRing.element)
      : 'NEUTRAL';

    const result = resolveBlock(attackerRing, defenderRing ?? new Ring(), timing, rel);

    if (result.defenderHeartLost) {
      defenderPlayer.hearts = Math.max(0, defenderPlayer.hearts - 1);
    }
    if (result.attackerHeartLost) {
      attackerPlayer.hearts = Math.max(0, attackerPlayer.hearts - 1);
    }

    // CHANGE 3: attack landed uncontested -> fill the defender's gauge for the
    // attacking ring's element, capped at 8 (2x the GDD §6.1 threshold of 4).
    if (result.gaugeIncreases) {
      const gaugeKeys = ['fireGauge', 'waterGauge', 'earthGauge', 'windGauge', 'woodGauge'] as const;
      const key = gaugeKeys[attackerRing.element];
      defenderPlayer[key] = Math.min(8, defenderPlayer[key] + 1);
    }

    if (defenderRing && this.defenseSlot >= 0) {
      state.defenderSelectedSlot = this.defenseSlot;
    }

    // CHANGE 4: broadcast THIS exchange's result BEFORE any KO early-return or
    // the rally swap, so the slots/ids captured reflect this exchange (the rally
    // branch below reassigns state.currentAttackerId / state.attackerSelectedSlot).
    // this.defenseSlot is -1 when no defense was submitted.
    const exchangeResult: ExchangeResultPayload = {
      attackerId,
      defenderId,
      attackerSlot: state.attackerSelectedSlot,
      defenderSlot: this.defenseSlot,
      attackerElements: [attackerRing.element],
      timing,
      relationship: rel,
      defenderHeartLost: result.defenderHeartLost,
      rallyContinues: result.rallyContinues,
      volleyedElement: result.volleyedElement,
      gaugeIncreases: result.gaugeIncreases,
    };
    this.broadcast('exchangeResult', exchangeResult);

    if (defenderPlayer.hearts <= 0) {
      state.winnerId = attackerId;
      state.phase = 'ENDED';
      return;
    }
    if (attackerPlayer.hearts <= 0) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      return;
    }

    state.rallyActive = result.rallyContinues;
    state.volleyedElement = result.volleyedElement;

    if (result.rallyContinues) {
      // Swap roles: former defender becomes attacker in DEFEND_WINDOW (no ATTACK_SELECT)
      // The parry already cost 1 use (in BlockResolver) — no extra charge for the volley.
      state.currentAttackerId = defenderId;
      state.attackerSelectedSlot = this.defenseSlot;
      this.defenseSubmitted = false;
      this.defenseSlot = -1;
      this.defensePressTime = 0;
      this.impactTime = Date.now() + TELEGRAPH_MS;
      state.phase = 'DEFEND_WINDOW';
      this.windowTimer = setTimeout(() => this._resolveExchange(), DEFEND_WINDOW_MS);
    } else {
      // Normal: swap roles, go to ATTACK_SELECT
      state.currentAttackerId = defenderId;
      state.attackerSelectedSlot = -1;
      state.defenderSelectedSlot = -1;
      state.rallyActive = false;
      state.volleyedElement = 0;
      state.phase = 'ATTACK_SELECT';
    }
  }

  onDispose() {
    if (this.windowTimer) clearTimeout(this.windowTimer);
  }
}
