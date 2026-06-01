# Asset Catalog — Elemental Rings

> Auto-generated. Each section covers one top-level asset folder.

> **Tiles** = static grid cells placed in Tiled maps. **Sprites** = game objects rendered by the engine; can be animated by cycling frames.


---

## `terrain/` — Terrain tilesets (tiles)

### `terrain_forest_main.png`
**Dimensions:** 128×32 `8 cols × 2 rows (16 tiles @ 16×16px)`  
4-tile strip for generated forest screens: void, green floor, dark tree (solid), dirt path.

### `terrain_forest_void.png`
**Dimensions:** 64×16 `4 cols × 1 rows (4 tiles @ 16×16px)`  
Single-purpose tileset: tile id 2 (gid 3) carries `collides:true` and is painted on map boundaries (pond edges, perimeter walls). Visible tile is a near-transparent pixel — it exists solely to mark solid terrain in Tiled.

### `terrain_forest_modern.png`
**Dimensions:** 320×96 `20 cols × 6 rows (120 tiles @ 16×16px)`  
16px tileset: ground patterns, stone paths, grass borders. Used in forest_anchorage hub map.

### `terrain_forest_deepwoods.png`
**Dimensions:** 416×144 `26 cols × 9 rows (234 tiles @ 16×16px)`  
16px deep-forest tileset: denser trees, mossy floor, root tangles. Ready for future deep-forest screens.

### `terrain_plains_fantasy.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
16px fantasy plains tileset: water, grass, soil variants, shoreline edges. Used in forest_anchorage hub map.

### `terrain_swamp_main.png`
**Dimensions:** 128×32 `8 cols × 2 rows (16 tiles @ 16×16px)`  
4-tile strip for generated swamp screen: void, murky floor, swamp tree (solid), muddy path.


---

## `structures/` — Structures & tilesets (tiles + sprites)

### `tileset_village_main_a.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
256-tile village spritesheet (16×16 cells). Buildings, fences, roofs, doors, windows. Used extensively in forest_anchorage behind/in-front layers.

### `tileset_village_main_b.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
Variant B of the village spritesheet — alternate colour palette and additional building styles. Not yet wired in maps.

### `structure_sanctum_exterior.png`
**Dimensions:** 128×160 `8 cols × 10 rows (80 tiles @ 16×16px)`  
128×160 single sprite of the Sanctum building exterior. Used on non-hub overworld screens to visually mark the anchored Sanctum position.

### `structure_misc.png`
**Dimensions:** 128×32 `8 cols × 2 rows (16 tiles @ 16×16px)`  
128×32 strip of miscellaneous structure sprites (4 frames). Used for small overworld props.


---

## `interiors/` — Interior tilesets (tiles)

### `interior_cozy_furniture.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
256-tile cozy indoor furniture sheet (16×16). Contains beds, appliances, tables, chairs, rugs, bookshelves. Placed on Furniture + Ceiling layers in sanctum.json.

### `interior_cozy_floor.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
256-tile auto-tiling floor sheet (2×2 pattern). Generates clean room floors from a 4-tile seed.

### `interior_cozy_ceiling.png`
**Dimensions:** 192×192 `12 cols × 12 rows (144 tiles @ 16×16px)`  
144-tile auto-tiling ceiling sheet (3×3 pattern). Forms walls, cornices, and window slots in the Sanctum interior.

### `interior_cozy_walls.png`
**Dimensions:** 256×256 `16 cols × 16 rows (256 tiles @ 16×16px)`  
256-tile wall-floor transition sheet. Internal room walls, wainscoting, door frames.


---

## `characters/` — Character spritesheets (sprites — animated)

### `charset_a1.png`
**Dimensions:** 192×256 `12 cols × 8 rows (96 tiles @ 16×32px)`  
192×256 (12 cols × 8 rows, 16×32 frames). 8 characters (4×2 grid). Each character: 3 walk frames × 4 directions (down/left/right/up). Middle column = idle. Characters 0, 4, 6 used for player + 2 merchant NPCs.

