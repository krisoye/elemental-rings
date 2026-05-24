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
