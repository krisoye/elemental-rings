## 10. World Regions & Region Manifests

This file covers world structure: the world progression overview, the overworld architecture, the short-range blink and field battle-hand mechanics, and the terrain/biome-scene approach. Per-region screen manifests live in their own files (see below). For overworld *mechanics* (biomes, detection, NPCs, Sanctum, waystones, anchorages, teleportation, merchants) see `gdd-10-overworld.md`.

> Implementation status — what's built, what's in progress — lives in GitHub Issues, not here. This section describes the intended world and how it is structured.

> **Region manifest files:** [`gdd-10-forest.md`](gdd-10-forest.md) · [`gdd-10-snow.md`](gdd-10-snow.md) · [`gdd-10-swamp.md`](gdd-10-swamp.md) · [`gdd-10-desert.md`](gdd-10-desert.md). This file holds shared architecture (§10.12–10.14, §10.16–10.17) and the world progression overview (§10.11).

---

### 10.11 World Progression Overview

The world consists of four biomes implemented across five region scenes. The Forest is the hub; all other biomes are reached from it or from one another via boss-gated transitions.

**World topology:**

```
                   ══════ SNOW MOUNTAINS ══════
                    SnowScene — Water · Wind
                    storm_shrine · dust_shrine · boss: Blizzard King
                             │ N (forest_snow_gate)
         ┌───────────────────┴──────────────────────────────┐
         │             FOREST (hub)                          ├──E──→ VOLCANO
         │   ForestScene — Wind · Earth · Wood               │     VolcanoScene
         │   thornado_shrine · bloom_shrine                  │     Fire · Wind
         │   boss: Thornwood Warden                          │     boss: Molten Sovereign
         └───────────────────┬──────────────────────────────┘
                             │ S (forest_swamp_gate)
                  ═══════ SWAMP ═══════
                  SwampScene — Water · Earth · Wood
                  mud_shrine · tidal_shrine
                  bosses: Mire Asp (S gate), Bogwood Striker (E gate)
                       │ S                    │ E
                       ↓                      ↓
         ══════════ DESERT / CANYON ═══════════════
         DesertScene — Fire · Earth
         wildfire_shrine · magma_shrine
                  ↕ ungated internal link
         ════════ VOLCANO ═══════════════════════
         VolcanoScene — Fire · Wind
         inferno_shrine · steam_shrine · boss: Molten Sovereign
```

**All 10 fusion shrines placed:**

| Biome | Shrines |
|---|---|
| Forest | Thornado (Wood+Wind), Bloom (Wood+Earth) |
| Snow | Storm (Water+Wind), Dust (Wind+Earth) |
| Swamp | Mud (Water+Earth), Tidal (Water+Wood) |
| Desert/Canyon | Wildfire (Fire+Wood), Magma (Fire+Earth) |
| Volcano | Inferno (Fire+Wind), Steam (Fire+Water) |

**Gate boss summary:**

| Boss | Screen | Elements | Opens |
|---|---|---|---|
| Frost Sentinel | `forest_snow_gate` | Wind | Snow biome |
| Bogwood Warden | `forest_swamp_gate` | Mud (Water+Earth) | Swamp biome |
| Cinder Sentinel | `forest_volcano_gate` | Fire+Wind | Volcano biome |
| Thornwood Warden | `forest_boss_clearing` | Wood+Wind (major) | Deep Forest |
| Blizzard King | `snow_blizzard_peak` | Water+Wind (major) | — |
| Mire Asp | `swamp_south_gate` | Earth+Water | Desert (south) |
| Bogwood Striker | `swamp_east_gate` | Wood+Water | Desert (east) |
| Molten Sovereign | `volcano_molten_throne` | Fire+Wind (major) | Summit stub |

**Shadow ring locations (one cave per biome):** `snow_frost_cavern` · `swamp_peat_hollow` · `desert_scorched_cave` · `forest_hidden_alcove` (teleport-only).

**World screen count:** Forest 29, Snow 9, Swamp 10, Desert 13, Volcano 9 = **70 screens total**.

**Progression summary:** Start in Forest with Wind/Earth rings. Swamp introduces Water/Wood triangle. Desert is the first Fire encounter. Defeating the Molten Sovereign is the current content endpoint.

---

### 10.12 Overworld Architecture

The world is rendered as **top-down tilemap scenes** with a walking protagonist (Arcade physics, WASD + arrows). There are two kinds of space:

**The Sanctum** is a walkable interior room — the protagonist's mobile home. Each fixture is a proximity-triggered interaction zone:

| Zone | Action |
|---|---|
| Ring-storage wall | Inventory, loadout, carry management, and Sanctum-side fusion |
| Meditation circle | Ring recharge; long-range teleportation to discovered Anchorages |
| Bed | Sleep — spend food, restore full spirit gauge |
| Campfire | Rest, and summon the Sanctum to a discovered Anchorage in the field |
| Exit door | Step into the overworld |

