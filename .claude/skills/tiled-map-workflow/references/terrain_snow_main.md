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

A cross-shaped flat snow-covered cliff top with a rocky border, a vertical cliff face, and a narrower base. The corner tiles of the 5×5 top block are transparent, giving the top surface its cross silhouette.

### Cliff Top — 5×5 block (rows 0–4, cols 0–4)

Rocky/stone border framing a snow-filled interior. Outer ring = rocky border tiles (`behind`); inner 3×3 = snow fill (`ground`). Corner tiles (r0c0, r0c4, r4c0, r4c4) are transparent.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 0 | r0,c0 | Transparent (corner) |
| 1 | r0,c1 | Rocky border — top edge left |
| 2 | r0,c2 | Rocky border — top edge center |
| 3 | r0,c3 | Rocky border — top edge right |
| 4 | r0,c4 | Transparent (corner) |
| 18 | r1,c0 | Rocky border — left edge top |
| 19 | r1,c1 | Snow fill — upper-left |
| 20 | r1,c2 | Snow fill — upper-center |
| 21 | r1,c3 | Snow fill — upper-right |
| 22 | r1,c4 | Rocky border — right edge top |
| 36 | r2,c0 | Rocky border — left edge center |
| 37 | r2,c1 | Snow fill — center-left |
| 38 | r2,c2 | Snow fill — center |
| 39 | r2,c3 | Snow fill — center-right |
| 40 | r2,c4 | Rocky border — right edge center |
| 54 | r3,c0 | Rocky border — left edge bottom |
| 55 | r3,c1 | Snow fill — lower-left |
| 56 | r3,c2 | Snow fill — lower-center |
| 57 | r3,c3 | Snow fill — lower-right |
| 58 | r3,c4 | Rocky border — right edge bottom |
| 72 | r4,c0 | Transparent (corner) |
| 73 | r4,c1 | Rocky border — bottom edge left |
| 74 | r4,c2 | Rocky border — bottom edge center |
| 75 | r4,c3 | Rocky border — bottom edge right |
| 76 | r4,c4 | Transparent (corner) |

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

Triangular peaked brown log house roof with snow accumulation on the upper surface. Use on `in-front` (player walks in front of the house base; roof is overhead).

Row structure: row 0 = peak (tip of triangle), rows 1–2 = upper steep slope (snow-covered), rows 3–4 = lower slope, row 5 = eave (overhanging bottom edge).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 9 | r0,c9 | Roof peak — left |
| 10 | r0,c10 | Roof peak — center-left |
| 11 | r0,c11 | Roof peak — center |
| 12 | r0,c12 | Roof peak — center-right |
| 13 | r0,c13 | Roof peak — right |
| 14 | r0,c14 | Roof peak — far right |
| 27 | r1,c9 | Upper slope (snow) — left |
| 28 | r1,c10 | Upper slope (snow) — center-left |
| 29 | r1,c11 | Upper slope (snow) — center |
| 30 | r1,c12 | Upper slope (snow) — center-right |
| 31 | r1,c13 | Upper slope (snow) — right |
| 32 | r1,c14 | Upper slope (snow) — far right |
| 45 | r2,c9 | Upper slope (snow) — left |
| 46 | r2,c10 | Upper slope (snow) — center-left |
| 47 | r2,c11 | Upper slope (snow) — center |
| 48 | r2,c12 | Upper slope (snow) — center-right |
| 49 | r2,c13 | Upper slope (snow) — right |
| 50 | r2,c14 | Upper slope (snow) — far right |
| 63 | r3,c9 | Lower slope — left |
| 64 | r3,c10 | Lower slope — center-left |
| 65 | r3,c11 | Lower slope — center |
| 66 | r3,c12 | Lower slope — center-right |
| 67 | r3,c13 | Lower slope — right |
| 68 | r3,c14 | Lower slope — far right |
| 81 | r4,c9 | Lower slope — left |
| 82 | r4,c10 | Lower slope — center-left |
| 83 | r4,c11 | Lower slope — center |
| 84 | r4,c12 | Lower slope — center-right |
| 85 | r4,c13 | Lower slope — right |
| 86 | r4,c14 | Lower slope — far right |
| 99 | r5,c9 | Eave — left |
| 100 | r5,c10 | Eave — center-left |
| 101 | r5,c11 | Eave — center |
| 102 | r5,c12 | Eave — center-right |
| 103 | r5,c13 | Eave — right |
| 104 | r5,c14 | Eave — far right |

### House Base / First Floor — 2×6 block (rows 6–7, cols 9–14)

