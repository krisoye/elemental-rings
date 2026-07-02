## 3. Element System

### 3.1 The Five Base Elements

There are five base elements, split into two roles. **Triangle elements** (Fire, Water, Wood) carry elemental risk and reward — counters exist and gauges fill. **Neutral elements** (Wind, Earth) are asymmetric safety valves that trade upside for predictability.

| Element | Role     | Attack              | Defense             |
|---------|----------|---------------------|---------------------|
| Fire    | Triangle | Beats Wood          | Loses to Water      |
| Water   | Triangle | Beats Fire          | Loses to Wood       |
| Wood    | Triangle | Beats Water         | Loses to Fire       |
| Wind    | Neutral  | Always Neutral      | Always Weak         |
| Earth   | Neutral  | Always Weak         | Always Neutral      |

Triangle elements are high risk / high reward: every triangle attack can be elementally countered, and every triangle hit can build a status gauge. Wind and Earth never participate in the triangle cycle — their relationship is fixed by role, not by the opposing element, so they offer reliable but capped outcomes.

### 3.2 Triangle Relationships

The three triangle elements form a single cycle. Each beats one and loses to one.

| Attacker | Beats | Loses To |
|---|---|---|
| Fire  | Wood  | Water |
| Wood  | Water | Fire  |
| Water | Fire  | Wood  |

The cycle reads **Fire → Wood → Water → Fire**. Wind and Earth have **no** triangle relationship — their roles are fixed regardless of the opposing element (see §3.3).

### 3.3 Wind and Earth Roles

Wind and Earth are the two **asymmetric neutrals**. Each is safe in exactly one role and a liability in the other.

**Wind — the safe offensive option.** Wind attacks are always **Neutral**: no element can counter a Wind attack. Wind defense is always **Weak**: pressing D1/D2 with a Wind ring, even with correct timing, still takes the heart. Players who load Wind into attack slots gain reliable pressure with no elemental blowback; loading Wind into defense slots is a liability.

**Earth — the safe defensive option.** Earth defenses are always **Neutral**: they can never be elementally **punished**, but remain subject to raw force overflow when significantly outmatched in force — both block and parry. Earth attacks are always **Weak**: they land with no elemental advantage. Players who load Earth into defense slots get reliable coverage; loading Earth into attack slots is a liability.

Every ring carries a tier-derived **force** stat (§4.2): a scalar that determines how much raw damage an attack pushes and how much a defending ring can absorb. Under the Neutral resolution formula, a defending ring's own `def_force` is a real subtractive shield against the attacker's `atk_force` — not an absolute wall — and whatever force is left over is mitigated by the equipped heart ring's `hp_force` and converted to an integer heart count: `max(0, ceil((atk_force − def_force) / hp_force))`. Earth's Neutral defense is heart-safe only when `def_force ≥ atk_force`: a high-force attacker can still bleed hearts through a low-force Earth ring.

**Worked example:** a Tier-3 Wind attack (`atk_force` 2) against a Tier-1 Earth defense (`def_force` 1), with a Tier-1 heart ring (`hp_force` 1): `max(0, ceil((2 − 1) / 1))` = **1 heart lost**, even though Earth's Neutral relationship blocked any elemental punish.

Wind's defense fares worse in the identical matchup. Because Wind defense is always **Weak**, it gets **zero** ring-force credit — `def_force` never subtracts, so the full `atk_force` passes straight through to hp mitigation: `max(1, ceil(atk_force / hp_force))`. The same Tier-3 Wind attack against a Tier-1 Wind defense with the same Tier-1 heart ring costs `max(1, ceil(2 / 1))` = **2 hearts** — worse than Earth's 1, consistent with Wind being a defensive liability.

- Neither Wind nor Earth fills gauges. Neither triggers status effects.
- **Design intent:** Wind favors aggressive/offensive loadouts; Earth favors patient/defensive loadouts. A player cannot load both safety valves into both attack and defense simultaneously without sacrificing elemental pressure entirely — committing to safety in one role costs you upside in the other.

