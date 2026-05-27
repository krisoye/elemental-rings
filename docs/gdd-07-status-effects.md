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
| Bloom | Wood + Earth | Wood ×1 (Earth: no gauge) |
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

### 7.3 Shadow Status — Curse Gauge

Shadow uses its own **Shadow gauge**, parallel to the three triangle gauges but with a distinct progressive effect. The same gauge rules apply: builds on uncontested hits (no-block or mistime) only; does not build during rally chains or caught attacks.

**Curse effect — progressive information hiding:**

Each shadow gauge stack hides a piece of the Cursed player's HUD from themselves. Their opponent still sees everything; only the Cursed player loses visibility.

| Shadow gauge | Newly hidden from Cursed player |
|---|---|
| 1 | A1 use count |
| 2 | A2 use count |
| 3 | D1 use count |
| 4 | D2 use count |
| 5 | Hearts |

Gauge cap: 5. The Cursed player can still use rings normally — they must track uses from memory.

**Cleanse — Fire is the counter:**
- **Parry with Fire** (STRONG timing against a Shadow attack): entire shadow gauge clears; all hidden HUD elements restore at once
- **Block with Fire** (BLOCK timing): shadow gauge −1; most-recently-hidden element restores

**Status display:** The battle HUD shows the shadow gauge value. Hidden HUD elements are replaced with a shadow/obscured visual for the Cursed player. The Cursed status indicator is visible to both players.

---
