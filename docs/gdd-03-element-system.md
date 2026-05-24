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
| Wood + Earth | Wood + Earth  | Nature/Bloom |
| Wind + Earth | Wind + Earth  | Dust         |

**Gauge rule:** only triangle-element components contribute gauges. Wind and Earth components contribute nothing. A dual-triangle fusion (e.g. Steam = Fire + Water) fills **both** parent gauges on an uncontested hit. See §7.1 for the full per-fusion table.

**Fusion matchup rules — Open Question.** The Strong/Neutral/Weak relationship of a fusion ring when it attacks or defends against another element has **not** yet been finalized. To be resolved in a future design session.

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
