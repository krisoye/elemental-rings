## 12. Spirit System

### 12.1 The Spirit Gauge

The spirit gauge represents the protagonist's spiritual energy — the force that allows them to attune to rings, channel power through them, and fold space for teleportation.

The protagonist has **no independent XP pool**. Their spiritual power is entirely derived from their rings. The spirit gauge maximum is a direct function of **aggregate ring XP** — the sum of XP across all rings in the **Reliquary** (the Sanctum ring storage; see §4.1 and §10.6). Rings in the carry loadout are excluded. As the protagonist retires experienced rings to the Reliquary and develops new ones to carry, the aggregate rises and the spirit gauge maximum grows.

```
spirit_max = SPIRIT_BASE + floor(aggregate_ring_xp / XP_SCALER)
```

| Constant | Location | Notes |
|---|---|---|
| `SPIRIT_BASE` | `server/src/game/constants.ts` | Base spirit max for a new player with no rings |
| `XP_SCALER` | `server/src/game/constants.ts` | Tune here — do not hardcode the value in the GDD |

Both constants are in one file — changing them automatically updates the boot-time backfill, all runtime recharge logic, and the sleep restore, with no other code to touch.

**Implications:**
- Use rings in battle → rings earn XP → aggregate rises → spirit max increases
- Win a high-XP ring → aggregate spikes → spirit may increase significantly
- Lose a ring through staking → aggregate drops → spirit max may decrease
- The protagonist IS their rings. There is no "self" apart from the collection.

### 12.2 Carry Capacity

Rings are not heavy — they are spiritually demanding. Attuning to too many simultaneously fragments the wielder's focus. Carry capacity is a **fixed constant** for every protagonist, new or seasoned:

```
carry_cap = CORE_SLOTS(5) + SPARE_SLOTS(9) = 14
```

- **5 core slots** — the named battle-hand: Thumb, A1, A2, D1, D2
- **9 spare slots** — a fixed spare pouch, the same for every player
- Combined with the 9-slot Reliquary cap (§10.6), the **total rings held at any time is bounded at 23** (14 carried + 9 in the Reliquary)

| Constant | Location | Notes |
|---|---|---|
| `CORE_SLOTS` | `server/src/game/constants.ts` | The five named battle-hand slots |
| `SPARE_SLOTS` | `server/src/game/constants.ts` | Fixed spare pouch — tune here, never hardcode in the GDD |

The spare count no longer scales with aggregate Reliquary XP: the former logarithmic curve is retired in favour of one predictable number that every player can plan around.

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

The protagonist can rest at two locations: the Sanctum or any Anchorage campfire in the field. Both restore spirit fully for the same food cost. The Sanctum provides access to the reliquary and long-range teleportation; a campfire provides neither.

| Where | Food cost | Spirit restored | Reliquary access | Teleportation |
|---|---|---|---|---|
| **Sanctum sleeping area** | 25 | 100% (full gauge) | Yes | Yes (meditation circle) |
| **Anchorage campfire** | 25 | 100% (full gauge) | No | No |

Ring recharging is always available anywhere in the overworld (§12.3) — it does not require the Sanctum.

**Why return to the Sanctum:** not for sleep or ring recharging (both available in the field), but for reliquary access (swap carried rings, retire rings to grow aggregate_xp) and long-range teleportation (meditation circle). A protagonist who only campfire-rests cannot manage their ring collection or travel across biomes.

**If no food is available:**
- Buy food from a merchant at 2× forage value
- If no food and no gold: cannot rest anywhere; spirit stays depleted
- Rings stay at their current uses; the protagonist continues with whatever spirit and uses remain

### 12.5 Long-Range Teleportation (Meditation Circle)

From the Sanctum's meditation circle, the protagonist folds space to any attuned Anchorage. The protagonist and the Sanctum move together — the Sanctum relocates to the destination.

Each destination carries a `spiritCost` (`shared/waystones.ts`) that scales with spiritual distance: nearby/familiar Anchorages are cheap (0–5), distant or newly discovered ones cost more (8–15). The protagonist must hold at least `spiritCost`; on teleport that spirit is deducted.

- **Spirit gauge (`spirit_current`)** = the resource spent on teleportation and ring recharging; restored to `spirit_max` by sleeping (25 food at Sanctum or campfire)
- **Aggregate ring XP** = the permanent level that raises `spirit_max` (the reserve ceiling) and gates attunement (whether a destination is reachable at all)
- This creates the intended **preparation loop**: explore → rest → restore spirit → teleport. A depleted protagonist must rest before a long trip even if their `spirit_max` is large.