### 3.4 Fusion Rings

Fusion rings combine two different base elements into a single **compound element** — a new element with its own matchup identity. There are **10 fusion rings** (5C2 — every distinct pair of base elements). A fusion ring occupies one named slot (A1, A2, D1, or D2) exactly like a base ring. There is **no special input** — pressing the slot button fires the fusion ring.

Fusion rings are **crafted from two parent rings** (see §4 Ring Progression for requirements, XP, and uses rules).

| Fusion        | Components     | Name     |
|---------------|----------------|----------|
| Fire + Water  | Fire + Water   | Steam    |
| Fire + Wood   | Fire + Wood    | Wildfire |
| Fire + Wind   | Fire + Wind    | Inferno  |
| Fire + Earth  | Fire + Earth   | Magma    |
| Water + Wood  | Water + Wood   | Tidal    |
| Water + Wind  | Water + Wind   | Storm    |
| Water + Earth | Water + Earth  | Mud      |
| Wood + Wind   | Wood + Wind    | Thornado |
| Wood + Earth  | Wood + Earth   | Bloom    |
| Wind + Earth  | Wind + Earth   | Dust     |

### Compound Element Matchups

A fusion ring behaves as a **single compound element** in battle — not as two separate components firing simultaneously. Its matchup profile inherits the **offensive strengths** of both parents but **none of their weaknesses**. Everything not explicitly listed as a strength is **Neutral**.

**Fusion is strictly offensive specialization:** you gain broader coverage (strong against more elements) at the cost of fewer ring uses (see §4). The defensive liability of each parent element is eliminated.

**Example — Steam (Fire + Water):**
- Fire's offensive strength: beats Wood
- Water's offensive strength: beats Fire
- Steam therefore: **beats Wood and Fire**, Neutral against everything else (Water, Earth, Wind, all fused elements, Shadow)

**Compound element matchup table:**

| Fusion | Beats (attack) | Neutral |
|---|---|---|
| Steam (F+W) | Wood, Fire | All others |
| Wildfire (F+Wo) | Wood, Water | All others |
| Tidal (W+Wo) | Fire, Water | All others |
| Inferno (F+Wi) | Wood | All others |
| Magma (F+E) | Wood | All others |
| Storm (W+Wi) | Fire | All others |
| Mud (W+E) | Fire | All others |
| Thornado (Wo+Wi) | Water | All others |
| Bloom (Wo+E) | Water | All others |
| Dust (Wi+E) | — (none) | Everything |

> **Note on single-parent fusions:** Inferno, Magma, Storm, Mud, Thornado, and Bloom each carry one triangle and one neutral element. They inherit the triangle parent's single offensive strength. Dust (Wind+Earth) carries no triangle parent and has no offensive advantage — it is entirely neutral, functionally a safer Earth or Wind ring rolled into one.

**Fused vs fused:** all compound elements are **Neutral against each other** (including mirror matches). Two players running fused rings have no elemental leverage over one another — the duel resolves on timing skill and gauge management.

### Fusion Ring Gauge Rules

**On attack (uncontested hit):** fills the **parent gauges** of any tracked-element components at full rate. Wind and Earth components contribute nothing.

| Ring | Tracked Components | Gauge per Uncontested Hit |
|------|---------------------|---------------------------|
| Steam | Fire + Water | Fire ×1, Water ×1 |
| Wildfire | Fire + Wood | Fire ×1, Wood ×1 |
| Tidal | Water + Wood | Water ×1, Wood ×1 |
| Inferno | Fire + Wind | Fire ×1 |
| Magma | Fire + Earth | Fire ×1 |
| Storm | Water + Wind | Water ×1 |
| Mud | Water + Earth | Water ×1 |
| Thornado | Wood + Wind | Wood ×1 |
| Bloom | Wood + Earth | Wood ×1 |
| Dust | Wind + Earth | None |

