## 10. Overworld

### 10.1 Visual Style
- Top-down isometric perspective
- Reference: *The Legend of Zelda: A Link to the Past*
- Renderer: Phaser.js canvas with tilemap support

### 10.2 Biomes
Each biome has NPCs and monsters that lean toward specific element distributions, requiring players to prepare appropriate counter-rings before entering.

| Biome | Dominant Elements | Key Weaknesses to Bring | Notable Content |
|---|---|---|---|
| Forest | Wood, Wind, Nature/Bloom | Fire, Ice | Early-game, teaches base element triangle |
| Snow Fields | Ice, Water, Wind | Fire, Metal, Earth | Frost shrine; Ice-type fusion recipes |
| Swamps | Mud, Water, Wood, Earth | Fire, Wind, Lightning | Mud shrine; reduced enemy visibility range |
| Desert | Fire, Earth, Lava | Water, Mud, Wind | Lava shrine; Magma-type recipes |
| Underground/Caves | Shadow (drops), mixed | Unpredictable by design | Shadow ring drops; no biome weakness pattern |
| Volcanic Region | Magma, Lava, Lightning | Water, Mud, Earth | Late-game only; extreme difficulty |

Environmental passives (e.g. Fire rings losing uses faster in snow) are flagged for a **future design pass** and are not implemented in the initial build.

### 10.3 Detection and Approach
- When the player gets within a certain distance of an enemy both parties begin to see each other's information
- **Visible from detection range:** element types in loadout, hearts, aggregate uses per element type, Thumb ring element (reveals passive)
- As both parties continue to approach they can **formally agree to duel**
- The player can always turn back and flee before formally agreeing — no penalty
- Once formally agreed the duel begins and the battle hand management screen appears

### 10.4 NPC Categories

| Category | Behavior | Stakes | Notes |
|---|---|---|---|
| Quest Givers | Send player on missions; not duelable mid-quest | N/A | Primary narrative drivers |
| Duelist NPCs | Actively seek duels; approach player | Pre-set stake ring | Wandering merchants, arena challengers, collectors |
| Passive Villagers | Can be challenged; do not initiate | Low-value rings | Good for early grinding; diminishing returns for veterans |
| Monsters | Always initiate; player can flee | Drop ring on loss; steal ring on win | Respawn on day cycle; named monsters do not |
| Boss NPCs | Fixed locations; high XP; unique rings | Rare/unique rings | Primary unlock mechanism for rare fusions and world areas |

### 10.5 NPC Personality Types

NPCs feel like distinct opponents through both combat AI behavior and their loadout archetype. Each personality has multiple randomized variants — the same personality can stake different elements across encounters, but the combat style remains consistent.

#### Behavior Summary

| Personality | Combat Style | No-Block Rate | Think Speed | Low-HP Shift |
|---|---|---|---|---|
| **Aggressive** | Targets elements the opponent can't counter; chases PARRY+STRONG for rallies | 0% | Fast (300–600 ms) | None |
| **Defensive** | Burns fewest-use ring first; takes safe BLOCK timing; sometimes deliberately no-blocks | 30% | Slow (900–1500 ms) | None |
| **Status-Hunter** | Commits to one triangle element and repeats it to build the gauge | 10% | Deliberate (900–1100 ms) | None |
| **Resilient** | Grinds most-use ring healthy; switches to Aggressive logic when cornered | 40% healthy / 0% low-HP | Medium→Fast | Timing σ tightens 150→60 ms; attack adapts |

#### Loadout Archetypes

Each personality draws from a set of archetype templates. The variant is chosen randomly at duel start using the room seed.

**Aggressive** (2 variants)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive |
|---|---|---|---|---|---|---|
| Fire-Aggressor | 🔴 Fire | Fire | Wind | Earth | Water | Kindling: A1 starts at +1 use |
| Wind-Aggressor | 🟢 Wind | Wind | Fire | Earth | Wood | Tailwind: attack rings self-refund |

**Defensive** (2 variants)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive |
|---|---|---|---|---|---|---|
| Earth-Defender | 🟤 Earth | Water | Wind | Earth | Earth | Bulwark: both Earth defense rings start at +1 use |
| Wood-Defender | 💚 Wood | Water | Wind | Wood | Earth | Deep Roots: heart-loss redirected to Thumb |

