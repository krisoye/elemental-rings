import { Schema, ArraySchema, type } from '@colyseus/schema';
import { Ring } from './Ring';

export class PlayerState extends Schema {
  @type('string') playerId: string = '';
  @type('uint8') hearts: number = 3;
  @type([Ring]) hand: ArraySchema<Ring> = new ArraySchema<Ring>();
  @type('int8') selectedSlot: number = -1;
}
