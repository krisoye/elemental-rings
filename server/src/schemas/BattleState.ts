import { Schema, MapSchema, type } from '@colyseus/schema';
import { PlayerState } from './PlayerState';

export class BattleState extends Schema {
  @type('string') phase: string = 'WAITING';
  @type('string') currentAttackerId: string = '';
  @type('int8') attackerSelectedSlot: number = -1;
  @type('int8') defenderSelectedSlot: number = -1;
  @type('uint8') volleyedElement: number = 0;
  @type('boolean') rallyActive: boolean = false;
  @type('string') winnerId: string = '';
  @type({ map: PlayerState }) players: MapSchema<PlayerState> = new MapSchema<PlayerState>();
}
