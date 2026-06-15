# terrain_cave_boulder

**File:** `client/public/assets/terrain/terrain_cave_boulder.png`
**Dimensions:** 128 × 16 px — 8 columns × 1 row of 16 px tiles (8 tiles, IDs 0–7)
**Tileset name in maps:** `terrain_cave_boulder`
**Tile ID formula:** `col` (single row)

A strip of **8 round boulder props** (dark rock, slight per-tile variation). Decorative
obstacles for caves/mines — scatter them as cover/landmarks, never in straight lines
(same clustering instinct as trees: 2–3 grouped reads better than one isolated).

| Tile ID | Description |
|---------|-------------|
| 0–7 | Round boulder variants (use a mix so repeated boulders don't look tiled) |

---

## Layer guidance

- Place boulders on **`behind`** so the player walks in front of them and they block movement
  (under the SnowScene-style `behind` = non-empty collision rule).
- For a boulder the player should pass *behind* (e.g. a large one at the top of a wall), put it
  on `in-front` instead — but then it won't block, so pair with a `behind` collision tile or a
  physics zone if a wall is intended.
