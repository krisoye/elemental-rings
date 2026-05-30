# Client Asset Catalog

Inventory of committed binary art assets under `client/public/assets/`, their
source, the generator that produces them (if any), and their status. Maintained
alongside the 16px map migration (EPIC #149). `Active` = referenced by a live
generator or scene; `Active (hub only)` = used only by the hand-authored
`forest_anchorage` hub; `Superseded` = replaced by the 16px pipeline, safe to
remove; `Orphaned` = not referenced anywhere; `Reference only` = proof/debug image.

## Terrain (`assets/terrain/`)

| Asset | Dimensions | Source | Generator | Status |
|---|---|---|---|---|
| `autotile_grass_16.png` | 768×16 | StarterVillage A2, cell (8,0) | `gen-autotile-16.mjs` | Active |
| `autotile_dirt_16.png` | 768×16 | StarterVillage A2, cell (8,9) — dark-grass substitute | `gen-autotile-16.mjs` | Active |
| `autotile_water_16.png` | 768×16 | StarterVillage A1, cell (0,0) | `gen-autotile-16.mjs` | Active |
| `autotile_cliff_16.png` | 768×16 | Procedural (`gen-cliff-cell.mjs`) | `gen-autotile-16.mjs` | Active |
| `autotile_proof_16.png` | proof grid | Generated visual gate evidence | `gen-autotile-16.mjs` | Reference only |
| `terrain_forest_modern.png` | 320×96 | GreenForest 16px tileset (20×6) | imported | Active (generated screens + hub) |
| `terrain_forest_main.png` | 128×32 | Placeholder 4-tile strip | `gen-forest-tiles.mjs` | **Superseded** — legacy 32px forest tileset; unused after #159 |
| `terrain_forest_void.png` | 64×16 | Hub placeholder (1 used tile, `forest16`) | imported | Active (hub only) |
| `terrain_forest_deepwoods.png` | GreenForest deepwoods variant | imported | — | **Orphaned** — not referenced by any generator or scene |
| `terrain_plains_fantasy.png` | Wild Plains fantasy pack | imported | — | Active (hub only) |
| `terrain_swamp_main.png` | 128×32 | Placeholder 4-tile swamp strip | `gen-swamp-tiles.mjs` | **Superseded** — legacy 32px swamp tileset; unused after #161 |
| `terrain_swamp_tiles.png` | swamp tile sheet | imported/generated | `gen-swamp-tiles.mjs` | **Superseded** — legacy 32px swamp art; unused after #161 |

## Flora (`assets/flora/`)

| Asset | Dimensions | Source | Generator | Status |
|---|---|---|---|---|
| `flora_berries_trees.png` | 80×176 | Berry & trees pack (5×11) | imported | Active (generated screens + hub; also the `berry-nodes` forage spritesheet) |

## Structures (`assets/structures/`)

| Asset | Dimensions | Source | Generator | Status |
|---|---|---|---|---|
| `tileset_village_main_a.png` | 256×256 | Starter Village main A (hub `asset_alliance_starter_village_main`) | imported | Active (hub only) |
| `tileset_village_main_b.png` | 256×256 | Starter Village main B | imported | **Orphaned** — not referenced anywhere |

## Monsters (`assets/monsters/`)

Per-element overworld + battler PNGs imported in PR #146. The overworld sprites
are wired by `client/src/objects/world/NpcSpriteRegistry.ts` (#158); the battler
fronts are loaded by `BattleScene.MONSTER_BATTLERS`.

| Element | Overworld PNG | Battler key | Status |
|---|---|---|---|
| FIRE (0) | `monster_fire_02_alt03_overworld.png` | `battle-monster-0-1` | Active |
| WATER (1) | `monster_water_grass_19_alt03_overworld.png` | `battle-monster-1-1` | Active |
| EARTH (2) | `monster_electro_ghost_14_alt01_overworld.png` | `battle-monster-2-0` | Active |
| WIND (3) | `monster_water_fly_11_alt01_overworld.png` | `battle-monster-3-0` | Active |
| WOOD (4) | `monster_water_grass_20_alt01_overworld.png` | `battle-monster-4-0` | Active |

Additional `*_battler_front.png` variants per element back the random-variant pool
in `MONSTER_BATTLERS`; all remain Active.

## Sprites (`assets/sprites/`)

| Asset | Source | Status |
|---|---|---|
| `sprite_npc_overworld.png` | 12-frame 32×32 charset strip | Active (duelist/merchant markers, frames 5–11; monster frames 0–4 superseded by the registry) |

## Generated maps (`assets/maps/`)

| Path | Generator | Status |
|---|---|---|
| `forest/<screen>.json` (14 non-hub) | `gen-forest-screens.mjs` | Active — 16px/3-layer, regenerated, do NOT edit by hand |
| `forest/forest_anchorage.json` | hand-authored (Tiled) | Active — hub; the generator skips it |
| `swamp/swamp_entry.json` | `gen-swamp-map.mjs` | Active — 16px/3-layer |

## Regeneration

```bash
cd client
npm run gen:maps          # full pipeline (all gen:* steps below, in order)
# or individually:
npm run gen:autotile-16   # autotile_{grass,dirt,water,cliff}_16.png strips
npm run gen:forest-screens # 14 non-hub forest/<screen>.json (skips the hub)
npm run gen:swamp          # swamp/swamp_entry.json
```

Both `gen:forest-screens` and `gen:swamp` are deterministic — re-running produces
byte-identical output (the only randomness, feature placement on open danger
screens, is seeded by a hash of the screen id).
