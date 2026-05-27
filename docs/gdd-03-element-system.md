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

**Earth — the safe defensive option.** Earth defenses are always **Neutral**: they can never be elementally punished. Earth attacks are always **Weak**: they land with no elemental advantage. Players who load Earth into defense slots get reliable coverage; loading Earth into attack slots is a liability.

- Neither Wind nor Earth fills gauges. Neither triggers status effects.
- **Design intent:** Wind favors aggressive/offensive loadouts; Earth favors patient/defensive loadouts. A player cannot load both safety valves into both attack and defense simultaneously without sacrificing elemental pressure entirely — committing to safety in one role costs you upside in the other.

### 3.4 Fusion Rings

Fusion rings combine two different base elements. There are **10 fusion rings** (5C2 — every distinct pair of base elements). A fusion ring is **crafted and equipped before battle**, occupying one named slot (A1, A2, D1, or D2) exactly like a base ring. There is **no special input** — pressing the slot button fires the fusion ring, just like a base ring.

| Fusion       | Components    | Name         |
|--------------|---------------|--------------|
| Fire + Water | Fire + Water  | Steam        |
| Fire + Wood  | Fire + Wood   | Wildfire     |
| Fire + Wind  | Fire + Wind   | Inferno      |
| Fire + Earth | Fire + Earth  | Magma        |
| Water + Wood | Water + Wood  | Tidal        |
| Water + Wind | Water + Wind  | Storm        |
| Water + Earth| Water + Earth | Mud          |
| Wood + Wind  | Wood + Wind   | Thornado     |
| Wood + Earth | Wood + Earth  | Bloom |
| Wind + Earth | Wind + Earth  | Dust         |

**Gauge rule:** only triangle-element components contribute gauges. Wind and Earth components contribute nothing. A dual-triangle fusion (e.g. Steam = Fire + Water) fills **both** parent gauges on an uncontested hit. See §7.1 for the full per-fusion table.

### Fusion Resolution

**A fusion ring = 2 components, 1 use.** Whether attacking or defending, each component is assessed independently under the standard timing × element table (§6.4). The combined outcome is the union of all component resolutions.

#### Attacking with a fusion ring

On an uncontested hit (No-block or Mistime) every component lands — up to two hearts and two gauge increments for the cost of one ring use. This is what makes fusion attacks dangerous.

| Timing | Outcome |
|--------|---------|
| No-block | −1 ♥ per component · +1 gauge per triangle component |
| Mistime | −1 ♥ per component · +1 gauge per triangle component · defender ring −1 use |
| Block / Parry | Each component resolved independently — see auto-align rule below |

#### Defending against a fusion attack — Auto-Align Rule

A single defense ring can only engage **one** attack component. It automatically aligns to whichever component it is **strongest** against (STRONG > NEUTRAL > WEAK). The remaining component resolves as **NO_BLOCK** regardless of timing.

**Tiebreaker:** when equally matched against both components, align to the component listed first on the ring (always deterministic).

**Example — Tidal (Water + Wood) attack vs single base-element defense (Parry timing):**

| Defense ring | Auto-aligns to | Engaged component result | Unengaged component (NO_BLOCK) | Net outcome |
|---|---|---|---|---|
| **Fire** | Wood (Strong) | Parry Strong → rally · Fire volley | Water → −1 ♥ · +Water gauge | −1 ♥ · +Water gauge · rally |
| **Water** | Water (Neutral) | Parry Neutral → safe | Wood → −1 ♥ · +Wood gauge | −1 ♥ · +Wood gauge |
| **Wood** | Water (Strong) | Parry Strong → rally · Wood volley | Wood → −1 ♥ · +Wood gauge | −1 ♥ · +Wood gauge · rally |

No single base-element ring fully stops a dual-triangle fusion attack without giving something up — the defender always absorbs at least one heart or triggers a rally that continues the exchange. Fire and Wood defenses both generate a rally (via their STRONG component match); Water defense neutralises the Water component and absorbs the Wood component as NO_BLOCK.

**Example — Tidal (Water + Wood) attack — all timing outcomes with Fire defense:**

| Timing | Wood component (Fire aligned) | Water component (NO_BLOCK) | Net |
|--------|-------------------------------|---------------------------|-----|
| No-block | −1 ♥ · +Wood gauge | −1 ♥ · +Water gauge | −2 ♥ · +2 gauges |
| Mistime | −1 ♥ · +Wood gauge · def −1 use | −1 ♥ · +Water gauge | −2 ♥ · +2 gauges · def −1 use |
| Block | Block Strong → safe | −1 ♥ · +Water gauge | −1 ♥ · +Water gauge |
| Parry | Parry Strong → rally | −1 ♥ · +Water gauge | −1 ♥ · +Water gauge · rally |

