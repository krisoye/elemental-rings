# autotile_snow_16 — Snow Autotile Sheet

**File:** `client/public/assets/terrain/autotile_snow_16.png`  
**Dimensions:** 160 × 144 px — 10 columns × 9 rows of 16 px tiles (90 tiles, IDs 0–89)

Tile ID formula: `row * 10 + col`

Each 3×3 block follows the standard edge convention: row 0 = bottom edge of the island, row 2 = top edge (same convention as `terrain_forest_modern`). Each 2×2 block provides the four inner-corner tiles for the inverted (island-in-field) case.

---

## Dirt Island — 3×3 autotile block (rows 0–2, cols 0–2)

Dirt/soil island surrounded by snow. Use on the `ground` layer.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 0 | r0,c0 | Dirt island — lower-right corner |
| 1 | r0,c1 | Dirt island — bottom edge |
| 2 | r0,c2 | Dirt island — lower-left corner |
| 10 | r1,c0 | Dirt island — right edge |
| 11 | r1,c1 | Dirt center |
| 12 | r1,c2 | Dirt island — left edge |
| 20 | r2,c0 | Dirt island — upper-right corner |
| 21 | r2,c1 | Dirt island — top edge |
| 22 | r2,c2 | Dirt island — upper-left corner |

## Snow Island (in Dirt) — 2×2 autotile block (rows 0–1, cols 3–4)

Inverted: snow island surrounded by dirt. The four inner-corner tiles.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 3 | r0,c3 | Snow-in-dirt — lower-right corner |
| 4 | r0,c4 | Snow-in-dirt — lower-left corner |
| 13 | r1,c3 | Snow-in-dirt — upper-right corner |
| 14 | r1,c4 | Snow-in-dirt — upper-left corner |

---

## Ice-Covered Foliage (Bushes) Island — 3×3 autotile block (rows 0–2, cols 5–7)

Ice-covered foliage/bush cluster surrounded by snow. Use on the `behind` or `in-front` layer depending on depth.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 5 | r0,c5 | Ice foliage island — lower-right corner |
| 6 | r0,c6 | Ice foliage island — bottom edge |
| 7 | r0,c7 | Ice foliage island — lower-left corner |
| 15 | r1,c5 | Ice foliage island — right edge |
| 16 | r1,c6 | Ice foliage center |
| 17 | r1,c7 | Ice foliage island — left edge |
| 25 | r2,c5 | Ice foliage island — upper-right corner |
| 26 | r2,c6 | Ice foliage island — top edge |
| 27 | r2,c7 | Ice foliage island — upper-left corner |

## Snow Island (in Ice Foliage) — 2×2 autotile block (rows 0–1, cols 8–9)

Inverted: snow clearing surrounded by ice-covered foliage.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 8 | r0,c8 | Snow-in-ice-foliage — lower-right corner |
| 9 | r0,c9 | Snow-in-ice-foliage — lower-left corner |
| 18 | r1,c8 | Snow-in-ice-foliage — upper-right corner |
| 19 | r1,c9 | Snow-in-ice-foliage — upper-left corner |

---

## Ice Island — 3×3 autotile block (rows 3–5, cols 0–2)

Solid ice patch surrounded by snow. Use on the `ground` layer.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 30 | r3,c0 | Ice island — lower-right corner |
| 31 | r3,c1 | Ice island — bottom edge |
| 32 | r3,c2 | Ice island — lower-left corner |
| 40 | r4,c0 | Ice island — right edge |
| 41 | r4,c1 | Ice center |
| 42 | r4,c2 | Ice island — left edge |
| 50 | r5,c0 | Ice island — upper-right corner |
| 51 | r5,c1 | Ice island — top edge |
| 52 | r5,c2 | Ice island — upper-left corner |

## Snow Island (in Ice) — 2×2 autotile block (rows 3–4, cols 3–4)

Inverted: snow patch surrounded by ice.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 33 | r3,c3 | Snow-in-ice — lower-right corner |
| 34 | r3,c4 | Snow-in-ice — lower-left corner |
| 43 | r4,c3 | Snow-in-ice — upper-right corner |
| 44 | r4,c4 | Snow-in-ice — upper-left corner |

---

## Ice-Covered Foliage (Transparent Border) — 3×3 autotile block (rows 3–5, cols 5–7)

Ice-covered foliage/bush cluster with a transparent outer border (blends into any background).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 35 | r3,c5 | Ice foliage (transparent border) — lower-right corner |
| 36 | r3,c6 | Ice foliage (transparent border) — bottom edge |
| 37 | r3,c7 | Ice foliage (transparent border) — lower-left corner |
| 45 | r4,c5 | Ice foliage (transparent border) — right edge |
| 46 | r4,c6 | Ice foliage (transparent border) — center |
| 47 | r4,c7 | Ice foliage (transparent border) — left edge |
| 55 | r5,c5 | Ice foliage (transparent border) — upper-right corner |
| 56 | r5,c6 | Ice foliage (transparent border) — top edge |
| 57 | r5,c7 | Ice foliage (transparent border) — upper-left corner |

## Transparent Island (in Ice Foliage) — 2×2 autotile block (rows 3–4, cols 8–9)

Inverted: transparent interior surrounded by ice-covered foliage. Use when the foliage should frame a clear/open area.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 38 | r3,c8 | Transparent-in-ice-foliage — lower-right corner |
| 39 | r3,c9 | Transparent-in-ice-foliage — lower-left corner |
| 48 | r4,c8 | Transparent-in-ice-foliage — upper-right corner |
| 49 | r4,c9 | Transparent-in-ice-foliage — upper-left corner |

---

## Pond (Soil Shore) — 3×3 autotile block (rows 6–8, cols 0–2)

Water pond with a thin soil/dirt ring at the shoreline, surrounded by snow. Center tile is open water. Use on the `ground` layer; set `collides: true` on the center tile (71) if the pond should block movement.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 60 | r6,c0 | Pond — lower-right corner (snow/soil/water transition) |
| 61 | r6,c1 | Pond — bottom edge |
| 62 | r6,c2 | Pond — lower-left corner |
| 70 | r7,c0 | Pond — right edge |
| 71 | r7,c1 | Pond center — open water |
| 72 | r7,c2 | Pond — left edge |
| 80 | r8,c0 | Pond — upper-right corner |
| 81 | r8,c1 | Pond — top edge |
| 82 | r8,c2 | Pond — upper-left corner |

## Snow Island (in Pond) — 2×2 autotile block (rows 6–7, cols 3–4)

Inverted: snow/ground patch surrounded by water with a soil shore ring.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 63 | r6,c3 | Snow-in-pond — lower-right corner |
| 64 | r6,c4 | Snow-in-pond — lower-left corner |
| 73 | r7,c3 | Snow-in-pond — upper-right corner |
| 74 | r7,c4 | Snow-in-pond — upper-left corner |

---

## Not Yet Catalogued

Tiles 65–69, 75–79, 85–89 (rows 6–8, cols 5–9) are visible in the sheet but not yet described.
