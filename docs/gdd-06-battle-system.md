## 6. Battle System

### 6.1 The Loadout System

Before setting out from camp, the player packs a **carry loadout** — up to `carry_cap` rings (default 10) chosen from their full inventory. Only these rings are available in the overworld and during battle.

Of the carried rings, the player assigns **5 to the battle hand** before each encounter — these are the only rings usable during the duel:


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

### 6.2a Combat Entry Preconditions

To initiate a duel, the player must meet **both** of the following conditions:

1. **Heart ring equipped with remaining uses:** The heart slot must have a ring with `current_uses > 0`. A drained heart ring (0 uses) blocks duel entry.
2. **Thumb (stake) ring assigned:** The thumb slot must have a ring assigned — any number of remaining uses is allowed, including zero. A player without an assigned thumb ring cannot enter a duel.

A player who lacks either condition cannot initiate via the E-key or double-click override when encountering an NPC or monster. The overworld encounter prompt is replaced with a brief hint:
- **"Equip & recharge a heart ring to fight"** — if the heart ring is missing or drained
- **"Stake a ring to fight"** — if the thumb slot is empty or unassigned

**Why this rule:** The heart ring represents the player's literal hitpoints; the thumb ring represents their stake (risk). This prevents duels without skin in the game and removes the silent fallback behavior of assigning a default fire ring when the thumb slot was null.

**Note on drained stakes:** A drained stake ring (uses = 0 but assigned to the thumb slot) **does not block** battle entry — the ring remains at risk even though its passive will not fire.

### 6.3 Turn Structure (Active Timed Block)
Combat is an **active, reaction-timed** exchange — not a hidden simultaneous selection. One player holds **initiative** at any moment; the other is the **reactor**.

**Initiative** is the right to choose the next action. After each action (and any resulting counter-chain) fully resolves, initiative passes to the other player. Initiative strictly alternates: every player receives an equal number of initiative phases.

The **initiative holder** chooses one of three actions:

**Option A — Attack:** Press A1 or A2 to fire the ring in that slot.
1. The attack costs **1 use** up front, regardless of the outcome.
2. The attack is **telegraphed**: the ring's element color(s) travel across the screen toward the reactor over a **900 ms** window. Fused rings show all of their component colors (e.g. a Mud ring shows blue + brown).
3. The **reactor** presses **D1 or D2** to fire the ring in that slot — it must land within the timing window as the incoming attack arrives.
4. The block is resolved on two independent axes — **timing** (parry / block / mistime / no-block) and **element relationship** (strong / neutral / weak). See §6.4.
5. If the reactor achieves **Parry + Strong**, a counter fires and the chain continues (see §6.4 Rally). Any other result ends the chain.
6. When the chain ends, **initiative passes to the other player** — regardless of who scored hits or how many volleys the chain contained.

**Option B — Recharge:** Double-press A1, A2, D1, or D2 to fully restore that ring's uses. Attack rings recharge via double-tap `1`/`2` or `Z`/`C`; defense rings recharge via double-tap `3`/`4` or a double-tap on the D1/D2 card. All four combat rings are rechargeable in-duel (the Thumb is not).
- Cost: **1 spirit per use restored** (same rate as overworld recharging, §4.3). A Tier 1 ring at 0 uses costs 3 spirit; one at 1 use costs 2 spirit.
- The ring is restored to its full `max_uses`. The initiative phase ends immediately — no attack is thrown.
- Spirit-gated: only the affordable portion is restored. If the player lacks spirit for a full recharge, the affordable uses are restored (or none, at zero affordable) and the phase is still consumed.
- Only one ring can be recharged per initiative phase.
- Defense recharge has **no letter-key (Z/C) form** — during the attack phase `Z`/`C` bind to A1/A2, so defense rings are reachable only by the number keys `3`/`4` and by tapping the D1/D2 cards.

