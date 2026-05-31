import { describe, it, expect } from 'vitest';
import { NPC_SPAWNS } from '../../server/src/persistence/NpcSpawns';
import { TEMPLATES } from '../../server/src/game/ai/AILoadout';

// Valid thumb elements per personality — mirrors AILoadout.ts TEMPLATES.
// Each NPC's element must be in this set or the battle falls back to a random
// template, causing overworld element ≠ battle thumb (the bug fixed here).
const VALID_THUMBS: Record<string, Set<number>> = {
  AGGRESSIVE:    new Set(TEMPLATES.AGGRESSIVE.map((t) => t.thumb)),
  DEFENSIVE:     new Set(TEMPLATES.DEFENSIVE.map((t) => t.thumb)),
  STATUS_HUNTER: new Set(TEMPLATES.STATUS_HUNTER.map((t) => t.thumb)),
  RESILIENT:     new Set(TEMPLATES.RESILIENT.map((t) => t.thumb)),
};

describe('NPC spawn table — personality/element consistency', () => {
  it('every spawn element has a matching thumb template for its personality', () => {
    for (const npc of NPC_SPAWNS) {
      const valid = VALID_THUMBS[npc.personality];
      expect(
        valid?.has(npc.element),
        `${npc.id}: element ${npc.element} has no ${npc.personality} template with that thumb`,
      ).toBe(true);
    }
  });
});
