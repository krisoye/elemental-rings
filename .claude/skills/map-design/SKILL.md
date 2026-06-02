# Map Design Skill — Elemental Rings

Design rules for composing Tiled maps in Elemental Rings. Derived from before/after analysis of `forest_south_path` (#185→current) and `forest_boss_clearing` (#246→#273). Read this before writing or editing any map JSON or before calling the map-generation tooling.

The three decoration layers and their roles:
- `ground` — base floor tiles, should be simple and unified
- `behind` — low vegetation, bush bases, ground clutter; renders behind the player
- `in-front` — canopy, tree tops, tall structures; renders in front of the player

---

## Layer Coverage Targets

| Layer | Path/corridor map | Arena/clearing map |
|---|---|---|
| `ground` unique GIDs | 4–6 | 8–12 |
| `behind` coverage | 25–28% of map area | 18–22% of map area |
| `behind` unique GIDs | 8+ (never 1) | 8+ (never 1) |
| `in-front` coverage | 40–48% of map area | 25–35% of map area |
| `in-front` unique GIDs | 8+ (never 1) | 8+ (never 1) |

**When ground layer has more unique GIDs, use fewer decoration GIDs, and vice versa.** They compete for visual attention — keep total complexity roughly constant.

---

## Rule 1 — Never use a single placeholder GID for an entire layer

A layer with 1 unique GID is always wrong. It means the tiles are test fills that were never replaced. Minimum 8 unique GIDs per decoration layer. The minimum viable sprite block is a 2×4 tile sprite = 8 GIDs; use at least two distinct sprite types per layer.

**Bad (v1 boss_clearing):** `in-front` had 166 tiles all GID 277, `behind` had 166 tiles all GID 239.  
**Fixed (v2 boss_clearing):** `in-front` has 18 unique GIDs, `behind` has 15 unique GIDs.

---

## Rule 2 — Behind and in-front must have different spatial patterns

v1 boss_clearing had behind ≡ in-front: pixel-identical occupancy at every position. This destroys depth perception. The two layers must serve distinct visual roles:

- `behind` tiles = trunk bases, bush clumps, low scrub — occupies lower-half of large sprite footprints, or isolated clutter in open areas
- `in-front` tiles = canopy tops, tall tree crowns, cliff faces — often placed 2–4 rows north of the corresponding `behind` tiles (the top of the tree overhangs the player while the trunk is behind them)

If `behind` and `in-front` have the same non-zero positions at more than 30% of tiles, the composition is wrong.

---

## Rule 3 — Path maps: anchor parallel wall columns, maintain a 3-tile-wide channel

For vertical corridor maps, fix `in-front` trees at two x-columns that run the full map height (e.g., x=6 and x=10 on a 16-wide map). Use a 1-wide × 3-tall canopy tile repeated at a 3-row pitch to create a continuous fence. Wider 2×4 tree sprites fill between fence posts.

**Quantified target for a 16×28 path map:**
- Canopy fence: 18 instances × 3 tiles = 54 tiles (~12% coverage, two columns)
- Wide tree sprites: 13–14 instances × 8 tiles = 104–112 tiles (~23–25% coverage)
- Combined `in-front` coverage: ~45%

**Path channel width:** maintain a contiguous open run of ≥ 3 tiles at the same x-range on every row. Narrower than 3 tiles at any row is a navigability issue; fix it by patching the offending row.

---

## Rule 4 — Arena/clearing maps: reserve 40–60% of map height as open combat floor

The bottom 40–60% of an arena map must have zero `in-front` tiles and minimal `behind` tiles. This is the combat zone.

**Boss clearing v2:** bottom 8 of 22 rows (36%) fully clear in `in-front`; combined with light `behind` in that zone, roughly 57% of the map is open arena floor.

Decoration belongs in the upper section (the "entrance" wall). The player enters from the top and the arena opens before them — compositionally correct for a boss reveal.

---

## Rule 5 — Arena trees stagger diagonally; never form straight horizontal walls

Straight horizontal rows of trees feel like a barricade. Organic forest compositions stagger diagonally:

Each 2-wide tree sprite group should be placed 2 columns to the left (or right) of the previous group, creating a cascading diagonal from one corner toward the center. The v2 boss_clearing cascade:
- (16,1) → (18,3) → (20,4) → (23,5) → dense row at y=6 → ground-level fill at y=10–13

This looks naturalistic. Use diagonal cascades, not grid rows.

---

## Rule 6 — Ground layer simplicity is inversely proportional to decoration complexity

When decoration layers are rich (15–20 unique GIDs), use a simple ground: 4–6 GIDs with one dominant tile covering 55–65% of the floor area.

**Boss clearing v1:** 44 unique ground GIDs (noisy floor competing with decoration).  
**Boss clearing v2:** 11 unique ground GIDs, dominant tile covers 57% of floor.  
**South path:** 5 ground GIDs, dominant tile covers ~60% — pairs with 20 unique `in-front` GIDs.

---

## Rule 7 — Forage nodes must be collocated with a visual tile

Every `forage_node` object in the `objects` layer must have a matching decoration tile at (or within 1 tile of) its position in `behind` or `in-front`. The player sees a bush or tree and knows they can interact with it.

South path v2 added the two `forage_node` objects at exactly the positions where new `in-front` and `behind` tiles were simultaneously placed.

**Check:** for every forage_node at (px, py), confirm there is a non-zero tile at (floor(px/16), floor(py/16)) or an adjacent cell in `behind` or `in-front`.

---

## Rule 8 — Spawn point placement by map type

| Map type | Spawn position |
|---|---|
| Path / corridor | Near one edge (player enters and walks through) |
| Arena / clearing | Near top edge (y ≈ 1–2 tiles from north border) — player enters from above and sees the full space |
| Hub | Near the biome entry exit |

**Boss clearing v1 mistake:** spawn at tile y=20 (row 20 of 22) — inside the tree cluster zone, player spawned surrounded by decoration.  
**v2 fix:** spawn at tile y=1.5 (top entry), player enters and arena opens before them.

---

## Rule 9 — Behind-layer cluster shapes by biome zone

Behind-layer decoration should not be uniformly random. Use intentional cluster shapes:

- **Dense rectangular block:** upper-left or upper-right quadrant, 8–12 tiles wide × 3–5 tiles tall — establishes the "edge of the treeline" reading
- **Wedge/diagonal scatter:** radiates from a 4-tile seed, expanding 1 column wider per row — looks like undergrowth spreading from a dense zone
- **Isolated pairs:** 2-tile `behind` pairs scattered in open areas — ground-level clutter that adds realism without blocking sight

Never scatter single isolated `behind` tiles across the whole map randomly. They read as noise, not vegetation.

---

## Rule 10 — Close canopy gaps before shipping any path map

Audit the `in-front` layer column-by-column for path maps. For each x-column that forms part of the wall boundary, verify non-zero tiles appear at every row (or every 2–3 rows for a fence-post pattern). Any 2+ consecutive empty rows in a wall column is a visible gap that breaks immersion.

South path v2 fixed exactly 2 such gaps: at (7,2) and (8–9,15).

---

## Reference Measurements (verified maps)

### forest_south_path (16×28, vertical corridor)
- `behind`: 125 tiles / 27.9% coverage / 19 unique GIDs
- `in-front`: 202 tiles / 45.1% coverage / 23 unique GIDs
- `ground`: 448 tiles / 100% / 5 unique GIDs
- Path channel: x=7–9 (3 tiles wide), maintained full map height
- Wall columns: x=0–6 (left), x=10–15 (right)

### forest_boss_clearing (28×22, outdoor arena)
- `behind`: 122 tiles / 19.8% coverage / 15 unique GIDs
- `in-front`: 173 tiles / 28.1% coverage / 18 unique GIDs
- `ground`: 616 tiles / 100% / 11 unique GIDs
- Clear arena zone: rows y=14–21 (8 rows, 36% of height) zero `in-front`
- Tree zone: rows y=1–13 (13 rows, 59% of height) diagonal cascade
- Spawn: tile (14,1) — top entry point
