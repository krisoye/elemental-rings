## 7. Status Effects

Status effects are managed through persistent **element gauges** — one per triangle element per player (Fire, Water, Wood). The gauge model replaces the rolling-window combo system used in earlier drafts.

### 7.1 Gauge Mechanics

Each player maintains **three status gauges: Fire, Water, Wood** — one per triangle element. All gauges start at 0 and floor at 0. Wind and Earth are not triangle elements — their attacks never trigger `gaugeIncreases` regardless of timing outcome.

**Gauge changes per battle exchange:**
- **Uncontested hit** (no-block or mistime): +1 per triangle-element component of the attacking ring, added to the defender's matching gauges. Wind and Earth components contribute nothing.

A gauge only moves when the attack lands uncontested. A **weak catch** loses a heart but the attack *was* caught, so it moves **no gauge** — heart loss and gauge gain are independent (see §6.4). Successful blocks and parries — including intermediate rally volleys — never move gauges. A rally that terminates in an uncontested hit emits one gauge delta on the terminating volley; a rally that terminates in a weak catch emits none.

**Server implementation:** Gauge deltas are computed by the Colyseus BattleRoom after each exchange. The `resolveBlock` result carries a `gaugeElements: number[]` array listing the specific triangle element indices whose gauges should increment. For base-element attacks the array contains the attacker's element on no-block or mistime, and is empty for any caught attack (neutral, strong, or weak). For fusion attacks each triangle component that lands uncontested — either via auto-align (the unengaged component resolves as NO_BLOCK) or on a full no-block/mistime — contributes its element index; a dual-triangle fusion on a full no-block therefore fills two gauge slots simultaneously. Gauges are broadcast to both clients as part of the state update.

**Fusion ring decomposition:**
A fusion ring contributes to gauges based only on its **triangle-element** components. Wind and Earth components contribute nothing.

| Ring | Triangle Components | Gauge per Uncontested Hit |
|------|---------------------|---------------------------|
| Steam | Fire + Water | Fire ×1, Water ×1 |
| Wildfire | Fire + Wood | Fire ×1, Wood ×1 |
| Inferno | Fire + Wind | Fire ×1 (Wind: no gauge) |
| Magma | Fire + Earth | Fire ×1 (Earth: no gauge) |
| Tidal | Water + Wood | Water ×1, Wood ×1 |
| Storm | Water + Wind | Water ×1 (Wind: no gauge) |
| Mud | Water + Earth | Water ×1 (Earth: no gauge) |
| Thornado | Wood + Wind | Wood ×1 (Wind: no gauge) |
| Nature/Bloom | Wood + Earth | Wood ×1 (Earth: no gauge) |
| Dust | Wind + Earth | No gauge contribution |

A caught attack against a fusion ring moves no gauge — the decomposition above applies only to uncontested hits.

**Status threshold:** Default **4**. The threshold scales upward with player experience and augmentations in late-game progression (formula TBD).

- Gauge ≥ threshold → status is **active** and persists
- Gauge drops below threshold → status ends, but the attacker can always rebuild it
- Gauges have a soft cap at **2× threshold** to keep HUD numbers readable

### 7.2 Base Element Statuses

| Element | Status | Effect | How to Reduce Gauge |
|---|---|---|---|
| Fire | Burning | Lose 1 full heart per turn | Defend with Water |
| Water | Drowning | All ring **attacks** cost +1 use | Defend with Wood |
| Wood | Entangled | Highest-uses ring in battle hand loses 1 use at the start of each turn | Defend with Fire |

Each status is independent — multiple can be active simultaneously and stack their effects.

### 7.3 Shadow Status (Unique)

Shadow operates outside the gauge system.

- Any connecting Shadow attack has a **25% chance** to inflict **Cursed**
- **Cursed:** the target's highest XP ring loses half its remaining uses for the entire battle
- Cannot be cured; does not interact with gauges

---
