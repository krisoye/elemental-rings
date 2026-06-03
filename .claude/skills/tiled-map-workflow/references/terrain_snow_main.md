# terrain_snow_main

**File:** `client/public/assets/terrain/terrain_snow_main.png`  
**Dimensions:** 288 × 464 px — 18 columns × 29 rows of 16 px tiles (522 tiles, IDs 0–521)

**Tileset name in maps:** `terrain_snow_main`  
**firstgid in generated maps:** not yet registered (no snow maps generated)  
**firstgid in hand-authored maps:** varies per map

Tile ID formula: `row * 18 + col`

This reference documents only the objects identified so far. Additional sections will be added as snow scenes are authored.

---

## Rocky Cliff — rows 0–6, cols 0–4

A cross-shaped flat snow-covered cliff top with a rocky border, a vertical cliff face, and a narrower base.

### Cliff Top — 5×5 block (rows 0–4, cols 0–4)

Cross-shaped flat snow surface with a rocky/stone border. Use on `behind` (border/edge tiles) and `ground` (snow fill tiles).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 0 | r0,c0 | Cliff top — r0,c0 |
| 1 | r0,c1 | Cliff top — r0,c1 |
| 2 | r0,c2 | Cliff top — r0,c2 |
| 3 | r0,c3 | Cliff top — r0,c3 |
| 4 | r0,c4 | Cliff top — r0,c4 |
| 18 | r1,c0 | Cliff top — r1,c0 |
| 19 | r1,c1 | Cliff top — r1,c1 |
| 20 | r1,c2 | Cliff top — r1,c2 |
| 21 | r1,c3 | Cliff top — r1,c3 |
| 22 | r1,c4 | Cliff top — r1,c4 |
| 36 | r2,c0 | Cliff top — r2,c0 |
| 37 | r2,c1 | Cliff top — r2,c1 |
| 38 | r2,c2 | Cliff top — r2,c2 |
| 39 | r2,c3 | Cliff top — r2,c3 |
| 40 | r2,c4 | Cliff top — r2,c4 |
| 54 | r3,c0 | Cliff top — r3,c0 |
| 55 | r3,c1 | Cliff top — r3,c1 |
| 56 | r3,c2 | Cliff top — r3,c2 |
| 57 | r3,c3 | Cliff top — r3,c3 |
| 58 | r3,c4 | Cliff top — r3,c4 |
| 72 | r4,c0 | Cliff top — r4,c0 |
| 73 | r4,c1 | Cliff top — r4,c1 |
| 74 | r4,c2 | Cliff top — r4,c2 |
| 75 | r4,c3 | Cliff top — r4,c3 |
| 76 | r4,c4 | Cliff top — r4,c4 |

### Cliff Middle — 1×5 block (row 5, cols 0–4)

The vertical rocky cliff face below the top surface. Use on `behind` (blocks player movement).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 90 | r5,c0 | Cliff face — left |
| 91 | r5,c1 | Cliff face — left-center |
| 92 | r5,c2 | Cliff face — center |
| 93 | r5,c3 | Cliff face — right-center |
| 94 | r5,c4 | Cliff face — right |

### Cliff Base — 1×3 block (row 6, cols 1–3)

Narrower base at the foot of the cliff. Use on `behind`.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 109 | r6,c1 | Cliff base — left |
| 110 | r6,c2 | Cliff base — center |
| 111 | r6,c3 | Cliff base — right |

---

## Chimney — 2×1 prop (rows 1–2, col 8)

Standalone chimney prop placed on top of the log house roof. Use on `in-front`.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 26 | r1,c8 | Chimney — top cap |
| 44 | r2,c8 | Chimney — shaft |

---

## Brown Log House — rows 0–7, cols 9–14

### House Roof — 6×6 block (rows 0–5, cols 9–14)

Triangular peaked brown log house roof with snow. Use on `in-front` (player walks in front of the house base; roof is overhead).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 9 | r0,c9 | Roof — r0,c9 |
| 10 | r0,c10 | Roof — r0,c10 |
| 11 | r0,c11 | Roof — r0,c11 |
| 12 | r0,c12 | Roof — r0,c12 |
| 13 | r0,c13 | Roof — r0,c13 |
| 14 | r0,c14 | Roof — r0,c14 |
| 27 | r1,c9 | Roof — r1,c9 |
| 28 | r1,c10 | Roof — r1,c10 |
| 29 | r1,c11 | Roof — r1,c11 |
| 30 | r1,c12 | Roof — r1,c12 |
| 31 | r1,c13 | Roof — r1,c13 |
| 32 | r1,c14 | Roof — r1,c14 |
| 45 | r2,c9 | Roof — r2,c9 |
| 46 | r2,c10 | Roof — r2,c10 |
| 47 | r2,c11 | Roof — r2,c11 |
| 48 | r2,c12 | Roof — r2,c12 |
| 49 | r2,c13 | Roof — r2,c13 |
| 50 | r2,c14 | Roof — r2,c14 |
| 63 | r3,c9 | Roof — r3,c9 |
| 64 | r3,c10 | Roof — r3,c10 |
| 65 | r3,c11 | Roof — r3,c11 |
| 66 | r3,c12 | Roof — r3,c12 |
| 67 | r3,c13 | Roof — r3,c13 |
| 68 | r3,c14 | Roof — r3,c14 |
| 81 | r4,c9 | Roof — r4,c9 |
| 82 | r4,c10 | Roof — r4,c10 |
| 83 | r4,c11 | Roof — r4,c11 |
| 84 | r4,c12 | Roof — r4,c12 |
| 85 | r4,c13 | Roof — r4,c13 |
| 86 | r4,c14 | Roof — r4,c14 |
| 99 | r5,c9 | Roof — r5,c9 (eave) |
| 100 | r5,c10 | Roof — r5,c10 (eave) |
| 101 | r5,c11 | Roof — r5,c11 (eave) |
| 102 | r5,c12 | Roof — r5,c12 (eave) |
| 103 | r5,c13 | Roof — r5,c13 (eave) |
| 104 | r5,c14 | Roof — r5,c14 (eave) |

