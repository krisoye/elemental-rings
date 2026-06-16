# autotile_desert_16 — Desert Autotile Sheet

**File:** `client/public/assets/terrain/autotile_desert_16.png`
**Dimensions:** 160 × 240 px — 10 columns × 15 rows of 16 px tiles (150 tiles, IDs 0–149)
**Tileset name in maps:** `autotile_desert` (texture key) / `autotile_desert_16`
**Tile ID formula:** `row * 10 + col`
**firstgid:** varies per map (hand-authored). The Desert counterpart to `autotile_snow_16`.

Same layout convention as `autotile_snow_16`: each material is a **3×3 island autotile block** (row 0 = bottom edge of the island, row 2 = top edge, corners on the diagonals, center = fill) with an adjacent **2×2 inverted block** (the four inner-corner tiles for the island-in-field case). Use on the `ground` layer for terrain; foliage blocks may go on `behind`/`in-front` by depth.

> **Confidence note.** Derived from visual inspection + a pixel-content decode at 16 px.
> Material regions and the dominant sand fill are reliable; confirm exact per-tile IDs
> in Tiled before heavy use (mirrors the "Needs Confirmation" sections in the snow sheets).

---

## Material blocks (by 3-row band; cols 0–2 = island, 3–4 = inverted, 5–7 = island, 8–9 = inverted)

| Rows | Cols 0–4 | Cols 5–9 |
|------|----------|----------|
| 0–2 | **Sand** — open desert ground (island + inverted) | **Green foliage** — oasis grass/bushes |
| 3–5 | **Wood decking** — planks (oasis boardwalk) | **Green foliage** (variant) |
| 6–8 | **Sand** (variant) + **brick/clay** inverted | **Stone/cobble** island + **oasis water** edge |
| 9–11 | **Brick/clay** (adobe floor) | **Stone/cobble** + **oasis water** island (pool) |
| 12–14 | **Sand** | **Brick wall** (adobe brick, orange/tan) |

### Dominant ground fill — plain sand
Sand fills most of a desert screen's `ground` layer (as plain snow GID 79 does for snow).
Plain-sand candidates (uniform, fully opaque — **confirm one in Tiled**):

| Local ID | Row, Col | RGB | Note |
|----------|----------|-----|------|
| 20 | r2,c0 | (228,180,116) | sand, opaque |
| 60 | r6,c0 | (242,200,126) | bright open sand |
| 80 | r8,c0 | (243,202,127) | bright open sand |

### Oasis water
Blue water-pool tiles cluster at **cols 8–9, rows 6–10** (3×3 pool block with edges + inverted
snow-in-pond-style corners). Set `collides:true` on the open-water centre if the pool should
block movement; leave it off for a shallow/wadeable oasis.

---

## Layer guidance
- **Sand / brick floor / cobble / water** → `ground`.
- **Green foliage (bushes)** → `behind` (player walks in front) or `in-front` (overhanging fronds) by intent.
- **Wood decking** → `ground` (walkable boardwalk).

## Needs Confirmation (verify in Tiled)
- Exact tile IDs within each material block (count precisely in Tiled).
- Which sand cell is the canonical "plain fill" (candidates above).
- Whether the wood vs brick/clay bands are distinct materials or palette variants (the colour decode overlaps).
