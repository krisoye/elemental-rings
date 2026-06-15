# terrain_cave_water / terrain_cave_water_alt

**Files:**
- `client/public/assets/terrain/terrain_cave_water.png`
- `client/public/assets/terrain/terrain_cave_water_alt.png` (recolor variant)

**Dimensions:** 480 × 48 px — 30 columns × 3 rows of 16 px tiles (90 tiles, IDs 0–89)
**Tileset name in maps:** `terrain_cave_water` / `terrain_cave_water_alt`
**Tile ID formula:** `row * 30 + col`

Subterranean water/pool tiles for cave screens. The sheet is a **3-tall strip of pool
autotile blocks** — a series of blue water cells, each framed by a grey rock rim (the
standard island-in-rock edge convention: row 0 = bottom edge, row 2 = top edge, plus
corners). Read on the `ground` layer; set `collides:true` on the open-water centre tiles
if the pool should block movement (omit it for a wadeable/shallow look).

> **Confidence / Needs Confirmation.** The strip appears to hold ~10 pool variants laid out
> as ≈3×3 autotile blocks (30 cols ÷ 3). Confirm the exact block boundaries and which cell
> is the open-water centre in Tiled before painting a large pool — the unusual 30-wide
> layout means it may instead be a wang/edge set or animation frames.

---

## Layer guidance

- Pool tiles → `ground`.
- `collides:true` on open-water centres only if the pool is impassable; cave water is often a
  hazard/landmark rather than a wall.
- Frame pool edges with `terrain_cave_main` cobble floor so banks read cleanly.
