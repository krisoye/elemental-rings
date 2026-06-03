# terrain_forest_modern — ModernEra GreenForest Tileset

**File:** `client/public/assets/terrain/terrain_forest_modern.png`  
**Dimensions:** 320 × 96 px — 20 columns × 6 rows of 16 px tiles (120 tiles, IDs 0–119)

**Tileset name in maps:**
- Generated maps: `ModernEra_GreenForest_Tileset`, firstgid **49** (see `forest-gid-map.mjs`)
- Hand-authored maps: same name, firstgid varies per map (boss_clearing uses 49)

**GID constants** (generated-map offsets from firstgid 49):

| Constant | GID | Tile ID | Description |
|----------|-----|---------|-------------|
| `GID_TREE_TRUNK` | 95 | 46 | Brown trunk cap — primary behind-layer trunk |
| `GID_ROCK_A` | 98 | 49 | Boulder / large rock |

---

## Water Pool — 3×3 autotile block (cols 0–2, rows 0–2)

Decorative in-ground water feature. These tiles do **not** carry `collides:true`; for collidable water use `autotile_water_16`.

| Tile ID | Row, Col | Description | Layer |
|---------|----------|-------------|-------|
| 0 | r0,c0 | Water pool — lower-right grass corner | ground |
| 1 | r0,c1 | Water pool — grass/water bottom edge | ground |
| 2 | r0,c2 | Water pool — lower-left grass corner | ground |
| 20 | r1,c0 | Water pool — grass/water right edge | ground |
| 21 | r1,c1 | Open water center | ground |
| 22 | r1,c2 | Water pool — grass/water left edge | ground |
| 40 | r2,c0 | Water pool — upper-right grass corner | ground |
| 41 | r2,c1 | Water pool — grass/water top edge | ground |
| 42 | r2,c2 | Water pool — upper-left grass corner | ground |

---

## Soil / Dirt Patch — 3×3 autotile block (cols 3–5, rows 0–2)

| Tile ID | Row, Col | Description | Layer |
|---------|----------|-------------|-------|
| 3 | r0,c3 | Grass/dirt — lower-right corner | ground |
| 4 | r0,c4 | Grass/dirt — bottom edge | ground |
| 5 | r0,c5 | Grass/dirt — lower-left corner | ground |
| 23 | r1,c3 | Grass/dirt — right edge | ground |
| 24 | r1,c4 | Dirt center | ground / behind / in-front |
| 25 | r1,c5 | Grass/dirt — left edge | ground |
| 43 | r2,c3 | Grass/dirt — upper-right corner | ground |
| 44 | r2,c4 | Grass/dirt — top edge | ground |
| 45 | r2,c5 | Grass/dirt — upper-left corner | ground |

---

## Tree Components (cols 9–16)

Trees are built from two horizontal layers:
- **Behind layer** (depth 2): trunk/lower boughs — blocks player movement (non-empty collision)
- **In-front layer** (depth 5): upper canopy — player walks under, no collision

The tiles in cols 9–16 come in pairs (left + right of a 2-wide tree); each row is a horizontal slice from top (row 0) to base (row 2).

| Tile ID | Row, Col | Typical layer(s) | Description |
|---------|----------|------------------|-------------|
| 9 | r0,c9 | behind + in-front | Tree top — left half |
| 10 | r0,c10 | behind + in-front | Tree top — right half |
| 11 | r0,c11 | behind + in-front | Tree top — left half (variant B) |
| 12 | r0,c12 | behind + in-front | Tree top — right half (variant B) |
| 13 | r0,c13 | behind + in-front | Tree top — left half (variant C) |
| 14 | r0,c14 | behind + in-front | Tree top — right half (variant C) |
| 29 | r1,c9 | in-front | Mid canopy — left half |
| 30 | r1,c10 | in-front | Mid canopy — right half |
| 31 | r1,c11 | behind + in-front | Mid canopy — left (variant B) |
| 32 | r1,c12 | behind + in-front | Mid canopy — right (variant B) |
| 33 | r1,c13 | in-front | Mid canopy — left (variant C) |
| 34 | r1,c14 | in-front | Mid canopy — right (variant C) |
| 35 | r1,c15 | behind + in-front | Mid canopy — left (variant D) |
| 36 | r1,c16 | behind + in-front | Mid canopy — right (variant D) |
| 46 | r2,c6 | behind | Brown trunk cap (**GID_TREE_TRUNK**) — most common generator trunk |
| 49 | r2,c9 | in-front | Lower canopy overlap — left half |
| 50 | r2,c10 | in-front | Lower canopy overlap — right half |
| 51 | r2,c11 | behind + in-front | Lower canopy — left (variant B) |
| 52 | r2,c12 | behind + in-front | Lower canopy — right (variant B) |
| 53 | r2,c13 | in-front | Lower canopy — left (variant C) |
| 54 | r2,c14 | in-front | Lower canopy — right (variant C) |
| 55 | r2,c15 | behind + in-front | Lower canopy — left (variant D) |
| 56 | r2,c16 | behind + in-front | Lower canopy — right (variant D) |

---

## Ground Floor Variants (cols 0–4, rows 3–5)

Flat terrain tiles used to fill walkable ground areas.

| Tile ID | Row, Col | Layer | Notes |
|---------|----------|-------|-------|
| 60 | r3,c0 | ground | Forest floor variant A |
| 61 | r3,c1 | ground | Forest floor variant B |
| 62 | r3,c2 | ground | Forest floor variant C |
| 80 | r4,c0 | ground | Forest floor variant D |
| 82 | r4,c2 | ground | Forest floor variant E |
| 84 | r4,c4 | ground + in-front | Mixed floor/canopy overlap |
| 100 | r5,c0 | ground | Forest floor variant F |
| 101 | r5,c1 | ground | Forest floor variant G |
| 102 | r5,c2 | ground + in-front | Forest floor / low canopy |
