## 7. Status Effects

Status effects are managed through persistent **element gauges** — one per triangle element per player (Fire, Water, Wood). The gauge model replaces the rolling-window combo system used in earlier drafts.

### 7.1 Gauge Mechanics

Each player maintains **three status gauges: Fire, Water, Wood** — one per triangle element. All gauges start at 0 and floor at 0. Wind and Earth are not triangle elements — their attacks never contribute to gauge changes regardless of timing outcome.

**Gauge changes per battle exchange — four cases:**

**1. Uncontested hit (no-block or mistime):** +1 per triangle-element component of the attacking ring, added to the defender's matching gauges. Wind and Earth components contribute nothing.

**2. Block with ring X:** The defender's X gauge +1, regardless of the attacker's element. Channelling an element as a shield concentrates its force inward rather than deflecting it outward.

**3. Counter-block:** When the defender blocks with ring X and the incoming attack's primary element is one that X counters, the opposing element's gauge also decreases by 1 (in addition to the +1 blocking cost on X). The triangle counter relationships:

| Defender blocks with | Against attack element | X gauge | Countered gauge |
|---|---|---|---|
| Water | Fire | Water +1 | Fire −1 |
| Wood | Water | Wood +1 | Water −1 |
| Fire | Wood | Fire +1 | Wood −1 |

Counter-blocks against non-matching attacks (e.g. Water ring blocking a Wood attack) still pay the +1 blocking cost with no counter reduction.

**4. Perfect counter (STRONG timing parry):** All three triangle gauges reset to 0. A flawlessly timed deflection disperses all accumulated elemental energy at once.

A **weak catch** loses a heart but moves **no gauge** — heart loss and gauge gain are independent (see §6.4). Intermediate rally volleys follow the same block/parry rules as regular exchanges. A rally terminating in an uncontested hit emits one gauge delta on the terminating volley; a rally terminating in a weak catch emits none.

**Server implementation:** Gauge deltas are computed by the Colyseus BattleRoom after each exchange. The `resolveBlock` result carries:
- `hitGaugeElements: number[]` — triangle element indices to increment on an uncontested hit
- `blockGaugeElement: number | null` — the defending ring's triangle element index (+1 to that gauge on any block or parry); null on no-block
- `counterGaugeElement: number | null` — the countered gauge index (−1) when a counter-block fires; null otherwise
- `clearAllGauges: boolean` — true on a STRONG parry; server sets all three triangle gauges to 0

For fusion attacks each triangle component that lands uncontested contributes its element index; a dual-triangle fusion on a full no-block fills two gauge slots simultaneously. Gauges are broadcast to both clients as part of the state update.

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

The decomposition above applies only to uncontested hits. Blocking a fusion attack still costs the defending ring's gauge as per case 2; the attacker's fusion elements do not drive `blockGaugeElement`.

**Status threshold:** Default **4**. The threshold scales upward with player experience and augmentations in late-game progression (formula TBD).

- Gauge ≥ threshold → status is **active** and persists
- Gauge drops below threshold → status ends, but the attacker can always rebuild it
- Gauges have a soft cap at **2× threshold** to keep HUD numbers readable

### 7.2 Base Element Statuses

| Element | Status | Effect | Counter-block to reduce gauge |
|---|---|---|---|
| Fire | Burning | Lose 1 full heart per turn | Block a Fire attack with Water (Fire −1, Water +1) |
| Water | Drowning | Highest-capacity **attack** ring loses 1 use at the start of each turn | Block a Water attack with Wood (Water −1, Wood +1) |
| Wood | Entangled | Highest-capacity **defense** ring loses 1 use at the start of each turn | Block a Wood attack with Fire (Wood −1, Fire +1) |

Each status is independent — multiple can be active simultaneously and stack their effects.

Gauge reduction via counter-block is incremental (−1 per exchange). A perfect counter is the only way to clear all gauges simultaneously (reset to 0).

### 7.3 Shadow Status — Curse Gauge

Shadow uses its own **Shadow gauge**, parallel to the three triangle gauges but with a distinct progressive effect. The Shadow gauge builds on uncontested hits only; it is not affected by the block/counter-block/perfect-counter rules above.

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
