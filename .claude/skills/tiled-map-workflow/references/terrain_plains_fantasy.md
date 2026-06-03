# terrain_plains_fantasy

**File:** `client/public/assets/terrain/terrain_plains_fantasy.png`  
**Dimensions:** 256 × 256 px — 16 columns × 16 rows of 16 px tiles (256 tiles, IDs 0–255)

**Tileset name in maps:** `terrain_plains_fantasy`  
**firstgid in generated maps:** **224** (see `forest-gid-map.mjs`)  
**firstgid in hand-authored maps:** varies (boss_clearing uses 332; north_road uses 224)

---

## Trees (rows 0–2)

All tree sprites are 3 tiles tall (rows 0–2). In generated maps the full trees appear on both `behind` (blocking) and `in-front` (canopy overhead) layers. Skinny trees are used on `in-front` only.

### Full trees (2 tiles wide, cols 0–5)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 0 | r0,c0 | behind + in-front | Light green tree — top-left |
| 1 | r0,c1 | behind + in-front | Light green tree — top-right |
| 16 | r1,c0 | behind + in-front | Light green tree — mid-left |
| 17 | r1,c1 | behind + in-front | Light green tree — mid-right |
| 32 | r2,c0 | behind + in-front | Light green tree — base-left |
| 33 | r2,c1 | behind + in-front | Light green tree — base-right |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 2 | r0,c2 | behind + in-front | Dark green tree — top-left |
| 3 | r0,c3 | behind + in-front | Dark green tree — top-right |
| 18 | r1,c2 | behind + in-front | Dark green tree — mid-left |
| 19 | r1,c3 | behind + in-front | Dark green tree — mid-right |
| 34 | r2,c2 | behind + in-front | Dark green tree — base-left |
| 35 | r2,c3 | behind + in-front | Dark green tree — base-right |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 4 | r0,c4 | in-front | Orange/fall tree — top-left |
| 5 | r0,c5 | in-front | Orange/fall tree — top-right |
| 20 | r1,c4 | in-front | Orange/fall tree — mid-left |
| 21 | r1,c5 | in-front | Orange/fall tree — mid-right |
| 36 | r2,c4 | in-front | Orange/fall tree — base-left |
| 37 | r2,c5 | in-front | Orange/fall tree — base-right |

### Skinny trees (1 tile wide, cols 6–8)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 6 | r0,c6 | in-front | Skinny light green tree — top |
| 22 | r1,c6 | in-front | Skinny light green tree — mid |
| 38 | r2,c6 | in-front | Skinny light green tree — base |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 7 | r0,c7 | in-front | Skinny dark green tree — top |
| 23 | r1,c7 | in-front | Skinny dark green tree — mid |
| 39 | r2,c7 | in-front | Skinny dark green tree — base |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 8 | r0,c8 | in-front | Skinny orange/fall tree — top |
| 24 | r1,c8 | in-front | Skinny orange/fall tree — mid |
| 40 | r2,c8 | in-front | Skinny orange/fall tree — base |

---

## Brown Cliff — 3×3 autotile blocks (cols 0–2, rows 5–13)

Three stacked variants. Edge tiles show the grass-to-cliff or cliff-to-cliff transition; center tile is the main cliff face.

### With grass at base (rows 5–7) — center tile 97, lighter brown

| Tile ID | Row, Col | Layer | Collides | Description |
|---------|----------|-------|----------|-------------|
| 80 | r5,c0 | ground + in-front | no | Cliff/grass — lower-right corner |
| 81 | r5,c1 | ground + in-front | no | Cliff/grass — bottom edge |
| 82 | r5,c2 | ground + in-front | no | Cliff/grass — lower-left corner |
| 96 | r6,c0 | ground + in-front | no | Cliff/grass — right edge |
| 97 | r6,c1 | ground + in-front | no | Cliff face center — lighter brown |
| 98 | r6,c2 | ground + in-front | no | Cliff/grass — left edge |
| 112 | r7,c0 | ground + in-front | no | Cliff/grass — upper-right corner |
| 113 | r7,c1 | ground + in-front | no | Cliff/grass — top edge |
| 114 | r7,c2 | ground + in-front | no | Cliff/grass — upper-left corner |

### No grass (rows 8–10) — center tile 145, lighter brown

| Tile ID | Row, Col | Layer | Collides | Description |
|---------|----------|-------|----------|-------------|
| 128 | r8,c0 | in-front | no | Cliff — lower-right corner |
| 129 | r8,c1 | in-front | no | Cliff — bottom edge |
| 130 | r8,c2 | in-front | no | Cliff — lower-left corner |
| 144 | r9,c0 | in-front | no | Cliff — right edge |
| 145 | r9,c1 | ground + in-front | no | Cliff face center — lighter brown |
| 146 | r9,c2 | ground + in-front | no | Cliff — left edge |
| 160 | r10,c0 | in-front | no | Cliff — upper-right corner |
| 161 | r10,c1 | ground + in-front | no | Cliff — top edge |
| 162 | r10,c2 | — | — | Cliff — upper-left corner |

