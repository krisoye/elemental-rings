## 12. Spirit System

### 12.1 The Spirit Gauge

The spirit gauge represents the protagonist's spiritual energy — the force that allows them to attune to rings and channel power through them. It is the central progression stat of the game.

- The gauge has a **maximum capacity** that starts small and grows with player XP
- The gauge **depletes** when the player recharges ring uses (anywhere in the overworld)
- The gauge **fully restores** when the player sleeps or meditates at camp (costs 25 food units)
- When the gauge is empty, no more recharging is possible until the next sleep

### 12.2 Spirit Capacity = Carry Capacity

Rings are not heavy — they are spiritually demanding. Attuning to too many simultaneously fragments the wielder's focus and weakens the connection to all of them. The number of rings a player can carry (their loadout size) is therefore determined by their **spirit gauge maximum**, not by physical weight.

- Starting spirit capacity → **carry cap of 10 rings**
- As spirit gauge maximum grows with XP, carry cap grows proportionally
- Garments and articles found or bought from merchants can further expand spirit capacity
- This is why the 11th ring feels impossible to carry at the start — not weight, but spiritual bandwidth

### 12.3 Recharging Rings

Recharging a ring restores its `current_uses` by channeling the player's spiritual energy into it.

| Parameter | Value |
|---|---|
| Cost | 1 spirit unit per use restored |
| Where | Anywhere in the overworld — not camp-exclusive |
| Limit | Stops when spirit gauge hits 0 |

**At camp (after waking):**
- **Recharge All** — automatically spends spirit in priority order: Thumb → A1 → A2 → D1 → D2 → spares (most-depleted first within each group). Stops when spirit runs out.
- **Manual** — tap individual rings to selectively restore specific uses

**In the field:**
- Same cost as camp recharging
- Pre-fight topping off: spend spirit to fill a key ring before an encounter
- Spirit conservation: hold spirit in reserve if more fights are expected before returning to camp
- When spirit hits 0 in the field, all remaining rings stay at their current uses until the next sleep

### 12.4 Restoring Spirit (Sleep / Meditate)

| Parameter | Value |
|---|---|
| Where | Camp only |
| Cost | 25 food units |
| Effect | Spirit gauge fully restored to current maximum |

Sleeping is the only way to restore spirit. The player cannot meditate in the overworld or during battle.

**If no food is available:**
- Buy food from a merchant at **2× forage value** (gold)
- If no food and no gold: cannot sleep, cannot restore spirit
- Rings stay depleted; the player must push on with whatever spirit and uses remain or return toward a food source

### 12.5 Spirit Progression

As the player gains XP through combat (rings earn XP through use), the spirit gauge maximum grows:

- Larger maximum → carry more rings simultaneously
- Larger maximum → recharge more rings per sleep cycle (more total uses restored before spirit runs out)
- Larger maximum → deeper field endurance before returning to camp

The spirit gauge is the primary expression of the protagonist's growth as a ring-wielder. A veteran carries twice the rings, recharges twice as many per day, and ranges twice as far before needing to rest.

> **Open questions (§13):** exact XP thresholds for spirit gauge increases; starting spirit capacity value; exact ratio of spirit units to ring carry slots.

---
