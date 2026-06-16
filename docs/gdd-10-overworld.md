## 10. Overworld

### 10.1 Visual Style
- Top-down orthogonal perspective, square grid
- Reference: *The Legend of Zelda: A Link to the Past*
- Renderer: Phaser.js canvas with Tiled tilemap support (orthogonal orientation)
- **Tile size:** 32 px for generated biome screens; **16 px at 2× camera zoom** for hand-authored hub screens (e.g. `forest_anchorage`). The 2× zoom makes 16px tiles read as 32px on screen while retaining finer art detail.

**Tile layer convention (all hand-authored screens):**

| Layer | Depth | Collision | Contains |
|-------|-------|-----------|----------|
| `ground` | 0 | `collides` property only | Base terrain — grass, water, paths, dirt |
| `behind` | 2 | all non-empty | South-facing building walls, tree trunks, fence posts — objects the player walks *in front of* |
| *(player)* | 3 | — | Player character |
| `in-front` | 5 | none | Roofs, tree canopy, cliff overhangs — objects the player walks *under* |

**Placement rule:** ask "can the player ever walk in front of this tile?" If yes → `behind`. If no (the player walks under it) → `in-front`. Terrain → `ground`.
Note: a single object (e.g. a building) typically uses both `behind` *and* `in-front` — south wall panels on `behind`, roof tiles on `in-front`.

### 10.2 Biomes
Each biome has NPCs and monsters that lean toward specific element distributions, requiring players to prepare appropriate counter-rings before entering.

| Biome | Dominant Elements | Key Weaknesses to Bring | Notable Content |
|---|---|---|---|
| Forest | Wood, Wind, Bloom | Fire, Water | Thornado shrine (sealed — ring-key unlock); Bloom shrine (open); boss: The Thornwood Warden; Desert biome waystone (The Barrowstone) |
| Snow Fields | Water, Wind, Mud | Fire, Earth ⚠️ *[Metal removed in v4 — counter TBD]* | Frost shrine; cold-water fusion encounters |
| Swamps | Mud, Water, Wood, Earth | Fire, Wind | Mud shrine; reduced enemy visibility range |
| Desert | Fire, Earth, Magma | Water, Mud, Wind | Magma shrine; Magma-type recipes |
| Underground/Caves | Shadow (drops), mixed | Unpredictable by design | Shadow ring drops; no biome weakness pattern |
| Volcanic Region | Magma, Inferno | Water, Mud, Earth ⚠️ *[Lightning/Lava removed in v4 — dominant list TBD]* | Late-game only; extreme difficulty |

> **v4 element note:** Ice, Metal, Lightning, and Lava do not exist in the v4 element enum. Rows marked ⚠️ retain partially-valid v4 equivalents but require a full biome element design pass before those areas are authored.

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
- **The Reliquary:** rings displayed along the walls — all rings not in the carry loadout rest here. Rings in the Reliquary do not earn XP; XP accrues only through battle use (see §4.4). Their uses recharge passively on the game day timer.

**The Sanctum as spiritual extension:**
The Sanctum is not an inert container. It is spiritually bonded to the protagonist's ring collection. The sum of XP across all Reliquary rings is the protagonist's `aggregate_xp`; `spirit_max` is derived from `aggregate_xp`. Carried rings are excluded — `spirit_max` grows only as the protagonist retires experienced rings to the Reliquary and develops new ones to carry. The protagonist and their Sanctum are one entity: the Reliquary is where their earned power lives between expeditions.

**Anchoring the Sanctum:**
- When the protagonist teleports to an Anchorage, the Sanctum materializes within it
- Anchoring it establishes the camp for that area
- When multiple players anchor their Sanctums at the same Anchorage, a temporary community forms — the campfires create a gathering space, and a small mystic settlement emerges naturally
- This is an **Anchorage community**: not a fixed city, but a living cluster of sanctums that comes and goes with its inhabitants

**Sanctum interaction (implemented):**

| Zone | How to activate |
|------|----------------|
| Reliquary wall, meditation circle, bed, campfire | Walk into zone → **Press E** |
| Exit door | **Walk into the door** — no key press needed; transition fires automatically after a brief moment |

The exit door uses touch-to-exit so leaving feels natural (protagonist walks out rather than pressing a button). All other zones retain press-E to avoid accidental triggers while passing through.

**Sanctum rendering:** the interior map uses **16 px tiles at 2× world zoom** so the room reads at the same apparent scale as the overworld. UI overlays (inventory panels, modal dialogs) render at 1:1 via a separate camera and are unaffected by the zoom.

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

**Overworld representation:** merchants appear as standing NPC sprites (drawn from the `charsetA_1` character sheet, distinct character per merchant). Walking into their interaction zone and pressing **E** opens the shop modal. Two merchants are placed at the Forest Anchorage hub by default.

