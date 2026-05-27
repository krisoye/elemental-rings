## 12. Spirit System

### 12.1 The Spirit Gauge

The spirit gauge represents the protagonist's spiritual energy — the force that allows them to attune to rings, channel power through them, and fold space for teleportation.

The protagonist has **no independent XP pool**. Their spiritual power is entirely derived from their rings. The spirit gauge maximum is a direct function of **aggregate ring XP** — the sum of XP across every ring the protagonist owns (including those stored in the Sanctum). As rings gain XP through battle, the aggregate rises and the spirit gauge maximum grows.

```
spirit_max = SPIRIT_BASE + floor(aggregate_ring_xp / XP_SCALER)
```

| Constant | Value | Location |
|---|---|---|
| `SPIRIT_BASE` | 50 | `server/src/game/constants.ts` |
| `XP_SCALER` | 5 | `server/src/game/constants.ts` |

Both constants are in one file — changing them automatically updates the boot-time backfill, all runtime recharge logic, and the sleep restore, with no other code to touch.

**Reference values:**

| Aggregate ring XP | spirit_max |
|---|---|
| 0 (new player) | 50 |
| 100 | 70 |
| 250 | 100 |
| 500 | 150 |
| 1 000 | 250 |
| 2 500 | 550 |

**Implications:**
- Use rings in battle → rings earn XP → aggregate rises → spirit max increases
- Win a high-XP ring → aggregate spikes → spirit may increase significantly
- Lose a ring through staking → aggregate drops → spirit max may decrease
- The protagonist IS their rings. There is no "self" apart from the collection.

### 12.2 Spirit Capacity = Carry Capacity

Rings are not heavy — they are spiritually demanding. Attuning to too many simultaneously fragments the wielder's focus. The number of rings a protagonist can carry on an expedition is determined by their **spirit gauge maximum**, not physical weight.

- Base spirit capacity → `carry_cap = 10` rings (starting)
- _(Phase 8 planned)_ As spirit max grows, carry cap grows proportionally — the exact ratio is an open question (§13)
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

Teleporting the Sanctum to a distant waystone **spends current spirit** (8D, #87 — GDD §10.8). Each destination carries a `spiritCost` (`shared/waystones.ts`) that scales with spiritual distance: nearby/familiar Anchorages are cheap (0–5), distant or newly discovered ones cost more (8–15). The protagonist must hold at least `spiritCost`; on teleport that spirit is deducted.

- **Spirit gauge (`spirit_current`)** = the resource teleporting now spends, alongside ring recharging; restored to `spirit_max` by sleeping (25 food)
- **Aggregate ring XP** = the permanent level that raises `spirit_max` (the reserve ceiling) and gates *attunement* (whether a destination is reachable at all)
- This creates the intended **preparation loop**: explore → return → sleep to restore spirit → teleport. A depleted protagonist must rest before a long trip even if their `spirit_max` is large.

> **Earlier model (superseded):** Through 8B–8C the teleport gate used `aggregate_xp >= threshold` (no spend). 8D (#87) replaced it with the `spirit_current >= spiritCost` spend model described above, per §10.8.

### 12.5a Short-Range Blink (the first non-recharge spirit sink)

**Blink** (8D, #87) lets the protagonist double-click a discrete interaction zone (Anchorage, waystone, Sanctum door) within `BLINK_MAX_RANGE` to snap onto it instantly, replacing walk-then-E for in-range points of interest.

- **Cost ∝ distance:** `blinkCost(distance) = max(BLINK_MIN_COST, ceil(distance / BLINK_PX_PER_SPIRIT))` (`shared/blink.ts`; `BLINK_PX_PER_SPIRIT = 100`, `BLINK_MIN_COST = 1`). A 300 px blink costs 3 spirit.
- **Server-authoritative:** `POST /api/spirit/blink { distance }` recomputes the cost, guards `spirit_current >= cost`, spends it, and returns the new balance. A 400 (insufficient spirit) leaves the protagonist in place.
- **Same gesture, full interaction:** on success the protagonist snaps onto the zone center, flashes, and fires the zone's interact() (attune / Sanctum return) in one motion.

### 12.5b Ambush First-Strike (a flat premium)

**Ambush** (8D, #87 — GDD §10.3/§10.9) spends a flat `AMBUSH_SPIRIT_COST` (5, `server/src/game/constants.ts`) to blink into a duel and seize the **opening attack**. Triggered by double-clicking an overworld enemy. The server (`BattleRoom.onJoin`) spends the spirit and grants initiative only when the player can afford it; otherwise the flag is ignored and the duel proceeds with default initiative. This is a flat, high-value sink (initiative can decide a duel) distinct from blink's distance-scaled cost.

### 12.6 Strategic Implications

**The diversification incentive:**
A protagonist with 20 rings averaging 100 XP (2000 aggregate) has the same spirit max as one with 5 rings at 400 XP each. But losing one ring from the concentrated collection hits aggregate — and spirit — far harder. Breadth is resilience.

**The staking risk/reward:**
High-XP rings provide stronger Thumb passives (§9.4). Staking a high-XP ring risks a significant aggregate drop on loss, but provides a powerful passive advantage during the duel. Players calibrate: stake something meaningful but not catastrophic.

**The PvP meta:**
If an opponent stakes a high-XP ring for a strong passive and you stake a Tier 1 ring, you fight at a passive disadvantage. The meta settles at a middle ground — not your crown jewel, but not your weakest ring either.

---