**Status-Hunter** (3 variants)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive | Target Gauge |
|---|---|---|---|---|---|---|---|
| Fire-Hunter | 🔴 Fire | Fire | Fire | Wood | Earth | Kindling: A1 starts at +1 use | Fire → Burning |
| Water-Hunter | 🔵 Water | Water | Water | Fire | Earth | Wellspring: defense uses refund | Water → Drowning |
| Wood-Hunter | 💚 Wood | Wood | Wood | Water | Earth | Deep Roots: heart guard | Wood → Entangled |

**Resilient** (5 variants — one per base element as the stake)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive |
|---|---|---|---|---|---|---|
| Fire-Resilient | 🔴 Fire | Wind | Water | Earth | Wood | Kindling |
| Water-Resilient | 🔵 Water | Wind | Fire | Earth | Wood | Wellspring |
| Earth-Resilient | 🟤 Earth | Wind | Water | Earth | Wood | Bulwark |
| Wind-Resilient | 🟢 Wind | Fire | Water | Earth | Wood | Tailwind |
| Wood-Resilient | 💚 Wood | Wind | Fire | Earth | Water | Deep Roots |

---

### 10.6 The Sanctum

The protagonist does not travel with a caravan or horse. They travel with their **Sanctum** — a magical dwelling spiritually bonded to them. The Sanctum is not physically carried; it is transported by folding space through the protagonist's spiritual energy. It is the foundation of all camp activity and the focal point for teleportation.

**Physical description:**
- A small structure — the size of a modest dwelling — that appears wherever the protagonist anchors it
- **Exterior:** a fire pit at the front for cooking and social gathering; the visible face of the sanctum to the world
- **Entry vestibule:** food storage, equipment, day-to-day supplies
- **Central chamber:** the meditation circle — a permanent inlaid pattern on the floor that focuses spiritual energy; this is where all teleportation is initiated and where rings are recharged through focused meditation
- **Sleeping area:** rest and restoration
- **Ring storage:** inventory displayed along the walls — rings that are not in the carry loadout are stored here, their XP still accumulating passively through the sanctum's ambient energy

**The Sanctum as spiritual extension:**
The Sanctum is not an inert container. It is spiritually bonded to the protagonist's ring collection — the aggregate XP of all stored rings contributes to the protagonist's spirit gauge maximum even when those rings are not carried. The protagonist and their Sanctum are one entity: the Sanctum is where their power lives when they are not channeling it.

**Anchoring the Sanctum:**
- When the protagonist teleports to a new location, the Sanctum materializes nearby
- Anchoring it establishes the camp for that area
- When multiple players anchor their Sanctums near a waystone, a temporary community forms — the campfires create a gathering space, and a small settlement emerges naturally
- This is what the game calls a **safe area**: not a fixed world structure, but a living cluster of sanctums

---

### 10.7 Waystones and the Compass

**Waystones** are ancient permanent objects scattered across the overworld — statues, monuments, standing stones, carved rocks. They are not items; they cannot be moved or taken. They are the spiritual anchors of the world.

**Attuning to a waystone:**
- The protagonist must physically touch a waystone
- Touching it creates an instant spiritual connection — the location is permanently added to the world map as a known teleportation destination
- The protagonist learns nothing about the surrounding area from the attunement alone — the area around the waystone is unknown until explored on foot after teleporting there
- Attunement is free and instant; no cost

**The Compass:**
- The protagonist has a preternatural spiritual sense that pulls them toward undiscovered waystones nearby
- Short range — only felt when within a meaningful distance of an undiscovered waystone
- Strengthens as the protagonist approaches (directional pull, increasing intensity)
- Waystones are often guarded by mini-bosses or major bosses — the compass leads toward challenge
- This is the primary navigation mechanism for exploration: no map markers, just a pull

**Waystone density:**
- Each biome contains multiple waystones — some accessible early, some guarded by powerful enemies
- The boss of a biome always guards or is located near a critical waystone that unlocks the path to a major city
- TBD: exact waystone count per biome (tuning)

---

### 10.8 Teleportation

Movement between areas is a **spiritual act**, not physical travel. The protagonist folds space through the meditation circle in their Sanctum, bringing themselves and their entire Sanctum — including all stored rings, food, and gold — to an attuned waystone.

