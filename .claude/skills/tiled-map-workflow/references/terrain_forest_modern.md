# terrain_forest_modern — ModernEra GreenForest Tileset

**File:** `client/public/assets/terrain/terrain_forest_modern.png`  
**Dimensions:** 320 × 96 px — 20 columns × 6 rows of 16 px tiles (120 tiles, IDs 0–119)

**Tileset name in maps:**
- Generated maps: `ModernEra_GreenForest_Tileset`, firstgid **49** (see `forest-gid-map.mjs`)
- Hand-authored maps: same name, firstgid varies per map (boss_clearing uses 49)



---

## Water Pool — 3×3 autotile block (cols 0–2, rows 0–2)

Decorative in-ground water feature. The center does carry `collides:true`; for collidable water you can also use `autotile_water_16`.

| Tile ID | Row, Col | Description | Layer | Collides |
|---------|----------|-------------|-------| --- |
| 0 | r0,c0 | Water pool — light green grass/water lower-right corner | ground | no |
| 1 | r0,c1 | Water pool — light green grass/water bottom edge | ground | no |
| 2 | r0,c2 | Water pool — light green grass/water lower-left corner | ground | no |
| 20 | r1,c0 | Water pool — light green grass/water on the right edge | ground | no |
| 21 | r1,c1 | Open water center | ground | collides |
| 22 | r1,c2 | Water pool — light green grass/water on the left edge | ground | no |
| 40 | r2,c0 | Water pool — light green grass/water on the upper-right corner | ground | no |
| 41 | r2,c1 | Water pool — light green grass/water top edge | ground | no |
| 42 | r2,c2 | Water pool — light green grass/water on the upper-left corner | ground | no |

---

## Island (Inverted Water Pool) — 3×3 autotile block (cols 0–2, rows 3–5)

| Tile ID | Row, Col |  Description | Layer | Collides |
|---------|----------|-------|-------| --- |
| 60 | r3,c0 |  Island edge - water/light green grass lower-right corner | ground | no |
| 61 | r3,c1 |  Island edge - water/light green grass bottom edge  | ground | no |
| 62 | r3,c2 |  Island edge - water/light green grass lower-left corner | ground | no |
| 80 | r4,c0 |  Island edge - water/light green grass on the right edge  | ground | no |
| 82 | r4,c2 |  Island edge - water/light green grass on the left edge | ground | no |
| 100 | r5,c0 | Island edge - water/light green grass on the upper-right corner | ground | no |
| 101 | r5,c1 | Island edge - water/light green grass top edge | ground | no |
| 102 | r5,c2 | Island edge - water/light green grass on the upper-left corner | ground | no |


---

## Grass surrounded by rocks — 3×3 autotile block (cols 6–8, rows 0-2)

| Tile ID | Row, Col |  Description | Layer | Collides |
|---------|----------|-------|-------| --- |
| 6 | r0,c6 |  Island edge - rocks/light green grass right side | ground | collides |
| 7 | r0,c7 |  Island edge - rocks/light green grass most of the bottom edge  | ground | collides |
| 8 | r0,c8 |  Island edge - rocks/light green grass left side | ground | collides |
| 26 | r1,c6 |  Island edge - rocks/light green grass on the right edge  | ground | collides |
| 28 | r1,c8 |  Island edge - rocks/light green grass on the left edge | ground | collides |
| 46 | r2,c6 |  Island edge - rocks/light green grass on the upper-right corner | ground | collides |
| 47 | r2,c7 |  Island edge - rocks/light green grass top edge | ground | collides |
| 48 | r2,c8 |  Island edge - rocks/light green grass on the upper-left corner | ground | collides |


---
## Soil / Dirt Patch — 3×3 autotile block (cols 3–5, rows 0–2)

| Tile ID | Row, Col | Description | Layer |
|---------|----------|-------------|-------|
| 3 | r0,c3 | Grass/dirt — lower-right corner | ground |
| 4 | r0,c4 | Grass/dirt — bottom edge | ground |
| 5 | r0,c5 | Grass/dirt — lower-left corner | ground |
| 23 | r1,c3 | Grass/dirt — right edge | ground |
| 24 | r1,c4 | Dirt center | ground  |
| 25 | r1,c5 | Grass/dirt — left edge | ground |
| 43 | r2,c3 | Grass/dirt — upper-right corner | ground |
| 44 | r2,c4 | Grass/dirt — top edge | ground |
| 45 | r2,c5 | Grass/dirt — upper-left corner | ground |
---

## Grass Patch — 3×3 autotile block (cols 3–5, rows 3–5)

| Tile ID | Row, Col | Description | Layer |
|---------|----------|-------------|-------|
| 63 | r3,c3 | Dirt/Grass — lower-right corner | ground |
| 64 | r3,c4 | Dirt/Grass — bottom edge | ground |
| 65 | r3,c5 | Dirt/Grass — lower-left corner | ground |
| 83 | r4,c3 | Dirt/Grass — right edge | ground |
| 84 | r4,c4 | Grass center | ground  |
| 85 | r4,c5 | Dirt/Grass — left edge | ground |
| 103 | r5,c3 | Dirt/Grass — upper-right corner | ground |
| 104 | r5,c4 | Dirt/Grass — top edge | ground |
| 105 | r5,c5 | Dirt/Grass — upper-left corner | ground |
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
| 49 | r2,c9 | in-front | Lower canopy overlap — left half |
| 50 | r2,c10 | in-front | Lower canopy overlap — right half |
| 51 | r2,c11 | behind + in-front | Lower canopy — left (variant B) |
| 52 | r2,c12 | behind + in-front | Lower canopy — right (variant B) |
| 53 | r2,c13 | in-front | Lower canopy — left (variant C) |
| 54 | r2,c14 | in-front | Lower canopy — right (variant C) |
| 55 | r2,c15 | behind + in-front | Lower canopy — left (variant D) |
| 56 | r2,c16 | behind + in-front | Lower canopy — right (variant D) |

---


