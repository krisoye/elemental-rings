## 4. Ring System

### 4.1 Inventory and Carry

**The Reliquary** is the protagonist's full ring collection, housed in the Sanctum. Rings in the Reliquary are not carried — they rest on the Sanctum walls. The aggregate XP of all Reliquary rings (`aggregate_xp`) determines the protagonist's spirit gauge maximum (`spirit_max`). See §10.6 and §10.8.

**Loadout (carry)** is the subset of rings the player takes on an expedition — chosen at camp before setting out. Only carried rings are accessible in the overworld and during battle. Carried rings are **not** part of `aggregate_xp`.

| Concept | Description | Cap | Grows via |
|---|---|---|---|
| Reliquary | All rings stored in the Sanctum; not in carry loadout; sum of their XP = `aggregate_xp` | 9 (default) | Reliquary Shard (+10, see §4.1.1) |
| Battle hand | 5 named slots (Thumb/A1/A2/D1/D2) used in combat | 5 (fixed) | No |
| Spare grid | Carried rings NOT assigned to any battle slot; swappable between encounters | `spare_ring_max` (default 9, per-player) | Future expansion |
| Loadout (carry) | Battle hand + spare grid combined | `spare_ring_max` + 5 (default 14) | Grows with `spare_ring_max` |

- **Spare grid** (`spare_ring_max`, default **9** per player): the rings carried but not in any named battle slot. This cap is stored as a per-player DB column and can be expanded independently in the future. The former `SPARE_SLOTS` constant still provides the default value. *(UI label: the Spare grid is shown to the player as **"Bench"** in the ring-management overlays — the canonical mechanic name stays "Spare grid"; the code/DB/API identifiers stay `spare_*`.)*
- **Battle hand and spare grid are independent pools.** Clearing a battle slot does **not** free spare capacity — the spare-grid cap counts only rings that are carried AND not in any battle slot. An empty battle slot is simply an empty battle slot; it has no effect on how many spare rings the player may hold.
- **WON ring overflow:** when a player wins a ring but the spare grid is already at `spare_ring_max`, the ring is added to carry as a **pending** ring (one allowed overflow slot). The player must resolve this — by discarding a spare, assigning the ring to a slot, or discarding the won ring — before the pending flag is cleared. `pending_ring_id` in `/api/me` is the authoritative identifier for an unresolved WON ring; it replaces the former `er_pending_ring` client-side key.
- Combined with the default Reliquary cap (§4.1.1), the total rings held at any time is bounded at **23** (14 carried + 9 resting) at default settings. See §12.2.
- Rings in the Reliquary recharge uses on the game day timer
- Rings on your person do **not** recharge in the field — only at camp (sleep or paid recharge)
- Rings in the Reliquary do **not** earn XP — battle use is the only XP source (see §4.4)

#### 4.1.1 Reliquary Capacity and Expansion

The Reliquary holds a **bounded** number of rings so the protagonist cannot stockpile hundreds of low-XP rings. The cap counts only rings **resting in the Sanctum** — `in_carry = 0` and **not** out on a stake (`escrowed = 0`). Carried rings and staked rings do not consume Reliquary slots.

| Property | Value |
|---|---|
| Default Reliquary capacity | **9** rings |
| Expansion increment | **+10** rings per Reliquary Shard added |
| Effective maximum | Bounded by the number of major bosses (each yields one Shard) — no separate hard cap |

**How the Reliquary fills.** Won rings do **not** go to the Reliquary — a won ring is added to the **loadout** (carried), or discarded, via the post-battle prompt. The Reliquary grows only when the player, at the Sanctum, **moves a carried ring back onto the Sanctum walls** (loadout → Reliquary). This is the single fill path.

**Behaviour when full.** When the Reliquary is at capacity, the loadout → Reliquary move is **blocked**: the player cannot return a carried ring to the Sanctum until they free a slot by discarding a resting Reliquary ring. The Reliquary panel locks the drop action and shows the cap, mirroring the existing carry-cap lock. (Won rings are unaffected — they only ever enter the loadout or are discarded.)

**Reliquary Shard.** A consumable dropped by **major bosses** (one per major boss), held as a per-character counter (`reliquary_shards`). At the Sanctum the player **adds a Shard to the Reliquary**: this consumes one Shard (`reliquary_shards − 1`) and permanently expands capacity by +10 (`reliquary_cap + 10`). Because Shards come only from finite major bosses, the maximum Reliquary size is naturally bounded by how many major bosses the campaign contains.

### 4.2 Ring Tiers

**Tier is a function of XP alone** — it is not determined by element count or fusion history. A single-element ring and a fused ring at the same XP total are the same tier. There are no XP caps.

Tier thresholds follow a **triangular-number × 500** pattern. Each tier's XP range is 500 wider than the previous, making higher tiers progressively harder to reach.

| Tier | Starts at | Range width | Formula |
|---|---|---|---|
| 0 | 0 XP | 500 | `500 × T(0) = 0` |
| 1 | 500 XP | 1 000 | `500 × T(1) = 500` |
| 2 | 1 500 XP | 1 500 | `500 × T(2) = 1 500` |
| 3 | 3 000 XP | 2 000 | `500 × T(3) = 3 000` |
| 4 | 5 000 XP | 2 500 | `500 × T(4) = 5 000` |
| 5 | 7 500 XP | 3 000 | `500 × T(5) = 7 500` |
| n | `250 × n × (n+1)` | `500 × (n+1)` | Extends indefinitely |

