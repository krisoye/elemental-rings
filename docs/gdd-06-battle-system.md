## 6. Battle System

### 6.1 The Loadout System

Before setting out from camp, the player packs a **carry loadout** — up to `carry_cap` rings (default 10) chosen from their full inventory. Only these rings are available in the overworld and during battle.

Of the carried rings, the player assigns **6 rings to their slots** before each encounter — one to the dedicated heart (HP) slot, and five to the battle hand:


| Slot  | Button | Role |
|-------|--------|------|
| Heart | —      | HP slot: equipped ring's `current_uses` = duel starting HP. Destroyed on KO (§6.7). Not a battle-hand slot — cannot be pressed in combat. Equipped via the ring management screen. |
| Thumb | —      | Staked ring: passive ability only (see §9). Never pressed in combat. |
| A1    | A1     | Attack slot 1 |
| A2    | A2     | Attack slot 2 |
| D1    | D1     | Defense slot 1 |
| D2    | D2     | Defense slot 2 |

**Button mapping is slot-locked:** the A1 button always fires whatever ring is in the A1 slot, regardless of element. There is no element-to-button locking. Ring identity (element, tier, fusion type) is visible on the HUD during battle.

### 6.2 Pre-Duel Setup
- Each player assigns **6 rings to their slots** (Heart, Thumb, A1, A2, D1, D2) from their inventory
- The **Heart ring provides HP** — its `current_uses` equals the player's starting hearts in the duel
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

**Starter inventory:** At game start, the player's battle-hand loadout is preset: Wind ring in the Heart slot (Tier 0 → 3 HP), Earth ring in the Thumb/STATUS slot, Wind × 2 in A1/A2 attack slots, and Earth × 2 in D1/D2 defense slots. This balanced starter kit provides immediate playability and teaches the triangle matchup by example (Wind neutral, Earth always safe). The player's reliquary contains additional rings for overworld foraging and ring fusion.

### 6.3 Turn Structure (Active Timed Block)
Combat is an **active, reaction-timed** exchange — not a hidden simultaneous selection. One player holds **initiative** at any moment; the other is the **reactor**.

**Initiative** is the right to choose the next action. After each action (and any resulting counter-chain) fully resolves, initiative passes to the other player. Initiative strictly alternates: every player receives an equal number of initiative phases.

The **initiative holder** chooses one of three actions:

**Option A — Attack (Tap or Charge):** Press A1 or A2 to throw the ring in that slot. There are two forms:

**Tap (hold < `CHARGE_THRESHOLD_MS`, default 150 ms):** Release quickly. The orb spawns on release and fires horizontally at the standard **900 ms** telegraph. Defender phase opens at full baseline window. This is always a hit — no arc-timing required.

**Charged Attack (hold ≥ `CHARGE_THRESHOLD_MS`):** Hold the button. As soon as the hold begins:
- The attack orb **spawns immediately** in front of the attacker and begins sweeping in a **constant-angular-velocity arc** from −45° to +45° (pivoting at the spawn point). 0° is the sweet spot — aimed directly at the opponent.
- The sweep **speeds up on each reversal** (3 sweeps to max speed, controlled by `SWEEP_SPEEDUP = 0.75`): each successive sweep takes 75% as long as the previous. Max speed is reached at sweep 3 and held there.
- The orb **glows gold** when within the hit cone (±`HIT_CONE_DEG`, default 10°); it dims when outside.
- **Both players see the arc-swinging orb** — the defender gets information about the attacker's charge level before the throw.

**Release = throw.** The orb's angle at the exact moment of release determines the outcome:

| Release angle | Result | Defender Phase |
|---|---|---|
| Within ±`HIT_CONE_DEG` (10°) of 0° | **Hit** — orb flies toward defender at a compressed telegraph | Yes — window scales with charge sharpness |
| Outside hit cone | **Miss** — orb flies off-screen at that angle | **No** — defender does nothing; attacker −1 use |

On a **miss**: the attacker loses 1 ring use, a brief "WHIFF" label appears on the attacker's side, and initiative passes immediately. The defender is never punished for an attacker's miss.

On a **hit**: telegraph duration and sharpness scale with the number of **sweeps completed**:

