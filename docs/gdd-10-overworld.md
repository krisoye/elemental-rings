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
- **Visible from detection range:** element types in loadout, hearts, aggregate uses per element type, staked ring jewelry position
- As both parties continue to approach they can **formally agree to duel**
- The player can always turn back and flee before formally agreeing — no penalty
- Once formally agreed the duel begins and the 5 battle ring selection screen appears

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

Both variants include an uncounterable attack slot (Wind). Fire-Aggressor uses Kindling to start the first Fire ring at 4 uses, creating immediate pressure. Wind-Aggressor chains uncounterable hits sustained by Tailwind.

---

**Defensive** (2 variants)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive |
|---|---|---|---|---|---|---|
| Earth-Defender | 🟤 Earth | Water | Wind | Earth | Earth | Bulwark: both Earth defense rings start at +1 use |
| Wood-Defender | 💚 Wood | Water | Wind | Wood | Earth | Deep Roots: heart-loss redirected to Thumb |

Earth-Defender front-loads defense via Bulwark — both D1 and D2 start at 4 uses, making it expensive to land a hit. Wood-Defender is harder to finish; every heart the attacker thinks they landed may have been absorbed by Deep Roots.

---

**Status-Hunter** (3 variants)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive | Target Gauge |
|---|---|---|---|---|---|---|---|
| Fire-Hunter | 🔴 Fire | Fire | Fire | Wood | Earth | Kindling: A1 starts at +1 use | Fire → Burning |
| Water-Hunter | 🔵 Water | Water | Water | Fire | Earth | Wellspring: defense uses refund | Water → Drowning |
| Wood-Hunter | 💚 Wood | Wood | Wood | Water | Earth | Deep Roots: heart guard | Wood → Entangled |

Triple same-element attack slots maximize gauge accumulation per exchange. The defense ring is the counter to the opponent's likely response — e.g., Water-Hunter uses Fire defense (STRONG vs Wood, which counters Water).

---

**Resilient** (5 variants — one per base element as the stake)

| Variant | Thumb (Stake) | A1 | A2 | D1 | D2 | Passive |
|---|---|---|---|---|---|---|
| Fire-Resilient | 🔴 Fire | Wind | Water | Earth | Wood | Kindling |
| Water-Resilient | 🔵 Water | Wind | Fire | Earth | Wood | Wellspring |
| Earth-Resilient | 🟤 Earth | Wind | Water | Earth | Wood | Bulwark |
| Wind-Resilient | 🟢 Wind | Fire | Water | Earth | Wood | Tailwind |
| Wood-Resilient | 💚 Wood | Wind | Fire | Earth | Water | Deep Roots |

All variants keep Wind in a primary attack slot as an uncounterable baseline. The second attack slot and the two defense slots vary with the stake element. Resilient opponents are not element-specialists — they are endurance fighters. At low health the AI stops no-blocking, tightens timing, and switches attack selection to Aggressive logic.

### 10.6 Key Locations

| Location | Purpose |
|---|---|
| **Player Camp** | Sleep (advance game day + recharge all rings); paid immediate recharge; full inventory management; pack carry loadout before setting out |
| **Cities / Settlements** | Merchants, services, social NPCs; safe zone — no duels initiated here |
| **Shrines** | One per fusion recipe; discovered via shrine maps dropped by fusion-type enemies |
| **Dark/Underground Areas** | Shadow ring drop locations; high risk, unpredictable opposition |
| **Boss Arenas** | Fixed high-XP encounters; unique ring rewards; may gate world regions |

**Camp vs City distinction:**
- Camp is a temporary personal rest stop — only the player's own rings and resources are accessible
- Cities are persistent world locations shared by all players, with access to merchants, trade, and social features
- Ring inventory management (choosing the 10 you carry) happens at **camp only** — you pack before you leave, not mid-expedition

### 10.7 Merchants

Merchants are encountered in cities and occasionally wandering the overworld between biomes.

**Wares:**

| Category | Examples | Currency |
|---|---|---|
| Rings | Tier 1 base rings, rare element variants | Gold |
| Carry capacity | +1 carry slot upgrades (up to a cap) | Gold |
| Garments | Equipment that modifies passive staking behavior or carry cap | Gold + rare materials |
| Fusion stones | Catalysts for ring fusion recipes | Gold + ring sacrifice |
| Shrine maps | Reveal fusion shrine locations on the overworld map | Gold |

**Carry cap expansion:**
- Players start with `carry_cap = 10`
- Each +1 carry capacity upgrade costs increasing amounts of gold (exact costs TBD — tuned for scarcity)
- Maximum carry cap TBD — progression gate for late-game ring diversity

**Wandering merchants:**
- A subset of merchants patrol fixed routes between biomes
- Encounter windows are limited — if the player doesn't trade during a patrol window they must wait for the next cycle
- Creates strategic timing decisions: return to trade now or continue the expedition?

---
