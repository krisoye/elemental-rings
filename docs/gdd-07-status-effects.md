## 7. Status Effects

Status effects are managed through persistent **element gauges** — one per tracked element per player (Fire, Water, Wood, Shadow). The gauge model replaces the rolling-window combo system used in earlier drafts.

### 7.1 Gauge Mechanics

Each player maintains **four status gauges: Fire, Water, Wood, Shadow**. All gauges start at 0 and floor at 0. Wind and Earth are not tracked elements — their attacks never contribute to gauge changes regardless of timing outcome.

**Gauge changes per battle exchange — four cases:**

**1. Uncontested hit (no-block or mistime):** +1 per tracked-element component of the attacking ring, added to the defender's matching gauges. Wind and Earth components contribute nothing.

**2. Block with ring X:** The defender's X gauge +1, regardless of the attacker's element. Channelling an element as a shield concentrates its force inward rather than deflecting it outward.

**3. Strong block:** When the defender blocks with ring X and the incoming attack's primary element is one that X is strong against, **all gauges that X is strong against** each decrease by 1 (in addition to the +1 blocking cost on X). The strong-block relationships:

| Defender blocks with | Against attack element | X gauge | Blocked gauges |
|---|---|---|---|
| Water | Fire | Water +1 | Fire −1 |
| Wood | Water | Wood +1 | Water −1 |
| Fire | Wood or Shadow | Fire +1 | Wood −1, Shadow −1 |

Fire is strong against both Wood and Shadow — a Fire strong block reduces both gauges simultaneously regardless of which of the two elements triggered the strong block. Water and Wood each cover one element; Fire covers two.

Blocks against non-matching attacks (e.g. Water ring blocking a Wood attack) still pay the +1 blocking cost with no reduction on any gauge.

**4. Parry (STRONG timing):** All four gauges reset to 0. A flawlessly timed deflection disperses all accumulated elemental energy at once.

A **weak catch** loses a heart but moves **no gauge** — heart loss and gauge gain are independent (see §6.4). Intermediate rally volleys follow the same block/parry rules as regular exchanges. A rally terminating in an uncontested hit emits one gauge delta on the terminating volley; a rally terminating in a weak catch emits none.

**Server implementation:** Gauge deltas are computed by the Colyseus BattleRoom after each exchange. The `resolveBlock` result carries:
- `hitGaugeElements: number[]` — tracked element indices to increment on an uncontested hit
- `blockGaugeElement: number | null` — the defending ring's tracked element index (+1 to that gauge on any block or parry); null on no-block
- `blockedGaugeElement: number | null` — the blocked gauge index (−1) when a strong block fires; null otherwise
- `clearAllGauges: boolean` — true on a parry; server sets all four gauges to 0

For fusion attacks each tracked component that lands uncontested contributes its element index; a dual-element fusion on a full no-block fills two gauge slots simultaneously. Gauges are broadcast to both clients as part of the state update.

**Fusion ring decomposition:**
A fusion ring contributes to gauges based only on its **tracked-element** components. Wind and Earth components contribute nothing.

| Ring | Tracked Components | Gauge per Uncontested Hit |
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

**Status threshold:** Default **4** for Fire, Water, and Wood. Shadow gauge triggers its status at each stack (see §7.2). Thresholds scale upward with player experience and augmentations in late-game progression (formula TBD).

- Gauge ≥ threshold → status is **active** and persists
- Gauge drops below threshold → status ends, but the attacker can always rebuild it
- Fire/Water/Wood have a soft cap at **2× threshold** to keep HUD numbers readable
- Shadow has a hard cap of **5**

### 7.2 Base Element Statuses

| Element | Status | Strong block to reduce gauge |
|---|---|---|
| Fire | Burning | Block a Fire attack with Water (Fire −1, Water +1) |
| Water | Drowning | Block a Water attack with Wood (Water −1, Wood +1) |
| Wood | Entangled | Block a Wood attack with Fire (Wood −1, Fire +1) |
| Shadow | Blinded | Block a Shadow attack with Fire (Shadow −1, Fire +1) |

Each status is independent — multiple can be active simultaneously and stack their effects.

Gauge reduction via strong block is incremental (−1 per exchange). A parry is the only way to clear all gauges simultaneously (reset to 0).

**Status effects:**

| Status | Effect |
|---|---|
| Burning | Lose 1 full heart per turn |
| Drowning | Highest-capacity **attack** ring loses 1 use at the start of each turn |
| Entangled | Highest-capacity **defense** ring loses 1 use at the start of each turn |
| Blinded | Progressive HUD information loss — each Shadow gauge stack hides one additional element from the Blinded player (opponent still sees everything) |

**Blinded — progressive information loss:**

| Shadow gauge | Newly hidden from Blinded player |
|---|---|
| 1 | A1 use count |
| 2 | A2 use count |
| 3 | D1 use count |
| 4 | D2 use count |
| 5 | Hearts |

The Blinded player can still use rings normally — they must track hidden values from memory. Hidden HUD elements are replaced with an obscured visual for the Blinded player only; the opponent's display is unaffected. The Blinded status indicator is visible to both players.

---
