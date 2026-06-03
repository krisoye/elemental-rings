# tileset_village_main_a

**File:** `client/public/assets/structures/tileset_village_main_a.png`  
**Dimensions:** 256 × 256 px — 16 columns × 16 rows of 16 px tiles (256 tiles, IDs 0–255)

**Tileset name in maps:** `tileset_village_main_a`  
**firstgid in generated maps:** **480** (see `forest-gid-map.mjs`)  
**firstgid in hand-authored maps:** varies (boss_clearing uses 588; north_road uses 480)

**GID constants** (generated-map offsets from firstgid 480):

| Constant | GID | Tile ID | Description |
|----------|-----|---------|-------------|
| `GID_GRASS_FILL` | 558 | 78 | Assorted medium green grass variant (r4,c14) |
| `GID_VILLAGE_CANOPY` | 624 | 144 | Vertical white fence — middle section (r9,c0) |

---

## Light Green Grass — 6×1 block (cols 2–7, row 0)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 2 | r0,c2 | Light green grass variant A |
| 3 | r0,c3 | Light green grass variant B |
| 4 | r0,c4 | Light green grass variant C |
| 5 | r0,c5 | Light green grass variant D |
| 6 | r0,c6 | Light green grass variant E |
| 7 | r0,c7 | Light green grass variant F |

---

## Assorted Light Green Grass — 2×3 block (cols 3–4, rows 1–3)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 19 | r1,c3 | Light green grass variant G |
| 20 | r1,c4 | Light green grass variant H |
| 35 | r2,c3 | Light green grass variant I |
| 36 | r2,c4 | Light green grass variant J |
| 51 | r3,c3 | Light green grass variant K |
| 52 | r3,c4 | Light green grass variant L |

---

## Light Green Grass Island — transparent boundary 3×3 (cols 0–2, rows 1–3)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 16 | r1,c0 | Light green grass island — lower-right corner |
| 17 | r1,c1 | Light green grass island — bottom edge |
| 18 | r1,c2 | Light green grass island — lower-left corner |
| 32 | r2,c0 | Light green grass island — right edge |
| 33 | r2,c1 | Light green grass island — center |
| 34 | r2,c2 | Light green grass island — left edge |
| 48 | r3,c0 | Light green grass island — upper-right corner |
| 49 | r3,c1 | Light green grass island — top edge |
| 50 | r3,c2 | Light green grass island — upper-left corner |

---

## Assorted Flowers — 3×2 block (cols 0–2, rows 4–5)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 64 | r4,c0 | Flower variant A |
| 65 | r4,c1 | Flower variant B |
| 66 | r4,c2 | Flower variant C |
| 80 | r5,c0 | Flower variant D |
| 81 | r5,c1 | Flower variant E |
| 82 | r5,c2 | Flower variant F |

---

## Assorted Medium Green Grass — 2×3 block (cols 14–15, rows 3–5)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 62 | r3,c14 | Medium green grass variant A |
| 63 | r3,c15 | Medium green grass variant B |
| **78** | r4,c14 | Medium green grass variant C (**GID_GRASS_FILL**) |
| 79 | r4,c15 | Medium green grass variant D |
| 94 | r5,c14 | Medium green grass variant E |
| 95 | r5,c15 | Medium green grass variant F |

---

## Medium Green Grass Island — transparent boundary 3×3 (cols 11–13, rows 3–5)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 59 | r3,c11 | Medium green grass island — lower-right corner |
| 60 | r3,c12 | Medium green grass island — bottom edge |
| 61 | r3,c13 | Medium green grass island — lower-left corner |
| 75 | r4,c11 | Medium green grass island — right edge |
| 76 | r4,c12 | Medium green grass island — center |
| 77 | r4,c13 | Medium green grass island — left edge |
| 91 | r5,c11 | Medium green grass island — upper-right corner |
| 92 | r5,c12 | Medium green grass island — top edge |
| 93 | r5,c13 | Medium green grass island — upper-left corner |

---

## Assorted Dark Green Grass — 2×3 block (cols 14–15, rows 6–8)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 110 | r6,c14 | Dark green grass variant A |
| 111 | r6,c15 | Dark green grass variant B |
| 126 | r7,c14 | Dark green grass variant C |
| 127 | r7,c15 | Dark green grass variant D |
| 142 | r8,c14 | Dark green grass variant E |
| 143 | r8,c15 | Dark green grass variant F |

