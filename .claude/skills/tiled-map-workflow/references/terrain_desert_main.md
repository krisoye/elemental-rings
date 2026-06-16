# terrain_desert_main

**File:** `client/public/assets/terrain/terrain_desert_main.png`
**Dimensions:** 288 × 800 px — 18 columns × 50 rows of 16 px tiles (900 tiles, IDs 0–899)
**Tileset name in maps:** `terrain_desert_main` / `ts_desert`
**Tile ID formula:** `row * 18 + col`
**firstgid:** varies per map (hand-authored). The Desert counterpart to `terrain_snow_main`.

A full desert town/oasis kit: sandstone canyon cliffs, a cave/mine archway, palms + cacti +
shrubs, market awnings, adobe buildings, shingled-roof houses, and pottery props. Pair with
`autotile_desert_16` (sand/water/foliage ground) the way Snow pairs `terrain_snow_main` +
`autotile_snow_16`.

> **Confidence note.** First pass from visual inspection at 16 px — region boundaries are
> reliable; confirm exact per-tile IDs in Tiled before heavy use.

---

## Region map

| Rows (approx) | Cols | Content | Layer |
|---|---|---|---|
| 0–5 | 0–17 | **Sandstone canyon cliff** — tan/brown rock with sandy interior (cross silhouette like the snow cliff). Two palette/shape variants side by side (cols 0–8, 9–17). | `behind` (rock face) / `ground` (cliff-top sand surface) |
| 6–8 | ~3–14 | **Cave / mine archway** — dark recessed entrance at the cliff base | `behind` (sides) / `in-front` (overhang) |
| 9 | 0–17 | **Boulders / rubble** props | `behind` |
| 11–16 | 0–4 | **Palm trees** (two sizes — large + small), green fronds + trunk | canopy `in-front`, trunk `behind` |
| 11–18 | 6–14 | **Cacti** (tall saguaro + small) and **desert shrubs/bushes** | `behind` (solid) or `in-front` (overhang) |
| ~20 | 0–9 | **Market awnings** — striped canopies (pink / green / blue) | `in-front` (overhead) |
| 21–32 | 0–17 | **Adobe buildings** — cream/tan walls, windows, wooden doors, flat roofs (two variants, cols 0–8 / 9–17) | walls `behind`, roof/overhang `in-front` |
| 33–44 | 0–17 | **Shingled-roof houses** — green/teal pitched roofs over tan walls (two variants) | walls `behind`, roof `in-front` |
| 45–49 | 0–8 | **Pottery / urns** — colored ceramic jars (props) | `behind` |

---

## Layer guidance (three-layer convention)
- **Cliff faces, building walls, cactus/shrub bodies, palm trunks, boulders, pottery** → `behind` (solid; non-empty collision blocks them).
- **Cliff-top sand surface, ground props** → `ground`.
- **Roofs, awnings, palm canopies, cave-arch overhang** → `in-front` (player walks under).

A building needs tiles on both `behind` (walls the player stops at) and `in-front` (roof overhead),
exactly like the Snow log cabin and Forest structures.

## Needs Confirmation (verify in Tiled)
- Exact tile IDs per region (count precisely in Tiled; 50 rows is large).
- Whether the side-by-side "two variants" are recolors or genuinely different structures.
- The cave-archway tiles — confirm which form the impassable interior vs the walkable threshold.