> **Earlier model (superseded):** Through 8B–8C the teleport gate used `aggregate_xp >= threshold` (no spend). 8D (#87) replaced it with the `spirit_current >= spiritCost` spend model described above, per §10.8.

### 12.5c Sanctum Summoning (Field Ability)

From any **discovered Anchorage** in the field, the protagonist can summon the Sanctum to their current location without returning to it physically. This is a natural spiritual ability — no talisman or item required.

**How it works:** the protagonist activates a campfire interaction at any Anchorage. If they have sufficient spirit, the Sanctum folds space from its current location to the protagonist's Anchorage. The Sanctum **stays** at the new Anchorage until summoned elsewhere or moved via the meditation circle.

**Cost:** equal to the `spiritCost` of the Anchorage where the Sanctum currently sits. Summoning the Sanctum from far away costs the same as if you had teleported there yourself — because the Sanctum is doing the same journey.

| Sanctum's current location | Summoning cost |
|---|---|
| Same Anchorage (already here) | 0 |
| Nearby Anchorage (same biome, low `spiritCost`) | 0–5 |
| Far Anchorage (same biome, high `spiritCost`) | 5–10 |
| Different biome | 8–15 |

**Insufficient spirit:** if the protagonist cannot afford the cost, the summon fails. They must campfire-rest at the current Anchorage (restoring full spirit for 25 food), then summon. The campfire rest → Sanctum summon sequence is always available as long as food exists — there is no death spiral.

**Unlock:** available from the moment the protagonist discovers their first Anchorage. There is no gate, no item to acquire. The ability reflects the protagonist's permanent spiritual bond with the Sanctum.

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

### 12.7 Short-range Blink

The first non-recharge use of the spirit gauge. The protagonist can teleport short distances to **interaction zones** (waystones, Anchorage campfires, Sanctum room zones) by double-clicking them.

**Targets:** Discrete interaction zones only — never arbitrary map points. Blinking replaces the walk-up-and-press-E interaction in one gesture: the protagonist blinks onto the zone and activates it simultaneously.

**Cost formula:**
```
blinkCost(distance) = max(BLINK_MIN_COST, ceil(distance / BLINK_PX_PER_SPIRIT))
```

| Constant | Value | Notes |
|---|---|---|
| `BLINK_PX_PER_SPIRIT` | 100 | Pixels per spirit unit; tune for feel |
| `BLINK_MIN_COST` | 1 | Floor cost even for short hops |
| `BLINK_MAX_RANGE` | 600 px | Client-side input gate; beyond this a double-click is ignored |

**Reference costs:**
| Hop | Distance | Cost |
|---|---|---|
| Adjacent zone | ~100 px | 1 spirit |
| Cross-room Sanctum | ~400–500 px | 4–5 spirit |
| Maximum range | 600 px | 6 spirit |

**Spirit is the natural range limiter.** There is no separate hard range rule beyond `BLINK_MAX_RANGE` — a player with full spirit can blink across a room freely; a depleted player must walk or recharge first. Blink competes with ring recharge for the same gauge (§12.3), which is the intended balance lever.

**Suppression:** Blink is unavailable while a modal overlay is open (inventory panel, sleep confirm, etc.) — the player must close the overlay first.

**Server authority:** The cost formula lives in a shared module (`shared/blink.ts`). The client reports the distance; the server validates balance and applies the deduction. Full proximity verification is deferred to a future shared WorldRoom.

---

### 12.8 Ambush Premium

A second non-recharge spirit expenditure: paying `AMBUSH_SPIRIT_COST` (5 spirit) when entering a duel grants the initiating player **first-attack initiative** (§6.10).

| Constant | Value |
|---|---|
| `AMBUSH_SPIRIT_COST` | 5 |

**Interaction with the spirit gauge:** The ambush cost is independent of the blink cost. A player who blinks to an enemy and ambushes them pays the **blink cost + ambush cost** (separate deductions). Ambush requires the blink gesture (double-click) — walking to an enemy and pressing E launches a normal duel with no first-strike option.

**Validation:** Server-enforced at `BattleRoom.onJoin`. Insufficient spirit → initiative defaults to normal; no spirit is spent.

---
