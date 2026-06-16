# Snow Map Design Guidelines

Derived from `snow_entry.json` and `snow_mockup.png`. These rules describe the decisions that make a snow screen look attractive — use them before placing any tile.

Two canonical references exist — study the one that matches your screen type:
- **Open field** → `snow_entry.json` (32×24) + `snow_mockup.png`
- **Narrow corridor / pass** → `snow_wind_pass.json` (20×36, hand-corrected by designer)

---

## 1. Composition Framework

**Divide the map into quadrants mentally before placing anything.**

- Place one major anchor feature in 3 of the 4 quadrants. Leave the 4th lighter.
- In `snow_entry`: NW = cliff, SW = dense trees, SE = river + dock, NE = open with sparse trees.
- The center 40–50% of the map by area should stay open traversable snow. Never crowd it.
- One feature should run edge-to-edge (e.g. the river runs full height on the right). This gives the map a spine.
- Aim for diagonal visual flow: strong feature NW ↔ strong feature SE creates a natural eye path across the map.

**Asymmetry is required.** Nothing should be centered or symmetrical. Symmetric maps look artificial.

---

## 2. Major Feature Placement

### Rocky cliff
- One corner only. Upper-left is canonical for `snow_entry`.
- The cliff block is a 5×5 top + cliff face + narrow base — about 8 tiles tall, 5 wide.
- Extend it with snow fill tiles (Group A, terrain_snow_main r0–3 c5–6) to widen the snowy surface around it.
- Place ice foliage autotile tiles at its base/sides to soften the hard edge where it meets flat snow.

### River / water
- One full edge, full height or width. Never a pond floating in the center.
- River width: 4–6 tiles. Use all available pond edge tiles — upper-right corner, right edge, lower-right corner, etc. — to make banks irregular, not straight lines.
- Vary the width slightly: widen at top, narrow slightly at bottom, or add a small cove bump at mid-height.
- Small snow-in-pond islands inside the river add realism (use Snow-in-Pond tiles from autotile_snow_16).

### Log cabin
- Upper half of the map, 1/4 to 1/3 from the nearest non-river edge. Not in a corner.
- In `snow_entry`: roughly at (col 1–6, row 0–7) — upper-left zone, adjacent to the cliff.
- Door faces south — leave 3–4 tiles of clear snow in front.
- A dirt footpath (dirt autotile tiles) runs from the door southward into the open center.

### Wooden dock
- Sits at the river bank, mid-height. Not at the very top or bottom of the river.
- Posts/pilings in `behind`, floor platform in `in-front`.
- The platform overhangs the water by 2–3 tiles.

### Anchorage
- Upper half, roughly center-horizontal. Clear of trees, cliff, and buildings.
- In `snow_entry`: col 16, row 4 (north-center of playable zone).

---

## 3. Tree Rules

Trees are the most important decoration. Getting them wrong makes a map look dead or cluttered.

### Always cluster — never isolate
A single tree looks like a mistake. Minimum cluster size is 2 overlapping sprites. Clusters of 3–4 overlapping trees (placed 2–3 tiles apart) create the forest-edge effect seen in the mockup.

### Trees belong at the edges, not the center
Trees "press in" from the map perimeter. They never appear in the open center zone (center ~40% by area). Think of them as a frame around the playable space.

### Cluster distribution (for a 32×24 map)
Aim for 4–6 distinct clusters:
- 1–2 clusters on the left edge (upper-left is usually cliff, so start from mid-left)
- 1–2 clusters in the lower-left corner — this is typically the densest
- 1 cluster lower-center or lower-right
- 1 sparse cluster upper-right (near river edge)

### Mix tree types within a scene
Use both conifer (triangular, cols 0–3 of terrain_snow_main) and round (broad, cols 4–8) trees in the same scene. Conifers tend to appear more toward the top/left; round trees are more common in the lower half and are bigger visually.

### Leave gaps between clusters
A 2–4 tile gap of open snow between clusters gives visual breathing room and looks more natural than a solid wall of trees.

### Layer split (mandatory)
| Tileset rows | Layer | Notes |
|---|---|---|
| r11–12 (top canopy) | `in-front` | Player walks under |
| r13–14 (mid canopy) | `in-front` | Player walks under |
| r15–16 (trunk + root) | `behind` | Blocks player movement |

Never put canopy on `behind` or trunk on `in-front`.

---

## 4. Ground Terrain Rules

### Snow fill dominates
Plain snow (autotile_snow_16 local 23, GID 79 at firstgid=56) fills 65–75% of the ground layer. Variant snow tiles (locals 24, 29) appear sparingly as subtle texture.

### Dirt patches are organic blobs
Dirt/exposed ground patches go in the center zone as texture variation. Shape them as irregular blobs — never rectangles. Use autotile dirt island edge tiles to form natural-looking perimeters. In `snow_entry` the dirt patch is a single large asymmetric blob at center-lower.

### Ice foliage at transitions
Ice foliage autotiles (autotile_snow_16, rows 0–2 cols 5–7) soften transitions between cliff and open snow, or between boulders and flat ground. Keep them sparse — 2–4 tiles at each transition point.

### Water banks use all edge variants
Don't use a single "right edge" tile for the entire river length. Use:
- `Pond lower-right/left corner` where the bank jogs
- `Pond right/left edge` for straight runs
- `Pond upper-right/left corner` at bends
- `Snow-in-Pond` tiles where small ground islands intrude into the water

---

## 5. Prop Placement

### Barrels
2–3 barrels placed at the south or east side of the cabin. They add life to the building exterior.

### Snowman
One snowman (terrain_snow_main r12,c9) placed near the cabin or anchorage. Never in the open center.

