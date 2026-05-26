## 12. Spirit System

### 12.1 The Spirit Gauge

The spirit gauge represents the protagonist's spiritual energy — the force that allows them to attune to rings, channel power through them, and fold space for teleportation.

The protagonist has **no independent XP pool**. Their spiritual power is entirely derived from their rings. The spirit gauge maximum is a direct function of **aggregate ring XP** — the sum of XP across every ring the protagonist owns (including those stored in the Sanctum). As rings gain XP through battle, the aggregate rises and the spirit gauge maximum grows.

```
spirit_max = f(aggregate_ring_xp)   [exact formula: TBD during tuning]
```

**Implications:**
- Use rings in battle → rings earn XP → aggregate rises → spirit max increases
- Win a high-XP ring → aggregate spikes → spirit may increase significantly
- Lose a ring through staking → aggregate drops → spirit max may decrease
- The protagonist IS their rings. There is no "self" apart from the collection.

### 12.2 Spirit Capacity = Carry Capacity

Rings are not heavy — they are spiritually demanding. Attuning to too many simultaneously fragments the wielder's focus. The number of rings a protagonist can carry on an expedition is determined by their **spirit gauge maximum**, not physical weight.

- Base spirit capacity → `carry_cap = 10` rings (starting)
- As spirit max grows, carry cap grows proportionally
- Garments from merchants can further expand carry cap beyond the spirit-derived baseline
- Rings stored in the Sanctum count toward aggregate XP even when not carried

This is why the 11th ring feels impossible to carry at the start — not weight, but spiritual bandwidth.

### 12.3 Recharging Rings

Recharging a ring restores its `current_uses` by channeling the protagonist's spiritual energy into it.

| Parameter | Value |
|---|---|
| Cost | 1 spirit unit per use restored |
| Where | Anywhere — in the Sanctum, in a safe area, or in the open overworld |
| Limit | Stops when spirit gauge hits 0 |

**At the Sanctum's meditation circle (recommended):**
- **Recharge All** — spends spirit in priority order: Thumb → A1 → A2 → D1 → D2 → spares (most-depleted first within each group). Stops when spirit runs out.
- **Manual** — tap individual rings to selectively restore specific uses

**In the field:**
- Same spirit cost as in the Sanctum
- Top off a key ring before an upcoming encounter
- When spirit hits 0 in the field, return to the Sanctum to sleep and restore

### 12.4 Restoring Spirit (Sleep)

| Parameter | Value |
|---|---|
| Where | Sanctum only (sleep in the sleeping area; meditate in the circle) |
| Cost | 25 food units |
| Effect | Spirit gauge fully restored to current maximum |

The protagonist cannot sleep or restore spirit in the open overworld. The Sanctum's sleeping area and meditation circle are required.

**If no food is available:**
- Buy food from a merchant at 2× forage value
- If no food and no gold: cannot sleep, spirit stays depleted
- Rings stay at their current uses; the protagonist continues with whatever spirit and uses remain

### 12.5 Teleportation Cost

Teleporting the Sanctum to a distant waystone also draws on spiritual reserves — specifically, the protagonist's **aggregate ring XP** sets a threshold for each destination, not the spirit gauge itself.

- **Spirit gauge** = daily recharge resource (depleted by ring recharging; restored by sleep)
- **Aggregate ring XP** = the permanent spiritual level that unlocks higher-threshold destinations
- These are separate: a high-XP protagonist with an empty spirit gauge can still teleport — they just can't recharge rings until they sleep

### 12.6 Strategic Implications

**The diversification incentive:**
A protagonist with 20 rings averaging 100 XP (2000 aggregate) has the same spirit max as one with 5 rings at 400 XP each. But losing one ring from the concentrated collection hits aggregate — and spirit — far harder. Breadth is resilience.

**The staking risk/reward:**
High-XP rings provide stronger Thumb passives (§9.4). Staking a high-XP ring risks a significant aggregate drop on loss, but provides a powerful passive advantage during the duel. Players calibrate: stake something meaningful but not catastrophic.

**The PvP meta:**
If an opponent stakes a high-XP ring for a strong passive and you stake a Tier 1 ring, you fight at a passive disadvantage. The meta settles at a middle ground — not your crown jewel, but not your weakest ring either.

---
