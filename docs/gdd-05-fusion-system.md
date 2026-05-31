## 5. Fusion System

### 5.1 Core Rules
- Fusion combines two parent rings into a single higher-tier ring
- Both parent rings must have reached the **XP cap for their tier** before they can be fused
- The fused ring **inherits combined XP** from both parents (additive)
- The fused ring's uses **reset to the full max uses of the new tier** (Tier 2 → 5 uses, Tier 3 → 7 uses)
- The two parent rings are **consumed** by the fusion — they no longer exist as separate rings
- Fusing is a long-term gain (higher tier, more uses, more power) but a short-term cost (both parents lost, new ring must earn XP)

> **Design note (v4.5/v5.0):** Earlier drafts included same-element upgrades (Fire+Fire→Lightning, etc.) and elements that no longer exist in v4 (Lightning, Ice, Metal, Lava, Frost, Ash, Obsidian). The v4 element system uses 5 base elements (Fire/Water/Earth/Wind/Wood) plus Shadow (a special 6th element obtained only as a drop — see §3.5). All base fusions are cross-element pairs; there are no same-element upgrade paths. Shadow fuses with all 5 base elements to produce 5 additional dark-variant Tier 2 fusions (see §5.2 Shadow Fusions).

### 5.2 Fusion Table (All Tier 2 Recipes)

There are **15 Tier 2 fusions**: 10 base-element fusions (every distinct pair of the 5 base elements) and 5 Shadow fusions (Shadow + each base element). All are valid Tier 2 rings.

**Base fusions (10):**

| Fusion | Parents | Name | Gauge contribution (uncontested hit) |
|---|---|---|---|
| Fire + Water | Fire, Water | **Steam** | Fire +1, Water +1 |
| Fire + Wood | Fire, Wood | **Wildfire** | Fire +1, Wood +1 |
| Fire + Wind | Fire, Wind | **Inferno** | Fire +1 (Wind: none) |
| Fire + Earth | Fire, Earth | **Magma** | Fire +1 (Earth: none) |
| Water + Wood | Water, Wood | **Tidal** | Water +1, Wood +1 |
| Water + Wind | Water, Wind | **Storm** | Water +1 (Wind: none) |
| Water + Earth | Water, Earth | **Mud** | Water +1 (Earth: none) |
| Wood + Wind | Wood, Wind | **Thornado** | Wood +1 (Wind: none) |
| Wood + Earth | Wood, Earth | **Bloom** | Wood +1 (Earth: none) |
| Wind + Earth | Wind, Earth | **Dust** | None (neither parent is a triangle element) |

Only triangle components (Fire, Water, Wood) contribute to gauges. Wind and Earth carry no gauge weight in any fusion.

**Shadow fusions (5) — dark-variant Tier 2:**

These require a Shadow drop ring as a parent. Obtainable only at shrines; Shadow cannot be crafted, only found (§3.5). Shadow fusions participate in the Shadow gauge (Blinded status, §7.2) rather than the triangle gauge system; their specific combat mechanics require a dedicated design pass.

| Fusion | Parents | Name |
|---|---|---|
| Shadow + Fire | Shadow, Fire | **Eclipse** |
| Shadow + Water | Shadow, Water | **Void** |
| Shadow + Earth | Shadow, Earth | **Abyss** |
| Shadow + Wind | Shadow, Wind | **Wraith** |
| Shadow + Wood | Shadow, Wood | **Plague** |

### 5.3 Tier 3 Fusions

A Tier 3 ring is created by fusing two **maxed Tier 2** parent rings. Both parents must have XP ≥ 300 (the Tier 2 cap). The Tier 3 ring has `max_uses = 7`.

Tier 3 recipes are not yet fully defined — they will emerge from the overworld design (which shrine unlocks which Tier 3, and what new element names apply). Flagged as an **open question** (§13).

### 5.4 Fusion Crafting

**Where:** Fusion shrines in the overworld. Each shrine is associated with one or more recipes. The player must physically reach the shrine to craft there. *(Phase 8 — for now, fusion is accessible from the Sanctum camp screen for development and testing.)*

**Shrine sealing — the ring-key mechanic:**
Some shrines are sealed on first visit. A sealed shrine displays its recipe but cannot be used until the player presents a ring of the correct fusion type to the altar. The ring is **consumed** as a key — it opens the shrine doors permanently for all future visits. The ring must be won in combat (typically from a guardian NPC who wields one in the area around the shrine).

| Shrine | Location | Sealed? | Key required |
|---|---|---|---|
| Thornado | Forest biome, eastern wing | Yes | A Thornado ring (won from the Shrine Guardian) |
| Bloom | Forest biome, deep south wing | No | Open; no key required |

The Thornado shrine is reachable before the Forest boss, but the key must be won first — the Shrine Guardian in that screen is the only source of a Thornado ring before crafting is unlocked.

**How to craft:**
1. The player visits an open shrine (or the Sanctum in early phases)
2. They select two rings they own that form a valid pair and are both at their tier's XP cap
3. The game previews the result (element, tier, XP, uses)
4. The player confirms — parent rings are consumed, fusion ring is created and added to inventory

**Discovery:** The complete list of Tier 2 recipes is always visible at any shrine (all 10 pairs). The shrine's location and access threshold (aggregate ring XP needed to reach it) is the gate, not recipe knowledge. Future shrine-specific Tier 3 recipes may be hidden until the shrine is reached.

### 5.5 Fusion Cost Summary

| Tier | Requirements |
|---|---|
| Tier 2 (any cross-element pair) | Two maxed Tier 1 rings (XP ≥ 100 each) + shrine access |
| Tier 3 (two Tier 2 parents) | Two maxed Tier 2 rings (XP ≥ 300 each) + shrine access |

No fusion stones. No gold. The cost is the **rings themselves** (consumed) and the **time to max them** (XP grind). Shrine access is gated by the aggregate ring XP required to reach that area of the overworld.

### 5.6 Fusion Combat Mechanics

Fusion ring combat behavior (how they attack, how they defend, auto-align) is documented in **§3.4**. All combat logic for fusion rings is already implemented in `BlockResolver.ts`.

---