**Requirements:**
1. **Must be in the Sanctum** — specifically at the meditation circle
2. **Must have attuned** to the destination waystone
3. **Must have sufficient spiritual level** — aggregate ring XP must meet or exceed the threshold for that destination. If too low, the destination is visible on the map but unavailable, with the required spiritual level shown

**What teleports:**
- The protagonist
- The entire Sanctum (structure, contents, stored rings)
- Carry loadout (the 10 rings on their person)
- All food and gold

**Failure state:**
- If spiritual level is insufficient, the teleportation cannot be initiated — there is no partial or dangerous attempt
- The player must raise their aggregate ring XP (by using rings in battle) to unlock a higher-threshold destination

**Distance and spiritual level:**
- Nearby waystone (same or adjacent biome): low threshold — accessible early game
- Distant waystone (far biome, different region): high threshold — requires veteran ring collection
- Late game: a powerful protagonist can teleport almost anywhere in the world from a single meditation session

**The biome loop:**
1. Meditate in Sanctum → teleport to a newly attuned waystone
2. Anchor Sanctum; other players may already be anchored here (safe area community)
3. Follow the compass → range on foot → find treasure, fight NPCs, locate shrines
4. Touch undiscovered waystones to add destinations to the map
5. Boss of the biome guards a critical waystone (or the path to the city) — required for chapter progression; drops significant food cache and rare items
6. As ring XP accumulates through combat, new higher-threshold destinations unlock
7. When ready: return to Sanctum, meditate, choose next destination

---

### 10.9 Key Locations

| Location | Purpose |
|---|---|
| **Sanctum** | The protagonist's traveling home — sleep, cook, meditate, manage inventory, teleport |
| **Safe Areas** | Naturally formed clusters of sanctums near waystones; campfire gatherings; PvP between anchored players |
| **Cities / Settlements** | Persistent world locations with merchants, services, social NPCs; chapter task endpoints |
| **Waystones** | Ancient permanent objects; touch to attune and add to teleportation map |
| **Shrines** | One per fusion recipe; discovered via shrine maps and compass |
| **Dark/Underground Areas** | Shadow ring drop locations; high risk, unpredictable opposition |
| **Boss Arenas** | Fixed high-XP encounters; unique rings; often guard critical waystones |

---

### 10.10 Food and Foraging

Food sustains the protagonist's ability to meditate and restore their spirit.

**Food units** (one type currently; future segments: fruits, vegetables, grains, meats)

| Use | Cost |
|---|---|
| Sleep in Sanctum (full spirit restore) | 25 food units |

> **Horse travel removed (v4.4):** Movement between areas is now spiritual teleportation, not physical travel. Horse food costs no longer exist.

**Foraging:**
- Gathered during overworld exploration (bushes, fields, hunting, mushroom patches, abandoned caches)
- Stored in the Sanctum — no carry weight limit on food
- The primary non-combat reason to range out from the Sanctum

**Merchant food:**
- Buy at **2× forage value** (emergency option when supplies are low)
- Sell at base forage value
- Creates a gold sink when expeditions run short

**Boss food drop:**
- Every biome boss drops a significant food cache on defeat
- Intended to remove food pressure at chapter transitions and reward completing the biome

**Starvation:**
- No food + no gold → cannot sleep → spirit stays depleted → rings cannot be recharged in bulk
- Player can still duel on remaining spirit and ring uses — desperation play is valid
- Eventually forces retreat toward a food source or merchant

---

### 10.11 Merchants

Merchants are encountered in cities and occasionally wandering the overworld between biomes. They may anchor their own modest sanctums near safe areas temporarily.

**Wares:**

| Category | Examples | Currency |
|---|---|---|
| Rings | Tier 1 base rings, rare element variants | Gold |
| Sanctum upgrades | Expanded ring storage, meditation circle enhancements | Gold + rare materials |
| Garments | Equipment that expands spiritual carry capacity | Gold + rare materials |
| Fusion stones | Catalysts for ring fusion recipes | Gold + ring sacrifice |
| Shrine maps | Reveal shrine locations on the world map | Gold |
| Food | Emergency provisions at 2× forage value | Gold |

**Carry cap (garments):**
- Players start with `carry_cap = 10` (spiritually derived from base spirit gauge)
- Garments from merchants can expand it beyond the spirit-derived default
- Maximum carry cap TBD

