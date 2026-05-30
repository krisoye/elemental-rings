## 4. Ring System

### 4.1 Inventory and Carry

**The Reliquary** is the protagonist's full ring collection, housed in the Sanctum. Rings in the Reliquary are not carried — they rest on the Sanctum walls. The aggregate XP of all Reliquary rings (`aggregate_xp`) determines the protagonist's spirit gauge maximum (`spirit_max`). See §10.6 and §10.8.

**Loadout (carry)** is the subset of rings the player takes on an expedition — chosen at camp before setting out. Only carried rings are accessible in the overworld and during battle. Carried rings are **not** part of `aggregate_xp`.

| Concept | Description | Default cap | Expandable |
|---|---|---|---|
| Reliquary | All rings stored in the Sanctum; not in carry loadout; sum of their XP = `aggregate_xp` | No hard limit | No |
| Loadout (carry) | Rings taken on expedition; excluded from `aggregate_xp` | 10 | Yes — via merchant |
| Battle hand | 5 named slots (Thumb/A1/A2/D1/D2) used in combat | 5 (fixed) | No |
| Spare | Carried rings not assigned to battle slots; swappable between encounters | up to carry cap − 5 | Via carry cap |

- **Carry cap expansion:** buying more carry capacity from a merchant (see §10.7)
- Rings in the Reliquary recharge uses on the game day timer
- Rings on your person do **not** recharge in the field — only at camp (sleep or paid recharge)
- Rings in the Reliquary do **not** earn XP — battle use is the only XP source (see §4.4)

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

"Naturally" means the ring's own battle XP pushed it through the threshold. Fusion can also land a ring at a tier (see §4.6), but that does not trigger the +1 use grant — the ring must earn *additional* XP in battle past the next threshold to collect it.

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
- Minimum tier to fuse: **Tier 2** (both rings must have ≥ 1 500 XP)
- Both parent rings are consumed; they cease to exist
- The fused ring's **XP = parent1.xp + parent2.xp** — the full investment of both parents is preserved
- The fused ring's **tier is determined by its total XP** via the standard tier formula
- The fused ring's **max uses = min(parent1.max\_uses, parent2.max\_uses) − 1**

**Uses penalty:** the −1 deduction reflects the energy cost of combining two rings. The fused ring is not weaker per se — it has a compound element that covers more match-ups — but it has fewer shots before depleting. It earns the next +1 use by crossing the following tier threshold naturally through battle.

**Worked example — fusing two minimum Tier 2 rings:**

| | Parent 1 | Parent 2 | Fused result |
|---|---|---|---|
| XP | 1 500 | 1 500 | 3 000 |
| Tier | 2 | 2 | 3 (lands at threshold) |
| Max uses | 5 | 5 | min(5,5) − 1 = **4** |
| Next +1 use | — | — | Cross Tier 4 (5 000 XP) in battle |

The fused ring starts at Tier 3 with 4 uses. A natural Tier 3 ring has 6 uses. The 2-use gap closes as the fused ring earns XP: +1 use at Tier 4, +1 more at Tier 5, and so on.

**Two progression paths:**

| Path | Mechanic | Reward | Cost |
|---|---|---|---|
| Natural ascension | Battle XP accumulates on one ring | +1 use per tier; ring retains its element | Time invested in a single ring |
| Fusion | Two same-tier rings combined | Compound element — broader offensive coverage, no weakness | Both parent rings consumed; starts with fewer uses |

Players who invest deeply in one ring gain durability (more uses). Players who fuse gain element coverage (stronger match-up profile). Both paths lead to high-tier rings; neither is strictly superior.

**Element count is separate from tier.** A fused ring's compound element is what it is regardless of how high a tier it reaches. A Steam ring at Tier 5 is still Steam — it does not become a three-element ring. Maximum fusion depth is **two elements**.

---
