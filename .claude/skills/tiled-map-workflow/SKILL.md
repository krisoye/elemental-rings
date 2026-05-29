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

- **Tile size:** 16 px (hand-authored hub screens) or 32 px (generated biome screens).
- Hub screens render at **2× world zoom** so 16 px reads as 32 px on screen.
- Each tileset image must be present in `client/public/assets/tiles/` (for generated screens) or `client/public/assets/tiles/regions/<biome>/` (for hand-authored art).
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
    npc/             ← Character sheet (charsetA_1.png etc.)
    interiors/       ← Sanctum interior tilesets
  maps/
    forest/          ← Master Tiled source maps
```

Repo paths (committed assets):
```
client/public/assets/
  tiles/
    forest16.png              ← Hub ground/collision tile
    regions/woods/            ← Hub tilesets copied from OneDrive
    npc/charsetA_1.png        ← Player + merchant sprites
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