> **Formula:** Tier n starts at `250 × n × (n + 1)` XP. Equivalently, the nth triangular number T(n) = n(n+1)/2, and Tier n starts at `500 × T(n)`.

**Max uses grow with tier.** Every time a ring **naturally** crosses a tier threshold through battle XP, it permanently gains **+1 max use**. A ring starts at 3 uses and gains 1 use per tier:

| Tier | Max uses (natural) |
|---|---|
| 0 | 3 |
| 1 | 4 |
| 2 | 5 |
| 3 | 6 |
| 4 | 7 |
| n | 3 + n |

**Max uses is a pure function of XP** — `max_uses = 3 + tier(xp)` — for *every* ring, natural or fused, with no exceptions. "Naturally" above just describes the common path (a ring's own battle XP carrying it across a threshold); a fused ring lands at the same `3 + tier` for its combined-XP tier (see §4.6), so the table holds for it too.

### 4.3 Ring Uses
- Uses are consumed during battle (attacking and defending)
- **Uses are NOT permanently lost** — they are restored by the player's spiritual energy
- Recharging costs **1 spirit unit per use restored** and can be done anywhere in the overworld (see §12)
- After sleeping at camp (costs 25 food, restores full spirit gauge), the player chooses which rings to recharge with their restored spirit
- A ring extinguished mid-battle (uses reach 0) cannot be used for the rest of that duel
- Rings left at camp recharge passively on the game day timer even while the player is in the field

### 4.4 Ring XP
- **Battle use is the only source of XP.** A ring earns XP only when the protagonist uses it in a duel — more uses in a duel = more XP for that ring
- Rings in the Reliquary, spare carry slots, or any resting state earn no XP
- XP is permanent and carries through fusion
- Losing a ring via staking means losing all XP associated with it
- *Exception:* a staked ring earns passive XP through the use-per-battle cost of its buff while staked (see §9) — this is the only passive XP path

### 4.5 Ring Abilities
- Rings unlock passive and active abilities as they accumulate XP
- Ability design: *flagged for future design session*

### 4.6 Fusion — Ring Crafting

Fusion combines two rings of the **same tier** into a single compound-element ring. The compound element's battle behaviour is defined in §3.4.

**Fusion rules:**
- Both parent rings must be the **same tier**
- Minimum tier to fuse: **Tier 1** (both rings must have ≥ 500 XP)
- Both parent rings are consumed; they cease to exist
- The fused ring's **XP = parent1.xp + parent2.xp** — the full investment of both parents is preserved
- The fused ring's **tier is determined by its total XP** via the standard tier formula
- The fused ring's **max uses = 3 + tier(parent1.xp + parent2.xp)** — the same pure-XP rule every natural ring obeys (§4.2), with no fusion exception

**Unified XP-only rule:** a fused ring is just a ring at its combined-XP tier. Its max uses follow `3 + tier` exactly like a natural ring, so the `max_uses = 3 + tier(xp)` invariant holds universally. Because XP is additive, two near-cap same-tier parents can push the combined XP into the *next* tier — in which case the child lands at that higher tier's full uses, which may exceed either parent. That is intended: the player banked the parents' combined investment.

**Worked example — fusing two minimum Tier 1 rings (stays in Tier 1):**

| | Parent 1 | Parent 2 | Fused result |
|---|---|---|---|
| XP | 500 | 500 | 1 000 |
| Tier | 1 | 1 | 1 (XP 1 000 is within Tier 1's range) |
| Max uses | 4 | 4 | 3 + 1 = **4** |

**Worked example — fusing two near-cap Tier 1 rings (crosses into Tier 2):**

| | Parent 1 | Parent 2 | Fused result |
|---|---|---|---|
| XP | 1 400 | 1 400 | 2 800 |
| Tier | 1 | 1 | 2 (XP 2 800 is within Tier 2's range) |
| Max uses | 4 | 4 | 3 + 2 = **5** |

The fused ring is a ring at its combined-XP tier — no penalty, no catch-up. Combining the full XP of both parents is what can carry it into a higher tier.

**Two progression paths:**

| Path | Mechanic | Reward | Cost |
|---|---|---|---|
| Natural ascension | Battle XP accumulates on one ring | Higher tier (and its `3 + tier` uses); ring retains its single element | Time invested in a single ring |
| Fusion | Two same-tier rings combined | Compound element — broader offensive coverage, no weakness — at the combined-XP tier | Two rings (two elements) collapse into one compound body; the second ring's separate identity is gone |

Players who invest deeply in one ring keep a focused single element; players who fuse trade two rings for one compound body with broader match-up coverage. Both paths reach high tiers and both follow the same `3 + tier` uses rule; neither is strictly superior.

**Element count is separate from tier.** A fused ring's compound element is what it is regardless of how high a tier it reaches. A Steam ring at Tier 5 is still Steam — it does not become a three-element ring. Maximum fusion depth is **two elements**.

---