---

## Dark Green Grass Island — transparent boundary 3×3 (cols 11–13, rows 6–8)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 107 | r6,c11 | Dark green grass island — lower-right corner |
| 108 | r6,c12 | Dark green grass island — bottom edge |
| 109 | r6,c13 | Dark green grass island — lower-left corner |
| 123 | r7,c11 | Dark green grass island — right edge |
| 124 | r7,c12 | Dark green grass island — center |
| 125 | r7,c13 | Dark green grass island — left edge |
| 139 | r8,c11 | Dark green grass island — upper-right corner |
| 140 | r8,c12 | Dark green grass island — top edge |
| 141 | r8,c13 | Dark green grass island — upper-left corner |

---

## Decorations

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 21 | r1,c5 | behind + in-front | Lamp post — top / lantern |
| 37 | r2,c5 | behind + in-front | Lamp post — upper shaft |
| 53 | r3,c5 | behind + in-front | Lamp post — lower shaft / base |
| 96 | r6,c0 | — | Bush A |
| 112 | r7,c0 | — | Bush B |
| 115 | r7,c3 | — | Sign post |

---

## White Fence

### Vertical fence — 1×3 (col 0, rows 8–10)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 128 | r8,c0 | in-front | Vertical fence — top cap |
| **144** | r9,c0 | in-front | Vertical fence — middle (**GID_VILLAGE_CANOPY**) |
| 160 | r10,c0 | in-front | Vertical fence — bottom cap |

### Horizontal fence + post — row 11

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 176 | r11,c0 | — | White post |
| 177 | r11,c1 | — | Horizontal fence — left end |
| 178 | r11,c2 | in-front | Horizontal fence — middle |
| 179 | r11,c3 | — | Horizontal fence — right end |

---

## Four Trees (cols 9–10, rows 0–13)

### Two smaller trees

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 9 | r0,c9 | behind + in-front | Tree canopy — top-left |
| 10 | r0,c10 | behind + in-front | Tree canopy — top-right |
| 25 | r1,c9 | behind | Tree trunk upper — left |
| 26 | r1,c10 | behind | Tree trunk upper — right |
| 41 | r2,c9 | behind | Tree trunk mid — left |
| 42 | r2,c10 | behind | Tree trunk mid — right |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 57 | r3,c9 | behind + in-front | Tree canopy — top-left |
| 58 | r3,c10 | behind + in-front | Tree canopy — top-right |
| 73 | r4,c9 | behind | Tree trunk upper — left |
| 74 | r4,c10 | behind | Tree trunk upper — right |
| 89 | r5,c9 | behind | Tree trunk mid — left |
| 90 | r5,c10 | behind | Tree trunk lower — right |

### Two taller trees

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 105 | r6,c9 | behind + in-front | Tree canopy — top-left |
| 106 | r6,c10 | behind + in-front | Tree canopy — top-right |
| 121 | r7,c9 | behind + in-front | Tree bough upper — left |
| 122 | r7,c10 | behind + in-front | Tree bough upper — right |
| 137 | r8,c9 | behind + in-front | Wide canopy — left |
| 138 | r8,c10 | behind + in-front | Wide canopy — right |
| 153 | r9,c9 | behind + in-front | Wide canopy spread — left |
| 154 | r9,c10 | behind + in-front | Wide canopy spread — right |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 169 | r10,c9 | behind + in-front | Lower canopy — left |
| 170 | r10,c10 | behind + in-front | Lower canopy — right |
| 185 | r11,c9 | behind + in-front | Tree base canopy — left |
| 186 | r11,c10 | behind + in-front | Tree base canopy — right |
| 201 | r12,c9 | behind + in-front | Tree base — left |
| 202 | r12,c10 | behind + in-front | Tree base — right |
| 217 | r13,c9 | behind + in-front | Tree root — left |
| 218 | r13,c10 | behind + in-front | Tree root — right |

---

