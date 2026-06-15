---
name: tiled-map-workflow
description: "Workflow for authoring Tiled maps and importing them into Elemental Rings. Covers the three-layer convention (ground / behind / in-front), tileset setup, tile validation, and the division of labour between designer (Tiled) and Claude (import, repair, scene wiring)."
---

# Tiled Map Workflow — Elemental Rings

The workflow has two roles:
- **Designer (you):** create and edit the map in Tiled, export to JSON, paste or provide the file.
- **Claude:** validate dimensions, fix transcription errors, split layers, wire the scene code.

---

## Three-Layer Convention

All hand-authored screens use exactly three tile layers. See **§10.1** of `docs/gdd-10-overworld.md` for the full rule table.

| Layer name | Depth | Collision | What goes here |
|------------|-------|-----------|----------------|
| `ground` | 0 | `collides` property | Base terrain: grass, water, paths, dirt |
| `behind` | 2 | all non-empty | South walls, tree trunks, fence posts — the player walks *in front of* these |
| `in-front` | 5 | none | Roofs, canopy, cliff overhangs — the player walks *under* these |

Player character depth: **3** (set in `BaseBiomeScene.create`).

**Placement rule:** ask "can the player ever walk in front of this tile?" Yes → `behind`. No (they walk under it) → `in-front`. It's terrain → `ground`.

A single object usually needs tiles on *both* `behind` and `in-front` — e.g. a building: south wall panels on `behind`, roof tiles on `in-front`.

### Optional fourth layer: `npcs`

You may include an `npcs` layer in Tiled for authoring reference (painting where merchants or NPCs stand). This layer is **not rendered by the scene** — interactive NPCs are spawned as sprites from the `objects` layer. Declaring it keeps the character sprites visible while editing in Tiled without affecting the shipped game.

---

## Tileset Rules

**Tileset reference sheets** — detailed tile-by-tile visual descriptions and layer conventions for the tilesets used in Forest maps are in `.claude/skills/tiled-map-workflow/references/`:

| File | Tileset |
|------|---------|
| `autotile_snow_16.md` | Snow autotile sheet (dirt/ice/foliage/pond islands, transparent foliage) |
| `terrain_snow_main.md` | Snow main tileset (rocky cliff, log house, chimney, conifer + round trees) |
| `snow_map_design.md` | **Snow map design guidelines** — composition, tree clustering, terrain, props, layer rules |
| `terrain_forest_modern.md` | ModernEra GreenForest (trees, water pool, cliff rocks) |
| `terrain_plains_fantasy.md` | Plains Fantasy (trees, brown cliffs, dirt island) |
| `tileset_village_main_a.md` | Village Main A (grass, fence, houses, trees, gray cliff) |
| `terrain_cave_main.md` | Cave tileset (walls, cobble floor, ladders, stair-down, crates) — grey `_main` / brown `_alt` |
| `terrain_mine_main.md` | Gold-mine tileset (ore veins, cart rails, timber supports) — brown `_main` / grey `_b` |
| `terrain_cave_water.md` | Cave water pools (`_main` / `_alt` recolor) |
| `terrain_cave_boulder.md` | Cave boulder props (8 variants) |
| `autotile_desert_16.md` | Desert autotile (sand/oasis-water/foliage/deck/brick/cobble islands) |
| `terrain_desert_main.md` | Desert tileset (canyon cliffs, cave arch, palms/cacti, awnings, adobe + shingled buildings, pottery) |

Read the relevant reference before placing tiles from these tilesets.

- **Tile size:** 16 px (hand-authored hub screens) or 32 px (generated biome screens).
- Hub screens render at **2× world zoom** so 16 px reads as 32 px on screen.
- Each tileset image must be present under `client/public/assets/` in the appropriate subdirectory: `terrain/` for terrain tilesets, `structures/` for building/decoration tilesets, `flora/` for flora. The `tiles/` path is outdated — do not use it.
- The scene's `ForestScene.preload()` lists which image keys to load; add new tileset images there.
- The **`collides` property** only needs to be set on tiles that should block movement in the `ground` layer (e.g. water/void boundary tiles). The `behind` layer uses `setCollisionByExclusion([-1])` — all non-empty tiles block automatically. The `in-front` layer uses no collision.

---

## How to export from Tiled

