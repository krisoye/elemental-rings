import { Schema, type } from '@colyseus/schema';
import { Ring } from './Ring';
import { SlotKey } from '../../../shared/types';

export class PlayerState extends Schema {
  @type('string') playerId: string = '';
  // Human duelists leave this empty; an AI opponent shows its personality name
  // here so the client HUD can label it.
  @type('string') displayName: string = '';
  @type('uint8') hearts: number = 3;

  // #259 — boss phase-2. Set true once on the AI PlayerState when a major boss's
  // hearts cross to ≤ its enrage threshold; broadcast so the client can show a
  // one-shot "roars!" banner + red tint/pulse on the opponent. Always false for
  // humans, non-enraging bosses (gate/sub), and non-boss AI.
  @type('boolean') enraged: boolean = false;

  // Named loadout slots (GDD §6.1). Each is always assigned by seatPlayer.
  // thumb is a passive staked ring — never pressed in combat.
  @type(Ring) thumb: Ring = new Ring();
  @type(Ring) a1: Ring = new Ring();
  @type(Ring) a2: Ring = new Ring();
  @type(Ring) d1: Ring = new Ring();
  @type(Ring) d2: Ring = new Ring();

  // Elemental gauges — one per triangle element (FIRE/WATER/WOOD). Fill when an
  // attack with that triangle component lands uncontested. Wind/Earth have no
  // gauge (GDD §7.1). float32 (not uint8) so tier-reduced block deltas
  // (delta = 1/2^tier, e.g. 0.25 at Tier 2) accumulate fractionally; the HUD
  // floors for display and status thresholds compare the raw float (#179, C6).
  @type('float32') fireGauge: number = 0;
  @type('float32') waterGauge: number = 0;
  @type('float32') woodGauge: number = 0;
  // Shadow gauge (#134, GDD §7.1/§3.5). Fills like the triangle gauges (four-case
  // model) but caps at 5 and triggers Blinded at any stack (≥ 1). Shadow sits
  // outside the triangle, so it is tracked separately here.
  @type('uint8') shadowGauge: number = 0;

  // #171 — XP-driven spare carry capacity (GDD §4.1). spare_slots = ceil(log_2(aggregate_xp))
  // derived from Reliquary ring XP (in_carry = 0). carry_cap = 5 + spare_slots. Broadcast
  // so the client HUD can show available spare slots without a separate REST call.
  @type('uint8') spareCapacity: number = 0;

  // #211 — Spirit gauge (DB-derived; only meaningful for human/token sessions). uint16 —
  // spirit_max = SUM(Reliquary max_uses) × difficulty multiplier (EPIC #279) can exceed 255.
  // AI / no-token sessions leave these at 0, which the HUD treats as "hide".
  // Only the LOCAL player's spirit is meaningful info to surface; the opponent's
  // is private (the client HUD only ever renders state.players.get(myId)).
  @type('uint16') spiritCurrent: number = 0;
  @type('uint16') spiritMax: number = 0;

  /**
   * Server-only helper (NOT a @type) to read a ring by its named slot key.
   * Lets BattleRoom / AI address slots generically (e.g. via state.attackerSlot).
   */
  getSlot(key: SlotKey): Ring {
    switch (key) {
      case 'thumb':
        return this.thumb;
      case 'a1':
        return this.a1;
      case 'a2':
        return this.a2;
      case 'd1':
        return this.d1;
      case 'd2':
        return this.d2;
    }
  }
}
