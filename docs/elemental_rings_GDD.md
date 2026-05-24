# Elemental Rings — Game Design Document
**Version 3.1 | Stack: Phaser.js + Colyseus | Multiplayer-first**

---

## Table of Contents
1. [Game Overview](#1-game-overview)
2. [Tech Stack & Architecture](#2-tech-stack--architecture)
3. [Element System](#3-element-system)
4. [Ring System](#4-ring-system)
5. [Fusion System](#5-fusion-system)
6. [Battle System](#6-battle-system)
7. [Status Effects](#7-status-effects)
8. [Player Progression](#8-player-progression)
9. [Staking Economy](#9-staking-economy)
10. [Overworld](#10-overworld)
11. [UI and Information Display](#11-ui-and-information-display)
12. [Build Sequence for Claude Code](#12-build-sequence-for-claude-code)
13. [Open Questions](#13-open-questions)

---

## 1. Game Overview

**Elemental Rings** is a multiplayer browser-based top-down RPG (Zelda: A Link to the Past visual style). The core gameplay loop is a turn-based duel system built on rock-paper-scissors elemental logic, layered with resource management, bluffing, ring progression, and a staking economy. Players battle each other in real time or fight AI opponents — all from a web browser with no installation required.

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

## 2. Tech Stack & Architecture

### 2.1 Stack Overview

| Layer | Technology | Role |
|---|---|---|
| **Client** | Phaser.js (TypeScript) | Browser canvas rendering, input handling, animation |
| **Server** | Colyseus (Node.js + TypeScript) | Authoritative game state, battle logic, matchmaking |
| **Testing** | Playwright | Browser-driven E2E tests — presses real keys at real timings |
| **Dev server** | Vite | Hot-reload dev server for the Phaser client |
| **Deployment** | game-da-god (192.168.4.140) | LAN-accessible Colyseus server + static Phaser client |
| **Mobile** | Capacitor | Wraps Phaser as a native iOS/Android app |
| **Desktop/Steam** | Electron + Greenworks | Wraps Phaser as a native desktop app for Steam distribution |

### 2.2 Architecture Principle: Server is Authoritative

All game logic — the battle state machine, BlockResolver, ElementSystem, timing classification, rally chain, gauge updates — runs **on the Colyseus server**. Clients are dumb renderers:

```
Browser (Phaser)                   Colyseus server (game-da-god)
─────────────────                  ──────────────────────────────
Player presses key 2     →  WS     BattleRoom receives move
                                   Server resolves exchange
                                   Server validates timing
                                   Server computes relationship
                                   Server advances state machine
Render orb + outcome     ←  WS     Server broadcasts new state
```

Neither client can cheat timing, spoof element matchups, or manipulate rally state — the server has the only copy of truth.

### 2.3 Multiplayer Modes

| Mode | Description |
|---|---|
| **Human vs Human (LAN)** | Two devices on the home network, Phase 1 target |
| **Human vs Human (online)** | Port-forward game-da-god or move Colyseus to a VPS |
| **Human vs NPC** | AI opponent runs as a server-side bot in the same BattleRoom |
| **Spectate** | Any connected client can observe an ongoing room (future) |

### 2.4 Development Workflow

During development everything runs on **small-boss** — both the Colyseus server and the Vite dev server. Production deployment pushes the server to game-da-god as a systemd service (same pattern as existing MCP services). Any device on the LAN opens `http://192.168.4.140:8080` in a browser to play.

### 2.5 Testing Philosophy

Because the client runs in a real browser, **Playwright can simulate actual gameplay** — press a key at a specific time, wait for the orb animation, assert on DOM state, read game state from JavaScript. This replaces headless Godot testing and gives genuine end-to-end coverage of the full stack including timing-sensitive input.

---

## 3. Element System

### 3.1 The Five Base Elements
All elements in the game derive from five base elements. These are the only elements shown in simplified UI views.

| Element | Symbol |
|---|---|
| Fire | 🔥 |
| Water | 💧 |
| Earth | 🪨 |
| Wind | 🌪 |
| Wood | 🌿 |

### 3.2 Base Element Relationships

| Attacker | Beats | Loses To |
|---|---|---|
| Fire | Wood | Water |
| Water | Fire | Wind |
| Wood | Earth | Fire |
| Earth | Wind | Wood |
| Wind | Water | Earth |

### 3.3 Derived Elements (Tier 2 Fusions)

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

### 3.4 Triple Fusions (Tier 3 — Rare)

| Fusion Name | Components | Beats | Loses To |
|---|---|---|---|
| Obsidian | Fire + Earth + Water | Most elements | Storm, Lava |

### 3.5 Shadow (Special Case)
Shadow is the only element that cannot be fused or crafted from base elements. It exists outside the normal system.

- **How to obtain:** Rare drop only, found in dark/underground areas of the overworld
- **No fusion recipe exists** for Shadow
- **Cannot be upgraded** via same-element fusion
- **Thematic identity:** Uncanny, unpredictable, a mystery the lore can explore

**Shadow relationships:**
- Beats: Lightning, Wind
- Loses to: Fire, Earth
- **Passive ability:** Every Shadow attack has a 25% chance to inflict Cursed regardless of the element matchup (see Section 7)

---

## 4. Ring System

### 4.1 Inventory
- **Starting inventory cap:** 10 rings (one per finger — thematic starting point)
- **Maximum inventory cap:** 99 rings
- **Inventory expansion:** Unlocked through buying, finding, or sacrificing rings/experience over time
- Rings sitting in inventory recharge on the game day timer even while the player is in the field

### 4.2 Ring Tiers and Stats

| Tier | Description | Max Uses | XP Cap |
|---|---|---|---|
| 1 | Base element rings — found easily | 3 | 100 |
| 2 | Two-element fusions | 5 | 300 |
| 3 | Advanced fusions (two Tier 2 parents) | 7 | 800 |
| 4 | Triple fusions — extremely rare | TBD | TBD |

### 4.3 Ring Uses
- Uses are consumed during battle (attacking and defending)
- **Uses are NOT permanently lost.** All rings fully recharge after one game day
- A game day advances when the player sleeps at camp — the player controls the pace
- Rings can be recharged immediately by paying gold/currency at camp (not fusion stones — keep those scarce)
- **Tier 1 rings recharge instantly or in half a day** — common rings are never a bottleneck
- **Tier 2 and above require a full game day** to recharge
- Heavily depleted rings (more than half their uses spent) may require two full game days — TBD on tuning
- If a ring is extinguished mid-battle (uses reach 0) it cannot be used for the rest of that duel

### 4.4 Ring XP
- Rings earn XP through use in battle — more uses in a duel = more XP for that ring
- XP is permanent and carries through fusion
- Losing a ring via staking means losing all XP associated with it
- The staked ring earns passive XP through the use-per-battle cost of its buff (see Section 9)

### 4.5 Ring Abilities
- Rings unlock passive and active abilities as they accumulate XP
- Ability design: *flagged for future design session*

---

## 5. Fusion System

### 5.1 Core Rules
- Fusion can only happen **in the overworld at a specific shrine** — never during a duel
- Both parent rings must be **maxed out** at their tier's XP cap before fusion is possible
- The fused ring **inherits XP** from both parent rings (XP is additive)
- The fused ring's uses **reset to the full max uses of the new tier** regardless of parent rings' remaining uses
- Fusing is a long-term gain (higher tier, more uses, more power) but a short-term cost (uses reset, must recharge)

### 5.2 Same-Element Upgrade Paths

| Input | Output | Thematic Logic |
|---|---|---|
| Fire + Fire | Lightning | Heat becomes electrical energy |
| Water + Water | Ice | Concentrated, stilled water |
| Earth + Earth | Metal | Compressed, refined earth |
| Wind + Wind | Storm | Air pressure concentrated into force |
| Wood + Wood | Nature/Bloom | Life energy distilled |

### 5.3 Cross-Element Fusion Paths

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

### 5.4 Fusion Unlock Mechanism (Discovery + Cost Hybrid)

Fusions are **discovered through gameplay**, then **executed with a resource cost** at a shrine.

**Step 1 — Discovery:**
The player encounters an NPC or monster using a fusion-type ring for the first time (e.g. a Mud-ring monster in the swamp). Defeating them reveals a map to the relevant shrine (e.g. the Mud Shrine).

**Step 2 — Shrine Access:**
The shrine is located in the overworld, often in an experience-gated region. The player must have sufficient player XP to reach the area.

**Step 3 — Fusion Execution:**
At the shrine the player combines two maxed parent rings. A catalyst cost (fusion stones found through exploration) is required for standard Tier 2 fusions. Ring sacrifice is reserved only for the rarest Tier 4 fusions.

### 5.5 Fusion Cost Summary

| Tier | Cost |
|---|---|
| Tier 2 (standard fusion) | Two maxed Tier 1 rings + fusion stones |
| Tier 3 (advanced fusion) | Two maxed Tier 2 rings + fusion stones (more) |
| Tier 4 (triple fusion) | Three maxed Tier 2 rings OR one Tier 3 + components + ring sacrifice |

---

## 6. Battle System

### 6.1 The Loadout System

The player manages three layers of ring access:

| Layer | Size | When Chosen |
|---|---|---|
| Full Inventory | Up to 99 rings | Managed at camp |
| Field Loadout | 10 rings | Chosen when leaving camp |
| Battle Hand | 5 rings | Chosen just before a duel begins |

**Dominant Hand (5 rings):** The active battle hand. These rings are used for attacking and defending in duels.

**Off Hand (5 rings):** The reserve hand. These rings recover 1 use whenever a dominant hand ring is used in battle (passive recharge drip). Off hand rings can be swapped into the dominant hand between battles.

**Choosing the loadout:** The player selects which 10 rings to carry based on the biome they're entering and the opponents they expect to face. This is the primary strategic decision made at camp.

### 6.2 Pre-Duel Setup
- Each player selects **5 battle rings** from their 10-ring loadout
- Each player confirms their **staked ring** and its **jewelry position** (see Section 9)
- Both players can see each other's element types, hearts, and aggregate uses from detection range before committing
- Once both players formally agree to duel, the battle begins

### 6.3 Turn Structure (Active Timed Block)
Combat is an **active, reaction-timed** exchange — not a hidden simultaneous selection. On each turn:
1. The **attacker** selects which ring to attack with using a single keypress (1–5) and "throws" it. The attack costs the attacker **1 use** up front, regardless of the outcome.
2. The attack is **telegraphed**: the attacking ring's base-element color(s) travel across the screen toward the defender. Fused rings show all of their component colors (e.g. a Mud ring shows blue + brown).
3. The **defender** must choose the correct ring AND time the block — a single keypress (1–5) that must land within the timing window as the incoming attack arrives.
4. The block is resolved on two independent axes — **timing** (parry / block / mistime / no-block) and **element** (strong / neutral / weak). See §6.4.
5. Roles swap — the defender becomes the attacker next turn.

Because the defender sees the incoming element before committing, there is no simultaneous hidden selection. Bluffing lives in the loadout, stake, and jewelry layers (§9), not in the turn itself.

### 6.4 Damage Rules
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

### Block Resolution Table

| Timing | Relationship | Defender ♥ | Defender Uses | Gauge (+1 for attacker's element) | Rally |
|--------|-------------|:-----------:|:-------------:|:---------------------------------:|:-----:|
| **No-block** | — | −1 | 0 | ✓ | — |
| **Mistime** | — | −1 | −1 | ✓ | — |
| **Block** | Neutral | 0 | −1 | — | — |
| **Block** | Strong | 0 | −1 | — | — |
| **Block** | Weak | −1 | −1 | — | — |
| **Parry** | Neutral | 0 | −1 | — | — |
| **Parry** | Strong | 0 | −1 | — | ✓ |
| **Parry** | Weak | −1 | −1 | — | — |

*Attacker always pays −1 use on throw. Gauge = defender's gauge for the attacking ring's element.*

**Compact form (original):**

| Timing ↓ / Element → | Strong | Neutral | Weak |
|---|---|---|---|
| **No-block** | −1 heart; defender ring spends **0** uses; **+gauge** | same | same |
| **Mistime** | −1 heart; attempted ring spends **1** use; **+gauge** | same | same |
| **Block** | safe; ring −1 use; no rally | safe; ring −1 use | ring −1 use; **−1 heart**; no gauge |
| **Parry** | safe; ring −1 use; **rally** (below) | safe; ring −1 use | ring −1 use; **−1 heart**; no gauge |

**A caught attack always costs exactly 1 use.** Whether you press block or parry, and whatever your element, committing a ring to a successful catch spends one use — no more. The element relationship then decides the consequence: a **strong** or **neutral** catch is fully safe, while a **weak** catch means your ring absorbed the blow but couldn't deflect it — you keep the ring (minus its one use) but still take **1 heart**. Weak is not an overflow mechanic; it is a flat heart cost for catching with the wrong element.

On the two failure rows (**no-block**, **mistime**) the element axis is irrelevant — timing failed and the attack lands uncontested. **No-block** is a deliberate sacrifice (save the ring use, take a heart); **mistime** is the punished attempt (lose a heart AND burn the attempted ring's use; a ring drained to exactly 0 this way is extinguished, no extra heart).

**Gauge only fills on an uncontested hit.** No-block and mistime let the attack land, so the defender's matching element gauge increases (§7). A weak catch loses a heart but the attack *was* caught — so it moves **no gauge**. Heart loss and gauge gain are independent: weak = heart but no gauge; no-block/mistime = heart and gauge.

**Rally (Parry + Strong = active counter).** Instead of an automatic reflect, the exchange continues as an interactive volley chain:

1. The original attacker becomes the new **rally-defender**; the parrying player becomes the **rally-attacker**.
2. The **volleyed element is the parrying ring's base element** (not the original thrown element). Example: defender parries FIRE with WATER → a WATER counter flies back.
3. A new 0.9 s telegraph plays for the volleyed element and the rally-defender must respond exactly as in a normal defend window (no-block / block / parry-strong).
4. If the rally-defender **parries-strong** with the next pentagon element they become the rally-attacker and the chain continues, walking the pentagon: FIRE → WATER → WIND → EARTH → WOOD → FIRE → …
5. Any other response ends the rally and resolves normally under the standard outcome table:
   - **No-block** → rally-defender loses 1 heart (+gauge); rally ends.
   - **Block/parry (neutral)** → safe; ring −1 use; rally ends.
   - **Block/parry (weak)** → ring −1 use; −1 heart (no gauge); rally ends.
   - **Mistime** → rally-defender loses 1 heart + 1 ring use (+gauge); rally ends.

**Cost symmetry:** the floor cost is identical to the old auto-reflect. Attacker throws (−1 use) → defender parries strong (−1 use) → rally-defender neutral-blocks (−1 use) = attacker −2 / defender −1. The rally adds optional escalation above that floor.

**Ring depletion naturally caps rally depth.** Each parry spends a ring use; a ring at 0 uses cannot parry. The rally walk also requires the specific next-pentagon element with uses remaining.

A strong element with only **Block** timing is a safe block but forfeits the rally — the elemental advantage converts to a counter-volley only when you also win the tight parry window.

*The same logic applies to all element matchups across all tiers.*

### 6.5 Neutral Block Rules
A neutral block occurs when the defender blocks (timing = block or parry) with an element that has no relationship to the attack.

- The defender's ring spends 1 use; the attacker's thrown ring already spent its 1 use
- No heart damage
- No status gauge change — gauges only move on uncontested hits (no-block, mistime); a caught attack never moves a gauge (see §7)

Neutrals are pure attrition exchanges. A correctly-timed neutral block is always safe; the tension is whether to spend a use blocking or to no-block and take the heart to conserve it.

### 6.6 Off Hand Passive Recharge
- Whenever a dominant hand ring is used in battle (attack or defense), the **most exhausted ring on the off hand recovers 1 use**
- This rewards sustained fighting across multiple encounters
- Players should keep their most depleted rings on the off hand between fights to maximize recovery
- Managing which rings sit on which hand between encounters is a meaningful micro-decision

### 6.7 Extinguished Rings
- A ring is **extinguished** whenever its `current_uses` reaches 0 during a battle, regardless of which outcome drained it (throw, block cost, or weak-catch cost)
- Extinguishment itself never costs a heart — a ring simply becomes unusable at 0 uses
- Any heart loss is decided by the outcome table (§6.4), not by the ring reaching 0. A weak catch costs a heart because of the element mismatch, independent of whether that catch happened to drain the ring to 0
- Extinguished rings cannot be used for the rest of the duel
- The opponent can see which element types are exhausted from the HUD

### 6.8 Hearts
- Each player starts a duel with **3 hearts**
- Hearts are lost when an attack lands uncontested (no-block or mistime), on a weak catch (block or parry with an element the attack beats), or via status effect damage
- When all hearts are gone that player loses the duel
- Hearts reset between duels

### 6.9 Post-Battle Loadout Management
After winning a duel:
1. The player receives the opponent's staked ring
2. The player must decide: keep the won ring in the loadout (replacing something) or send it directly to inventory
3. If keeping it: choose which loadout ring to send back to inventory — including exhausted rings
4. The player can then reorganize their 10-ring loadout freely — moving rings between dominant and off hand to prepare for the next encounter

After losing a duel:
1. The player's staked ring is forfeited to the opponent
2. A monster opponent also steals one random ring from the player's full inventory (not just the loadout)
3. An NPC opponent only takes the staked ring

### 6.10 Monster Encounters
- Monsters always initiate encounters in the overworld
- The player can **flee** before formally agreeing to duel — always free, no penalty
- Once a duel is formally agreed, fleeing is not possible
- If a monster wins it **steals a random ring from the player's full inventory** and flees
- If a monster loses it **drops a ring as loot** and flees — outside the staking system
- A monster that has stolen your ring is now carrying it in the world — it can be tracked down and won back
- Monsters **respawn on a real-time or in-game day cycle**; named/boss monsters do not respawn

---

## 7. Status Effects

Status effects are managed through persistent **element gauges** — one per base element per player. The gauge model replaces the rolling-window combo system used in earlier drafts.

### 7.1 Gauge Mechanics

Each player maintains five status gauges — one per base element: Fire, Water, Earth, Wind, Wood. All gauges start at 0 and floor at 0.

**Gauge changes per battle exchange:**
- **Uncontested hit** (no-block or mistime): +1 per base element component of the attacking ring, added to the defender's matching gauges.

A gauge only moves when the attack lands uncontested. A **weak catch** loses a heart but the attack *was* caught, so it moves **no gauge** — heart loss and gauge gain are independent (see §6.4). Successful blocks and parries — including intermediate rally volleys — never move gauges. A rally that terminates in an uncontested hit emits one gauge delta on the terminating volley; a rally that terminates in a weak catch emits none.

**Server implementation:** Gauge deltas are computed by the Colyseus BattleRoom after each exchange. The `resolveBlock` result carries a `gaugeIncreases` flag — `true` only for no-block and mistime, `false` for any caught attack (neutral, strong, or weak). Gauges are broadcast to both clients as part of the state update.

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

A caught attack against a fused ring moves no gauge — the decomposition above applies only to uncontested hits.

**Status threshold:** Default **4**. The threshold scales upward with player experience and augmentations in late-game progression (formula TBD).

- Gauge ≥ threshold → status is **active** and persists
- Gauge drops below threshold → status ends, but the attacker can always rebuild it
- Gauges have a soft cap at **2× threshold** to keep HUD numbers readable

### 7.2 Base Element Statuses

| Element | Status | Effect | How to Reduce Gauge |
|---|---|---|---|
| Fire | Burning | Lose 1 full heart per turn | Defend with Water |
| Water | Drowning | All ring **attacks** cost +1 use | Defend with Wind |
| Earth | Petrified | All ring **defenses** cost +1 use | Defend with Wood |
| Wind | Scattered | Your attacks always resolve neutral — no strong hits | Defend with Earth |
| Wood | Entangled | Highest-uses ring in your battle hand loses 1 use at the start of each turn | Defend with Fire |

Each status is independent — multiple can be active simultaneously and stack their effects.

### 7.3 Shadow Status (Unique)

Shadow operates outside the gauge system.

- Any connecting Shadow attack has a **25% chance** to inflict **Cursed**
- **Cursed:** the target's highest XP ring loses half its remaining uses for the entire battle
- Cannot be cured; does not interact with gauges

---

## 8. Player Progression

### 8.1 Player XP
- Player XP = **aggregate XP of all rings currently in the player's possession**
- Rings earn XP through use in battle
- Losing a ring through staking permanently reduces player XP
- Winning a staked ring from an opponent permanently increases player XP

### 8.2 World Access Gating
- Higher player XP unlocks new areas of the overworld
- Losing significant XP through staking can **revoke access** to areas previously unlocked
- This creates genuine long-term stakes beyond any individual duel

### 8.3 Inventory Expansion
- Starting cap: 10 rings
- Expanded through gameplay milestones — buying, finding, or sacrificing
- Hard cap: 99 rings
- A wide inventory is a genuine competitive advantage due to the recharge timer — a player with 40 leveled rings across all elements can keep dueling while a player with 10 perfect rings must rest

---

## 9. Staking Economy

### 9.1 Core Rules
- Every duel requires both players to **stake a ring** before the duel begins
- The staked ring does not have to be one of the 5 battle rings or even in the loadout — it can be any ring in the player's possession
- The staked ring is held in escrow for the duration of the duel
- **Loser forfeits their staked ring and all XP associated with it**
- **Winner receives the staked ring and its full XP**

### 9.2 Changing the Staked Ring
- The staked ring can be changed **freely at any time in the overworld**
- Once the player enters **detection range of an enemy**, the staked ring locks in for that encounter
- The lock releases if the player flees or moves out of detection range without dueling
- This prevents last-second stake-swapping once an opponent has already evaluated the offer

### 9.3 The Stake Jewelry System
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

### 9.4 Staked Ring XP
- The staked ring earns passive XP through its use-per-battle cost even if it never fights directly
- A ring used as a permanent stake slowly levels up through its passive role
- Higher XP stakes provide stronger buffs — a maxed Tier 2 staked ring provides noticeably more than a Tier 1
- This creates a reason to stake high-value rings even at personal risk

### 9.5 Natural Self-Regulation
No artificial matchmaking is needed. The economy self-regulates:
- Experienced players won't challenge weak players — winning a low-XP ring wastes a valuable inventory slot
- Weak players won't challenge strong players — staking a good ring is too risky
- Players naturally gravitate toward dueling others in a similar XP band
- The staked ring's jewelry position adds a bluffing layer — wearing your stake on the dominant hand to signal aggression when you plan to play defensively

---

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

## 11. UI and Information Display

### 11.1 Overworld Detection HUD
When within detection range of an enemy, both parties see:
- Opponent's **element types** in loadout (base element view; fused rings show as both component elements)
- Opponent's **hearts**
- Opponent's **aggregate uses per base element type**
- Opponent's **staked ring jewelry position** (dominant hand bracelet / off hand bracelet / necklace)

### 11.2 Battle HUD
During a duel, both players see for each opponent:
- **Hearts remaining**
- **Element types** in battle hand (same fused ring display rule as overworld)
- **Aggregate uses per base element type** — updated in real time

**Fused ring display rule:** A Mud ring (Water + Earth) adds its uses to both the Water and Earth counters. This creates deliberate ambiguity — the opponent knows elemental exposure but cannot cleanly reverse-engineer ring configuration.

**Example:** Player has a Mud ring (5 uses) and a separate Water ring (3 uses).
- Water shows: 8 uses
- Earth shows: 5 uses
The opponent knows Water and Earth are present but must infer whether that's one Mud ring, two separate rings, or both.

### 11.3 Ring Reveal
The attack is **telegraphed before the defender commits**: when the attacker throws, the attacking ring's base-element color(s) travel across the screen toward the defender (fused rings show all component colors). The defender therefore sees the attacker's element identity — revealed by the orb color crossing the screen — *before* choosing a ring. The exact ring identity — including whether it is a fused ring and its specific tier — becomes fully visible to both players at the moment the block resolves.

### 11.4 Extinguished Ring Visibility
When a ring is extinguished during battle the use count for that element type drops to 0 and the element icon becomes inactive in the HUD. Both players can see exactly which element types are exhausted.

### 11.5 Status Effect Display
Active status effects are shown in the battle HUD alongside the affected player's hearts. The status name, icon, and remaining duration (in turns) are visible to both players.

### 11.6 Necklace Pulse Visual
When the Recharge Pulse triggers (necklace stake position, player is losing), a visible elemental pulse effect plays — color matching the staked ring's element. Both players see this. It signals that a ring was just recharged, changing the opponent's calculus going forward.

---

## 12. Build Sequence for Claude Code

Build in phases so the game is playable and testable at each stage before moving to the next. All phases use **Phaser.js (client) + Colyseus (server) + TypeScript**. Playwright provides E2E test coverage at each phase — actual browser interaction, real key presses, real timings.

### Phase 1 — Battle Core (Colyseus Server)

Build the authoritative Colyseus `BattleRoom` in TypeScript. All battle logic runs here: ElementSystem (pentagon matchup table), BlockResolver (timing classification, relationship, resolve), the state machine (attack-select → defend-window → resolve), and the rally chain (§6.4). No client yet — test with Vitest unit tests (ElementSystem, BlockResolver) and `@colyseus/testing` integration tests (two SDK clients driving real server exchanges). Deliverable: all timing classifications (PARRY / BLOCK / MISTIME / NO_BLOCK) and all element relationships produce correct outcomes across all 8 Block Resolution Table combinations; a full 3-heart KO sequence resolves correctly.

### Phase 2 — Phaser Client

Build the browser client. Telegraph orb (element-colored Phaser tween crossing from attacker sprite to defender sprite over 0.9 s). Battle hand UI (5 slot cards, highlight on press). HUD (hearts, ring use counts, role labels ATTACKING / DEFENDING). Keyboard input: each player uses keys 1-5 in their own browser window; touch input: tap the slot card. Client renders whatever the server broadcasts — it holds no game state of its own. Playwright tests: assert orb appears on attack, assert slot highlights on keypress, assert HUD updates after resolution. Deliverable: two browser tabs on the LAN produce a visually complete playable exchange.

### Phase 3 — NPC AI Opponents

Add AI bots as server-side Colyseus clients. The AI runs inside the `BattleRoom` — it receives the same state messages a human would and calls the same `submitMove(slot, pressTime)` method. Personality types (§10.5): Aggressive, Defensive, Status-hunter, Resilient. Deliverable: a human player on one tab can complete a full battle against an AI opponent; the AI makes contextually appropriate decisions and feels like a distinct opponent.

### Phase 4 — Ring Inventory and Loadout System

Persistent player state: JWT auth, ring inventory stored server-side (PostgreSQL or file-backed JSON). Pre-duel loadout selection screen (pick 5 from 10). Off hand passive recharge drip (§6.6). Post-battle ring management screen (keep won ring, return one to inventory). Ring XP tracking. Camp scene: sleep to recharge all rings. Deliverable: a player can carry persistent rings across multiple sessions, level them up, and manage a real loadout.

### Phase 5 — Staking Economy

Jewelry position selection before each duel (dominant hand bracelet / off hand bracelet / necklace) with corresponding passive buffs (§9). Stake escrow during duel, ring transfer on loss. Stake lock-in once player enters detection range. Deliverable: full staking loop playable end-to-end between two human players.

### Phase 6 — Status Effects (Gauge System)

Five per-player element gauges (§7). Gauge increments on uncontested hit (no-block or mistime); threshold triggers status effects (Burning, Drowning, Petrified, Scattered, Entangled). Shadow passive (25% Cursed). Gauge display in battle HUD. Deliverable: status effects fire correctly and influence battle outcomes.

### Phase 7 — Fusion System

Shrine mechanic: fuse two maxed parent rings into a higher-tier ring at a shrine location (§5). Recipe discovery gated by defeating fusion-type opponents. Deliverable: player can discover and execute all Tier 2 fusion recipes.

### Phase 8 — Overworld

Browser-rendered top-down overworld (Phaser tilemap, Zelda: A Link to the Past visual style, placeholder art from itch.io). Player movement, collision, at least two biomes (Forest, Swamp). Detection radius triggers (§10.3), camp location, shrine locations, underground caves for Shadow drops. NPCs and monsters placed in the world. Deliverable: a navigable world where organic encounters lead into duels.

### Phase 9 — Distribution

Android/iOS packaging via Capacitor (wrap Phaser client as native WebView app). Steam/desktop packaging via Electron + Greenworks SDK (achievements, cloud saves). Internet matchmaking via public Colyseus server (VPS or Fly.io). Deliverable: submittable builds for Google Play, App Store, and Steam.

---

## 13. Open Questions

**Game design (engine-agnostic):**
- Full element relationship web — all matchups documented for all 11 named elements
- Ring passive and active abilities unlocked at XP milestones
- ~~Exact heart count per duel~~ → settled: **3 hearts**
- Exact catalyst (fusion stone) costs per tier
- Tier 4 triple fusion full details
- NPC personality tuning and difficulty progression curve
- Inventory expansion milestones and exact costs
- Shadow ring drop rate and underground area density
- Whether heavily depleted rings take two game days to recharge (vs always one)
- Monster respawn cycle — real time vs in-game day cycle
- Named/boss monster design and unique ring rewards
- Environmental passives per biome — flagged for a later design pass
- Nature/Bloom fusion — final name TBD
- Whether monster stolen rings retain their specific position in the world (trackable) or just re-enter the monster loot pool
- Status gauge threshold scaling formula with player XP and augmentations
- Playtesting tune for status severity now that gauges persist indefinitely (Burning at 1 full heart/turn especially)

**Tech / multiplayer:**
- Database choice for persistent player state (PostgreSQL vs Redis vs file-backed JSON for Phase 4)
- Internet matchmaking provider (self-hosted VPS vs Fly.io vs Colyseus Cloud) and timing relative to LAN-first phases
- Account system — username/password, OAuth (Google/Discord), or anonymous session with optional persistence
- Touch input layout for mobile — full slot-card tap vs dedicated P1/P2 split screen for local co-op on a tablet
- Spectator mode — open observation or invite-only
- Art asset sourcing strategy — itch.io top-down packs as placeholder, custom art for release

---

*Document version 3.1 — Updated May 2026*
*v3.1 changes: GDD consistency pass. Fixed all subsection numbers (were off by 1 vs ToC throughout). Added §6.4 Block Resolution Table expanded row-per-outcome format. Corrected: hearts settled at 3 (was TBD); parry costs 1 use only (volley is free); gauge fills only on uncontested hit, not on caught attacks including fused rings (removed erroneous "perfect counter decrements gauges" note). Updated Phase 1 build description to reflect Vitest/@colyseus/testing (not Playwright/Godot). Updated Phase 2 keyboard layout (each player uses 1–5 in own window). Fixed all §-cross-references (§5.4→§6.4, §6→§7 for status effects, §8→§9 for staking). Removed duplicate combined v2.0/2.1 changelog entry. Marked hearts open question as resolved.*

*Document version 3.0 — Updated May 2026*
*v3.0 changes: Pivoted from Godot 4.x to **Phaser.js + Colyseus** multiplayer stack. Added §2 Tech Stack & Architecture (server-authoritative model, LAN deployment on game-da-god, Playwright E2E testing, Capacitor/Electron distribution). Rewrote §12 Build Sequence for 9 TypeScript/Playwright phases replacing Godot GDScript prompts. Updated §13 Open Questions to include tech/multiplayer items. Removed all Godot-specific implementation notes (EventBus, GDScript, Godot TileMap) from body text. Game design content (§3–§11) unchanged.*

*Document version 2.2 — Updated May 2026*
*v2.2 changes: Replaced the simultaneous-secret turn model (§6.3) with the **active timed-block** model and added the rally mechanic (§6.4). Rewrote §6.4 damage rules around two axes (timing: parry/block/mistime/no-block; element: strong/neutral/weak). Removed auto-reflect in favour of interactive rally volley chain walking the pentagon.*

*Document version 2.1 — Updated May 2026*
*v2.1 changes: Simplified §5.5 neutral block rules (removed first/second neutral distinction and the neutral recharge bonus). Rewrote §6 from rolling-window combo system to persistent gauge model — gauges change ±1 per base element component on strong hits / perfect counters, neutrals don't move gauges. Replaced restrictive status effects (Petrified, Scattered, Entangled) with attrition-based effects that never restrict ring choice. Eliminated separate fusion statuses (§6.2) — fused rings now decompose recursively to base elements (Lightning = Fire ×2, Frost = Water ×2 + Wind ×1, etc). Burning now deals 1 full heart per turn. Updated Phase 4 build prompt accordingly.*

*Document version 2.0 — Updated May 2026*
*v2.0 changes: Loadout system, dominant/off hand split, post-battle ring management, recharge timer, biomes, monster flee/steal mechanics, detection and approach system, staking jewelry position system (bracelet dominant / bracelet off / necklace), neutral recharge bonus, off hand passive recharge drip, staked ring XP, full NPC category breakdown, expanded Claude Code build prompts*
