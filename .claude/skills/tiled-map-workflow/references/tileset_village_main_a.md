# tileset_village_main_a

**File:** `client/public/assets/structures/tileset_village_main_a.png`  
**Dimensions:** 256 × 256 px — 16 columns × 16 rows of 16 px tiles (256 tiles, IDs 0–255)

**Tileset name in maps:** `tileset_village_main_a`  
**firstgid in generated maps:** **480** (see `forest-gid-map.mjs`)  
**firstgid in hand-authored maps:** varies (boss_clearing uses 588; north_road uses 480)

**GID constants** (generated-map offsets from firstgid 480):

| Constant | GID | Tile ID | Description |
|----------|-----|---------|-------------|
| `GID_GRASS_FILL` | 558 | 78 | Dominant forest floor fill tile |
| `GID_VILLAGE_CANOPY` | 624 | 144 | Large in-front canopy / fence-top overlay |

---

## Ground / Floor Tiles

The primary fill tile for walkable forest floor in generated and hand-authored screens.

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 63 | r3,c15 | ground | Floor variant — far-right end cap |
| 76 | r4,c12 | ground | Natural floor A |
| 77 | r4,c13 | ground | Natural floor B |
| **78** | r4,c14 | ground | **GID_GRASS_FILL** — dominant forest floor fill |
| 79 | r4,c15 | ground | Natural floor D |
| 95 | r5,c15 | ground | Floor detail / leaf litter |
| 110 | r6,c14 | ground | Floor variant |
| 124 | r7,c12 | ground | Stone-edged floor A |
| 126 | r7,c14 | ground | Stone-edged floor B |
| 127 | r7,c15 | ground | Stone-edged floor C |
| 238 | r14,c14 | ground | Dark ground A |
| 239 | r14,c15 | ground | Dark ground B |

---

## Small Shrubs and Grasses (cols 2–7, rows 0–3)

Decorative plants and ground-level flora. Used on `ground` layer and occasionally `behind` (blocking shrubs) or `in-front` (overhead foliage).

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 2 | r0,c2 | ground | Light green grass clump A |
| 4 | r0,c4 | ground | Light green grass clump B |
| 5 | r0,c5 | ground | Light green grass clump C |
| 6 | r0,c6 | ground + behind | Low shrub (blocks if on behind) |
| 7 | r0,c7 | ground | Small grass tuft |
| 19 | r1,c3 | ground + in-front | Small foliage / flower |
| 20 | r1,c4 | ground | Grass variant |
| 28 | r1,c12 | ground | Ground detail |
| 35 | r2,c3 | ground | Low plant / short grass |
| 51 | r3,c3 | ground | Ground foliage variant |

---

## Lamp Post (col 5, rows 1–3)

Single-tile-wide vertical lamp post. Place on `behind` to block, or `in-front` for overhead clearance. Typically assembled top-to-bottom.

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 21 | r1,c5 | behind + in-front | Lamp post — top / lantern |
| 37 | r2,c5 | behind + in-front | Lamp post — upper shaft |
| 53 | r3,c5 | behind + in-front | Lamp post — lower shaft / base |

---

## White Fence

Vertical (north–south running) and horizontal (east–west running) fence sections. These are rendered **in-front** (depth 5) so they appear above the player. The fence itself does not block movement unless a matching `behind`-layer tile is also placed.

### Vertical fence (col 0, rows 8–10)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 128 | r8,c0 | Vertical fence — north end (top cap) |
| 129 | r8,c1 | Vertical fence — top section right |
| 130 | r8,c2 | Vertical fence — top section mid |
| 131 | r8,c3 | Vertical fence — top section far |
| **144** | r9,c0 | **GID_VILLAGE_CANOPY** — vertical fence middle / large canopy overlay |
| 160 | r10,c0 | Vertical fence — south end (bottom cap) |
| 161 | r10,c1 | Vertical fence — bottom section right |

### Horizontal fence (row 11)

| Tile ID | Row, Col | Description |
|---------|----------|-------------|
| 178 | r11,c2 | Horizontal fence — middle section |

---

## Large Tree (cols 9–12, rows 0–14)

A tall 2-column tree structure spanning most of the sheet height. Each pair of rows represents one horizontal slice of the tree from canopy (top) to trunk base (bottom). Assembled using:
- **behind layer** for trunk slices that block player passage
- **in-front layer** for canopy slices the player walks under

The col-9/col-10 pair is the primary trunk column; col-11/col-12 extends the canopy to the right.

| Tile ID | Row, Col | Layer | Description |
|---------|----------|-------|-------------|
| 9 | r0,c9 | behind + in-front | Tree canopy — top-left |
| 10 | r0,c10 | behind + in-front | Tree canopy — top-right |
| 25 | r1,c9 | behind | Tree trunk upper — left |
| 26 | r1,c10 | behind | Tree trunk upper — right |
| 41 | r2,c9 | behind | Tree trunk mid — left |
| 42 | r2,c10 | behind | Tree trunk mid — right |
| 90 | r5,c10 | behind | Tree trunk lower — right |
| 105 | r6,c9 | behind + in-front | Tree bough — left |
| 106 | r6,c10 | behind + in-front | Tree bough — right |
| 121 | r7,c9 | behind + in-front | Tree bough lower — left |
| 122 | r7,c10 | behind + in-front | Tree bough lower — right |
| 137 | r8,c9 | behind + in-front | Wide canopy — left |
| 138 | r8,c10 | behind + in-front | Wide canopy — right |
| 153 | r9,c9 | behind + in-front | Wide canopy spread — left |
| 154 | r9,c10 | behind + in-front | Wide canopy spread — right |
| 155 | r9,c11 | in-front | Wide canopy — right extension A |
| 156 | r9,c12 | in-front | Wide canopy — right extension B |
| 169 | r10,c9 | behind + in-front | Lower canopy — left |
| 170 | r10,c10 | behind + in-front | Lower canopy — right |
| 171 | r10,c11 | ground + in-front | Lower canopy right edge A |
| 172 | r10,c12 | ground + in-front | Lower canopy right edge B |
| 185 | r11,c9 | behind + in-front | Tree base canopy — left |
| 186 | r11,c10 | behind + in-front | Tree base canopy — right |
| 187 | r11,c11 | in-front | Tree base canopy right A |
| 188 | r11,c12 | in-front | Tree base canopy right B |
| 190 | r11,c14 | in-front | Canopy edge detail |
| 201 | r12,c9 | behind + in-front | Tree base — left |
| 202 | r12,c10 | behind + in-front | Tree base — right |
| 203 | r12,c11 | in-front | Tree base right A |
| 204 | r12,c12 | ground + in-front | Tree base right B / ground shadow |
| 205 | r12,c13 | in-front | Tree base right C |
| 217 | r13,c9 | behind + in-front | Tree root — left |
| 218 | r13,c10 | behind + in-front | Tree root — right |
| 219 | r13,c11 | in-front | Tree root right A |
| 220 | r13,c12 | ground + in-front | Tree root right B / ground shadow |
| 221 | r13,c13 | in-front | Tree root right C |
| 235 | r14,c11 | in-front | Root spread A |
| 236 | r14,c12 | ground + in-front | Root spread B / ground |
| 237 | r14,c13 | in-front | Root spread C |
