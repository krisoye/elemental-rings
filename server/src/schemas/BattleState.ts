import { Schema, MapSchema, type } from '@colyseus/schema';
import { PlayerState } from './PlayerState';

export class BattleState extends Schema {
  @type('string') phase: string = 'WAITING';
  @type('string') currentAttackerId: string = '';
  // The slot the current attacker is firing. During a normal attack this is
  // 'a1'|'a2'; during a rally volley it holds the parrying defense slot
  // ('d1'|'d2'). Treat it as a generic SlotKey. '' when none.
  @type('string') attackerSlot: string = '';
  // The defense slot recorded for the last/current exchange ('d1'|'d2'); '' when none.
  @type('string') defenderSlot: string = '';
  @type('uint8') volleyedElement: number = 0;
  @type('boolean') rallyActive: boolean = false;
  @type('string') winnerId: string = '';
  // Travel duration (ms) the client must use for the orb launched on the current
  // DEFEND_WINDOW entry. 0 = client falls back to TELEGRAPH_MS (safe default for
  // the _resolveOrb2 orb-2 continuation path which has no new impactTime assignment).
  @type('uint16') telegraphMs: number = 0;
  @type({ map: PlayerState }) players: MapSchema<PlayerState> = new MapSchema<PlayerState>();
}