**Wares:**

| Category | Examples | Currency |
|---|---|---|
| Rings | Tier 1 base rings, rare element variants | Gold |
| Sanctum upgrades | Expanded ring storage, meditation circle enhancements | Gold + rare materials |
| Garments | Equipment that expands spiritual carry capacity | Gold + rare materials |
| Shrine maps | Reveal shrine locations on the world map | Gold |
| Food | Emergency provisions at 2× forage value | Gold |

**Shop mechanics (implemented):**

*Buy prices — Tier 1 base rings only:*

| Element | Buy price |
|---|---|
| Fire, Water, Wood (triangle) | 30 GP |
| Wind, Earth (neutral) | 25 GP |
| Food | 2 GP / unit |

*Sell prices — carried rings of any tier, base elements only:*

Sell price = **base + floor(xp / 100)** GP, where base is element-type determined:

| Element | Base sell price | Example: 3000 XP (T3) |
|---|---|---|
| Fire, Water, Wood | 10 GP | 40 GP |
| Wind, Earth | 8 GP | 38 GP |
| Food | 1 GP / unit | — |

**What can be sold:**
- Any base-element ring (Fire, Water, Earth, Wind, Wood) of any tier that the player is **currently carrying** (in the carry set)
- Rings stored in the Reliquary cannot be sold — they are not on the player's person

**What cannot be sold:**
- Fused rings (elements 5–14)
- Shadow rings
- Rings currently assigned to a battle slot (must be unslotted first)

**Carry cap (garments):**
- Players start with `carry_cap = 10` (spiritually derived from base spirit gauge)
- Garments from merchants can expand it beyond the spirit-derived default
- Maximum carry cap TBD

**Wandering merchants:**
- A subset patrol fixed routes between biomes; they may anchor at well-traveled Anchorages briefly
- Encounter windows are limited — if the player doesn't trade during a visit they must wait for the next cycle
- Creates strategic decisions: return to trade now or continue the expedition?

---

### 10.12 Design-Change Log (Overworld)

This log records how the overworld's design has evolved — what it *became* and why. It is not a build log; implementation status, issues, and PRs live in GitHub.

- **The Forest deep wing is now exclusively post-boss.** The old `Root Tangle → Deepwood` backdoor was removed so the deep forest (Verdant Descent and beyond) can only be reached by defeating the warden north of Boss Clearing. `Briar Pass` was relocated to the **west** of Crossroads, and the `Briar Pass → Deepwood → Boss Clearing` chain became a clean vertical spine. This eliminated a non-planar 5-cycle in the screen graph, so cardinal navigation is now coherent (`N→E→S→W` returns to start).
- **The World Map modal is fully derived from the Forest screen manifest.** The M-key overworld map (`OverworldMapModal`) no longer carries hardcoded node positions or edges; it reads every node's grid cell from `FOREST_SCREENS` coords (`col = x`, `row = −y`) and derives its edge set from the screens' reciprocal exits. Display-only metadata (short labels, boss-tier glyphs) lives in `client/src/objects/world/forestMeta.ts`. The reason: a hardcoded mirror of `forest.ts` could drift independently after any graph change — deriving the modal makes the manifest the single source of truth. Adding a Forest screen now requires one entry in `shared/world/forest.ts` (with a `coord`) and one label/metadata entry in `forestMeta.ts`; the only remaining hardcoded positions are the isolated Hidden Alcove (teleport-only, no coord) and the Swamp biome's entry node (not a Forest screen — a static biome node placed adjacent to its gate screen). The modal opens at `OPEN_ZOOM = max(FIT_SCALE, min(READABLE_SCALE, ZOOM_MAX))` centered on the player's current screen, supports focal-point zoom (mouse wheel and ±/keyboard keys use the cursor or map-centre as focal point), and allows free drag-pan at any zoom level (bounds clamped).
- **All 9 Snow Mountain screens now appear on the World Map, fully manifest-derived.** The original static `snow_entry` hardcoded node was replaced with nodes derived from `SNOW_SCREENS` — the same pattern used for Forest. Each Snow screen carries a `coord` field; the modal applies a `SNOW_ROW_OFFSET = −3` so Snow nodes render north of the Forest grid (render row = `SNOW_ROW_OFFSET + (−coord.y)`, giving rows −3 through −8). `MIN_ROW` was extended from −5 (Forest only) to −8 to accommodate `snow_blizzard_peak` (coord y=5 → render row −8); intra-Snow edges are derived from each screen's reciprocal `exits` in the same loop that handles Forest. This makes `shared/world/snow.ts` the single source of truth for Snow map layout — adding a Snow screen requires one entry in the manifest with a `coord` field.