Wooden log walls with window (row 6) and door/ground-floor facade (row 7). Use on `behind` (blocks player movement).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 117 | r6,c9 | Upper wall — left |
| 118 | r6,c10 | Upper wall — center-left |
| 119 | r6,c11 | Upper wall — center (window) |
| 120 | r6,c12 | Upper wall — center-right (window) |
| 121 | r6,c13 | Upper wall — right |
| 122 | r6,c14 | Upper wall — far right |
| 135 | r7,c9 | Ground floor — left |
| 136 | r7,c10 | Ground floor — center-left |
| 137 | r7,c11 | Ground floor — center (door) |
| 138 | r7,c12 | Ground floor — center-right (door) |
| 139 | r7,c13 | Ground floor — right |
| 140 | r7,c14 | Ground floor — far right |

---

## Snow-Covered Trees — rows 11–16, cols 0–7

Rows 11–12 = top canopy (`in-front`). Rows 13–14 = mid canopy (`in-front`). Rows 15–16 = trunk / base (`behind`, blocks movement).

### Triangular (Conifer) Tree — 6×4 block (rows 11–16, cols 0–3)

Tall triangular/coniferous snow-covered tree.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 198 | r11,c0 | Top canopy — left |
| 199 | r11,c1 | Top canopy — center-left |
| 200 | r11,c2 | Top canopy — center-right |
| 201 | r11,c3 | Top canopy — right |
| 216 | r12,c0 | Top canopy — left |
| 217 | r12,c1 | Top canopy — center-left |
| 218 | r12,c2 | Top canopy — center-right |
| 219 | r12,c3 | Top canopy — right |
| 234 | r13,c0 | Mid canopy — left |
| 235 | r13,c1 | Mid canopy — center-left |
| 236 | r13,c2 | Mid canopy — center-right |
| 237 | r13,c3 | Mid canopy — right |
| 252 | r14,c0 | Mid canopy — left |
| 253 | r14,c1 | Mid canopy — center-left |
| 254 | r14,c2 | Mid canopy — center-right |
| 255 | r14,c3 | Mid canopy — right |
| 270 | r15,c0 | Trunk / base — left |
| 271 | r15,c1 | Trunk / base — center-left |
| 272 | r15,c2 | Trunk / base — center-right |
| 273 | r15,c3 | Trunk / base — right |
| 288 | r16,c0 | Ground / root — left |
| 289 | r16,c1 | Ground / root — center-left |
| 290 | r16,c2 | Ground / root — center-right |
| 291 | r16,c3 | Ground / root — right |

### Round Tree — 6×4 block (rows 11–16, cols 4–7)

Broad rounded snow-covered tree.

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 202 | r11,c4 | Top canopy — left |
| 203 | r11,c5 | Top canopy — center-left |
| 204 | r11,c6 | Top canopy — center-right |
| 205 | r11,c7 | Top canopy — right |
| 220 | r12,c4 | Top canopy — left |
| 221 | r12,c5 | Top canopy — center-left |
| 222 | r12,c6 | Top canopy — center-right |
| 223 | r12,c7 | Top canopy — right |
| 238 | r13,c4 | Mid canopy — left |
| 239 | r13,c5 | Mid canopy — center-left |
| 240 | r13,c6 | Mid canopy — center-right |
| 241 | r13,c7 | Mid canopy — right |
| 256 | r14,c4 | Mid canopy — left |
| 257 | r14,c5 | Mid canopy — center-left |
| 258 | r14,c6 | Mid canopy — center-right |
| 259 | r14,c7 | Mid canopy — right |
| 274 | r15,c4 | Trunk / base — left |
| 275 | r15,c5 | Trunk / base — center-left |
| 276 | r15,c6 | Trunk / base — center-right |
| 277 | r15,c7 | Trunk / base — right |
| 292 | r16,c4 | Ground / root — left |
| 293 | r16,c5 | Ground / root — center-left |
| 294 | r16,c6 | Ground / root — center-right |
| 295 | r16,c7 | Ground / root — right |

---

## Not Yet Documented

The following regions are visible in the sheet but not yet described (to be added as snow scenes are authored):

- Rows 0–10, cols 5–7 and 15–17 — misc props / snow fill
- Rows 8–10, cols 0–8 — additional cliff/ground variants
- Rows 11–16, cols 8–17 — decorative props (figures, snowman, crates, etc.)
- Rows 17–28 — interior furniture, flooring, and objects

---

## Needs Confirmation (used in snow_entry.json)

These tile IDs appear in `snow_entry.json` but fall in undocumented regions of the sheet. Local ID formula: `row * 18 + col`. GIDs assume `firstgid = 146`.

### Group A — Rows 0–3, cols 5–6 (cliff-adjacent snow fill)

Used on the `behind` layer alongside the Rocky Cliff block. Visually these are plain snow fill tiles — no rocky border, just the snow ground texture used to extend the snowy surface area around the cliff.