### `charset_a2.png`
**Dimensions:** 384×512 `24 cols × 16 rows (384 tiles @ 16×32px)`  
384×512 — 2× resolution version of charset_a1. Same layout; each frame is 32×64. Ready for high-DPI rendering.

### `charset_b1.png`
**Dimensions:** 192×256 `12 cols × 8 rows (96 tiles @ 16×32px)`  
192×256 — charset family B, variant 1. Alternative character designs; same grid layout as charset_a1.

### `charset_b2.png`
**Dimensions:** 384×512 `24 cols × 16 rows (384 tiles @ 16×32px)`  
384×512 — 2× resolution version of charset_b1.

### `charset_base.png`
**Dimensions:** 64×48 `4 cols × 1 rows (4 tiles @ 16×32px)`  
64×48 — minimal character base template tile. Reference sprite.


---

## `monsters/` — Monster sprites (sprites)

### `monster_<type>_<num>_<alt>_overworld.png` *(pattern — multiple files)*
Overworld sprite shown on the map when the monster is present. Displayed as a positioned sprite, not a tile. Sizes vary: 48×64 (small), 72×96 (medium), 96×128 (large), 236×148 (boss-sized).

### `monster_<type>_<num>_<alt>_battler_front.png` *(pattern — multiple files)*
Front-facing battle sprite shown during duel. Standardised at 80×80px.

### `monster_<type>_<num>_<alt>_battler_back.png` *(pattern — multiple files)*
Back-facing battle sprite (seen by the opposing player). 80×80px.

### `— fire_01–03 alts 01–04` *(pattern — multiple files)*
Fire-element creatures. Three body types; four colour/pattern alternates each.

### `— electro_ghost_14–16 alt01` *(pattern — multiple files)*
Ghost/electric creatures. Three designs, one colour alternate each.

### `— water_fly_11–13 alts 01–04` *(pattern — multiple files)*
Flying water creatures. Progressive size scaling across variants 11–13.

### `— water_grass_19–21 alts 01–03` *(pattern — multiple files)*
Water/grass hybrids. Overworld sizes range from 48×64 to 96×128.


---

## `flora/` — Flora tiles (tiles)

### `flora_berries_trees.png`
**Dimensions:** 80×176 `5 cols × 11 rows (55 tiles @ 16×16px)`  
80×176 spritesheet (5 cols × 11 rows, 16×16 frames). Berry bushes, fruit trees, exotic plants and their depleted/available states. Frames 0 and 7 used for forage node available/depleted states in BaseBiomeScene.


---

## `sprites/` — Composite sprites (sprites — generated/computed)

### `sprite_forest_decor.png`
**Dimensions:** 384×32  
384×32 strip (12 frames, 32×32 each). Forest decoration objects: tree trunks, root clusters, log piles. Placed as world sprites via placeDecoration(). Not a tileset.


---

## Naming Convention

```
<category>_<descriptor>[_<variant>][_<view>].png
```

| Prefix | Category | Example |
|--------|----------|---------|
| `terrain_` | Tile grids for map ground layers | `terrain_forest_main.png` |
| `tileset_` | Multi-purpose tile sheets (buildings etc.) | `tileset_village_main_a.png` |
| `interior_cozy_` | Cozy indoor room tiles | `interior_cozy_furniture.png` |
| `charset_` | Character spritesheets (player/NPC walk cycles) | `charset_a1.png` |
| `monster_` | Monster sprites (overworld + battle) | `monster_fire_01_alt01_overworld.png` |
| `flora_` | Plants, trees, forage objects | `flora_berries_trees.png` |
| `structure_` | Building sprites (not tile-grid) | `structure_sanctum_exterior.png` |
| `sprite_` | Computed/generated sprite sheets | `sprite_forest_decor.png` |

**Monster file anatomy:**  
`monster_<type>_<number>_alt<XX>_<view>.png`  
- `type` = `fire`, `electro_ghost`, `water_fly`, `water_grass`  
- `number` = 2-digit creature variant within the type  
- `alt<XX>` = 2-digit colour/pattern alternate  
- `view` = `overworld`, `battler_front`, or `battler_back`
