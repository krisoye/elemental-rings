# Elemental Rings — Game Design Document
**Version 2.0 | Engine: Godot 4.x**

---

## Table of Contents
1. [Game Overview](#1-game-overview)
2. [Element System](#2-element-system)
3. [Ring System](#3-ring-system)
4. [Fusion System](#4-fusion-system)
5. [Battle System](#5-battle-system)
6. [Status Effects](#6-status-effects)
7. [Player Progression](#7-player-progression)
8. [Staking Economy](#8-staking-economy)
9. [Overworld](#9-overworld)
10. [UI and Information Display](#10-ui-and-information-display)
11. [Build Sequence for Claude Code](#11-build-sequence-for-claude-code)
12. [Open Questions](#12-open-questions)

---

## 1. Game Overview

**Elemental Rings** is a top-down isometric RPG (Zelda: A Link to the Past visual style) built in Godot 4.x. The core gameplay loop is a turn-based duel system built on rock-paper-scissors elemental logic, layered with resource management, bluffing, ring progression, and a staking economy.

### Core Loop
- Leave camp with a 10-ring loadout chosen for the current biome
- Explore the overworld → encounter NPCs and monsters, evaluate their loadout from a distance
- Choose to duel or flee → select 5 battle rings from your loadout, duel, win or lose
- Post-battle → reorganize loadout, absorb won ring, return exhausted rings to inventory
- Return to camp → full recharge after one game day, reassess full inventory
- Level up rings → fuse them into more powerful variants at shrines
- Higher player XP unlocks new world areas and stronger opponents

### Tone
Nobody dies. Monsters flee when beaten and steal a ring when they win. NPCs hand over their staked ring on loss and walk away. The world is alive, consequential, but never grim.

---

## 2. Element System

### 2.1 The Five Base Elements
All elements in the game derive from five base elements. These are the only elements shown in simplified UI views.

| Element | Symbol |
|---|---|
| Fire | 🔥 |
| Water | 💧 |
| Earth | 🪨 |
| Wind | 🌪 |
| Wood | 🌿 |

### 2.2 Base Element Relationships

| Attacker | Beats | Loses To |
|---|---|---|
| Fire | Wood | Water |
| Water | Fire | Wind |
| Wood | Earth | Fire |
| Earth | Wind | Wood |
| Wind | Water | Earth |

### 2.3 Derived Elements (Tier 2 Fusions)

| Fusion Name | Components | Beats | Loses To |
|---|---|---|---|
| Lightning | Fire + Fire | Water (conducts everywhere), Wood, Metal | Earth (grounds), Mud |
| Ice | Water + Water | Wind (stills it), Fire* | Metal, Lightning |
| Metal | Earth + Earth | Wood (cuts it), Earth | Fire (melts), Lightning |
| Storm | Wind + Wind | Water, Wood, Metal | Earth, Ice |
| Nature/Bloom | Wood + Wood | Earth, Water | Fire, Wind |
| Mud | Water + Earth | Fire, Lightning | Wood, Wind |
| Lava | Fire + Earth | Ice, Metal, Wood | Water, Mud |
| Frost | Ice + Wind | Water, Fire* | Metal, Lightning |
| Magma | Fire + Metal | Ice, Earth, Wood | Water, Mud |
| Ash | Fire + Wood | Wind, Ice | Water, Earth |
| Steam | Water + Fire | Ice, Metal, Wood | Wind, Earth |

*Frost flash-freezes Fire as a counterintuitive surprise counter — intentional design. Rewards experimentation over meta-solving.

### 2.4 Triple Fusions (Tier 3 — Rare)

| Fusion Name | Components | Beats | Loses To |
|---|---|---|---|
| Obsidian | Fire + Earth + Water | Most elements | Storm, Lava |

### 2.5 Shadow (Special Case)
Shadow is the only element that cannot be fused or crafted from base elements. It exists outside the normal system.

- **How to obtain:** Rare drop only, found in dark/underground areas of the overworld
- **No fusion recipe exists** for Shadow
- **Cannot be upgraded** via same-element fusion
- **Thematic identity:** Uncanny, unpredictable, a mystery the lore can explore

**Shadow relationships:**
- Beats: Lightning, Wind
- Loses to: Fire, Earth
- **Passive ability:** Every Shadow attack has a 25% chance to inflict Cursed regardless of the element matchup (see Section 6)

---

## 3. Ring System

### 3.1 Inventory
- **Starting inventory cap:** 10 rings (one per finger — thematic starting point)
- **Maximum inventory cap:** 99 rings
- **Inventory expansion:** Unlocked through buying, finding, or sacrificing rings/experience over time
- Rings sitting in inventory recharge on the game day timer even while the player is in the field

### 3.2 Ring Tiers and Stats

| Tier | Description | Max Uses | XP Cap |
|---|---|---|---|
| 1 | Base element rings — found easily | 3 | 100 |
| 2 | Two-element fusions | 5 | 300 |
| 3 | Advanced fusions (two Tier 2 parents) | 7 | 800 |
| 4 | Triple fusions — extremely rare | TBD | TBD |

### 3.3 Ring Uses
- Uses are consumed during battle (attacking and defending)
- **Uses are NOT permanently lost.** All rings fully recharge after one game day
- A game day advances when the player sleeps at camp — the player controls the pace
- Rings can be recharged immediately by paying gold/currency at camp (not fusion stones — keep those scarce)
- **Tier 1 rings recharge instantly or in half a day** — common rings are never a bottleneck
- **Tier 2 and above require a full game day** to recharge
- Heavily depleted rings (more than half their uses spent) may require two full game days — TBD on tuning
- If a ring is extinguished mid-battle (uses reach 0) it cannot be used for the rest of that duel

### 3.4 Ring XP
- Rings earn XP through use in battle — more uses in a duel = more XP for that ring
- XP is permanent and carries through fusion
- Losing a ring via staking means losing all XP associated with it
- The staked ring earns passive XP through the use-per-battle cost of its buff (see Section 8)

### 3.5 Ring Abilities
- Rings unlock passive and active abilities as they accumulate XP
- Ability design: *flagged for future design session*

---

## 4. Fusion System

### 4.1 Core Rules
- Fusion can only happen **in the overworld at a specific shrine** — never during a duel
- Both parent rings must be **maxed out** at their tier's XP cap before fusion is possible
- The fused ring **inherits XP** from both parent rings (XP is additive)
- The fused ring's uses **reset to the full max uses of the new tier** regardless of parent rings' remaining uses
- Fusing is a long-term gain (higher tier, more uses, more power) but a short-term cost (uses reset, must recharge)

### 4.2 Same-Element Upgrade Paths

| Input | Output | Thematic Logic |
|---|---|---|
| Fire + Fire | Lightning | Heat becomes electrical energy |
| Water + Water | Ice | Concentrated, stilled water |
| Earth + Earth | Metal | Compressed, refined earth |
| Wind + Wind | Storm | Air pressure concentrated into force |
| Wood + Wood | Nature/Bloom | Life energy distilled |

### 4.3 Cross-Element Fusion Paths

| Input | Output |
|---|---|
| Water + Earth | Mud |
| Fire + Earth | Lava |
| Fire + Metal | Magma |
| Ice + Wind | Frost |
| Wind + Lightning | Storm (alternate path) |
| Fire + Wood | Ash |
| Water + Fire | Steam |
| Fire + Earth + Water | Obsidian (Tier 3) |

### 4.4 Fusion Unlock Mechanism (Discovery + Cost Hybrid)

Fusions are **discovered through gameplay**, then **executed with a resource cost** at a shrine.

**Step 1 — Discovery:**
The player encounters an NPC or monster using a fusion-type ring for the first time (e.g. a Mud-ring monster in the swamp). Defeating them reveals a map to the relevant shrine (e.g. the Mud Shrine).

**Step 2 — Shrine Access:**
The shrine is located in the overworld, often in an experience-gated region. The player must have sufficient player XP to reach the area.

**Step 3 — Fusion Execution:**
At the shrine the player combines two maxed parent rings. A catalyst cost (fusion stones found through exploration) is required for standard Tier 2 fusions. Ring sacrifice is reserved only for the rarest Tier 4 fusions.

### 4.5 Fusion Cost Summary

| Tier | Cost |
|---|---|
| Tier 2 (standard fusion) | Two maxed Tier 1 rings + fusion stones |
| Tier 3 (advanced fusion) | Two maxed Tier 2 rings + fusion stones (more) |
| Tier 4 (triple fusion) | Three maxed Tier 2 rings OR one Tier 3 + components + ring sacrifice |

---

## 5. Battle System

### 5.1 The Loadout System

The player manages three layers of ring access:

| Layer | Size | When Chosen |
|---|---|---|
| Full Inventory | Up to 99 rings | Managed at camp |
| Field Loadout | 10 rings | Chosen when leaving camp |
| Battle Hand | 5 rings | Chosen just before a duel begins |

**Dominant Hand (5 rings):** The active battle hand. These rings are used for attacking and defending in duels.

**Off Hand (5 rings):** The reserve hand. These rings recover 1 use whenever a dominant hand ring is used in battle (passive recharge drip). Off hand rings can be swapped into the dominant hand between battles.

**Choosing the loadout:** The player selects which 10 rings to carry based on the biome they're entering and the opponents they expect to face. This is the primary strategic decision made at camp.

### 5.2 Pre-Duel Setup
- Each player selects **5 battle rings** from their 10-ring loadout
- Each player confirms their **staked ring** and its **jewelry position** (see Section 8)
- Both players can see each other's element types, hearts, and aggregate uses from detection range before committing
- Once both players formally agree to duel, the battle begins

### 5.3 Turn Structure (Active Timed Block)
Combat is an **active, reaction-timed** exchange — not a hidden simultaneous selection. On each turn:
1. The **attacker** selects which ring to attack with using a single keypress (1–5) and "throws" it. The attack costs the attacker **1 use** up front, regardless of the outcome.
2. The attack is **telegraphed**: the attacking ring's base-element color(s) travel across the screen toward the defender. Fused rings show all of their component colors (e.g. a Mud ring shows blue + brown).
3. The **defender** must choose the correct ring AND time the block — a single keypress (1–5) that must land within the timing window as the incoming attack arrives.
4. The block is resolved on two independent axes — **timing** (parry / block / mistime / no-block) and **element** (strong / neutral / weak). See §5.4.
5. Roles swap — the defender becomes the attacker next turn.

Because the defender sees the incoming element before committing, there is no simultaneous hidden selection. Bluffing lives in the loadout, stake, and jewelry layers (§8), not in the turn itself.

### 5.4 Damage Rules
The attacker always pays **1 use to throw**. The defender's response — its **timing** and its **element relationship** to the attack — determines everything else.

**Timing axis** — the defender's keypress relative to the moment the telegraph arrives:

| Timing | Condition |
|---|---|
| **Parry** | pressed within the tight inner window |
| **Block** | pressed within the wider outer window (but outside the parry window) |
| **Mistime** | pressed, but outside the block window |
| **No-block** | no key pressed |

**Element axis** — the defender's ring vs the attack's base-element component(s):
- **Strong** — defender's element beats the attack (parry-eligible)
- **Neutral** — no relationship
- **Weak** — the attack beats the defender's element

**Outcome:**

| Timing ↓ / Element → | Strong | Neutral | Weak |
|---|---|---|---|
| **No-block** | −1 heart; defender ring spends **0** uses | same | same |
| **Mistime** | −1 heart; attempted ring spends **1** use | same | same |
| **Block** | safe; ring −1 use; **no reflect** | safe; ring −1 use | ring −2 uses; overflow → −1 heart if it had <2 uses |
| **Parry** | safe; ring −1 use; **reflect** (below) | safe; ring −1 use | ring −2 uses; overflow risk |

On the two failure rows the element axis is irrelevant — timing failed and the attack lands. **No-block** is a deliberate sacrifice (save the ring use, take a heart); **mistime** is the punished attempt (lose a heart AND burn the attempted ring's use; a ring drained to exactly 0 this way is extinguished, no extra heart).

**Rally (Parry + Strong = active counter).** Instead of an automatic reflect, the exchange continues as an interactive volley chain:

1. The original attacker becomes the new **rally-defender**; the parrying player becomes the **rally-attacker**.
2. The **volleyed element is the parrying ring's base element** (not the original thrown element). Example: defender parries FIRE with WATER → a WATER counter flies back.
3. A new 0.9 s telegraph plays for the volleyed element and the rally-defender must respond exactly as in a normal defend window (no-block / block / parry-strong).
4. If the rally-defender **parries-strong** with the next pentagon element they become the rally-attacker and the chain continues, walking the pentagon: FIRE → WATER → WIND → EARTH → WOOD → FIRE → …
5. Any other response ends the rally and resolves normally under the standard outcome table:
   - **No-block** → rally-defender loses 1 heart; rally ends.
   - **Block (neutral or weak)** → standard block costs apply; rally ends.
   - **Mistime** → rally-defender loses 1 heart + 1 ring use; rally ends.

**Cost symmetry:** the floor cost is identical to the old auto-reflect. Attacker throws (−1 use) → defender parries strong (−1 use) → rally-defender neutral-blocks (−1 use) = attacker −2 / defender −1. The rally adds optional escalation above that floor.

**Ring depletion naturally caps rally depth.** Each parry spends a ring use; a ring at 0 uses cannot parry. The rally walk also requires the specific next-pentagon element with uses remaining.

A strong element with only **Block** timing is a safe block but forfeits the rally — the elemental advantage converts to a counter-volley only when you also win the tight parry window.

*The same logic applies to all element matchups across all tiers.*

### 5.5 Neutral Block Rules
A neutral block occurs when the defender blocks (timing = block or parry) with an element that has no relationship to the attack.

- The defender's ring spends 1 use; the attacker's thrown ring already spent its 1 use
- No heart damage
- No status gauge change — gauges only move on unblocked hits, perfect counters, or reflect overflow (see §6)

Neutrals are pure attrition exchanges. A correctly-timed neutral block is always safe; the tension is whether to spend a use blocking or to no-block and take the heart to conserve it.

### 5.6 Off Hand Passive Recharge
- Whenever a dominant hand ring is used in battle (attack or defense), the **most exhausted ring on the off hand recovers 1 use**
- This rewards sustained fighting across multiple encounters
- Players should keep their most depleted rings on the off hand between fights to maximize recovery
- Managing which rings sit on which hand between encounters is a meaningful micro-decision

### 5.7 Extinguished Rings
- A ring is **extinguished** whenever its `current_uses` reaches 0 during a battle, regardless of which outcome caused it (throw, block cost, weak-block overflow, or reflect)
- Extinguishing a ring at exactly 0 (the attack or cost was fully absorbed) does NOT cost a heart
- A ring extinguished **by overflow** (it had fewer uses than the cost it received) costs its owner **1 heart**. This is symmetric: a defender's ring overflows on a weak block (had 1 use, received 2), and an attacker's already-thrown ring overflows when a parry reflects onto it after the throw left it at 0
- Extinguished rings cannot be used for the rest of the duel
- The opponent can see which element types are exhausted from the HUD

### 5.8 Hearts
- Each player starts a duel with a set number of hearts (exact count TBD — suggest 3 or 5)
- Hearts are lost when an attack reaches a player (no-block or mistime), a ring overflows, a parry reflects onto an extinguished attacking ring, or via status effect damage
- When all hearts are gone that player loses the duel
- Hearts reset between duels

### 5.9 Post-Battle Loadout Management
After winning a duel:
1. The player receives the opponent's staked ring
2. The player must decide: keep the won ring in the loadout (replacing something) or send it directly to inventory
3. If keeping it: choose which loadout ring to send back to inventory — including exhausted rings
4. The player can then reorganize their 10-ring loadout freely — moving rings between dominant and off hand to prepare for the next encounter

After losing a duel:
1. The player's staked ring is forfeited to the opponent
2. A monster opponent also steals one random ring from the player's full inventory (not just the loadout)
3. An NPC opponent only takes the staked ring

### 5.10 Monster Encounters
- Monsters always initiate encounters in the overworld
- The player can **flee** before formally agreeing to duel — always free, no penalty
- Once a duel is formally agreed, fleeing is not possible
- If a monster wins it **steals a random ring from the player's full inventory** and flees
- If a monster loses it **drops a ring as loot** and flees — outside the staking system
- A monster that has stolen your ring is now carrying it in the world — it can be tracked down and won back
- Monsters **respawn on a real-time or in-game day cycle**; named/boss monsters do not respawn

---

## 6. Status Effects

Status effects are managed through persistent **element gauges** — one per base element per player. The gauge model replaces the rolling-window combo system used in earlier drafts.

### 6.1 Gauge Mechanics

Each player maintains five status gauges — one per base element: Fire, Water, Earth, Wind, Wood. All gauges start at 0 and floor at 0.

**Gauge changes per battle exchange:**
- **Heart lost** (no-block, mistime, or weak-block overflow): +1 per base element component of the attacking ring, added to the defender's matching gauges.

Successful blocks and parries — including intermediate rally volleys — do not move gauges. A rally that terminates in a heart loss emits one gauge delta on the terminating volley only.

**Implementation (Phase 1 hook):** Gauge deltas are emitted by `BattleManager` via `EventBus.status_gauge_delta(player_id, components, delta)` — the payloads above are produced now (no consumer until Phase 4). Concretely: no-block / mistime → +1 on the defender; heart loss → +1 on the defender. Parry/rally continuation volleys emit no gauge delta.

**Fusion ring decomposition:**
A fused ring contributes to gauges based on its full recursive decomposition into base elements.

| Ring | Base Decomposition | Gauge Contribution per Strong Hit |
|---|---|---|
| Lightning | Fire + Fire | Fire ×2 |
| Ice | Water + Water | Water ×2 |
| Metal | Earth + Earth | Earth ×2 |
| Storm | Wind + Wind | Wind ×2 |
| Nature/Bloom | Wood + Wood | Wood ×2 |
| Mud | Water + Earth | Water ×1, Earth ×1 |
| Lava | Fire + Earth | Fire ×1, Earth ×1 |
| Ash | Fire + Wood | Fire ×1, Wood ×1 |
| Steam | Water + Fire | Water ×1, Fire ×1 |
| Frost | Ice + Wind (= Water + Water + Wind) | Water ×2, Wind ×1 |
| Magma | Fire + Metal (= Fire + Earth + Earth) | Fire ×1, Earth ×2 |
| Obsidian | Fire + Earth + Water | Fire ×1, Earth ×1, Water ×1 |

A perfect counter against a fused ring decrements those same gauges by the same amounts.

**Status threshold:** Default **4**. The threshold scales upward with player experience and augmentations in late-game progression (formula TBD).

- Gauge ≥ threshold → status is **active** and persists
- Gauge drops below threshold → status ends, but the attacker can always rebuild it
- Gauges have a soft cap at **2× threshold** to keep HUD numbers readable

### 6.2 Base Element Statuses

| Element | Status | Effect | How to Reduce Gauge |
|---|---|---|---|
| Fire | Burning | Lose 1 full heart per turn | Defend with Water |
| Water | Drowning | All ring **attacks** cost +1 use | Defend with Wind |
| Earth | Petrified | All ring **defenses** cost +1 use | Defend with Wood |
| Wind | Scattered | Your attacks always resolve neutral — no strong hits | Defend with Earth |
| Wood | Entangled | Highest-uses ring in your battle hand loses 1 use at the start of each turn | Defend with Fire |

Each status is independent — multiple can be active simultaneously and stack their effects.

### 6.3 Shadow Status (Unique)

Shadow operates outside the gauge system.

- Any connecting Shadow attack has a **25% chance** to inflict **Cursed**
- **Cursed:** the target's highest XP ring loses half its remaining uses for the entire battle
- Cannot be cured; does not interact with gauges

---

## 7. Player Progression

### 7.1 Player XP
- Player XP = **aggregate XP of all rings currently in the player's possession**
- Rings earn XP through use in battle
- Losing a ring through staking permanently reduces player XP
- Winning a staked ring from an opponent permanently increases player XP

### 7.2 World Access Gating
- Higher player XP unlocks new areas of the overworld
- Losing significant XP through staking can **revoke access** to areas previously unlocked
- This creates genuine long-term stakes beyond any individual duel

### 7.3 Inventory Expansion
- Starting cap: 10 rings
- Expanded through gameplay milestones — buying, finding, or sacrificing
- Hard cap: 99 rings
- A wide inventory is a genuine competitive advantage due to the recharge timer — a player with 40 leveled rings across all elements can keep dueling while a player with 10 perfect rings must rest

---

## 8. Staking Economy

### 8.1 Core Rules
- Every duel requires both players to **stake a ring** before the duel begins
- The staked ring does not have to be one of the 5 battle rings or even in the loadout — it can be any ring in the player's possession
- The staked ring is held in escrow for the duration of the duel
- **Loser forfeits their staked ring and all XP associated with it**
- **Winner receives the staked ring and its full XP**

### 8.2 Changing the Staked Ring
- The staked ring can be changed **freely at any time in the overworld**
- Once the player enters **detection range of an enemy**, the staked ring locks in for that encounter
- The lock releases if the player flees or moves out of detection range without dueling
- This prevents last-second stake-swapping once an opponent has already evaluated the offer

### 8.3 The Stake Jewelry System
The staked ring is worn on the body — not on the fingers. Its position determines which passive buff it provides during battle. The position is visible to both players from detection range, adding a strategic information layer to the pre-duel approach.

**Dominant Hand Bracelet — Elemental Aura (Offensive)**
- The staked ring's element provides a passive bonus to all rings of the same element in the battle hand
- Effect: Same-element battle rings gain +1 use at the start of the duel (scales with staked ring's XP tier)
- Cost: The staked ring loses 1 use per battle
- Posture signal: Aggressive — loaded with one element, looking to overwhelm

**Off Hand Bracelet — Defensive Ward (Defensive)**
- The staked ring absorbs the first heart damage the player would take in the duel
- Effect: First heart loss is negated; the staked ring loses 1 use instead
- When the staked ring is extinguished the ward is gone
- Cost: The staked ring loses 1 use per battle and loses 1 additional use when the ward triggers
- Posture signal: Defensive — protecting hearts, waiting for the opponent to exhaust themselves

**Necklace — Recharge Pulse (Resilient)**
- The staked ring activates once per battle when the player is losing (more hearts lost than the opponent)
- Effect: The most exhausted ring in the battle hand is fully recharged
- A visible pulse effect signals to both players that the comeback mechanic has fired
- Cost: The staked ring loses 1 use per battle and 1 additional use when the pulse triggers
- Posture signal: Resilient — dangerous when down, built for attrition

### 8.4 Staked Ring XP
- The staked ring earns passive XP through its use-per-battle cost even if it never fights directly
- A ring used as a permanent stake slowly levels up through its passive role
- Higher XP stakes provide stronger buffs — a maxed Tier 2 staked ring provides noticeably more than a Tier 1
- This creates a reason to stake high-value rings even at personal risk

### 8.5 Natural Self-Regulation
No artificial matchmaking is needed. The economy self-regulates:
- Experienced players won't challenge weak players — winning a low-XP ring wastes a valuable inventory slot
- Weak players won't challenge strong players — staking a good ring is too risky
- Players naturally gravitate toward dueling others in a similar XP band
- The staked ring's jewelry position adds a bluffing layer — wearing your stake on the dominant hand to signal aggression when you plan to play defensively

---

## 9. Overworld

### 9.1 Visual Style
- Top-down isometric perspective
- Reference: *The Legend of Zelda: A Link to the Past*
- Engine: Godot 4.x with built-in TileMap and isometric support

### 9.2 Biomes
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

### 9.3 Detection and Approach
- When the player gets within a certain distance of an enemy both parties begin to see each other's information
- **Visible from detection range:** element types in loadout, hearts, aggregate uses per element type, staked ring jewelry position
- As both parties continue to approach they can **formally agree to duel**
- The player can always turn back and flee before formally agreeing — no penalty
- Once formally agreed the duel begins and the 5 battle ring selection screen appears

### 9.4 NPC Categories

| Category | Behavior | Stakes | Notes |
|---|---|---|---|
| Quest Givers | Send player on missions; not duelable mid-quest | N/A | Primary narrative drivers |
| Duelist NPCs | Actively seek duels; approach player | Pre-set stake ring | Wandering merchants, arena challengers, collectors |
| Passive Villagers | Can be challenged; do not initiate | Low-value rings | Good for early grinding; diminishing returns for veterans |
| Monsters | Always initiate; player can flee | Drop ring on loss; steal ring on win | Respawn on day cycle; named monsters do not |
| Boss NPCs | Fixed locations; high XP; unique rings | Rare/unique rings | Primary unlock mechanism for rare fusions and world areas |

### 9.5 NPC Personality Types
NPCs should feel like distinct opponents, not just difficulty levels:
- **Aggressive** — opens with strongest ring, burns through uses fast, likely wearing stake on dominant hand bracelet
- **Defensive** — holds strong rings in reserve, tries to exhaust player uses, likely wearing stake on off hand bracelet
- **Bluffing** — deliberately misleads with element positioning and jewelry position
- **Status-hunter** — builds methodically toward status effect triggers
- **Resilient** — likely wearing stake as necklace, dangerous when low on hearts

### 9.6 Key Locations

| Location | Purpose |
|---|---|
| Player Camp | Sleep to advance game day and fully recharge all rings; pay gold to recharge immediately; full inventory access |
| Shrines | One per fusion recipe; discovered via shrine maps dropped by fusion-type enemies |
| Merchant Areas | Buy/sell rings and fusion stones |
| Dark/Underground Areas | Shadow ring drop locations; high risk, unpredictable opposition |
| Boss Arenas | Fixed high-XP encounters; unique ring rewards; may gate world regions |

---

## 10. UI and Information Display

### 10.1 Overworld Detection HUD
When within detection range of an enemy, both parties see:
- Opponent's **element types** in loadout (base element view; fused rings show as both component elements)
- Opponent's **hearts**
- Opponent's **aggregate uses per base element type**
- Opponent's **staked ring jewelry position** (dominant hand bracelet / off hand bracelet / necklace)

### 10.2 Battle HUD
During a duel, both players see for each opponent:
- **Hearts remaining**
- **Element types** in battle hand (same fused ring display rule as overworld)
- **Aggregate uses per base element type** — updated in real time

**Fused ring display rule:** A Mud ring (Water + Earth) adds its uses to both the Water and Earth counters. This creates deliberate ambiguity — the opponent knows elemental exposure but cannot cleanly reverse-engineer ring configuration.

**Example:** Player has a Mud ring (5 uses) and a separate Water ring (3 uses).
- Water shows: 8 uses
- Earth shows: 5 uses
The opponent knows Water and Earth are present but must infer whether that's one Mud ring, two separate rings, or both.

### 10.3 Ring Reveal
The attack is **telegraphed before the defender commits**: when the attacker throws, the attacking ring's base-element color(s) travel across the screen toward the defender (fused rings show all component colors). The defender therefore sees the attacker's element identity — revealed by the orb color crossing the screen — *before* choosing a ring. The exact ring identity — including whether it is a fused ring and its specific tier — becomes fully visible to both players at the moment the block resolves.

### 10.4 Extinguished Ring Visibility
When a ring is extinguished during battle the use count for that element type drops to 0 and the element icon becomes inactive in the HUD. Both players can see exactly which element types are exhausted.

### 10.5 Status Effect Display
Active status effects are shown in the battle HUD alongside the affected player's hearts. The status name, icon, and remaining duration (in turns) are visible to both players.

### 10.6 Necklace Pulse Visual
When the Recharge Pulse triggers (necklace stake position, player is losing), a visible elemental pulse effect plays — color matching the staked ring's element. Both players see this. It signals that a ring was just recharged, changing the opponent's calculus going forward.

---

## 11. Build Sequence for Claude Code

Build in phases so the game is playable at each stage before moving to the next. Each prompt below is designed to be copy-pasted into Claude Code as the opening instruction for that phase.

### Phase 1 — Battle Engine (Start Here)
> **Note (v2.2):** The battle model was changed to the **active timed-block** system — see §5.3–5.7. The authoritative implementation spec now lives in GitHub issue #11. The original simultaneous-secret prompt below is retained for historical context only.

> "Build a standalone battle scene in Godot 4.x for a game called Elemental Rings. Two players face off in a turn-based duel. Each player has 5 ring slots representing their dominant hand battle rings. Each ring has an element type chosen from: Fire, Water, Earth, Wind, Wood — and a use count (Tier 1 default = 3 uses). On each turn the attacker picks a ring to attack with and the defender picks a ring to block with. Implement the damage rules: if the attacker's element beats the defender's element the defender's ring costs 2 uses; if the defender's element beats the attacker's element the attacker's ring costs 2 uses; otherwise both cost 1 use (neutral). Implement neutral block rules: first neutral in a duel both rings cost 1 use only; second neutral both rings cost 1 use and both players lose a heart. If a ring reaches 0 uses it is extinguished and cannot be used for the rest of the duel. If a defending ring is extinguished by an attack the attack goes through and the defender loses a heart. Each player starts with 3 hearts. The player who loses all hearts loses the duel. Include a HUD showing each player's hearts, element type icons, and use count per element updated in real time."

### Phase 2 — Ring Inventory and Loadout System
> "Add a full ring management system to Elemental Rings in Godot 4.x. Rings have: element type, current uses, max uses (tier-based: Tier 1 = 3, Tier 2 = 5, Tier 3 = 7), current XP, XP cap (Tier 1 = 100, Tier 2 = 300, Tier 3 = 800), and tier. The player has a full inventory (starting cap 10, expandable to 99). When leaving camp the player selects a 10-ring loadout split into a dominant hand (5 rings) and off hand (5 rings). Before each duel the player selects which 5 rings from their loadout go into the battle hand. Implement the off hand passive recharge: whenever a dominant hand ring is used in battle the most exhausted off hand ring recovers 1 use. Implement the neutral recharge bonus: on a neutral block the most exhausted off hand ring is fully recharged. Add a post-battle screen where the player can reorganize their loadout and optionally keep a won ring by sending a loadout ring back to inventory. Add an XP gain system: rings earn XP based on how many times they were used in the last duel. Add a camp scene where sleeping advances the game day and fully recharges all rings (Tier 1 instant, Tier 2+ require one full day)."

### Phase 3 — Staking System and Jewelry Positions
> "Add the staking system to Elemental Rings in Godot 4.x. Before each duel both players select a staked ring from their full inventory and choose a jewelry position: dominant hand bracelet, off hand bracelet, or necklace. Dominant hand bracelet — Elemental Aura: same-element battle rings gain +1 use at duel start; staked ring loses 1 use per battle. Off hand bracelet — Defensive Ward: first heart damage is negated and staked ring loses 1 use instead; staked ring also loses 1 use per battle. Necklace — Recharge Pulse: once per battle when the player has more hearts lost than the opponent, the most exhausted battle ring is fully recharged and a visual pulse plays; staked ring loses 1 use per battle and 1 additional use on trigger. The staked ring's jewelry position must be visible in the overworld detection HUD. On duel loss the loser's staked ring (with all its XP) transfers to the winner. The staked ring cannot be changed once the player enters detection range of an enemy."

### Phase 4 — Status Effects (Gauge System)
> "Add the status effect gauge system to the Elemental Rings battle in Godot 4.x. Each player has five persistent gauges — Fire, Water, Earth, Wind, Wood — starting at 0 with a default threshold of 4 and a soft cap at 8. On every battle exchange: if the attacker scores a strong hit, increment each base element component of their ring by 1 on the defender's matching gauges; if the defender scores a perfect counter, decrement those same gauges by 1; on a neutral block, no gauge change. Fused rings decompose recursively to base elements (Lightning = Fire ×2, Mud = Water ×1 + Earth ×1, Frost = Water ×2 + Wind ×1, Obsidian = Fire ×1 + Earth ×1 + Water ×1). When a gauge reaches threshold, apply the corresponding status: Burning (Fire) — lose 1 full heart per turn; Drowning (Water) — all attacks cost +1 use; Petrified (Earth) — all defenses cost +1 use; Scattered (Wind) — attacks always resolve neutral (no strong hits); Entangled (Wood) — highest-uses ring in battle hand loses 1 use per turn. Statuses are independent and stack. When a gauge drops below threshold, the status ends but can be rebuilt by the attacker. Add Shadow as a separate passive outside the gauge system: 25% chance per connecting Shadow hit to inflict Cursed (target's highest XP ring loses half its remaining uses for the rest of the duel, cannot be cured). Display all five gauges with current values and threshold in the battle HUD for both players, alongside active status icons."

### Phase 5 — Fusion System
> "Add ring fusion to Elemental Rings in Godot 4.x. Fusion rules: both parent rings must be maxed at their XP cap. The fused ring inherits the combined XP of both parents. The fused ring uses reset to the full max uses of the new tier. Fusion can only be performed at a shrine scene in the overworld. Gate each fusion behind a recipe unlock flag (discovered = true/false). Implement these recipes: Fire + Fire = Lightning, Water + Water = Ice, Earth + Earth = Metal, Wind + Wind = Storm, Wood + Wood = Nature, Water + Earth = Mud, Fire + Earth = Lava, Fire + Wood = Ash, Water + Fire = Steam, Ice + Wind = Frost, Fire + Metal = Magma. In the battle HUD fused rings display as both their component base elements — a Mud ring adds its uses to both Water and Earth counters in the aggregate display."

### Phase 6 — NPC Battle AI
> "Add NPC opponents to Elemental Rings in Godot 4.x. Each NPC has a predefined ring loadout, a staked ring with a jewelry position, and a personality type: Aggressive (prioritizes strongest ring, attack-forward, prefers dominant hand bracelet stake), Defensive (holds strong rings in reserve, tries to exhaust player uses, prefers off hand bracelet stake), Status-hunter (builds methodically toward status effect triggers), Resilient (prefers necklace stake, activates comeback mechanics deliberately). NPCs are aware of the element display information available to both players and make decisions based on visible opponent data. Monster NPCs steal one random inventory ring on win and drop a ring as loot on loss. NPC duelists stake a ring and award it to the player on loss. First encounter of a fusion-type NPC drops the shrine map for that fusion recipe."

### Phase 7 — Overworld
> "Build an isometric top-down overworld for Elemental Rings in Godot 4.x in the visual style of Zelda: A Link to the Past. Use Godot's TileMap with isometric tiles and placeholder art. Include: player movement with collision detection, at least two distinct biomes (Forest as starter biome, Swamp as second), experience-gated region transitions, NPC and monster placement with detection radius triggers, a camp location where the player can sleep to recharge rings and manage inventory, shrine locations for fusion, and underground cave areas for Shadow ring drops. When the player enters an enemy's detection radius both parties' overworld HUDs activate showing element types, hearts, aggregate uses, and staked ring jewelry position. The player can turn back to flee before formally agreeing to duel."

---

## 12. Open Questions

Items flagged for future design sessions:

- Full element relationship web — all matchups documented for all 11 named elements
- Ring passive and active abilities unlocked at XP milestones
- Exact heart count per duel (3 or 5?)
- Exact catalyst (fusion stone) costs per tier
- Tier 4 triple fusion full details
- NPC personality tuning and difficulty progression curve
- Inventory expansion milestones and exact costs
- Shadow ring drop rate and underground area density
- Whether heavily depleted rings take two game days to recharge (vs always one)
- Recharge timer for rings sitting in inventory while player is in the field
- Monster respawn cycle — real time vs in-game day cycle
- Named/boss monster design and unique ring rewards
- Environmental passives per biome — flagged for a later design pass
- Game name — "Elemental Rings" is a working title
- Art asset sourcing strategy (itch.io isometric packs recommended as starting point)
- Nature/Bloom fusion — final name TBD
- Whether monster stolen rings retain their specific position in the world (trackable) or just re-enter the monster loot pool
- Status gauge threshold scaling formula with player XP and augmentations
- Whether the gauge soft cap at 2× threshold is the right ceiling
- Playtesting tune for status severity now that gauges persist indefinitely (Burning at 1 full heart/turn especially)

---

*Document version 2.2 — Updated May 2026*
*v2.2 changes: Replaced the simultaneous-secret turn model (§5.3) with the **active timed-block** model — the attacker throws (telegraphed by base-element color) and the defender must pick the correct ring AND time the block. Rewrote §5.4 around two axes (timing: parry/block/mistime/no-block; element: strong/neutral/weak), with the attacker paying 1 to throw and a parry adding a reflect onto the attacker's thrown ring. Updated §5.5 (timed neutral block), §5.7 (reflect overflow on the attacker), §5.8 (heart-loss sources), §6.1 (gauge deltas for unblocked hits and reflect overflow), §10.3 (attack telegraphed before defense). Authoritative implementation spec: GitHub issue #11.*

*Document version 2.1 — Updated May 2026*
*v2.1 changes: Simplified §5.5 neutral block rules (removed first/second neutral distinction and the neutral recharge bonus). Rewrote §6 from rolling-window combo system to persistent gauge model — gauges change ±1 per base element component on strong hits / perfect counters, neutrals don't move gauges. Replaced restrictive status effects (Petrified, Scattered, Entangled) with attrition-based effects that never restrict ring choice. Eliminated separate fusion statuses (§6.2) — fused rings now decompose recursively to base elements (Lightning = Fire ×2, Frost = Water ×2 + Wind ×1, etc). Burning now deals 1 full heart per turn. Updated Phase 4 build prompt accordingly.*

*Document version 2.0 — Updated May 2026*
*v2.0 changes: Loadout system, dominant/off hand split, post-battle ring management, recharge timer, biomes, monster flee/steal mechanics, detection and approach system, staking jewelry position system (bracelet dominant / bracelet off / necklace), neutral recharge bonus, off hand passive recharge drip, staked ring XP, full NPC category breakdown, expanded Claude Code build prompts*