1. File → Export As → JSON (`.json`). Use **"Embed tilesets"** OFF — keep external tileset references.
2. The image paths in the exported JSON are relative to the map file. Use `../../tiles/...` for the hub map at `maps/forest/`.
3. Verify: each tileset `"image"` path resolves from the map file's directory.

---

## How to provide a map update

**Preferred (zero transcription risk):**
```
! cp /path/to/exported.json client/public/assets/maps/forest/forest_anchorage.json
```
Paste the shell command with the `!` prefix so it runs in the conversation and the file lands directly.

**Fallback (paste JSON):**
Paste the full JSON in the message. Claude will:
1. Validate all tile layers have exactly `width × height` tiles.
2. Check all tileset `"image"` paths exist on disk.
3. Split the `above-ground` layer into `behind` + `in-front` if needed.
4. Write the corrected file and confirm.

**Common transcription error:** each tile layer must contain exactly `width × height = 1200` tiles (for a 40×30 map). Copying a formatted JSON block can accidentally drop or duplicate a row. Claude validates this automatically on every write.

---

## What Claude fixes automatically

| Issue | Detection | Fix |
|-------|-----------|-----|
| Wrong tile count per layer | `len(data) != width * height` | Reconstruct from non-zero tile positions |
| Missing tileset images on disk | `os.path.exists(resolved_path)` for each tileset | Copy from OneDrive art library at `/mnt/t/OneDrive/Documents/Game Assets/game/elemental-rings/tiles/` |
| `above-ground` layer needs splitting | Layer named `above-ground` in map | Classify gids into `behind`/`in-front` by inspecting tileset images, rewrite as two layers |
| Scene not loading new tilesets | `ForestScene.preload` missing entries | Add `this.load.image(key, path)` for each new tileset |
| `buildTilesets` not filtering | `ForestScene.buildTilesets` | Iterates `map.tilesets`, skips any whose texture isn't loaded |

---

## Scene wiring (ForestScene)

`ForestScene` overrides three hooks from `BaseBiomeScene` for hub screens:

```typescript
// Which layers to render (in draw order)
protected tileLayerNames(): string[] {
  return this.screenId === 'forest_anchorage'
    ? ['ground', 'behind', 'in-front']
    : super.tileLayerNames();
}

// Collision mode per layer
protected tileLayerCollisionMode(layerName: string): 'property' | 'non-empty' {
  if (this.screenId === 'forest_anchorage' && layerName === 'behind') return 'non-empty';
  return super.tileLayerCollisionMode(layerName); // 'property' default
}

// Render depth per layer
protected tileLayerDepth(layerName: string): number {
  if (this.screenId !== 'forest_anchorage') return super.tileLayerDepth(layerName);
  if (layerName === 'behind')    return 2;
  if (layerName === 'in-front')  return 5;
  return 0; // ground
}
```

Add new hub screens by extending these conditionals or factoring the per-screen config into a lookup table once there are multiple hub screens.

---

## Art library location

Source assets live on OneDrive and are copied into the repo as needed:

```
/mnt/t/OneDrive/Documents/Game Assets/game/elemental-rings/
  tiles/
    regions/woods/   ← Forest biome tilesets
    npc/             ← Character charsets (charsetA_1–2, charsetB_1–2, base)
    interiors/       ← Sanctum interior tilesets
    monsters/        ← Monster overworld + battler sprites (68 files)
  maps/
    forest/          ← Master Tiled source maps
```

