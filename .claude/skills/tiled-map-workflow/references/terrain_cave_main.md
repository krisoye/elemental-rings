# terrain_cave_main / terrain_cave_alt

**Files:**
- `client/public/assets/terrain/terrain_cave_main.png` — **grey** rock palette
- `client/public/assets/terrain/terrain_cave_alt.png` — **brown** rock palette (identical layout, recolor)

**Dimensions:** 256 × 256 px — 16 columns × 16 rows of 16 px tiles (256 tiles, IDs 0–255)
**Tileset name in maps:** `terrain_cave_main` / `terrain_cave_alt`
**firstgid:** varies per map (hand-authored)
**Tile ID formula:** `row * 16 + col`

Companion sheets: `terrain_cave_water.md` (pools), `terrain_cave_boulder.md` (boulders),
`terrain_mine_main.md` (gold-mine variant). Use for cave / underground screens; pair
`*_alt` (brown) with `*_main` (grey) for visual variety between adjacent screens.

> **Confidence note.** This sheet is a first pass derived from visual inspection of the
> 256×256 sheet at 16 px. Region boundaries (col/row ranges) are reliable; exact
> per-tile IDs inside each region should be confirmed in Tiled before heavy use, the
> same way the snow sheets carry a "Needs Confirmation" section. Update with precise
> IDs as cave screens are authored.

---

## Region map

| Region (rows, cols) | Tile IDs (approx) | Content | Layer |
|---|---|---|---|
| rows 0–9, cols 0–1 | 0,1,16,17,… | Solid rock **cliff/wall faces** — three shades top→bottom (light → dark) | `behind` |
| rows 0–9, cols 2–4 | 2–4,18–20,… | Rock **wall blocks with a recessed dark centre** (alcove / cave-mouth look) | `behind` |
| rows 0–1, cols 10–13 | 10–13,26–29 | **Dark jagged cave ceiling / entrance** rock (stalactite tops) | `in-front` (overhead) |
| rows 0–1, cols 14–15 | 14,15,30,31 | **Stone pillars / columns** (vertical) | `behind` |
| rows 2–5, cols 5–6 | 37,38,53,54,… | **Wooden ladders** (vertical) | `behind` |
| rows 2–3, cols 8–11 | 40,41,56,57 | **Water pools** (blue, rock-rimmed) — see `terrain_cave_water.md` for the full pool set | `ground` |
| rows 2–5, cols 8–13 | 40–45,56–61,… | **Cobble / flagstone cave floor** (walkable) | `ground` |
| rows 6–8, cols 7–9 | 103–105,119–121,… | **Stair / pit descent** (teal down-arrows) — vertical-travel feature | `ground` |
| rows 6–9, cols 10–13 | 106–109,122–125,… | **Crates, barrels, boxes** (wooden props) | `behind` |
| rows 2–9, cols 14–15 | 46,47,62,63,… | **Rope / vine accents** in two colours (red + green) — decorative hangers | `in-front` |
| rows 10–15, cols 0–15 | 160–255 | Additional **floor variants, plank tiles, and small props** | `ground` / `behind` |

---

## Layer guidance (three-layer convention)

- **Cave walls / cliff faces / pillars / crates / ladders** → `behind` (solid; SnowScene-style
  `behind` = non-empty collision blocks them).
- **Cobble floor / water pools / stair-down** → `ground` (set `collides:true` only on tiles that
  should block, e.g. deep water if not meant to be wadeable).
- **Cave ceiling / overhead rock / hanging vines** → `in-front` (player walks under).

A cave wall usually needs tiles on both `behind` (the face the player stops at) and `in-front`
(the ceiling/overhang above), exactly like a Forest building.

---

## Needs Confirmation (verify in Tiled)

- Exact tile IDs within each region (the table gives the first cell of each block; count
  precisely in Tiled).
- Whether the **rope/vine** column (cols 14–15) is decoration only or includes climbable tiles.
- Whether the **stair/pit** tiles (cols 7–9, rows 6–8) are purely visual or intended to mark a
  level-transition zone (they have no engine meaning yet — a `screen_exit`/`biome_exit` object
  drives transitions, not the tile).
