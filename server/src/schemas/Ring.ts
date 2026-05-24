import { Schema, ArraySchema, type } from '@colyseus/schema';

export class Ring extends Schema {
  @type('uint8') element: number = 0;
  @type('uint8') currentUses: number = 3;
  @type('uint8') maxUses: number = 3;
  @type('boolean') isExtinguished: boolean = false;
  // Fusion metadata. Base rings: isFusion=false, fusionParents empty.
  // Fusion rings: isFusion=true, fusionParents holds its 2 component elements
  // (first entry is the auto-align tiebreak winner — see Fusions.ts).
  @type('boolean') isFusion: boolean = false;
  @type(['uint8']) fusionParents: ArraySchema<number> = new ArraySchema<number>();
}