| GID | Local ID | Row, Col | Layer | Description |
|-----|----------|----------|-------|-------------|
| 151 | 5 | r0,c5 | behind | Snow fill — cliff area (top row) |
| 152 | 6 | r0,c6 | behind | Snow fill — cliff area (top row, right) |
| 169 | 23 | r1,c5 | behind | Snow fill — cliff area |
| 170 | 24 | r1,c6 | behind | Snow fill — cliff area (right) |
| 187 | 41 | r2,c5 | behind | Snow fill — cliff area |
| 188 | 42 | r2,c6 | behind | Snow fill — cliff area (right) |
| 205 | 59 | r3,c5 | behind | Snow fill — cliff area (bottom row) |
| 206 | 60 | r3,c6 | behind | Snow fill — cliff area (bottom row, right) |

### Group B — Rows 11–16, col 8 (5th column of round tree)

The round tree is 5 columns wide (cols 4–8), not 4. The reference sheet only documented cols 4–7. This column is visually continuous with the round tree — canopy coloring at top rows, trunk/root coloring at bottom. Used on `in-front`.

| GID | Local ID | Row, Col | Layer | Description |
|-----|----------|----------|-------|-------------|
| 352 | 206 | r11,c8 | in-front | Round tree — top canopy far right |
| 370 | 224 | r12,c8 | in-front | Round tree — top canopy far right (lower) |
| 388 | 242 | r13,c8 | in-front | Round tree — mid canopy far right |
| 406 | 260 | r14,c8 | in-front | Round tree — mid canopy far right (lower) |
| 424 | 278 | r15,c8 | in-front | Round tree — trunk / base far right |
| 442 | 296 | r16,c8 | in-front | Round tree — ground / root far right |

### Group C — Row 12, col 9 (snowman prop)

One tile used in isolation on the `behind` layer near the cabin. Visually a small standing snowman figure.

| GID | Local ID | Row, Col | Layer | Description |
|-----|----------|----------|-------|-------------|
| 371 | 225 | r12,c9 | behind | Snowman — standalone decorative prop |

### Group D — Rows 13–17, cols 12–17 (wooden dock)

Two sub-structures visible in the tileset: **cols 12–14** are vertical dock posts/pilings; **cols 15–17** are the horizontal dock platform (top rail, plank floor, bottom edge). Cols 15–17 tiles are used with left-cap / fill (repeating) / right-cap pattern in the map. Used on `behind` (posts and understructure) and `in-front` (platform floor overhead).

| GID | Local ID | Row, Col | Layer | Description |
|-----|----------|----------|-------|-------------|
| 395 | 249 | r13,c15 | behind | Dock platform — top rail left cap |
| 396 | 250 | r13,c16 | behind | Dock platform — top rail fill (repeating) |
| 397 | 251 | r13,c17 | behind | Dock platform — top rail right cap |
| 410 | 264 | r14,c12 | behind | Dock post — cap left |
| 411 | 265 | r14,c13 | behind | Dock post — cap center |
| 412 | 266 | r14,c14 | behind | Dock post — cap right |
| 413 | 267 | r14,c15 | behind | Dock platform — upper section left |
| 414 | 268 | r14,c16 | behind | Dock platform — upper section fill (repeating) |
| 415 | 269 | r14,c17 | behind | Dock platform — upper section right |
| 428 | 282 | r15,c12 | behind | Dock post — body left |
| 429 | 283 | r15,c13 | behind | Dock post — body center |
| 430 | 284 | r15,c14 | behind | Dock post — body right |
| 431 | 285 | r15,c15 | behind | Dock platform — lower section left |
| 432 | 286 | r15,c16 | behind | Dock platform — lower section fill (repeating) |
| 433 | 287 | r15,c17 | behind | Dock platform — lower section right |
| 446 | 300 | r16,c12 | behind | Dock post — base left |
| 447 | 301 | r16,c13 | behind | Dock post — base center |
| 448 | 302 | r16,c14 | behind | Dock post — base right |
| 449 | 303 | r16,c15 | in-front | Dock floor — left edge (overhead) |
| 450 | 304 | r16,c16 | in-front | Dock floor — fill (repeating, overhead) |
| 451 | 305 | r16,c17 | in-front | Dock floor — right edge (overhead) |
| 464 | 318 | r17,c12 | behind | Dock post — bottom left |
| 465 | 319 | r17,c13 | behind | Dock post — bottom center |
| 466 | 320 | r17,c14 | behind | Dock post — bottom right |
| 467 | 321 | r17,c15 | in-front | Dock floor bottom edge — left (overhead) |
| 468 | 322 | r17,c16 | in-front | Dock floor bottom edge — fill (repeating, overhead) |
| 469 | 323 | r17,c17 | in-front | Dock floor bottom edge — right (overhead) |