| Sweep (0-based) | Sharpness | Telegraph Window | Parry Window |
|---|---|---|---|
| Tap (no charge) | 0 | 900 ms (baseline) | Standard |
| Sweep 0 (first pass, ~0–1200ms) | 1/3 | ~767 ms | Slightly compressed |
| Sweep 1 (return pass, ~1200–2100ms) | 2/3 | ~633 ms | Significantly compressed |
| Sweep 2+ (max speed, ~2100ms+) | 1.0 | `CHARGE_TELEGRAPH_MIN_MS` (500 ms) | Most compressed |

The arc formulas are deterministic and computed server-side to prevent angle-spoofing:
```
sweepDuration(n)  = BASE_SWEEP_MS × SWEEP_SPEEDUP ^ min(n, MAX_SWEEPS − 1)
sweepIndex(t)     = 0-based sweep we are in at holdMs t
orbAngle(t)       = −SWEEP_RANGE_DEG..+SWEEP_RANGE_DEG (degrees)   0° = sweet spot
isHit             = |orbAngle(holdDuration)| ≤ HIT_CONE_DEG
sharpness         = 1/3 (sweep 0) | 2/3 (sweep 1) | 1.0 (sweep 2+)
telegraphDuration = lerp(TELEGRAPH_MS, CHARGE_TELEGRAPH_MIN_MS, sharpness)
```

**Common rules for both tap and charge:**
1. The attack costs **1 use** up front, regardless of hit or miss.
2. Fused rings show all of their component colors.
3. On a successful hit, the **reactor** presses **D1 or D2** within the (variable) telegraph window.
4. The block is resolved on two independent axes — **timing** and **element relationship**. See §6.4.
5. If the reactor achieves **Parry + Strong**, a counter fires (see §6.4 Rally).
6. When the chain ends, **initiative passes to the other player**.

**Option B — Recharge:** Press `R` (or tap the RECHARGE slot card in the Hand row) during your initiative phase to enter **recharge-armed state**. The HUD shows "RECHARGE — pick a ring". Then press any ring key (`1`/`2`/`3`/`4`) or tap any ring card to recharge that ring. This gesture unifies attack-ring and defense-ring recharge under a single two-step input. Cancel with `R` again, `Esc`, or no input for ~2,500 ms.
- Cost: **1 spirit per use restored** (same rate as overworld recharging, §4.3). A Tier 1 ring at 0 uses costs 3 spirit; one at 1 use costs 2 spirit.
- The ring is restored to its full `max_uses`. The initiative phase ends immediately — no attack is thrown.
- Spirit-gated: only the affordable portion is restored. If the player lacks spirit for a full recharge, the affordable uses are restored (or none, at zero affordable) and the phase is still consumed.
- Only one ring can be recharged per initiative phase.
- `R` off-turn is a no-op with a brief visual cue; recharge can only be armed during your own initiative phase.

**Option C — Forfeit:** Press D1 and D2 simultaneously during the attack phase to flee.
- The forfeiting player **loses their staked Thumb ring** and pays **25 gold** (`GOLD_FORFEIT_PENALTY` in constants.ts).
- Forfeiting is only available during your own initiative phase — the reactor cannot flee mid-telegraph.
- This is the escape valve when the duel cannot be won, but it costs more than just the stake.
- Forfeiting preserves the heart ring — it is only destroyed if hearts reach 0 (§6.7).

### 6.3a Fusion Ring Charge Interaction

When the attacker holds one attack button (A1 or A2) while the orb oscillates, tapping the **other** attack button triggers a **fusion double-attack release** — the same hold-cross-tap gesture as the standard double attack (§3.4), but with the charge mechanic applied:

- **Held orb (A1):** flies from whatever arc angle it occupies **at the moment A2 is tapped**. Applies the normal hit/miss check against `HIT_CONE_DEG` (±10° around 0°). If outside the hit cone → **miss** (−1 use for A1, no A1 defender window); A2 still fires regardless.
- **Tapped orb (A2):** treated as a **tap** — always spawns and fires horizontal. Always hits.
- Both orbs fire simultaneously (as with all fusion double-attacks). The telegraph window for the combined phase is determined by A1's sharpness (sweep index) at the moment A2 is tapped, provided A1 hits.
- If A1 misses but A2 hits: a single defender phase opens for A2 only, at full baseline telegraph (A1 contributed no sharpness to the hit path).

