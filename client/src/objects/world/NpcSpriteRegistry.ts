// Canonical overworld sprite per monster element (0–4 = FIRE…WOOD), EPIC #149 / #158.
//
// Each entry's `battleKey` is the EXACT battle texture key BattleScene registers
// (`battle-monster-${element}-${index}`, where `index` is the 0-based position in
// MONSTER_BATTLERS[element]) — so the overworld marker and the battler are the same
// creature. Indices verified against MONSTER_BATTLERS in BattleScene.ts:
//   FIRE  monster_fire_02_alt03          → MONSTER_BATTLERS[0][1]  → battle-monster-0-1
//   WATER monster_water_grass_19_alt03   → MONSTER_BATTLERS[1][1]  → battle-monster-1-1
//   EARTH monster_electro_ghost_14_alt01 → MONSTER_BATTLERS[2][0]  → battle-monster-2-0
//   WIND  monster_water_fly_11_alt01     → MONSTER_BATTLERS[3][0]  → battle-monster-3-0
//   WOOD  monster_water_grass_20_alt01   → MONSTER_BATTLERS[4][0]  → battle-monster-4-0
export interface MonsterOWEntry {
  /** Phaser texture key for the overworld image. */
  key: string;
  /** Asset path relative to the served `assets/` root. */
  path: string;
  /** Battle texture key matching this variant — forwarded so the battler matches. */
  battleKey: string;
}

export const MONSTER_OW_REGISTRY: Record<number, MonsterOWEntry> = {
  0: { key: 'npc-ow-fire', path: 'assets/monsters/monster_fire_02_alt03_overworld.png', battleKey: 'battle-monster-0-1' },
  1: { key: 'npc-ow-water', path: 'assets/monsters/monster_water_grass_19_alt03_overworld.png', battleKey: 'battle-monster-1-1' },
  2: { key: 'npc-ow-earth', path: 'assets/monsters/monster_electro_ghost_14_alt01_overworld.png', battleKey: 'battle-monster-2-0' },
  3: { key: 'npc-ow-wind', path: 'assets/monsters/monster_water_fly_11_alt01_overworld.png', battleKey: 'battle-monster-3-0' },
  4: { key: 'npc-ow-wood', path: 'assets/monsters/monster_water_grass_20_alt01_overworld.png', battleKey: 'battle-monster-4-0' },
};

// Overworld display size in world-space pixels (appears 48×48 on screen at 2× zoom).
export const NPC_OW_DISPLAY_SIZE = 24;