**Option C — Forfeit:** Press D1 and D2 simultaneously during the attack phase to flee.
- The forfeiting player **loses their staked Thumb ring** and pays **25 gold** (`GOLD_FORFEIT_PENALTY` in constants.ts).
- Forfeiting is only available during your own initiative phase — the reactor cannot flee mid-telegraph.
- This is the escape valve when the duel cannot be won, but it costs more than just the stake.
- Forfeiting preserves the heart ring — it is only destroyed if hearts reach 0 (§6.7).

**Phase-locked input:** Attack buttons (A1/A2) only register during the **attack phase**. Defense buttons (D1/D2) only register during the **defense phase**. Wrong-phase presses are silently ignored — protective, not punishing. The phase transition is the most visually prominent UI moment in a battle.

**Combat hotkeys:** Two input layers are available simultaneously:

| Action | Absolute keys | Phase-relative keys |
|---|---|---|
| Attack A1 | `1` | `Z` (single press, attack phase) |
| Attack A2 | `2` | `C` (single press, attack phase) |
| Recharge A1 | `1` `1` | `Z` `Z` (double-tap, attack phase) |
| Recharge A2 | `2` `2` | `C` `C` (double-tap, attack phase) |
| Recharge D1 | `3` `3` / double-tap D1 card | — (no Z/C form; Z/C bind to A1/A2 in attack phase) |
| Recharge D2 | `4` `4` / double-tap D2 card | — (no Z/C form; Z/C bind to A1/A2 in attack phase) |
| Forfeit | `3` + `4` simultaneously | `Z` + `C` simultaneously (attack phase) |
| Defend D1 | `3` | `Z` (defense phase) |
| Defend D2 | `4` | `C` (defense phase) |

`Z` always maps to slot-1 for the current phase; `C` always maps to slot-2. Double-tap is disambiguated by a short timing window — two presses within the window trigger recharge; outside it each press is treated independently (and phase-locked anyway). Simultaneous D1+D2 is only recognized during the attack phase; during the defense phase the two buttons act independently. Wrong-phase presses are silently ignored.

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
- **Fusion rings:** resolved via auto-align (§3.4). Gauge contributions come from triangle components only.

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

*Attacker always pays −1 use on throw. Gauge rules: see §7.1.*

**Compact form (original):**

| Timing ↓ / Element → | Strong | Neutral | Weak |
|---|---|---|---|
| **No-block** | −1 heart; defender ring spends **0** uses; **+gauge** | same | same |
| **Mistime** | −1 heart; attempted ring spends **1** use; **+gauge** | same | same |
| **Block** | safe; ring −1 use; no rally | safe; ring −1 use | ring −1 use; **−1 heart**; no gauge |
| **Parry** | safe; ring −1 use; **rally** (below) | safe; ring −1 use | ring −1 use; **−1 heart**; no gauge |

**A caught attack always costs exactly 1 use.** Whether you press block or parry, and whatever your element, committing a ring to a successful catch spends one use — no more. The element relationship then decides the consequence: a **strong** or **neutral** catch is fully safe, while a **weak** catch means your ring absorbed the blow but couldn't deflect it — you keep the ring (minus its one use) but still take **1 heart**. Weak is not an overflow mechanic; it is a flat heart cost for catching with the wrong element.

