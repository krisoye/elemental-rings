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
- **Approach options (8D, #87):** walk into detection range and press **E** to approach normally, OR **double-click the enemy** to **ambush** — spending a flat `AMBUSH_SPIRIT_COST` (5) spirit to blink into the duel and seize the **opening attack** (first-strike initiative). Ambush is server-guarded: if the player cannot afford the cost the flag is ignored and the duel proceeds with default initiative. See §10.9 (Key Locations) and §12 (Spirit System).
- **Blink (8D, #87):** double-clicking a discrete interaction zone (Anchorage / waystone / Sanctum door) within `BLINK_MAX_RANGE` blinks the protagonist onto it — spending spirit proportional to distance — and fires the zone's interaction in the same gesture. This replaces walk-then-E for in-range points of interest. See §12.

**Blink approach (ambush):** Instead of walking in and pressing E, the protagonist can **double-click an enemy within blink range** (`BLINK_MAX_RANGE` = 600 px) to blink directly into the duel. This spends spirit (see §12.7 for blink cost + §12.8 for ambush premium) and grants **first-attack initiative** — the protagonist attacks before the monster or NPC does. If the protagonist cannot afford the ambush premium at the moment of blinking, the duel starts with default (opponent-first) initiative; the blink still moves the player and the blink cost is still spent. Fleeing is still possible by walking away while only in detection range, before the duel is formally initiated.

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
- When the protagonist teleports to an Anchorage, the Sanctum materializes within it
- Anchoring it establishes the camp for that area
- When multiple players anchor their Sanctums at the same Anchorage, a temporary community forms — the campfires create a gathering space, and a small mystic settlement emerges naturally
- This is an **Anchorage community**: not a fixed city, but a living cluster of sanctums that comes and goes with its inhabitants

---

### 10.7 Waystones and the Compass

**Waystones** are ancient permanent objects scattered across the overworld — statues, monuments, standing stones, carved rocks. They are not items; they cannot be moved or taken.

Waystones are **revelation objects**, not teleportation destinations. Each waystone carries spiritual memory of its *place of origin* — the region it came from before it was moved to its present location. When the protagonist attunes to a waystone, they receive this knowledge: a revelation of a distant area or biome that becomes accessible to them. Waystones are the mechanism for **long-distance progression** — finding and attuning them opens the path forward into new regions of the world.

**Attuning to a waystone:**
- The protagonist must physically touch the waystone and press E
- Touching it creates an instant spiritual connection — the waystone's origin region is revealed
- This may immediately unlock one or more distant Anchorages as potential teleportation destinations (see §10.7a)
- Attunement is permanent, free, and instant; no spirit cost
- The protagonist learns nothing about the *current* surrounding area — the waystone reveals what is *far away*, not what is nearby

**The Compass:**
- The protagonist has a preternatural spiritual sense that pulls them toward undiscovered waystones nearby
- Short to medium range — only felt when within a meaningful distance of an unattuned waystone
- Strengthens as the protagonist approaches (directional pull, increasing intensity)
- Waystones are often guarded by mini-bosses or major bosses — the compass leads toward challenge
- This is the primary navigation mechanism for exploration within a biome: no map markers, just a pull

**Waystone density:**
- Each biome contains multiple waystones — some accessible early, some guarded by powerful enemies
- The boss of a biome always guards or is located near a critical waystone that unlocks the path to a major city or the next region
- TBD: exact waystone count per biome (tuning)

---

### 10.7a Anchorages

**Anchorages** are fixed areas of concentrated spiritual energy scattered across the world. They are distinct from waystones: where a waystone is a marker that reveals distant places, an Anchorage is a *destination* — a place where the Sanctum can rest.

**Discovery:**
- The protagonist discovers an Anchorage by **physically walking into it**
- Discovery is automatic — no action required. The protagonist immediately and permanently attunes to the Anchorage the moment they enter it
- Anchorages are visible as areas: a distinct ground treatment, a gathering-fire, or other environmental cue marks them as special. They read as *inviting*

**What an Anchorage is:**
- A spiritually concentrated location where the fabric of the world is favorable to Sanctum anchoring
- Fixed in the world — they always exist in the same place; they are not created by players
- Multiple Sanctums can anchor at the same Anchorage simultaneously, forming an Anchorage community (see §10.6)
- Can be in the middle of wilderness, on the outskirts of a village, or adjacent to a city — wherever the spiritual geography places them
- Wandering merchants may temporarily anchor their modest Sanctums at well-traveled Anchorages

**Relationship with waystones:**
- Waystones and Anchorages are neighbors in the world but conceptually separate
- A waystone might be near an Anchorage, or it might be alone in dangerous territory
- Attuning a waystone may *reveal* Anchorages in distant areas (as part of the region knowledge it grants), adding them to the meditation circle's destination list before the protagonist has physically walked to them — but the protagonist cannot *teleport* to an Anchorage they have not yet discovered (either by walking there or via waystone revelation; TBD: exact unlock rule)

**Anchorage density:**
- Each biome contains multiple Anchorages — some in the open, some requiring navigation past obstacles or enemies
- TBD: exact count per biome; Forest biome MVP has a small number of Anchorages

---

### 10.8 Teleportation

Movement between Anchorages is a **spiritual act**, not physical travel. The protagonist folds space through the meditation circle in their Sanctum, bringing themselves and their entire Sanctum — including all stored rings, food, and gold — to a discovered Anchorage.

**Requirements:**
1. **Must be in the Sanctum** — specifically at the meditation circle
2. **Must have discovered** the destination Anchorage (walked there or had it revealed by a waystone)
3. **Must have sufficient current spirit level** — `spirit_current` must meet or exceed the spirit cost for that destination. If spirit is low, the destination is visible but locked; resting (sleeping in the Sanctum) fully restores spirit and enables longer journeys

**Spirit cost and distance:**
- Spirit cost scales with the spiritual distance to the Anchorage — nearby Anchorages in the current biome cost little; distant Anchorages in far biomes cost significantly more
- `spirit_current` is fully restored by sleeping (costs 25 food). A well-provisioned protagonist can always make any journey; a depleted one must rest first
- `spirit_max` grows with aggregate ring XP — veteran protagonists have a larger total spirit reserve, making long trips easier to sustain without multiple rest cycles. But a high `spirit_max` does not help if `spirit_current` is depleted; preparation matters
- Late game: a powerful protagonist with full spirit can teleport across the world in a single meditation session; early game, long journeys may require a food stop to rest midway

**What teleports:**
- The protagonist
- The entire Sanctum (structure, contents, stored rings)
- Carry loadout
- All food and gold

**Failure state:**
- If `spirit_current` is insufficient, teleportation cannot be initiated — there is no partial attempt
- The protagonist must sleep to restore spirit (requiring food), then meditate again

**The exploration loop:**
1. Exit Sanctum → explore the current biome on foot
2. Follow the compass → attune waystones → learn about distant regions
3. Discover Anchorages by walking into them (auto-attune)
4. Return to Sanctum (walk back or walk to the nearest discovered Anchorage and enter)
5. Meditate → view discovered Anchorages and their spirit costs
6. Sleep if needed to restore spirit to maximum
7. Teleport to chosen Anchorage → exit Sanctum in the new location
8. Repeat — the new Anchorage is now the base; range outward from it

---

### 10.9 Key Locations

| Location | Purpose |
|---|---|
| **Sanctum** | The protagonist's traveling home — sleep, cook, meditate, manage inventory, teleport |
| **Anchorages** | Fixed spiritual energy concentrations; auto-attune on discovery; Sanctums anchor here; multiple Sanctums form an Anchorage community; PvP between anchored players |
| **Cities / Settlements** | Persistent world locations with merchants, services, social NPCs; chapter task endpoints |
| **Waystones** | Ancient permanent objects scattered across biomes; press E to attune; reveals the waystone's origin region and unlocks progression into distant areas |
| **Shrines** | One per fusion recipe; discovered via shrine maps and compass |
| **Dark/Underground Areas** | Shadow ring drop locations; high risk, unpredictable opposition |
| **Boss Arenas** | Fixed high-XP encounters; unique rings; often guard critical waystones |

> **Overworld battle-hand access (8D, #87):** press **Tab** anywhere in the overworld to open the **Manage Battle-Hand** overlay (reassign loadout slots, recharge rings with spirit, resolve a pending won ring) without returning to the Sanctum; **Escape** closes it. While open the protagonist is frozen and blink is suppressed. This is the same battle-hand management surface used at duel agreement (cf. §6.8 battle-hand management); it is implemented as the standalone `BattleHandOverlay` shared by the EncounterScene and the overworld.

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

Merchants are encountered in cities and occasionally wandering the overworld between biomes. They may anchor their own modest sanctums at well-traveled Anchorages temporarily.

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
- A subset patrol fixed routes between biomes; they may anchor at well-traveled Anchorages briefly
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

#### EPIC 8B — Overworld World (EPIC [#60](https://github.com/krisoye/elemental-rings/issues/60))

**What ships:** The 8A overworld *stub* becomes a real **Forest biome** — a generated Tiled map with 3 waystone markers (touch to attune, **server-persisted**), a compass HUD that pulls toward the nearest *unattuned* waystone, and teleportation from the Sanctum's meditation circle. Unlike 8A (client-only), **8B adds server state and routes** — attunement, the Sanctum anchor, and the teleport gate are game rules and are server-enforced (§2).

> **Design note (v4.9 — 8B.4 shipped):** The 8B.4 EPIC (#70, PRs #77/#79 + the overworld-fixes follow-up) closed the visual foundation and a large part of the Waystone/Anchorage distinction. As shipped now: the three Forest locations render as **Anchorages** (campfire + ground ring, no standing stone) and **auto-attune on walk-in** (§10.7a); the Sanctum exterior sits **directly at the Anchorage center** (`SANCTUM_OFFSET = 0`) and materializes there; and two **first-class discovery waystones** now exist (standing stones, press-E attune) that reveal adjacent biomes. As of **8D (#87)** the §10.8 teleport gate is the **`spirit_current >= spiritCost`** rule (spending spirit on travel — see §10.8), completing the preparation loop. The data model still keeps Anchorages and waystones in one catalog (`shared/waystones.ts`), distinguished by the map object `name` — a full table-level separation remains a future pass.

**Sub-issues shipped (8B.1–8B.3):**
- [#61](https://github.com/krisoye/elemental-rings/issues/61) — 8B.1: Forest biome map + waystone attunement (`shared/waystones.ts` catalog, map generator, `waystone_attunements` table, `GET /api/waystones` + `POST /api/waystones/attune`, overworld markers)
- [#62](https://github.com/krisoye/elemental-rings/issues/62) — 8B.2: Compass HUD (directional pull to nearest unattuned waystone; client-only)
- [#63](https://github.com/krisoye/elemental-rings/issues/63) — 8B.3: Teleportation + Sanctum anchoring (`players.anchored_waystone`, `POST /api/teleport`, meditation-circle modal list, anchor-derived overworld spawn)

**8B.4 EPIC — Visual foundation + design correction (#70):**
- [#71](https://github.com/krisoye/elemental-rings/issues/71) — 8B.4.1: Sanctum exterior + anchor co-location (hotfix — Sanctum has no visible exterior; `sanctum_return` zone doesn't move with anchor)
- [#72](https://github.com/krisoye/elemental-rings/issues/72) — closed (waystone visual already functional; waystones render as standing stones with glow + label)
- [#73](https://github.com/krisoye/elemental-rings/issues/73) — 8B.4.3: Safe area ground treatment around waystones (campfire, worn ground)
- [#74](https://github.com/krisoye/elemental-rings/issues/74) — 8B.4.4: Forest map terrain overhaul (trees, paths, clearings)

**Forest locations (as shipped — Anchorages and discovery waystones are now visually + behaviorally distinct):**

| id | Name | Type | Gate | Notes |
|---|---|---|---|---|
| `forest_entry` | Forest Waystone | Anchorage | 0 (free) | Default Anchorage; pre-attuned at creation. Renders campfire + ground ring; auto-attunes on walk-in. |
| `forest_glade` | Glade Waystone | Anchorage | 100 aggregate XP | Mid-biome Anchorage. Auto-attune; teleport destination. |
| `forest_depths` | Deepwood Waystone | Anchorage | 300 aggregate XP | Deep-biome Anchorage. Auto-attune; teleport destination. |
| `forest_north_stone` | Frost-Worn Stone | Waystone | 150 aggregate XP | Discovery marker (standing stone, press-E). Reveals the **Snow Fields** (future biome). |
| `forest_sw_stone` | Bogwood Sentinel | Waystone | 250 aggregate XP | Discovery marker. Reveals the **Swamp** biome — gates the Forest→Swamp transition (8C.2). |

**Known limitations (remaining after 8B.4):**
- Anchorages and waystones still share one catalog (`shared/waystones.ts`); they are distinguished by the map object `name` and rendered differently, but a table-level separation (a dedicated `anchorages` table) is still future.
- The server cannot verify the player physically stood on an Anchorage before auto-attuning (per-player overworld MVP). A future shared `WorldRoom` would verify proximity authoritatively.

> **Implemented in 8D (#87):** The §10.8 teleport gate now spends **`spiritCost`** (per-destination, in `shared/waystones.ts`) and rejects when `spirit_current < spiritCost`, completing the sleep → restore spirit → teleport preparation loop. Short-range **blink** (§12, below) and **ambush first-strike** (§10.3/§10.9) add the first non-recharge spirit sinks.

---

#### EPIC 8C — World Population, Sanctum Stone & Swamp Biome (EPIC [#80](https://github.com/krisoye/elemental-rings/issues/80))

**What ships:** A field tool for managing the Sanctum (Sanctum Stone talisman), a second navigable biome (Swamp) with a hidden-progression secret, and the first living inhabitants (NPCs + detection). Decomposed into three sub-issues that can largely proceed in parallel.

**Sub-issues:**
- [#81](https://github.com/krisoye/elemental-rings/issues/81) — 8C.1: Talisman equipment system + Sanctum Stone (necklace slot, `talisman_loadout` table, charge economy, field-anchor from any Anchorage)
- [#82](https://github.com/krisoye/elemental-rings/issues/82) — 8C.2: Swamp biome + hidden Forest alcove (new map + tileset, `SwampScene`, gated Forest→Swamp transition, the Ironbark Rune revealing an unreachable Forest Anchorage)
- [#83](https://github.com/krisoye/elemental-rings/issues/83) — 8C.3: NPC & monster world population + detection (per-biome spawn table, detection radius, duels via the existing `battle-ai` room, server-side defeat tracking)

**Sanctum Stone (GDD §14.3):** A necklace talisman with 3 charges. Activated at any discovered Anchorage in the field, it **permanently transports** the Sanctum to that Anchorage (the Sanctum physically moves and stays there until summoned elsewhere or the player teleports from within the meditation circle). Charges refill on sleep. This is the inverse of the meditation-circle teleport: it lets the player relocate home from the field rather than from inside the Sanctum.

**Swamp biome:** Dominant elements Mud/Water/Wood/Earth (§10.2). Reached from the Forest's southwest edge once the `forest_sw_stone` (Bogwood Sentinel) waystone is attuned. Contains the `swamp_secret_forest` (Ironbark Rune) waystone, whose revelation unlocks `forest_hidden_anchor` — an Anchorage inside a tiny Forest alcove reachable ONLY by teleporting there (no walking path from the Forest side). This closes a discovery loop: explore Swamp → find rune → unlock hidden Forest area.

**World population:** NPC/monster placement using the existing 4-personality AI (Aggressive/Defensive/Status-Hunter/Resilient). Detection radius reveals an opponent's element; approach (E) launches the duel via the existing `battle-ai` room, flee = walk away. Defeats are recorded server-side (permanent NPCs stay beaten; daily NPCs respawn on the game-day tick). Shrines and the Underground/Shadow drop zone remain deferred to a later phase.

**Confirmed implementation decisions (8C):**

| Decision | Choice | Rationale |
|---|---|---|
| Anchorage data model | Anchorages remain entries in the `shared/waystones.ts` catalog (with `xpThreshold` gate) | First-class Anchorage/waystone separation is still a future pass; the map object `name` (`anchorage` vs `waystone`) already drives the visual + auto-attune split (shipped in the 8B.4 follow-up) |
| Biome scenes | `SwampScene`/`HiddenForestScene` clone `OverworldScene` for MVP | A `BiomeScene` abstraction is deferred until a third biome justifies the refactor |
| NPC duels | Reuse the `battle-ai` Colyseus room (`npcId` added to `BattleRoomOptions`) | No new duel endpoint; defeat recorded in `persistBattleResult` |
| Multiplayer overworld | Still per-player | Shared `WorldRoom` remains deferred |

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

**Available actions:** Same as the in-Sanctum battle-hand screen — reassign carried rings to battle slots (`PUT /api/loadout`), recharge individual rings or all rings (`POST /api/spirit/recharge`, consuming `spirit_current`). Sleep is NOT available in the field (§12.4).

**GDD rule reference:** §6.8 ("After any battle, the player can freely reorganize their battle hand among their carried rings before the next encounter") and §12.3 ("Recharging a ring — anywhere"). Both explicitly allow field access; the Tab binding makes this convenient without requiring a Sanctum return.

---

### 10.15 Forest Region Screens

The Forest is a **multi-screen region** — a graph of discrete maps connected by road edges. Walking off a screen edge transitions (brief fade) to the neighbor, spawning the player at the opposite edge. Each screen is one Tiled map file generated from this manifest.

**Schema conventions:**
- `size` is width × height in tiles (32 px/tile). Narrow dimensions imply a corridor — the generator flanks the short axis with trees/rocks, leaving only the road open.
- `exits` are always reciprocal and validated by a Vitest drift test. `north`/`south` and `east`/`west` are the only valid directions.
- `anchorage` and `waystone` ids must exist in `shared/waystones.ts`.
- `danger` (1–3) controls NPC tier and density. Omit for safe screens.
- `biome_exit` marks a transition to a different biome scene, gated by attunement of the named waystone.
- Add a new screen here first; the drift test will catch any broken exits or unknown ids before implementation.

**Region topology:**
```
            [snow_gate]
                 │ N/S
            [north_road]
                 │ N/S
[mossy_fen]──W/E─[anchorage]─E/W──[east_path]──E/W──[glade]──N/S──[crossroads]──E/W──[briar_pass]
                      │ N/S                                               │ N/S              │ N/S
               [south_path]                                         [ridge]──E/W──[deepwood]──E/W──[boss_clearing]
                      │ N/S                                                                          │ N/S
               [hollow]──W/E──[swamp_gate]──→ SwampScene                                      [briar_pass] (loop)

[hidden_alcove]  ← teleport-only, no walking exits
```

---

#### `forest_anchorage` — Forest Anchorage (hub)
- **size:** 40×30
- **exits:** north → `forest_north_road`, east → `forest_east_path`, south → `forest_south_path`, west → `forest_mossy_fen`
- **safe:** true
- **anchorage:** `forest_entry`
- **content:** The safe community hub. Open clearing with the central campfire ring. Wandering NPCs, friendly duels, and the Merchant (when visiting). The Sanctum anchors here by default. Dirt paths radiate toward all four exits.

---

#### `forest_north_road` — North Road
- **size:** 16×32
- **exits:** south → `forest_anchorage`, north → `forest_snow_gate`
- **danger:** 1
- **content:** A narrow north corridor — trees press in on both sides, the dirt path bisects the center. Pines gradually take on frost tips toward the north edge. One or two early-zone roamers patrol the length.

---

#### `forest_snow_gate` — Snow Gate
- **size:** 32×20
- **exits:** south → `forest_north_road`
- **danger:** 2
- **waystone:** `forest_north_stone`
- **content:** A widening clearing at the forest's northern fringe. The Frost-Worn Stone stands here guarded by a mid-tier mini-boss. Attuning it reveals the Snow Fields. Dead end — the northern edge is a wall of frost-touched firs with no path forward.

---

#### `forest_mossy_fen` — Mossy Fen
- **size:** 32×22
- **exits:** east → `forest_anchorage`
- **danger:** 1
- **content:** A quiet, slightly boggy clearing west of town. Mossy ground, scattered mushroom clusters, low-hanging branches. The richest early foraging spot. A solitary passive Villager wanders here. Dead end — the western edge is impassable undergrowth.

---

#### `forest_east_path` — East Path
- **size:** 24×12
- **exits:** west → `forest_anchorage`, east → `forest_glade`
- **danger:** 1
- **content:** A short east-west connector. Trees close in from north and south; a single dirt road runs the length. One roamer patrols the midpoint. Feels like stepping out of the safety of town for the first time.

---

#### `forest_glade` — The Glade
- **size:** 36×28
- **exits:** west → `forest_east_path`, north → `forest_crossroads`
- **anchorage:** `forest_glade`
- **danger:** 1
- **content:** A sunlit open meadow — the second Anchorage and the first natural rest stop beyond the hub. Tall grass at the edges, a worn campfire ring at center. Several Duelist NPCs wander between here and the Crossroads.

---

#### `forest_crossroads` — The Crossroads
- **size:** 28×22
- **exits:** south → `forest_glade`, east → `forest_briar_pass`, north → `forest_ridge`
- **danger:** 1
- **content:** A three-way junction where the road forks into increasingly dangerous territory. Two to three mid-tier duelists patrol. The choice of east (Briar Pass loop) or north (Ridge descent) gives the player a meaningful direction decision.

---

#### `forest_south_path` — South Path
- **size:** 16×28
- **exits:** north → `forest_anchorage`, south → `forest_hollow`
- **danger:** 1
- **content:** A narrow portrait corridor south of town. The dirt path narrows and the canopy closes overhead. Mushrooms crowd the verges. A gentle danger ramp between the hub and the Hollow.

---

#### `forest_hollow` — The Hollow
- **size:** 36×24
- **exits:** north → `forest_south_path`, west → `forest_swamp_gate`
- **danger:** 2
- **content:** A wide, sunken clearing with darker palette and muddy ground patches. The best foraging density in the Forest — mushroom clusters, roots, berry tangles. Two to three tougher NPCs. The western path carries a faint smell of peat; the Swamp Gate is close.

---

#### `forest_swamp_gate` — Swamp Gate
- **size:** 28×18
- **exits:** east → `forest_hollow`
- **danger:** 2
- **waystone:** `forest_sw_stone`
- **biome_exit:** south → `SwampScene` *(gated by attunement of `forest_sw_stone`)*
- **content:** The southwestern fringe. Ground shifts from dirt to mud; standing water pools near the edge. The Bogwood Sentinel stands here guarded by a mid-tier boss. Attuning it reveals the Swamp and opens the southern biome exit. Until then the south edge is impassable.

---

#### `forest_briar_pass` — Briar Pass
- **size:** 40×16
- **exits:** west → `forest_crossroads`, south → `forest_boss_clearing`
- **danger:** 2
- **content:** A wide, low east-west corridor choked with thorns on both sides — the road is barely a lane. Danger 2 roamers feel more menacing because of the tight sightlines. The path south opens suddenly into the Boss Clearing.

---

#### `forest_ridge` — The Ridge
- **size:** 32×22
- **exits:** south → `forest_crossroads`, east → `forest_deepwood`
- **danger:** 2
- **content:** Rocky elevated ground; implied hillside looking south over the canopy. Sparse trees, more open sky. Danger 2 duelists patrol the exposed rock. The eastern descent drops into the darkest part of the forest.

---

#### `forest_deepwood` — The Deepwood
- **size:** 40×30
- **exits:** west → `forest_ridge`, east → `forest_boss_clearing`
- **anchorage:** `forest_depths`
- **danger:** 3
- **content:** The oldest, darkest part of the forest — ancient gnarled trees, almost no light reaching the floor. The forest_depths Anchorage sits in a rare clearing, a hard-earned rest point. Danger 3 duelists. The eastern path descends toward the Boss Clearing, creating a loop with Briar Pass.

---

#### `forest_boss_clearing` — The Boss Clearing
- **size:** 28×22
- **exits:** north → `forest_briar_pass`, west → `forest_deepwood`
- **danger:** 3
- **content:** A circular clearing, unnaturally still and quiet. The Forest biome boss resides here and guards the waystone or unique item that closes the Forest chapter. Reachable from two directions — Briar Pass from the north, Deepwood from the west — rewarding thorough exploration with the loop.

---

#### `forest_hidden_alcove` — Hidden Alcove
- **size:** 24×18
- **exits:** *(none — teleport-only via `forest_hidden_anchor`)*
- **anchorage:** `forest_hidden_anchor`
- **waystone:** `forest_hidden_glade`
- **danger:** 1
- **content:** A serene, impossibly still clearing accessible only by teleporting after attuning the Ironbark Rune in the Swamp. Both the Hidden Anchorage and the Hidden Glade Waystone sit here. A secret reward — quiet and beautiful, a deliberate contrast to the boss route.

---

### 10.16 Phase 8D — Asset Art Pass

Replaces placeholder generated tiles with real **Asset Alliance** pixel-art assets. Produces the reusable pipeline (decoder, tilesets, sprite system) and applies it to the Sanctum (permanent) + current Forest/Swamp maps (proof). Tilesets and the `Decoration.ts` sprite-placement system are inherited by Phase 8E.

#### Biome → Asset Mapping

| Screen / Scene | Ground tileset | Object sprites | Source pack |
|---|---|---|---|
| `forest_anchorage` hub | GreenForest grass + dirt path | GreenForest trees; Starter Village houses, fences, lamp posts | GreenForest + Starter Village 32×32 |
| Forest corridor screens (`north_road`, `east_path`, `south_path`, `briar_pass`) | GreenForest grass + dirt | GreenForest trees dense on short axis | GreenForest |
| `forest_glade` | GreenForest grass | GreenForest sparse trees, flowers | GreenForest |
| `forest_mossy_fen` | GreenForest dark grass | GreenForest trees, rocks, pond blobs | GreenForest |
| `forest_hollow` | Dark grass + mud patch | GreenForest trees, Cold Cave rocks | GreenForest + Cold Cave |
| `forest_snow_gate` | Stone + frost | Cold Cave rocks + pine variants | Cold Cave |
| `forest_swamp_gate` | Mud/dirt | Cold Cave alt rocks + GreenForest | Cold Cave + GreenForest |
| `forest_crossroads`, `forest_ridge` | GreenForest grass + stone | GreenForest trees, rock clusters | GreenForest |
| `forest_deepwood` | GreenForest dark grass | GreenForest dense trees, dark variants | GreenForest |
| `forest_boss_clearing` | Stone circle | Rock pillars, minimal trees | GreenForest + Cold Cave |
| `forest_hidden_alcove` | GreenForest grass (serene) | Single large tree, soft bush ring | GreenForest |
| Swamp screens | Mud + water | Cold Cave alt rocks, reed sprites | Cold Cave + GreenForest |
| **Sanctum interior** | Cozy Indoor wood + stone floors | Cozy Indoor furniture (bed, bookshelf, rug, hearth, door) | Cozy Indoor |

#### Phase 8D Build Decomposition (EPIC [#92](https://github.com/krisoye/elemental-rings/issues/92))

**Sub-issues (8D.1 + 8D.3 parallel; 8D.4 after 8D.2):**

- [#93](https://github.com/krisoye/elemental-rings/issues/93) — **8D.1:** RPG Maker VX autotile decoder tool (`client/scripts/lib/rpgmaker-autotile.mjs`). Reads A2/A4 source sheets; outputs flat 48-variant Tiled-compatible tileset PNGs. Verified by Vitest. NOT wired into any map — tool only, consumed by 8E.
- [#94](https://github.com/krisoye/elemental-rings/issues/94) — **8D.2:** Forest + Swamp ground tilesets. Generates `forest.png` (GreenForest grass/tree/dirt) and refreshes `swamp.png` (real mud/water). Splits the shared `placeholder.png` — OverworldScene + HiddenForestScene → `forest`; CampScene → `sanctum` (see 8D.3). GID contract unchanged (4-tile strip, GID3 `collides:true`).
- [#95](https://github.com/krisoye/elemental-rings/issues/95) — **8D.3:** Sanctum interior. Generates `sanctum.png` (Cozy Indoor wood/stone floors). Adds furniture sprites at the five interaction zones (bed, meditation, ringwall, campfire, door). All E2E hooks and InteractionZones unchanged.
- [#96](https://github.com/krisoye/elemental-rings/issues/96) — **8D.4:** Decoration sprite system. `client/src/objects/world/Decoration.ts` — `placeDecoration(scene, group, spec[])` helper usable by any biome scene. Generates `forest-decoration.png` (trees, rocks, bushes, ponds) and `structures.png` (Starter Village buildings). Minimal proof placement in current OverworldScene/ForestScene; full per-screen placement is 8E.5.

**Confirmed implementation decisions (8D):**

| Decision | Choice | Rationale |
|---|---|---|
| Orientation | **Orthogonal 32px** — unchanged | No engine changes; Asset Alliance ships 32×32 variants |
| GID structure | 4-tile strip preserved (void/floor/wall/accent) | Drop-in swap; all map generators and collision unchanged |
| Autotile transitions | Decoder built as a **tool**; NOT applied to maps in 8D | Maps re-indexed once in 8E, not twice |
| Map application scope | Sanctum (permanent) + current Forest/Swamp (proof) | Tilesets + system are 100% reusable by 8E; current map decoration is throwaway |
| Source art location | Read from absolute host paths at generation time; committed PNGs are the portable artifact | No repo bloat; regeneration is host-bound (acceptable) |
| Tileset split | `forest.png` / `sanctum.png` / `swamp.png` | Sanctum must not inherit grass from the shared placeholder sheet |

---

### 10.17 Phase 8E — Forest Region Expansion

Implements the §10.15 Forest region manifest as a **15-screen connected world** using a new biome class hierarchy. Inherits all tilesets, sprite catalogs, and the `Decoration.ts` system from Phase 8D.

#### Architecture

```
BaseBiomeScene (abstract Phaser.Scene)
│   Core mechanics — written once:
│     tilemap load, Player, Arcade physics, camera, compass HUD,
│     waystone attunement, NPC detection + duel launch, talisman,
│     blink (§10.13), biome_exit, edge-transition system, E2E hooks
│   Abstract contract:
│     abstract tilesetKey(): string
│     abstract mapKeyForScreen(screenId: string): string
│   Optional overrides:
│     biomeVisuals?()   ← fog, snow, tint
│     onEnterScreen?()  ← per-screen decoration placement

ForestScene extends BaseBiomeScene
│   manifest: FOREST_SCREENS (shared/world/forest.ts — 15 screens)
│   tilesetKey() → 'forest'
│   Phaser key: 'ForestScene'; init({ screenId, spawnEdge })
│   onEnterScreen() → calls Decoration.placeDecoration per screenId spec

SwampScene extends BaseBiomeScene
│   manifest: SWAMP_SCREENS (shared/world/swamp.ts — 1 screen, grows later)
│   tilesetKey() → 'swamp-tiles'
│   biomeVisuals() → fog overlay, reduced NPC detection radius

[HiddenForestScene deleted — absorbed as forest_hidden_alcove screen in ForestScene]
```

**Edge-transition system:** when the player walks off a map edge that has an `exits` entry in `ScreenDef`, `BaseBiomeScene` fades (250 ms) and restarts the same scene class with the neighbor's `screenId`, spawning the player at the opposite edge midpoint. `biomeExit` edges still use the attunement-gated transition (existing `tryBiomeExit` pattern).

#### Phase 8E Build Decomposition (EPIC [#97](https://github.com/krisoye/elemental-rings/issues/97))

**DAG: `{8E.1, 8E.3}` parallel → `{8E.2, 8E.4}` after 8E.1 → `8E.5` after 8E.2 + 8D.4**

- [#98](https://github.com/krisoye/elemental-rings/issues/98) — **8E.1:** `BaseBiomeScene` + `ForestScene` core. Extracts all shared logic from `OverworldScene` into `BaseBiomeScene`. Creates `ForestScene`, `shared/world/forest.ts` manifest, edge-transition system. Deletes `OverworldScene.ts` + `HiddenForestScene.ts`. Extends drift test for reciprocal exits + waystones.ts parity.
- [#99](https://github.com/krisoye/elemental-rings/issues/99) — **8E.3:** Server NPC screen-awareness. Adds `screen: string` to `NpcSpawnDef`; expands `NPC_SPAWNS` for all Forest screens by danger tier; adds `?screen=` filter to `GET /api/overworld/npcs` (screen required when biome provided).
- [#100](https://github.com/krisoye/elemental-rings/issues/100) — **8E.2:** Forest screen map generator. Single `gen-forest-screens.mjs` generates all 15 maps from `FOREST_SCREENS` manifest → `maps/forest/<id>.json`. Corridor maps auto-shaped; open maps get grove clusters; object layer derived from manifest fields. Deletes `gen-overworld-map.mjs`, `overworld.json`, `forest_hidden.json`.
- [#101](https://github.com/krisoye/elemental-rings/issues/101) — **8E.4:** Migrate `SwampScene` to `BaseBiomeScene`. Removes ~250 lines of duplicated shared logic; keeps fog + detection-radius overrides; creates `shared/world/swamp.ts`.
- [#102](https://github.com/krisoye/elemental-rings/issues/102) — **8E.5:** Forest decoration + hub structures placement. Art-directs all 15 Forest screens via `Decoration.ts` + `SCREEN_SPECS` constant in `ForestScene`. Hub gets Starter Village buildings; corridors get dense flanking trees; deep forest gets densest coverage; boss clearing kept open.

**Confirmed implementation decisions (8E):**

| Decision | Choice | Rationale |
|---|---|---|
| Biome architecture | `BaseBiomeScene` abstract + subclass per biome | Core mechanics once; biomes diverge via override hooks |
| Scene key | One `'ForestScene'`, `init({ screenId })` | 15 screens as instances of one class |
| HiddenForestScene | Deleted — `forest_hidden_alcove` manifest entry | Was an OverworldScene clone; manifest entry is the right abstraction |
| SwampScene | Rewritten to `extend BaseBiomeScene` | Explicitly "clone for MVP" per §10.12; now migrated |
| Manifest location | `shared/world/forest.ts` (TypeScript, typed) | Importable by generator + drift test + server; §10.15 is the human-readable mirror |
| NPC placement | `screen` field server-side | Defeat-tracking and placement must share a source of truth |
| Transition UX | Walk-off-edge → 250 ms fade → spawn at opposite edge | Classic LttP screen-transition; camera-bounds already pins overrun |
| Map layout | `maps/forest/<screenId>.json` | Clean namespace; single generator; no name collisions |

---