**Note:** All examples in §3.4 use the Tidal (Water + Wood) ring. "Tidal" was formerly called "Forest" in earlier GDD drafts — the canonical v4 name is **Tidal** (see §5.2).

#### Countering fusion attacks with a fusion defense

A fusion defense ring applies the same auto-align rule per component — giving the defender two coverage slots instead of one. A well-chosen fusion defense can neutralise both components of an incoming fusion attack.

**Example — Tidal (Water + Wood) attack vs Steam (Fire + Water) defense (Parry timing):**

| Defense component | Attack component aligned to | Relationship | Result |
|---|---|---|---|
| Fire | Wood | Strong | Parry Strong → rally · Fire volley |
| Water | Water | Neutral | Parry Neutral → safe |

Net: safe on both components · rally triggered. Steam fully covers Forest.

Fusion defense rings are the primary tool for cleanly answering fusion attacks — their component choice directly determines which attacks they can absorb without heart loss.

#### Defending with a fusion ring against a single attack

When a fusion defense ring faces a single base-element attack, both defense components can potentially engage — but only one attack must be handled. The auto-align rule picks the STRONGEST defense component; the other is simply unused (there is no second attack for it to defend against).

**Example — Fire attack vs Tidal (Water + Wood) defense (Parry timing):**

| Defense component | vs Fire attack | Relationship | Result |
|---|---|---|---|
| Water | Water beats Fire | **Strong** | Parry Strong → rally · Water volley |
| Wood | Fire beats Wood | Weak | *Unused — attack already handled by Water* |

Net: rally triggered · no heart lost · Forest ring −1 use.

**Coverage profile of Tidal in a defense slot:**

| Incoming attack | Component engaged | Relationship | Outcome |
|---|---|---|---|
| Fire | Water | Strong | Rally |
| Water | Wood | Strong | Rally |
| Wood | Wood | Neutral | Safe, no rally |

Forest defense is STRONG against two of the three triangle elements and NEUTRAL against the third. Compare to a plain Water ring: STRONG vs Fire, NEUTRAL vs Water, WEAK vs Wood. A dual-triangle fusion defense eliminates the weak-element exposure of any single base ring, at the cost of a harder-to-acquire ring.


#### Auto-Align Resolution (resolved — issue #20)

Fusion-vs-fusion component assignment uses a **greedy auto-align** algorithm: each defense component (in defender-ring order) is assigned to the unmatched attack component it is STRONGEST against (STRONG > NEUTRAL > WEAK). Ties break by the attack component's listed order (first listed wins). The result is fully deterministic — no randomness, fully reproducible.

### 3.5 Shadow (Special Case)

Shadow exists outside the element pentagon. It cannot be crafted from base rings — it is obtained solely as a rare overworld drop in dark underground areas.

**How to obtain:** Rare drop only. Underground/Cave biome. Cannot be purchased, fused, or created from other rings.

**Fusion:** Shadow fuses with all 5 base elements to produce 5 Tier 2 dark-variant fusions (Eclipse, Void, Abyss, Wraith, Plague — see §5.2). These are the rarest fusions: a Shadow drop ring is required as a parent and the recipe can only be completed at a shrine. Shadow itself must be found before any dark-variant fusion is accessible.

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

#### Shadow Gauge — Curse

Shadow uses a **Shadow gauge** that builds on uncontested hits only (no-block or mistime), identical to triangle gauge rules. It does not build during successful rally chains. The gauge persists throughout the duel and progressively hides the **Cursed player's ring and heart information from themselves** — they must track from memory; their opponent still sees everything.

| Shadow gauge | Newly hidden |
|---|---|
| 1 | A1 use count |
| 2 | A2 use count |
| 3 | D1 use count |
| 4 | D2 use count |
| 5 | Hearts |

The gauge caps at 5. The Cursed player can still use rings normally.

**Cleansing the Shadow gauge** follows the same parry/block rule as triangle cleanse (§7.1):
- **Parry with Fire** (STRONG timing) → entire shadow gauge clears; all hidden information restores at once
- **Block with Fire** (BLOCK timing) → shadow gauge −1; most-recently-hidden item restores

Fire is the natural counter to Shadow — loading Fire defense rings is the correct preparation.

---