On the two failure rows (**no-block**, **mistime**) the element axis is irrelevant — timing failed and the attack lands uncontested. **No-block** is a deliberate sacrifice (save the ring use, take a heart); **mistime** is the punished attempt (lose a heart AND burn the attempted ring's use; a ring drained to exactly 0 this way is extinguished, no extra heart).

**Gauge movement** is governed by §7.1. Heart loss and gauge movement are fully independent.

**Fusion ring resolution.** A fusion ring's two components are each resolved independently. On No-block or Mistime all components land. On a timed defense the defending ring auto-aligns to the attack component it is strongest against; the remaining component resolves as No-block. See §3.4 for the full rule and outcome tables.

**Rally (Parry + Strong = active counter).** The exchange continues as an interactive volley chain:

1. The initiative holder becomes the new **rally-defender**; the parrying reactor becomes the **rally-attacker**.
2. The **volleyed element is the parrying ring's base element** (not the original thrown element). Example: reactor parries FIRE with WATER → a WATER counter flies back.
3. A new 0.9 s telegraph plays for the volleyed element and the rally-defender must respond exactly as in a normal defend window (no-block / block / parry-strong).
4. If the rally-defender **parries-strong** they become the rally-attacker and the chain continues. The volleyed element is the rally-defender's parrying ring's element. Only triangle elements (Fire, Water, Wood) can produce a PARRY+STRONG; Wind defense is always Weak and Earth defense is always Neutral, so neither can extend a rally.
5. Any other response ends the chain and resolves normally under the standard outcome table:
   - **No-block** → rally-defender loses 1 heart (+gauge); chain ends.
   - **Block/parry (neutral)** → safe; ring −1 use; chain ends.
   - **Block/parry (weak)** → ring −1 use; −1 heart (no gauge); chain ends.
   - **Mistime** → rally-defender loses 1 heart + 1 ring use (+gauge); chain ends.

**After the chain ends, initiative passes to the non-initiative-holder** — the player who did not start the chain. This is true regardless of rally depth or who scored the final hit. A rally counter does not transfer initiative; it extends the current initiative phase and forces the holder to defend.

**Cost symmetry:** Attacker throws (−1 use) → reactor parries strong (−1 use) → rally-defender neutral-blocks (−1 use) = initiative holder −2 / reactor −1. The rally adds optional escalation above that floor.

**Ring depletion naturally caps rally depth.** Each parry spends a ring use; a ring at 0 uses cannot parry. Only a triangle element ring with remaining uses can continue the chain.

A strong element with only **Block** timing is a safe block but forfeits the rally — the elemental advantage converts to a counter-volley only when you also win the tight parry window.

*The same logic applies to all element matchups across all tiers.*

**Outcome feedback (HUD).** When a defense resolves, the defender sees a single label, color, and (for a counter) a screen flash. This is presentation only — the underlying result is the Block Resolution Table above; the feedback collapses the (timing × element) outcome into one legible cue. The timing bands map to the table as **PERFECT = Parry**, **GOOD = Block**, and **MISS = Mistime _or_ No-block**.

| Timing | Element | Label | Color | Flash |
|---|---|---|---|---|
| **PERFECT** (parry window) | Strong | `COUNTER!` | Gold | Orange flash — rally triggered |
| **PERFECT** | Neutral | `PERFECT!` | Cyan | Cyan flash — tight window, no rally |
| **PERFECT** | Weak | `ABSORBED` | Red | — heart lost despite timing |
| **GOOD** (block window) | Strong or Neutral | `BLOCKED!` | Green | — |
| **GOOD** | Weak | `ABSORBED` | Red | — heart lost despite good timing |
| **MISTIME / NO_BLOCK** | any | `MISS` | Grey | — |

`COUNTER!` is the only label that signals a rally — the only outcome where Parry timing and a Strong element combine (§6.4 Rally). `PERFECT!` teaches players what the inner timing window feels like even when their element isn't strong enough to counter. `ABSORBED` explains why a heart was lost despite pressing a key on time — a weak-element catch costs a heart regardless of timing.

### 6.5 Neutral Block Rules
A neutral block occurs when the defender blocks (timing = block or parry) with an element that has no relationship to the attack.

- The defender's ring spends 1 use; the attacker's thrown ring already spent its 1 use
- No heart damage
- Gauge movement follows §7.1 — a standard block (not a strong block) applies case 2 only

Neutrals are pure attrition exchanges — safe on hearts, with the gauge and use cost as the only tradeoff.

### 6.6 Extinguished Rings
- A ring is **extinguished** whenever its `current_uses` reaches 0 during a battle, regardless of which outcome drained it (throw, block cost, or weak-catch cost)
- Extinguishment itself never costs a heart — a ring simply becomes unusable at 0 uses
- Any heart loss is decided by the outcome table (§6.4), not by the ring reaching 0. A weak catch costs a heart because of the element mismatch, independent of whether that catch happened to drain the ring to 0
- Extinguished rings cannot be used for the rest of the duel
- The opponent can see which element types are exhausted from the HUD

**Attack-ring exhaustion.** If both A1 and A2 are extinguished, the attacker cannot throw — they must recharge at least one ring (Option B, §6.3) before attacking. If they lack the spirit to recharge either, their only recourse is to forfeit (Option C, §6.3), losing the staked ring and a gold penalty.

### 6.7 Hearts
- Each player starts a duel with **3 hearts**
- Hearts are lost when an attack lands uncontested (no-block or mistime), on a weak catch (block or parry with an element the attack beats), or via status effect damage
- When all hearts are gone that player loses the duel
- Hearts reset between duels
- When a player's hearts reach 0 and the duel ends, their heart ring is permanently destroyed (broken)

### 6.8 Post-Battle Loadout Management

**After any battle:**
- The player can freely reorganize their battle hand among their carried rings — reassigning Thumb/A1/A2/D1/D2 from the carry pool before the next encounter
- No sleeping or recharging in the field — return to camp for that

**After winning (ring received):**
1. A prompt appears: **"You won a [element] ring!"**
2. If carry has room (`total carried < carry_cap`): choose **Add to Carry**, **Leave at Camp** (ring goes to inventory on return), or **Discard**
3. If carry is full: choose **Swap** (pick which carried ring to displace — displaced ring returns to camp inventory on return), **Leave at Camp**, or **Discard**
4. Discarded rings are permanently lost

**After losing:**
- The staked Thumb ring is forfeited — removed from carry and from the player's inventory
- If the loss was by depletion (hearts reached 0), the heart ring is destroyed (§6.7) — a forfeit with hearts still > 0 preserves it
- No additional penalty beyond the ring loss

After losing a duel:
1. The player's staked ring is forfeited to the opponent
2. If hearts reached 0, the heart ring is permanently destroyed; a forfeit preserves it

### 6.9 Monster Encounters
- Monsters always initiate encounters in the overworld
- The player can **flee** before formally agreeing to duel — always free, no penalty
- Once a duel is formally agreed, fleeing is not possible
- If a monster wins it takes the player's staked Thumb ring and flees — the same stake an NPC or human win claims
- If a monster loses it **drops a ring as loot** and flees — outside the staking system
- Monsters **respawn on a real-time or in-game day cycle**; named/boss monsters do not respawn

---

### 6.10 Ambush Initiative

Normally the monster or NPC attacks first. A protagonist who **double-clicks an enemy within blink range** (§10.3, §12.8) can seize initiative instead.

**Trigger:** Double-click only. Walking into detection range and pressing E launches a normal duel — no first-strike. Ambush is exclusively a blink gesture; the choice to spend spirit for initiative is made at the moment of the double-click.

**Cost:** `AMBUSH_SPIRIT_COST` = 5 spirit, spent at the moment the duel room is joined (in addition to the blink distance cost).

**Effect:** The initiating protagonist becomes the first attacker for that duel — they throw the first ring regardless of encounter type.

**Validation:** The server (`BattleRoom.onJoin`) checks `spirit_current >= AMBUSH_SPIRIT_COST` before granting initiative. If the player cannot afford the ambush premium (not the blink cost — just the 5-spirit ambush flat fee), the duel begins with the normal (opponent-first) initiative and no ambush spirit is spent. The blink still moves the player; only the initiative is lost.

**Balance note:** Ambush is a meaningful but not decisive edge. The defender still has the full 900 ms telegraph window. The value is first-throw flexibility, not a guaranteed advantage.

---