**Strategic implication:** The attacker must time the A1 orb at 0° (sweet spot) **at the tap moment**, not just execute the hold-cross-tap gesture. Tapping A2 when A1 is far off-center sacrifices the first orb while the second still lands — creating genuine attacker skill pressure on fusion double-attacks. The arc model makes the sweet-spot window slightly wider than the old Y-sine model on sweep 0, but narrower on sweep 2+ as the orb accelerates.

**Phase-locked input:** Attack buttons (A1/A2) only register during the **attack phase**. Defense buttons (D1/D2) only register during the **defense phase**. Wrong-phase presses are silently ignored — protective, not punishing. The phase transition is the most visually prominent UI moment in a battle.

**Combat hotkeys:** Two input layers are available simultaneously:

| Action | Absolute keys | Phase-relative keys |
|---|---|---|
| Attack A1 | `1` | `Z` (single press, attack phase) |
| Attack A2 | `2` | `C` (single press, attack phase) |
| Arm Recharge | `R` / RECHARGE slot card (Hand row, left of Thumb) | — (attack phase only) |
| Complete Recharge | `1`/`2`/`3`/`4` or any ring card tap | — (while recharge-armed) |
| Forfeit | `3` + `4` simultaneously | — (attack phase only) |
| Defend D1 | `3` | `Z` (defense phase) |
| Defend D2 | `4` | `C` (defense phase) |

`Z` always maps to slot-1 for the current phase; `C` always maps to slot-2. Simultaneous D1+D2 is only recognized during the attack phase; during the defense phase the two buttons act independently. Wrong-phase presses are silently ignored.

Because the defender sees the incoming element before committing, there is no simultaneous hidden selection. Bluffing lives in the loadout, stake, and jewelry layers (§9), not in the turn itself.

### 6.4 Damage Rules
The attacker always pays **1 use to throw**. The defender's response — its **timing** and its **element relationship** to the attack — determines everything else.

**Variable telegraph duration (charge mechanic, §6.3 Option A):** For a charged attack that hits, the telegraph window shrinks based on `sharpness` (charge level). The formula: `telegraphDuration = lerp(TELEGRAPH_MS, CHARGE_TELEGRAPH_MIN_MS, sharpness)`. A tap uses the full baseline `TELEGRAPH_MS` (900 ms); a maximum charge uses `CHARGE_TELEGRAPH_MIN_MS` (500 ms). The parry window compresses proportionally — both window edges close toward impact, keeping classification semantics unchanged. A missed charge never opens a defender window at all (§6.3 Option A).

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

### 6.7 Hearts and HP Derivation

**HP at duel start** is derived from the equipped heart ring's `current_uses`, capped at its `max_uses`. A Tier 0 heart ring has `max_uses = 3`, giving 3 HP at game start; a higher-tier heart ring grants more HP. For example, a Tier 1 heart ring with `max_uses = 4` provides 4 starting hearts in a duel.

**Heart ring uses drain across duels.** A duel that ends with 2 hearts remaining saves the heart ring at 2 `current_uses`. The ring must be recharged (at the meditation circle or via field spirit) before it restores full HP. Uses are not automatically restored between duels — a drained heart ring blocks duel entry until recharged.

**On KO (hearts reach 0):** the heart ring is permanently destroyed — removed from the player's inventory entirely. This is the harsh consequence of losing without forfeit.

**On forfeit (hearts > 0, §6.3):** the heart ring is preserved at its remaining uses. This is the core strategic reason to forfeit: a heart ring with 4 or 5 pips (Tier 1+) represents a significant investment. Losing it to a KO is permanent; forfeiting costs the staked Thumb ring and 25 gold but saves the heart ring for the next duel. A player holding a high-tier heart ring may choose to cut losses early rather than risk permanent destruction.

**Hearts are lost** when an attack lands uncontested (no-block or mistime), on a weak catch (block or parry with an element the attack beats), or via status effect damage. When all hearts are gone that player loses the duel.

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