## Light Dirt Island — 3×3 autotile block (cols 11–13, rows 0–2)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 11 | r0,c11 | — | Light dirt island — lower-right corner |
| 12 | r0,c12 | — | Light dirt island — bottom edge |
| 13 | r0,c13 | — | Light dirt island — lower-left corner |
| 27 | r1,c11 | — | Light dirt island — right edge |
| 28 | r1,c12 | ground | Light dirt island — center |
| 29 | r1,c13 | — | Light dirt island — left edge |
| 43 | r2,c11 | — | Light dirt island — upper-right corner |
| 44 | r2,c12 | — | Light dirt island — top edge |
| 45 | r2,c13 | — | Light dirt island — upper-left corner |

---

## Inverse Light Dirt Island — 2×2 autotile block (cols 14–15, rows 1–2)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 30 | r1,c14 | — | Inv. light dirt island — lower-right corner |
| 31 | r1,c15 | — | Inv. light dirt island — lower-left corner |
| 46 | r2,c14 | — | Inv. light dirt island — upper-right corner |
| 47 | r2,c15 | — | Inv. light dirt island — upper-left corner |

---

## Gray Cliff — 3×3 autotile blocks (cols 11–13)

### With grass (rows 12–14) — center tile 220 is grass

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 203 | r12,c11 | in-front | Gray cliff/grass — lower-right corner |
| 204 | r12,c12 | ground + in-front | Gray cliff/grass — bottom edge |
| 205 | r12,c13 | in-front | Gray cliff/grass — lower-left corner |
| 219 | r13,c11 | in-front | Gray cliff/grass — right edge |
| 220 | r13,c12 | ground + in-front | Gray cliff/grass — center (grass) |
| 221 | r13,c13 | in-front | Gray cliff/grass — left edge |
| 235 | r14,c11 | in-front | Gray cliff/grass — upper-right corner |
| 236 | r14,c12 | ground + in-front | Gray cliff/grass — top edge |
| 237 | r14,c13 | in-front | Gray cliff/grass — upper-left corner |

### No grass (rows 9–11) — center tile 172 is gray cliff

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 155 | r9,c11 | in-front | Gray cliff — lower-right corner |
| 156 | r9,c12 | in-front | Gray cliff — bottom edge |
| 157 | r9,c13 | — | Gray cliff — lower-left corner |
| 171 | r10,c11 | ground + in-front | Gray cliff — right edge |
| 172 | r10,c12 | ground + in-front | Gray cliff — center |
| 173 | r10,c13 | — | Gray cliff — left edge |
| 187 | r11,c11 | in-front | Gray cliff — upper-right corner |
| 188 | r11,c12 | in-front | Gray cliff — upper edge |
| 189 | r11,c13 | — | Gray cliff — upper-left corner |

---

## Inverted Gray Cliff — 2×2 autotile blocks (cols 14–15)

### No grass (rows 10–11)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 174 | r10,c14 | — | Inv. gray cliff — lower-right corner |
| 175 | r10,c15 | — | Inv. gray cliff — lower-left corner |
| 190 | r11,c14 | in-front | Inv. gray cliff — upper-right corner |
| 191 | r11,c15 | — | Inv. gray cliff — upper-left corner |

### With grass (rows 13–14)

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 222 | r13,c14 | — | Inv. gray cliff/grass — lower-right corner |
| 223 | r13,c15 | — | Inv. gray cliff/grass — lower-left corner |
| 238 | r14,c14 | ground | Inv. gray cliff/grass — upper-right corner |
| 239 | r14,c15 | ground | Inv. gray cliff/grass — upper-left corner |

---

## House One — 4×4 block (cols 0–3, rows 12–15)

Row 15 is the front face (door, two windows).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 192 | r12,c0 | House 1 — roof row 1, col 1 |
| 193 | r12,c1 | House 1 — roof row 1, col 2 |
| 194 | r12,c2 | House 1 — roof row 1, col 3 |
| 195 | r12,c3 | House 1 — roof row 1, col 4 |
| 208 | r13,c0 | House 1 — roof row 2, col 1 |
| 209 | r13,c1 | House 1 — roof row 2, col 2 |
| 210 | r13,c2 | House 1 — roof row 2, col 3 |
| 211 | r13,c3 | House 1 — roof row 2, col 4 |
| 224 | r14,c0 | House 1 — upper wall, col 1 |
| 225 | r14,c1 | House 1 — upper wall, col 2 |
| 226 | r14,c2 | House 1 — upper wall, col 3 |
| 227 | r14,c3 | House 1 — upper wall, col 4 |
| 240 | r15,c0 | House 1 — front face, col 1 |
| 241 | r15,c1 | House 1 — front face, col 2 |
| 242 | r15,c2 | House 1 — front face, col 3 |
| 243 | r15,c3 | House 1 — front face, col 4 |