### Figure sprites (geese/birds)
The figure sprites visible at terrain_snow_main rows 11–16 cols 9+ work well as ambient wildlife. Place 2–4 near the cabin or along the river bank.

### Flowers
Small flower clusters (from the flora sheet) appear near tree bases and at the map edge — not in the open center snow. Scatter 3–5 clusters total. They should feel incidental, not patterned.

### Footprint trail
A light dirt/mud path (1–2 tiles wide, made of dirt autotile tiles) running from the cabin door southward into the open zone gives the scene a sense of habitation.

---

## 6. Layer Assignment Summary

| Object | ground | behind | in-front |
|--------|--------|--------|----------|
| Snow / water / dirt | ✓ | | |
| Rocky cliff | ✓ (snow fill interior) | ✓ (rocky border + face) | |
| Tree trunk + root | | ✓ | |
| Tree canopy (r11–14) | | | ✓ |
| Cabin walls | | ✓ | |
| Cabin roof | | | ✓ |
| Chimney | | | ✓ |
| Dock posts/pilings | | ✓ | |
| Dock floor platform | | | ✓ |
| Barrels / props | | ✓ | |
| Snowman | | ✓ | |

---

## 7. Exit and Object Layer

- **Spawn point:** 3–4 tiles inside the entry edge, horizontally centered on the expected entry corridor.
- **biome_exit zone:** at the exit edge, 4+ tiles wide, centered on the corridor. Width 64px (4 tiles) minimum.
- **Anchorage:** upper half, center-horizontal, at least 4 tiles from any tree or building.
- **Forage nodes / merchant positions:** place on open snow, never inside tree clusters.

---

## 7b. Corridor Map Rules (narrow pass screens)

Derived from `snow_wind_pass.json`. These supplement the general rules above for any narrow passage screen.

### Cliff protrusions create the path — never go straight

The single most important rule: cliff structures should **jut INTO the walkable area from alternating sides** at different heights, forcing the player to navigate an S-curve or zigzag. A straight corridor is boring and wrong.

How to build a protrusion:
- Place cliff top **interior snow fill tiles** (ts_snow locals 19–21, 37–39, 55–57 = the inner 3×3 of the cliff top block) in the **`ground` layer** — this is the cliff surface the player can't walk on.
- Place cliff **rocky border tiles** (locals 18, 22, 36, 40, 54, 58, 72–76) in the **`behind` layer** — these are the collision edges.
- The protrusion from the left wall forces the player right; the next protrusion from the right wall forces them left. Alternate left-right every 8–12 rows.

### Ice obstacle pools

A 5×3 (or wider) ice patch in the `ground` layer makes a navigate-around obstacle within the corridor. Size matters: a 3×3 patch is texture, a 5×3 patch is an obstacle that shapes movement. Surround it with GID 241 (ts_snow r5,c5 — cliff edge marker) on the sides to frame the hazard.

### Ice foliage strips from cliff faces

Ice foliage autotile (autotile_snow_16, rows 0–2, cols 5–7) can form a **vertical strip 2–3 tiles wide, 6–8 rows tall** growing from a cliff face into the corridor. Place on the `ground` layer. This softens the hard cliff edge visually and fills gaps where a protrusion ends before the next one begins.

### Corridor width varies

Minimum passable width: 4–5 tiles (64–80px). Maximum width at openings: 8–10 tiles. The variation between min and max is what creates the "squeeze" sensation of a mountain pass.

### Trees cluster at both openings and along walls

In a corridor map, tree clusters frame the north AND south openings. Additionally, 2–3 individual round trees can be placed with their trunks partially embedded in the cliff wall (trunk/root in `in-front` rather than `behind` is acceptable when the cliff tiles provide the collision). The 5-wide round tree (cols 4–8 of terrain_snow_main) works better against a wall than the 4-wide conifer.

### Decorative props in the corridor

A snowman (ts_snow r12,c9) can be placed mid-corridor as ambient scenery, not just near buildings. Single isolated props feel natural in a narrow pass where a character might have left something behind.

### Cliff top tiles in `ground` layer — full pattern

When a cliff surface extends across multiple rows in the ground layer:
- Row N (top of cliff surface): rocky border top row (locals 1–3, or 18/22 at sides)
- Rows N+1 to N+2: snow fill interior rows (locals 19–21, 37–39)
- Row N+3 (bottom of cliff surface): rocky border bottom row (locals 73–75)
- Row N+4: cliff face row in `behind` (locals 90–94)
- Row N+5: cliff base row in `behind` (locals 109–111)

The `ground` layer holds the TOP surface; the `behind` layer holds the FACE and BASE below it.

---

## 8. Reference Metrics (snow_entry.json, 32×24)

| Element | Position | Notes |
|---------|----------|-------|
| Cliff | rows 0–8, cols 0–4 | NW corner anchor |
| River | cols 23–31, full height | SE edge, 5 tiles wide at widest |
| Cabin | rows 0–7, cols 0–6 | Upper-left zone, door faces south |
| Dock | rows 9–11, cols 14–16 (pilings) + 22–28 (platform) | Mid-right, over water |
| Anchorage | col 16, row 4 | North-center of playable zone |
| Biome exit south | x=224, y=368, w=64 | col 14, row 23 |
| Open center zone | cols 6–22, rows 6–18 | ~50% of map area — kept clear |
| Dirt patch | rows 5–10, cols 5–14 | Organic blob, center-left of open zone |
| Dense tree zone | rows 18–23, cols 4–8 | Lower-left, largest cluster |
| Sparse tree zone | rows 4–11, cols 19–23 | Center-right, lighter density |
