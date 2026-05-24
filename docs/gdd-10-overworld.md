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
NPCs should feel like distinct opponents, not just difficulty levels:
- **Aggressive** — opens with strongest ring, burns through uses fast, likely wearing stake on dominant hand bracelet
- **Defensive** — holds strong rings in reserve, tries to exhaust player uses, likely wearing stake on off hand bracelet
- **Bluffing** — deliberately misleads with element positioning and jewelry position
- **Status-hunter** — builds methodically toward status effect triggers
- **Resilient** — likely wearing stake as necklace, dangerous when low on hearts

### 10.6 Key Locations

| Location | Purpose |
|---|---|
| Player Camp | Sleep to advance game day and fully recharge all rings; pay gold to recharge immediately; full inventory access |
| Shrines | One per fusion recipe; discovered via shrine maps dropped by fusion-type enemies |
| Merchant Areas | Buy/sell rings and fusion stones |
| Dark/Underground Areas | Shadow ring drop locations; high risk, unpredictable opposition |
| Boss Arenas | Fixed high-XP encounters; unique ring rewards; may gate world regions |

---