### House Base / First Floor — 2×6 block (rows 6–7, cols 9–14)

Wooden log walls, window, and door. Use on `behind` (blocks player movement).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 117 | r6,c9 | House base — r6,c9 |
| 118 | r6,c10 | House base — r6,c10 |
| 119 | r6,c11 | House base — r6,c11 |
| 120 | r6,c12 | House base — r6,c12 |
| 121 | r6,c13 | House base — r6,c13 |
| 122 | r6,c14 | House base — r6,c14 |
| 135 | r7,c9 | House base — r7,c9 |
| 136 | r7,c10 | House base — r7,c10 |
| 137 | r7,c11 | House base — r7,c11 |
| 138 | r7,c12 | House base — r7,c12 |
| 139 | r7,c13 | House base — r7,c13 |
| 140 | r7,c14 | House base — r7,c14 |

---

## Snow-Covered Trees — rows 11–16, cols 0–7

### Triangular (Conifer) Tree — 6×4 block (rows 11–16, cols 0–3)

Tall triangular/coniferous snow-covered tree. Use lower rows on `behind` (trunk blocks movement); upper rows on `in-front` (canopy overhead).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 198 | r11,c0 | Triangular tree — top-left |
| 199 | r11,c1 | Triangular tree — top-center-left |
| 200 | r11,c2 | Triangular tree — top-center-right |
| 201 | r11,c3 | Triangular tree — top-right |
| 216 | r12,c0 | Triangular tree — upper-mid left |
| 217 | r12,c1 | Triangular tree — upper-mid center-left |
| 218 | r12,c2 | Triangular tree — upper-mid center-right |
| 219 | r12,c3 | Triangular tree — upper-mid right |
| 234 | r13,c0 | Triangular tree — mid left |
| 235 | r13,c1 | Triangular tree — mid center-left |
| 236 | r13,c2 | Triangular tree — mid center-right |
| 237 | r13,c3 | Triangular tree — mid right |
| 252 | r14,c0 | Triangular tree — lower-mid left |
| 253 | r14,c1 | Triangular tree — lower-mid center-left |
| 254 | r14,c2 | Triangular tree — lower-mid center-right |
| 255 | r14,c3 | Triangular tree — lower-mid right |
| 270 | r15,c0 | Triangular tree — base left |
| 271 | r15,c1 | Triangular tree — base center-left |
| 272 | r15,c2 | Triangular tree — base center-right |
| 273 | r15,c3 | Triangular tree — base right |
| 288 | r16,c0 | Triangular tree — ground left |
| 289 | r16,c1 | Triangular tree — ground center-left |
| 290 | r16,c2 | Triangular tree — ground center-right |
| 291 | r16,c3 | Triangular tree — ground right |

### Round Tree — 6×4 block (rows 11–16, cols 4–7)

Broad rounded snow-covered tree. Use lower rows on `behind` (trunk); upper rows on `in-front` (canopy).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 202 | r11,c4 | Round tree — top-left |
| 203 | r11,c5 | Round tree — top-center-left |
| 204 | r11,c6 | Round tree — top-center-right |
| 205 | r11,c7 | Round tree — top-right |
| 220 | r12,c4 | Round tree — upper-mid left |
| 221 | r12,c5 | Round tree — upper-mid center-left |
| 222 | r12,c6 | Round tree — upper-mid center-right |
| 223 | r12,c7 | Round tree — upper-mid right |
| 238 | r13,c4 | Round tree — mid left |
| 239 | r13,c5 | Round tree — mid center-left |
| 240 | r13,c6 | Round tree — mid center-right |
| 241 | r13,c7 | Round tree — mid right |
| 256 | r14,c4 | Round tree — lower-mid left |
| 257 | r14,c5 | Round tree — lower-mid center-left |
| 258 | r14,c6 | Round tree — lower-mid center-right |
| 259 | r14,c7 | Round tree — lower-mid right |
| 274 | r15,c4 | Round tree — base left |
| 275 | r15,c5 | Round tree — base center-left |
| 276 | r15,c6 | Round tree — base center-right |
| 277 | r15,c7 | Round tree — base right |
| 292 | r16,c4 | Round tree — ground left |
| 293 | r16,c5 | Round tree — ground center-left |
| 294 | r16,c6 | Round tree — ground center-right |
| 295 | r16,c7 | Round tree — ground right |

---

## Not Yet Documented

The following regions are visible in the sheet but not yet described (to be added as snow scenes are authored):

- Rows 0–10, cols 5–7 and 15–17 — misc props / snow fill
- Rows 8–10, cols 0–8 — additional cliff/ground variants
- Rows 11–16, cols 8–17 — decorative props (figures, snowman, crates, etc.)
- Rows 17–28 — interior furniture, flooring, and objects
