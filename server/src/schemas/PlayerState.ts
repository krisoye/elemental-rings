import { Schema, ArraySchema, type } from '@colyseus/schema';
import { Ring } from './Ring';

export class PlayerState extends Schema {
  @type('string') playerId: string = '';
  @type('uint8') hearts: number = 3;
  @type([Ring]) hand: ArraySchema<Ring> = new ArraySchema<Ring>();
  @type('int8') selectedSlot: number = -1;

  // Elemental gauges — fill when an attack of that element lands uncontested.
  // Indexed to match ElementEnum: FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4.
  @type('uint8') fireGauge: number = 0;
  @type('uint8') waterGauge: number = 0;
  @type('uint8') earthGauge: number = 0;
  @type('uint8') windGauge: number = 0;
  @type('uint8') woodGauge: number = 0;
}