**Biomes** are multi-screen regions — graphs of discrete tilemap screens connected by walkable edges (walk off an edge → brief fade → spawn at the neighbor's opposite edge). The Forest is the hub region (`gdd-10-forest.md`); the Snow Mountains, Swamp, and Desert/Volcano adjoin it (§10.11).

**World model:** the overworld is per-player for now (a shared, area-scoped multiplayer world is a future direction). NPCs and monsters are placed per screen by danger tier; a detection radius reveals an opponent's element, and approaching launches a duel through the authoritative battle room. Defeats persist server-side — boss and guardian defeats permanently, roamers respawn on the game-day tick. Biome-to-biome passage is held by **boss gates**: a boss NPC physically blocks the exit until defeated.

---

### 10.13 Short-range Blink

The protagonist can **teleport short distances** in any spatial scene (overworld biomes and the Sanctum interior) by double-clicking an interaction zone.

**Mechanics:**
- Double-click an interaction zone within `BLINK_MAX_RANGE` (600 px) → the protagonist blinks onto it and activates it simultaneously (replaces walk + E as a single gesture)
- Costs spirit proportional to distance (§12.7)
- Only targets discrete interaction zones — never arbitrary terrain points
- Suppressed while a modal overlay is open

**Uses:**
- Teleport directly into the Sanctum door rather than walking to it
- Navigate quickly between ring-storage wall, meditation circle, bed, and campfire inside the sprawling Sanctum interior
- Blink to a waystone to attune it without approaching on foot
- Blink to an enemy to ambush (§10.3, §12.8) — enters the duel with first-attack initiative if spirit permits

**Relationship to long-range teleportation (§10.8):** Short-range blink and Sanctum teleportation are distinct systems. Blink is point-to-point spatial movement within a scene; Sanctum teleportation folds space across biomes from the meditation circle. Both draw on `spirit_current`.

---

### 10.14 Overworld Battle-Hand Management

The protagonist can review and reassign their battle hand (Thumb/A1/A2/D1/D2 slots) without returning to the Sanctum. This is a quality-of-life access to the existing battle-hand screen, available from any biome scene.

**Key binding:** `Tab` toggles the overlay open/closed; `Esc` also closes it. While the overlay is open, player movement is suppressed and blink (§10.13) is disabled.

**Available actions:** Same as the in-Sanctum battle-hand screen — reassign carried rings to battle slots, recharge individual rings or all rings (consuming `spirit_current`). Sleep is NOT available in the field (§12.4).

**GDD rule reference:** §6.8 ("After any battle, the player can freely reorganize their battle hand among their carried rings before the next encounter") and §12.3 ("Recharging a ring — anywhere"). Both explicitly allow field access; the Tab binding makes this convenient without requiring a Sanctum return.

---

> Forest region screens have moved to [`gdd-10-forest.md`](gdd-10-forest.md).

---

### 10.16 Terrain & Asset Approach

Biome maps use **16 px tiles on a three-layer convention** (`ground` / `behind` / `in-front`, §10.1) rendered at 2× zoom. Terrain is **autotiled** — grass, dirt roads, water, and cliffs each resolve from a 48-variant autotile set, so generated screens read as continuous terrain rather than flat color. Trees, rocks, bushes, and structures are placed as a separate decoration sprite layer on top.

Generated screens are **deterministic and drift-tested**: re-running a generator is a no-op diff, and integrity tests verify map format, collision, and that every screen is BFS-traversable. The hub (`forest_anchorage`) is hand-authored in Tiled rather than generated, because its multi-tileset village layout is richer than the generator targets.

Art is sourced from pixel-art packs at generation time and committed as portable tileset PNGs; the source-art paths are host-bound and not part of the repo. Swapping art means regenerating tilesets — the GID contract and collision rules stay fixed, so maps and code are unaffected.

---

### 10.17 Biome-Scene Architecture

The whole Forest region — all 29 screens — is a **single scene class** parameterized by screen id, not 29 separate scenes. Biomes share one abstract base; each biome subclass supplies only what differs.

```
BaseBiomeScene (abstract)
│   Core mechanics — written once:
│     tilemap load, Player, physics, camera, compass HUD,
│     waystone attunement, NPC detection + duel launch,
│     campfire (rest + Sanctum summon), blink (§10.13),
│     biome-exit boss gates, edge-transition system
│   Abstract contract:
│     tilesetKey(): string
│     mapKeyForScreen(screenId): string
│   Optional overrides:
│     biomeVisuals()   ← fog, snow, tint
│     onEnterScreen()  ← per-screen decoration placement

ForestScene extends BaseBiomeScene
│   manifest: FOREST_SCREENS (shared/world/forest.ts)
│   init({ screenId, spawnEdge })

SwampScene extends BaseBiomeScene
│   manifest: SWAMP_SCREENS (shared/world/swamp.ts)
│   biomeVisuals() → fog overlay, reduced detection radius

SnowScene extends BaseBiomeScene
│   manifest: SNOW_SCREENS (shared/world/snow.ts)
│   biomeVisuals() → snow particles, pale-blue tint

DesertScene extends BaseBiomeScene
│   manifest: DESERT_SCREENS (shared/world/desert.ts)
│   biomeVisuals() → heat shimmer, bleached palette

VolcanoScene extends BaseBiomeScene
│   manifest: VOLCANO_SCREENS (shared/world/volcano.ts)
│   biomeVisuals() → ash particles, lava-glow ambient, heat shimmer
```

**The manifest is the source of truth.** Each biome's screens live in a typed manifest (`shared/world/<biome>.ts`) — imported by the map generator, the drift test, and the server's NPC placement alike, so a screen's exits, anchorages, and danger tier cannot disagree across systems. The per-region manifest files (`gdd-10-forest.md`, `gdd-10-snow.md`, `gdd-10-swamp.md`, `gdd-10-desert.md`) are the human-readable mirrors of those manifests.

**Edge transitions:** walking off a map edge that has an `exits` entry fades briefly and restarts the same scene class with the neighbor's `screenId`, spawning the player at the opposite edge. `biome_exit` edges instead cross to another biome scene once that biome's boss gate is cleared.

**NPC placement** is server-side and screen-aware: each NPC carries the `screen` it belongs to, so defeat-tracking and placement share one source of truth.