---

## House Two — 4×4 block (cols 4–7, rows 12–15)

Row 15 is the front face (door, two windows).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 196 | r12,c4 | House 2 — roof row 1, col 1 |
| 197 | r12,c5 | House 2 — roof row 1, col 2 |
| 198 | r12,c6 | House 2 — roof row 1, col 3 |
| 199 | r12,c7 | House 2 — roof row 1, col 4 |
| 212 | r13,c4 | House 2 — roof row 2, col 1 |
| 213 | r13,c5 | House 2 — roof row 2, col 2 |
| 214 | r13,c6 | House 2 — roof row 2, col 3 |
| 215 | r13,c7 | House 2 — roof row 2, col 4 |
| 228 | r14,c4 | House 2 — upper wall, col 1 |
| 229 | r14,c5 | House 2 — upper wall, col 2 |
| 230 | r14,c6 | House 2 — upper wall, col 3 |
| 231 | r14,c7 | House 2 — upper wall, col 4 |
| 244 | r15,c4 | House 2 — front face, col 1 |
| 245 | r15,c5 | House 2 — front face, col 2 |
| 246 | r15,c6 | House 2 — front face, col 3 |
| 247 | r15,c7 | House 2 — front face, col 4 |

---

## House Three — 4×5 block (cols 4–7, rows 7–11)

Row 11 is the front face (door, two windows). Second floor window at r9,c5–c6 (tiles 149, 150).

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 116 | r7,c4 | House 3 — upper roof, col 1 |
| 117 | r7,c5 | House 3 — upper roof, col 2 |
| 118 | r7,c6 | House 3 — upper roof, col 3 |
| 119 | r7,c7 | House 3 — upper roof, col 4 |
| 132 | r8,c4 | House 3 — lower roof, col 1 |
| 133 | r8,c5 | House 3 — lower roof, col 2 |
| 134 | r8,c6 | House 3 — lower roof, col 3 |
| 135 | r8,c7 | House 3 — lower roof, col 4 |
| 148 | r9,c4 | House 3 — second floor, col 1 |
| 149 | r9,c5 | House 3 — second floor window, left |
| 150 | r9,c6 | House 3 — second floor window, right |
| 151 | r9,c7 | House 3 — second floor, col 4 |
| 164 | r10,c4 | House 3 — wall, col 1 |
| 165 | r10,c5 | House 3 — wall, col 2 |
| 166 | r10,c6 | House 3 — wall, col 3 |
| 167 | r10,c7 | House 3 — wall, col 4 |
| 180 | r11,c4 | House 3 — front face, col 1 |
| 181 | r11,c5 | House 3 — front face, col 2 |
| 182 | r11,c6 | House 3 — front face, col 3 |
| 183 | r11,c7 | House 3 — front face, col 4 |

---

## Fence Junctions — 3×3 block (cols 1–3, rows 8–10)

Each tile combines one vertical and one horizontal fence piece, giving all corner and T-junction combinations. Used on the `in-front` layer.

|  | c1 — left vert. | c2 — mid vert. | c3 — right vert. |
|--|-----------------|----------------|------------------|
| **r8 — top horiz.** | 129 top-left corner | 130 top T-junction | 131 top-right corner |
| **r9 — mid horiz.** | 145 left T-junction | 146 cross junction | 147 right T-junction |
| **r10 — bot horiz.** | 161 bottom-left corner | 162 bottom T-junction | 163 bottom-right corner |

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 129 | r8,c1 | in-front | Fence junction — top-left corner |
| 130 | r8,c2 | in-front | Fence junction — top T-junction |
| 131 | r8,c3 | in-front | Fence junction — top-right corner |
| 145 | r9,c1 | — | Fence junction — left T-junction |
| 146 | r9,c2 | — | Fence junction — cross |
| 147 | r9,c3 | — | Fence junction — right T-junction |
| 161 | r10,c1 | in-front | Fence junction — bottom-left corner |
| 162 | r10,c2 | — | Fence junction — bottom T-junction |
| 163 | r10,c3 | — | Fence junction — bottom-right corner |
