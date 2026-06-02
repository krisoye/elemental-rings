## 15. Settings & Difficulty

Difficulty in Elemental Rings is not a wall of damage sliders. It is a single, honest lever: **how scarce spirit feels**. The player chooses a named tier that scales their spirit gauge maximum, and they can change it anytime from the Sanctum's Settings button. The choice is about mood and pacing — whether spirit is a backdrop or a constant companion — not about whether the game is "beatable."

### 15.1 Difficulty Tiers

Three named tiers, each a multiplier on the spirit formula (see §12.1). The multipliers are the single source of truth in `DIFFICULTY_MULTIPLIERS` (`shared/types.ts`); the client never recomputes `spirit_max` itself.

| Tier | Multiplier | Spirit feel |
|---|---|---|
| **Wanderer** | ×5 | Spirit is a backdrop — focus on rings and battles |
| **Seeker** (default) | ×4 | Meaningful choices — spirit matters but rarely desperate |
| **Ascendant** | ×3 | Spirit is always on your mind |

`spirit_max = SUM(max_uses WHERE in_carry = 0) × DIFFICULTY_MULTIPLIERS[player.difficulty]`

A new player defaults to **Seeker**. Existing players migrate to Seeker on the difficulty-column rollout. An empty Reliquary still yields `spirit_max = 0` regardless of tier — the multiplier scales a sum that starts at zero (the zero-spirit design intent in §12.1).

### 15.2 Spirit as the difficulty lever

Spirit is the right knob because it is the resource that touches every system the player cares about: ring recharge, teleportation, and Sanctum summoning all draw from it. Scaling `spirit_max` therefore changes how often the player must stop and manage spirit without ever changing combat math, ring drops, or world layout. A higher multiplier (Wanderer) means the same Reliquary yields a deeper pool, so spirit rarely runs dry; a lower multiplier (Ascendant) tightens the pool so every recharge and teleport is a real decision.

Crucially, because spirit derives from the Reliquary, difficulty interacts with progression organically: a deep, mature Reliquary feels comfortable even on Ascendant, while a thin one feels tense even on Wanderer. The tier shifts the curve; the player's collection still earns its place on it.

### 15.3 What difficulty controls now

For the current build, difficulty controls **exactly one thing: the spirit multiplier**. There are no hidden adjustments. Selecting a tier:

1. Persists `players.difficulty`.
2. Recomputes `spirit_max` under the new multiplier.
3. Clamps `spirit_current` down to the new `spirit_max` (the gauge never reads above its cap).

Combat damage, AI behaviour, ring drop rates, fusion rules, food economy, and travel distances are all **unaffected** by difficulty today. This keeps the lever legible: a player who switches tiers knows precisely what changed.

### 15.4 Future difficulty knobs

The tier system is deliberately built as a bundle that currently carries a single value, so additional knobs can be folded into each tier later without a UI redesign or a second setting. Candidate future levers, all expressed as per-tier scalars:

- **Food cost** — sleeping / resting consuming more food on harder tiers.
- **Teleport cost** — spirit per unit distance scaling up on Ascendant.
- **Recharge efficiency** — spirit-per-use returned when recharging rings.
- **NPC spirit pools** — how much recharge a Sanctum NPC can offer.

These are **placeholders**, not commitments. If added, each would key off `player.difficulty` the same way the spirit multiplier does, and §15.3 would be updated to list the new controls so the lever stays legible.

### 15.5 Where to change

Difficulty is changed from the **Settings button** in CampScene (the Sanctum interior). Unlike Reliquary, Recharge, and Sleep — which are spatial stations the player walks to — Settings is a persistent HUD button, because difficulty is a global preference rather than a place-bound action.

Pressing Settings opens the **Difficulty modal**, which lists all three tiers with their multiplier and spirit-feel description. The player's current tier is highlighted. Selecting a different tier issues `PUT /api/difficulty { tier }`; the server applies the change (§15.3) and returns the recomputed `spirit_max`, which the client mirrors into the stats header immediately. The header shows the active tier as a bracketed label after the spirit gauge (e.g. `Spirit: 45 / 100 [Wanderer]`). Selecting the current tier, dismissing with `[×]`, or clicking outside the modal closes it with no change.