**Wandering merchants:**
- A subset patrol fixed routes between biomes; they may anchor near safe areas briefly
- Encounter windows are limited — if the player doesn't trade during a visit they must wait for the next cycle
- Creates strategic decisions: return to trade now or continue the expedition?

---

### 10.12 Phase 8 Build Decomposition

Phase 8 is the largest phase in the roadmap — it introduces a full tilemap world, spatial movement, and all overworld systems. It is broken into three EPICs that ship sequentially.

#### EPIC 8A — Spatial Engine + Sanctum Scene (EPIC [#54](https://github.com/krisoye/elemental-rings/issues/54))

**What ships:** The Phaser tilemap engine and the Sanctum as a walkable room. Client-only — no Colyseus or server route changes. Every camp action (carry, loadout, sleep, recharge, fusion) already round-trips to authoritative REST endpoints; 8A only adds the spatial presentation layer.

**Sanctum room zones** (walk to zone + press E to activate):

| Zone | Action |
|---|---|
| Ring-storage wall | Inventory, loadout, carry management, and fusion (until shrines arrive in 8C) |
| Meditation circle | Ring recharge. Teleportation UI stub (enabled in 8B). |
| Bed | Sleep — spend 25 food, restore full spirit gauge |
| Campfire (exterior) | Placeholder — food display; cook/eat mechanic is a future phase |
| Exit door | Transition to OverworldScene (stub in 8A.3; real biome in 8B) |

**Sub-issues (implement in order):**
- [#55](https://github.com/krisoye/elemental-rings/issues/55) — 8A.1: Spatial movement engine + Sanctum room shell (tilemap, Player, collision, camera)
- [#56](https://github.com/krisoye/elemental-rings/issues/56) — 8A.2: Sanctum interaction zones (reintegrate CampScene panels as proximity overlays)
- [#57](https://github.com/krisoye/elemental-rings/issues/57) — 8A.3: Overworld stub + scene transition (seam to 8B)

**Confirmed implementation decisions (8A):**

| Decision | Choice | Rationale |
|---|---|---|
| Tile assets | Kenney CC0 placeholder tilesheet (32px tiles, committed PNG + generator script); Tiled-format JSON maps | Swappable: replace PNG + reindex in Tiled. No Tiled GUI or MCP needed for 8A. |
| Multiplayer overworld | Per-player (local) for 8A MVP | Per-player adds zero server complexity. Area-scoped Colyseus `WorldRoom` designed in once biome authoring begins. |
| Scene key | Keep `'CampScene'` (transform in place) | Preserves 4 existing `scene.start('CampScene')` callers and all `window.__camp*` E2E hooks — zero test churn. |
| EncounterScene | Survives as a dev/test shortcut ("Set Out →" button) | The overworld is its eventual spatial replacement, but it remains invaluable for isolated battle testing. |
| Fusion entry point | Sanctum ring-wall zone until 8C | Shrines are a physical overworld object that requires biome content. The existing `/api/fusion/combine` route is unchanged. |
| Player movement | Top-down Arcade Physics, zero gravity, WASD + arrows, 160 px/s | Standard Phaser top-down pattern; no physics complexity needed for a walking protagonist. |

---

#### EPIC 8B — Overworld World (planned, no EPIC issue yet)

**What ships:** The real overworld map (≥1 biome using Kenney tiles, authored in Tiled), waystones, compass, and teleportation.

- Biome map: Tiled-authored orthogonal map, Kenney CC0 tileset replacing the placeholder
- 3–5 waystones in the biome: touch to attune → added to teleportation map
- Compass HUD: directional pull toward nearest unattuned waystone
- Teleportation: meditation circle → map screen → spiritual-level-gated destination selection
- Sanctum anchors near the teleport arrival point

---

#### EPIC 8C — World Population (planned, no EPIC issue yet)

**What ships:** NPCs and monsters in the biome, detection radius, duel initiation from overworld, shrines.

- NPC/monster placement using the existing 4-personality AI (Aggressive/Defensive/Status-Hunter/Resilient)
- Detection radius: proximity reveals opponent's element loadout; approach/flee before committing
- Duel trigger: spatial proximity → agreement → BattleRoom (replaces EncounterScene for live play)
- Shrines: one per fusion recipe; fusion UI entry point moves from Sanctum ring-wall to shrine interaction
- Underground zone: Shadow ring drop location (Shadow combat use deferred to a later phase)

---