**Any block — even a weak block with the wrong element — stops all gauge fill.** Only a true uncontested hit (no-block or mistime) triggers gauge increments.

**On defense (blocking cost):** a fusion defense ring fills **both parent tracked-element gauges** equally, each at the tier-reduced rate (see §7.1). At Tier 2, each parent gauge fills at 0.5 per block; at Tier 3, 0.25; and so on.

### Fusion Ring Attack Resolution

A fusion ring resolves its attack as a **single compound element** against the standard timing × element table (§6.4). The outcome is determined by the compound element's matchup against the defender's ring:

| Attack | Defense | Matchup |
|---|---|---|
| Steam | Wood ring | **Strong** (Steam beats Wood) |
| Steam | Fire ring | **Strong** (Steam beats Fire) |
| Steam | Water ring | **Neutral** |
| Steam | Steam ring | **Neutral** (fused vs fused) |

On a **no-block or mistime**: −1 ♥ and gauges fill per the table above.

### Fusion Ring Defense Resolution

A fusion defense ring resolves as its compound element against the incoming attack. Coverage uses the same matchup table — the compound element is Strong, Neutral, or Weak against the attacker, which determines the timing outcome.

**Example — Steam (Fire + Water) defense:**

| Incoming attack | Compound matchup | Outcome (Parry timing) |
|---|---|---|
| Wood attack | Strong | Parry Strong → rally |
| Fire attack | Strong | Parry Strong → rally |
| Water attack | Neutral | Parry Neutral → safe |
| Wind attack | Neutral | Parry Neutral → safe |
| Tidal attack | Neutral (fused vs fused) | Parry Neutral → safe |

Steam defense is Strong against two of the three triangle elements and Neutral against everything else. A dual-triangle fusion defense eliminates the weak-element exposure of any single base ring, at the cost of fewer uses (§4).

### 3.5 Shadow (Special Case)

Shadow exists outside the element pentagon. It cannot be crafted from base rings — it is obtained solely as a rare overworld drop in dark underground areas.

**How to obtain:** Rare drop only. Underground/Cave biome. Cannot be purchased, fused, or created from other rings.

**Fusion:** Shadow fuses with all 5 base elements to produce 5 dark-variant fusions (Eclipse, Void, Abyss, Wraith, Plague — see §5.2). These are the rarest fusions: a Shadow drop ring is required as a parent and the recipe can only be completed at a shrine. Shadow itself must be found before any dark-variant fusion is accessible. The resulting ring's tier is determined by the summed XP of both parent rings, following the standard progression rules in §4.

#### Shadow Matchups

Shadow has its own asymmetric matchup table, independent of the Fire→Wood→Water→Fire triangle:

| Relationship | Element | Reason |
|---|---|---|
| **Shadow beats** | Wood | Darkness suppresses growth |
| **Shadow loses to** | Fire | Light illuminates and dispels darkness |
| **Shadow neutral** | Water, Earth, Wind | No inherent advantage either direction |

Shadow vs. Shadow is neutral (mirror match).

#### Staked Shadow Passive

When Shadow is the staked Thumb ring, the **last 20% of every telegraph duration is hidden from the opponent** — the orb disappears from the screen ~180 ms before impact, forcing the defender to anticipate hit timing from the first 80% of the animation only. This is an information-denial passive; the attack cannot be reacted to at the last moment.

#### Shadow Gauge — Blinded

Shadow uses a **Shadow gauge** governed by the same four-case rules as all other tracked elements (§7.1). The status it inflicts is **Blinded** — see §7.2 for the full effect table and progressive HUD-hiding progression.

Fire is the natural counter to Shadow. A Fire strong block against a Shadow attack reduces both the Shadow and Wood gauges simultaneously (§7.1 strong-block rule — Fire is strong against both). A parry resets all four gauges to 0.

---