Repo paths (committed assets, reorganized in PR #146):
```
client/public/assets/
  ASSET_CATALOG.md            ← Full glossary of every asset file
  terrain/                    ← Map tilesets (terrain_forest_main, terrain_forest_void, …)
  structures/                 ← Building tilesets + sanctum exterior
  interiors/                  ← Cozy indoor tiles (furniture, floor, ceiling, walls)
  characters/                 ← charset_a1/a2/b1/b2/base spritesheets
  monsters/                   ← 67 monster sprites (overworld + battler views)
  flora/                      ← flora_berries_trees.png
  sprites/                    ← Generated strips (sprite_npc_overworld, sprite_forest_decor)
  maps/
    forest/forest_anchorage.json
    sanctum.json
```

---

## Character sprites (`charsetA_1.png`)

The shared `charset.ts` module handles frame math. The sheet is 192×256 (12 cols × 8 rows of 16×32 frames), 8 characters in a 4×2 grid, each character being 3 walk frames × 4 directions.

| Character index | Used for |
|-----------------|----------|
| 0 | Player |
| 4 | Merchant NPC 1 |
| 6 | Merchant NPC 2 |

Walk animations are registered once on the Phaser `AnimationManager` under keys `player-walk-down/left/right/up`. The idle frame is the middle column (col 1) of each direction row.

**Battle screen usage:** `BattleScene.preload()` loads `characters/charset_a1.png` under the key `battle-charset`. The front-facing idle frame (row 0 = down direction, col 1 = idle) is frame index **1** in the 12-col sheet. It's displayed at 4× scale as the player's battle avatar.

**Battle sprite frame mapping** (from `NpcSpawns.ts`):

| spriteFrame | NPC type | Battle sprite key |
|-------------|----------|------------------|
| 0 | Fire monster | `battle-monster-0` → `monster_fire_01_alt01_battler_front.png` |
| 1 | Water monster | `battle-monster-1` → `monster_water_grass_19_alt01_battler_front.png` |
| 2 | Earth monster | `battle-monster-2` → `monster_electro_ghost_14_alt01_battler_front.png` |
| 3 | Wind monster | `battle-monster-3` → `monster_water_fly_11_alt01_battler_front.png` |
| 4 | Wood monster | `battle-monster-4` → `monster_water_grass_20_alt01_battler_front.png` |
| 5–11 | Human duelist | `battle-charset` (charset_a1, char index = frame-5) |

The `spriteFrame` flows: overworld `NpcInfo.spriteFrame` → `scene.start('EncounterScene', { spriteFrame })` → `startAIDuel(..., spriteFrame)` → `scene.start('BattleScene', { opponentSpriteFrame })` → `OpponentDuelist(scene, spriteFrame)`.

---

## The `forest16.png` tileset

`forest16.png` is a tiny (64×16 px) placeholder tileset — four 16px tiles, three are blank/transparent. **Only tile id 2 (gid 3) is meaningful:** it carries `collides:true` and is painted wherever the designer wants an invisible solid boundary (water edges, void areas, map perimeter). The tile renders as a faint colored pixel, invisible at game zoom.

**Never remove this tileset from `forest_anchorage.json`.** gid 3 tiles form the perimeter collision (top/bottom walls, east edge) and the blue pond. If forest16 is removed, all of those boundaries become walkable.

---

## Collision on the `ground` layer — perimeter pattern

The hub map (`forest_anchorage`) uses **gid 3 (forest16 water tile)** for most of the perimeter:
- North row 0: gid 3 cols 0-16 and 23-39 — solid. Cols 17-22 open (north road).
- South row 29: same — solid except cols 17-22 (south road).
- East col 39: gid 3 rows 0-13 and 18-29 — solid. Rows 14-17 open (east road).
- West col 0: gid 3 only at corners/select rows. The rest is walkable tiles.

**The west wall gap is handled in code**, not tiles. `ForestScene.onEnterScreen()` adds invisible static physics zones (28 px wide) for rows 2-12, 18-22, and 27-28, leaving the road gap at rows 14-17 open. The zones are 28 px wide — deliberately wider than `EDGE=24 px` — so a blocked player stops at x ≈ 26 and does **not** trigger the west exit. Only the road gap (no zone) lets the player reach x ≤ 24.

Pattern for any screen that needs solid walls with specific road openings:
1. Paint gid 3 tiles in the `ground` layer where the wall should be solid.
2. Leave non-gid-3 tiles where road exits should be open.
3. If walkable tiles appear at the perimeter without a road, add a static zone in `onEnterScreen()`.

### Adding collision to interior terrain tiles

To make a specific tile type solid (e.g. stone tiles, cliff faces), add `collides: true` to the relevant **tile ID** in the tileset definition inside the map JSON:

```python
# Example: add collides:true to asset_alliance tile IDs 155-189 (grey stone tiles)
tileset["tiles"].append({
    "id": 155,
    "properties": [{"name": "collides", "type": "bool", "value": True}]
})
```

The `ground` layer already calls `setCollisionByProperty({ collides: true })` in `BaseBiomeScene`. No scene code change is needed when adding collision via tile properties.

### Adding screen-specific physics bodies (`onEnterScreen`)

For collision that can't be expressed cleanly through tile properties (e.g. the west wall gaps), override `onEnterScreen()` in `ForestScene`:

```typescript
onEnterScreen(): void {
  if (this.screenId !== 'forest_anchorage') return;
  const zone = this.add.zone(cx, cy, w, h);
  this.physics.add.existing(zone, true); // static body
  this.physics.add.collider(this.getPlayer(), zone); // getPlayer() is a protected accessor
}
```

`onEnterScreen?.()` is called at the end of `BaseBiomeScene.create()`. Zones created here are invisible but physically solid.

---

## Decorations gotcha — non-solid sprites and the UI camera

`placeDecoration(scene, group, specs)` adds solid sprites to the physics `staticGroup` and non-solid sprites directly to the scene. **Non-solid sprites are NOT in the group** and were historically missed by `uiCam.ignore()`, causing them to be rendered by both the world camera (correct, world-space) and the UI camera (wrong — fixed screen position on top of all world content, appearing to float above buildings and follow the player).

**Always use `decorHandle.sprites` to route decorations to the correct camera** — `DecorationHandle.sprites` now exposes all sprites (solid and non-solid):

```typescript
// Correct — routes ALL decoration sprites to world cam only
if (this.decorHandle) worldObjects.push(...this.decorHandle.sprites);

// Wrong — misses non-solid sprites
if (this.decorationGroup) worldObjects.push(...this.decorationGroup.getChildren());
```

The base class already uses the correct form. Only matters if you bypass `placeDecoration`.

---

## Sanctum interior maps (`sanctum.json`)

The Sanctum uses a **different layer system** from overworld maps — it has no `behind`/`in-front` layers. Instead it uses three Cozy Indoor tileset layers:

| Layer | Depth | Collision enabled |
|-------|-------|-------------------|
| `Floor` | 0 | `setCollisionByProperty` (walls, blocking floor tiles) |
| `Furniture` | 0 | `setCollisionByProperty` (table, appliances, bookcases) |
| `Ceiling` | 10 | `setCollisionByProperty` (outer walls, upper structure tiles) |

To add collision to a tile, add `collides: true` to its tile ID in the relevant tileset definition within `sanctum.json`. Collision is enabled on all three layers via `setCollisionByProperty` in `CampScene.create()`.

**Rug placement rule:** decorative floor rugs belong on the **Floor** layer (depth 0) so the player appears above them. If a rug tile ends up on the Ceiling layer (depth 10), the player disappears behind it. Move the tiles to Floor and re-export from Tiled.

**Zone naming:** the five interaction zones in the Sanctum objects layer are:
- `ringwall` → inventory / ring management
- `meditation` → recharge + teleport
- `bed` → sleep
- `eat` → food / cooking (was `campfire`, zone moved to the table)
- `door` → touch-to-exit (fires automatically, no E press needed)

---

## Generated Screen Convention (16px)

Generated screens — **all Forest/Swamp except `forest_anchorage`** — are produced
by `gen-forest-screens.mjs` and `gen-swamp-map.mjs` (sharing `lib/map-builders.mjs`),
NOT hand-authored in Tiled. They use the 6-tileset fixed-firstgid GID contract from
`client/scripts/lib/forest-gid-map.mjs`:

| Tileset (texture key) | firstgid | Contents |
|---|---|---|
| `autotile_grass_16` | 1 | Grass variants 0–47 (ground base; forest background) |
| `autotile_dirt_16` | 49 | Dirt/road variants (paths / swamp walkways) |
| `autotile_water_16` | 97 | Water variants — all 48 collide (forest ponds; swamp background) |
| `autotile_cliff_16` | 145 | Cliff variants — all 48 collide (perimeter + groves/outcrops) |
| `ModernEra_GreenForest_Tileset` | 193 | Tree trunks (behind), canopy (in-front), rocks |
| `berry_and_trees` | 313 | Bush / flower detail |

Layers follow the three-layer convention: `ground` (depth 0), `behind` (depth 2,
non-empty collision — trunks/outcrops block), `in-front` (depth 5, no collision —
canopy the player walks under), plus an `objects` group (spawn / anchorage /
waystone / biome_exit).

**Do NOT open generated maps in Tiled to edit them** — they are overwritten by
`npm run gen:forest-screens` / `npm run gen:swamp` (deterministic output). To change
a generated screen, edit the generator or the manifest (`shared/world/forest.ts`,
`shared/world/swamp.ts`) and regenerate. Only `forest_anchorage.json` is
hand-authored and safe to open in Tiled.
