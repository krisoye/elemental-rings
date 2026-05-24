## 6. Battle System

### 6.1 The Loadout System

The player equips **5 rings on their dominant hand** before a duel, each in a named slot:

| Slot  | Button | Role |
|-------|--------|------|
| Thumb | —      | Staked ring: passive ability only (see §9). Never pressed in combat. |
| A1    | A1     | Attack slot 1 |
| A2    | A2     | Attack slot 2 |
| D1    | D1     | Defense slot 1 |
| D2    | D2     | Defense slot 2 |

**Button mapping is slot-locked:** the A1 button always fires whatever ring is in the A1 slot, regardless of element. There is no element-to-button locking. Ring identity (element, tier, fusion type) is visible on the HUD during battle.

### 6.2 Pre-Duel Setup
- Each player assigns **5 rings to their slots** (Thumb, A1, A2, D1, D2) from their inventory
- The **Thumb ring is staked** (see Section 9) — it grants a passive ability but is never pressed in combat
- Both players can see each other's element types and aggregate uses from detection range before committing
- Once both players formally agree to duel, the battle begins

### 6.3 Turn Structure (Active Timed Block)
Combat is an **active, reaction-timed** exchange — not a hidden simultaneous selection. On each turn:
1. The **attacker** presses **A1 or A2** to fire the ring in that slot. The attack costs **1 use** up front, regardless of the outcome.
2. The attack is **telegraphed**: the ring's element color(s) travel across the screen toward the defender over a **900 ms** window. Fused rings show all of their component colors (e.g. a Mud ring shows blue + brown).
3. The **defender** presses **D1 or D2** to fire the ring in that slot — it must land within the timing window as the incoming attack arrives.
4. The block is resolved on two independent axes — **timing** (parry / block / mistime / no-block) and **element relationship** (strong / neutral / weak). See §6.4.
5. Roles swap — the defender becomes the attacker next turn.

**Phase-locked input:** Attack buttons (A1/A2) only register during the **attack phase**. Defense buttons (D1/D2) only register during the **defense phase**. Wrong-phase presses are silently ignored — protective, not punishing. The phase transition is the most visually prominent UI moment in a battle.

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

**Element axis** — the defender's ring vs the attack's element:
- **Triangle matchups (Fire/Water/Wood):** Fire beats Wood; Wood beats Water; Water beats Fire. The matching Strong/Neutral/Weak relationship is determined by this cycle.
- **Wind attacking:** always **Neutral** — no element can counter Wind offensively.
- **Wind defending:** always **Weak** — Wind defense costs a use and still loses the heart.
- **Earth attacking:** always **Weak** — Earth attacks never carry elemental advantage.
- **Earth defending:** always **Neutral** — Earth defense is never elementally punished.
- **Fusion rings:** matchup TBD (§3.4 Open Question). Gauge contributions come from triangle components only.

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

### 6.6 Extinguished Rings
- A ring is **extinguished** whenever its `current_uses` reaches 0 during a battle, regardless of which outcome drained it (throw, block cost, or weak-catch cost)
- Extinguishment itself never costs a heart — a ring simply becomes unusable at 0 uses
- Any heart loss is decided by the outcome table (§6.4), not by the ring reaching 0. A weak catch costs a heart because of the element mismatch, independent of whether that catch happened to drain the ring to 0
- Extinguished rings cannot be used for the rest of the duel
- The opponent can see which element types are exhausted from the HUD

### 6.7 Hearts
- Each player starts a duel with **3 hearts**
- Hearts are lost when an attack lands uncontested (no-block or mistime), on a weak catch (block or parry with an element the attack beats), or via status effect damage
- When all hearts are gone that player loses the duel
- Hearts reset between duels

### 6.8 Post-Battle Loadout Management
After winning a duel:
1. The player receives the opponent's staked ring
2. The player must decide: keep the won ring in the loadout (replacing something) or send it directly to inventory
3. If keeping it: choose which loadout ring to send back to inventory — including exhausted rings
4. The player can then reorganize their slots freely — reassigning rings to the Thumb/A1/A2/D1/D2 slots to prepare for the next encounter

After losing a duel:
1. The player's staked ring is forfeited to the opponent
2. A monster opponent also steals one random ring from the player's full inventory (not just the loadout)
3. An NPC opponent only takes the staked ring

### 6.9 Monster Encounters
- Monsters always initiate encounters in the overworld
- The player can **flee** before formally agreeing to duel — always free, no penalty
- Once a duel is formally agreed, fleeing is not possible
- If a monster wins it **steals a random ring from the player's full inventory** and flees
- If a monster loses it **drops a ring as loot** and flees — outside the staking system
- A monster that has stolen your ring is now carrying it in the world — it can be tracked down and won back
- Monsters **respawn on a real-time or in-game day cycle**; named/boss monsters do not respawn

---
