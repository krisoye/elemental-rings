# terrain_mine_main / terrain_mine_main_b

**Files:**
- `client/public/assets/terrain/terrain_mine_main.png` — **brown / dirt** palette
- `client/public/assets/terrain/terrain_mine_main_b.png` — **grey stone** palette (identical layout, recolor)

**Dimensions:** 256 × 256 px — 16 columns × 16 rows of 16 px tiles (256 tiles, IDs 0–255)
**Tileset name in maps:** `terrain_mine_main` / `terrain_mine_main_b`
**firstgid:** varies per map (hand-authored)
**Tile ID formula:** `row * 16 + col`

The gold-mine counterpart to `terrain_cave_main`. Use for mine / excavation screens.
Pair the two palettes for variety (e.g. brown earthen mine vs grey rock mine).

> **Confidence note.** First pass from 16 px visual inspection — region boundaries are
> reliable; confirm exact per-tile IDs in Tiled before heavy use.

---

## Region map

| Region (rows, cols) | Tile IDs (approx) | Content | Layer |
|---|---|---|---|
| rows 0–9, cols 0–4 | 0–4,16–20,… | **Rock/dirt wall blocks with gold-ore veins** (yellow nuggets embedded) + loose **gold-ore piles** | `behind` (walls) / `ground` (piles as forage props) |
| rows 0–2, cols 5–9 | 5–9,21–25,… | **Dark mine-shaft openings** (with gold glints) + **checkered dirt floor** | `behind` (shaft) / `ground` (floor) |
| rows 3–5, cols 5–9 | 53–57,69–73,… | **Mine-cart rails / track** (straight + ends) | `ground` |
| rows 0–9, cols 10–15 | 10–15,26–31,… | **Brown plank walls** + **black cave void** (off-map / pit) | `behind` |
| rows 9–13, cols 0–9 | 144–153,160–169,… | **Timber mine supports**: beams, scaffolding, pit-prop frames, fences, ladders | `behind` |
| rows 11–13, cols 7–10 | 183–186,199–202,… | **Stone mine-entrance structure** + **minecart** (grey/red) | `behind` (structure) / `in-front` (roof) |
| rows 13–15, cols 0–9 | 208–217,… | Additional **support framing / flooring** | `behind` / `ground` |

---

## Layer guidance (three-layer convention)

- **Ore walls, plank walls, timber supports, the entrance structure, minecart** → `behind`
  (solid; blocks via non-empty collision).
- **Rails, dirt/checkered floor, gold-ore piles** → `ground` (rails non-blocking; mark deep
  void/pit tiles `collides:true` so players can't walk into the shaft).
- **Structure roof / overhead beams** → `in-front` (player passes beneath).

### Gold-ore note
The embedded-ore wall tiles and loose ore piles are the natural fit for a **`forage_node`**
or a future mining-resource interaction; place the object marker on the adjacent walkable
floor tile (an object on a solid `behind` tile can't be reached).

---

## Needs Confirmation (verify in Tiled)

- Exact tile IDs per region (count precisely in Tiled).
- The **mine-cart rail** set — whether it includes corners/junctions or only straight runs.
- The **black void** tiles (cols 10–15) — confirm which represent an impassable pit (need
  `collides:true`) vs decorative shadow.
