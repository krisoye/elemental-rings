import { Schema, type } from '@colyseus/schema';

export class Ring extends Schema {
  @type('uint8') element: number = 0;
  @type('uint8') currentUses: number = 3;
  @type('uint8') maxUses: number = 3;
  @type('boolean') isExtinguished: boolean = false;
}