### No grass, dark (rows 11–13) — center tile 193, dark brown

| Tile ID | Row, Col | Layer | Collides | Description |
|---------|----------|-------|----------|-------------|
| 176 | r11,c0 | — | — | Dark cliff — lower-right corner |
| 177 | r11,c1 | — | — | Dark cliff — bottom edge |
| 178 | r11,c2 | — | — | Dark cliff — lower-left corner |
| 192 | r12,c0 | ground | — | Dark cliff — right edge |
| 193 | r12,c1 | — | — | Dark cliff face center — dark brown |
| 194 | r12,c2 | — | — | Dark cliff — left edge |
| 208 | r13,c0 | ground | — | Dark cliff — upper-right corner |
| 209 | r13,c1 | — | — | Dark cliff — top edge |
| 210 | r13,c2 | — | — | Dark cliff — upper-left corner |

---

## Inverted Brown Cliff — 3×3 autotile blocks (cols 3–5, rows 5–13)

The base of the cliff is in the center tile; no center tile listed. Edge tiles show the floor/ground surrounding the cliff base.

### Inverted cliff with grass (rows 5–7) — no center

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 83 | r5,c3 | ground | Inv. cliff/grass — lower-right corner |
| 84 | r5,c4 | behind + ground | Inv. cliff/grass — bottom edge |
| 85 | r5,c5 | ground | Inv. cliff/grass — lower-left corner |
| 99 | r6,c3 | ground | Inv. cliff/grass — right edge |
| 101 | r6,c5 | ground | Inv. cliff/grass — left edge |
| 115 | r7,c3 | ground | Inv. cliff/grass — upper-right corner |
| 116 | r7,c4 | in-front | Inv. cliff/grass — top edge |
| 117 | r7,c5 | — | Inv. cliff/grass — upper-left corner |

### Inverted cliff, no grass (rows 8–10) — no center

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 131 | r8,c3 | — | Inv. cliff — lower-right corner |
| 132 | r8,c4 | — | Inv. cliff — bottom edge |
| 133 | r8,c5 | — | Inv. cliff — lower-left corner |
| 147 | r9,c3 | — | Inv. cliff — right edge |
| 149 | r9,c5 | — | Inv. cliff — left edge |
| 163 | r10,c3 | — | Inv. cliff — upper-right corner |
| 164 | r10,c4 | — | Inv. cliff — top edge |
| 165 | r10,c5 | — | Inv. cliff — upper-left corner |

### Inverted cliff, dark (rows 11–13) — no center

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 179 | r11,c3 | ground + in-front | Dark inv. cliff — lower-right corner |
| 180 | r11,c4 | ground | Dark inv. cliff — bottom edge |
| 181 | r11,c5 | ground | Dark inv. cliff — lower-left corner |
| 195 | r12,c3 | ground | Dark inv. cliff — right edge |
| 197 | r12,c5 | ground | Dark inv. cliff — left edge |
| 211 | r13,c3 | ground | Dark inv. cliff — upper-right corner |
| 212 | r13,c4 | ground | Dark inv. cliff — top edge |
| 213 | r13,c5 | ground | Dark inv. cliff — upper-left corner |

---

## Dirt / Mud Island — 3×3 autotile block (cols 6–8, rows 11–13)

Dirt/mud center surrounded by grass. In generated maps these tiles are also used as road/path fill (`GID_PATH_B` = tile 199) and in-front canopy variants (`GID_PLAINS_CANOPY_A` = tile 199).

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 182 | r11,c6 | ground | Dirt island — lower-right corner |
| 183 | r11,c7 | ground + in-front | Dirt island — bottom edge |
| 184 | r11,c8 | ground | Dirt island — lower-left corner |
| 198 | r12,c6 | ground + in-front | Dirt island — right edge (GID_PATH_A / GID_PLAINS_CANOPY_C) |
| 199 | r12,c7 | behind + ground + in-front | Dirt island center (GID_PATH_B / GID_PLAINS_CANOPY_A) |
| 200 | r12,c8 | ground + in-front | Dirt island — left edge (GID_PATH_C / GID_PLAINS_CANOPY_B) |
| 214 | r13,c6 | ground | Dirt island — upper-right corner |
| 215 | r13,c7 | ground + in-front | Dirt island — top edge (GID_PATH_D / GID_PLAINS_CANOPY_D) |
| 216 | r13,c8 | ground | Dirt island — upper-left corner |

---

## Inverted Dirt / Mud Island — 2×2 autotile block (cols 9–10, rows 11–12)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 185 | r11,c9 | ground | Inv. dirt island — lower-right corner |
| 186 | r11,c10 | ground + in-front | Inv. dirt island — lower-left corner |
| 201 | r12,c9 | ground | Inv. dirt island — upper-right corner |
| 202 | r12,c10 | ground | Inv. dirt island — upper-left corner |

---

## Miscellaneous

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 225 | r14,c1 | ground | Dark brown rocky cliff |
