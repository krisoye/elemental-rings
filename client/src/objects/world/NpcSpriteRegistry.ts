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
//
// Frame layout — all sheets use RPG Maker walk-cycle format (col 1, row 0 = idle/south):
//   FIRE / EARTH: 72×96  → 3 cols × 4 rows, 24×24 per frame
//   WATER:        48×64  → 3 cols × 4 rows, 16×16 per frame
//   WOOD:         96×128 → 3 cols × 4 rows, 32×32 per frame
//   WIND fly_11:  100×79 → 4 cols × 3 rows, 25×26 per frame (1 px transparent pad at bottom)
//   WIND fly_12:  116×79 → 4 cols × 3 rows, 29×26 per frame (1 px transparent pad at bottom)
//   WIND fly_13:  236×148 → 4 cols × 4 rows, 59×37 per frame
export interface MonsterOWEntry {
  /** Phaser texture key for the overworld spritesheet. */
  key: string;
  /** Asset path relative to the served `assets/` root. */
  path: string;
  /** Battle texture key matching this variant — forwarded so the battler matches. */
  battleKey: string;
  /** Spritesheet frame width in pixels. */
  frameWidth: number;
  /** Spritesheet frame height in pixels. */
  frameHeight: number;
}

export const MONSTER_OW_REGISTRY: Record<number, MonsterOWEntry> = {
  0: { key: 'npc-ow-fire',  path: 'assets/monsters/monster_fire_02_alt03_overworld.png',         battleKey: 'battle-monster-0-1', frameWidth: 24, frameHeight: 24 },
  1: { key: 'npc-ow-water', path: 'assets/monsters/monster_water_grass_19_alt03_overworld.png',   battleKey: 'battle-monster-1-1', frameWidth: 16, frameHeight: 16 },
  2: { key: 'npc-ow-earth', path: 'assets/monsters/monster_electro_ghost_14_alt01_overworld.png', battleKey: 'battle-monster-2-0', frameWidth: 24, frameHeight: 24 },
  3: { key: 'npc-ow-wind',  path: 'assets/monsters/monster_water_fly_11_alt01_overworld.png',     battleKey: 'battle-monster-3-0', frameWidth: 25, frameHeight: 26 },
  4: { key: 'npc-ow-wood',  path: 'assets/monsters/monster_water_grass_20_alt01_overworld.png',   battleKey: 'battle-monster-4-0', frameWidth: 32, frameHeight: 32 },
};

// Target display height in world-space pixels for all overworld monster markers
// (appears 48 px on screen at 2× zoom). Width scales proportionally from frameWidth/frameHeight.
export const NPC_OW_DISPLAY_SIZE = 24;
