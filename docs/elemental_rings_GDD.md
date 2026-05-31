# Elemental Rings — Game Design Document
**Version 5.1 | Stack: Phaser.js + Colyseus | Multiplayer-first**

---

## Navigation

Each section lives in its own file. Read only what you need.

| # | Section | File | Notes |
|---|---------|------|-------|
| 1 | Game Overview | [gdd-01-overview.md](gdd-01-overview.md) | Core loop, tone |
| 2 | Tech Stack & Architecture | [gdd-02-tech-stack.md](gdd-02-tech-stack.md) | Server-authoritative model, LAN deployment |
| 3 | Element System | [gdd-03-element-system.md](gdd-03-element-system.md) | Triangle (Fire/Water/Wood), Wind/Earth asymmetry, fusions |
| 4 | Ring System | [gdd-04-ring-system.md](gdd-04-ring-system.md) | Tiers, uses, XP, recharge |
| 5 | Fusion System | [gdd-05-fusion-system.md](gdd-05-fusion-system.md) | Recipes, shrine mechanic, costs |
| 6 | Battle System | [gdd-06-battle-system.md](gdd-06-battle-system.md) | **Block Resolution Table, timing, rally** — read for any combat work; §6.3 Z/C hotkeys; §6.10 ambush initiative |
| 7 | Status Effects | [gdd-07-status-effects.md](gdd-07-status-effects.md) | Gauge mechanics, statuses, Shadow curse |
| 8 | Player Progression | [gdd-08-player-progression.md](gdd-08-player-progression.md) | Player XP, world gating, inventory |
| 9 | Staking Economy | [gdd-09-staking-economy.md](gdd-09-staking-economy.md) | Stake rules, jewelry positions, self-regulation |
| 10 | Overworld | [gdd-10-overworld.md](gdd-10-overworld.md) | Biomes, detection, NPC types, Sanctum, waystones, anchorages, teleportation; §10.13 short-range blink; §10.14 overworld battle-hand (Tab) |
| 10r | World Regions & Build Decomposition | [gdd-10-regions.md](gdd-10-regions.md) | Phase 8 build phases (8A–8E), Forest region screen manifest (§10.15), 8D asset mapping (§10.16), 8E BiomeScene architecture (§10.17) |
| 11 | UI and Information Display | [gdd-11-ui.md](gdd-11-ui.md) | HUD, ring reveal, status display |
| 12 | Spirit System | [gdd-12-spirit-system.md](gdd-12-spirit-system.md) | Spirit gauge, carry capacity, ring recharge, food/sleep; §12.7 short-range blink cost; §12.8 ambush premium |
| 13 | Open Questions | [gdd-13-open-questions.md](gdd-13-open-questions.md) | Unresolved design decisions |
| 14 | Talisman System | [gdd-14-talismans.md](gdd-14-talismans.md) | Sanctum summoning (natural ability), necklace/bracelet slots, future talismans |
| — | Build Sequence (Phases 1–9) | [GitHub Issue #14](https://github.com/krisoye/elemental-rings/issues/14) | Project management — not game design |

---

## Quick Reference

**Element triangle:** FIRE > WOOD > WATER > FIRE · Wind = neutral attack / weak defense · Earth = weak attack / neutral defense  
**Block Resolution Table:** see [§6.4](gdd-06-battle-system.md)  
**Timing windows:** PARRY ±175 ms · BLOCK ±200 ms · Telegraph 900 ms  
**Hearts per duel:** 3 · **Starting uses per ring:** 3 · **Gauge threshold:** 4  
**Combat hotkeys:** `1/2/3/4` = A1/A2/D1/D2 (absolute) · `Z` = slot-1-of-phase (A1 or D1) · `C` = slot-2-of-phase (A2 or D2)  
**Blink cost:** `max(1, ceil(distance / 100))` spirit · `Tab` = overworld battle-hand overlay · `AMBUSH_SPIRIT_COST` = 5  

---

## Changelog

*Document version 5.1 — Updated May 2026*
*v5.1 changes: **Sanctum Stone retired** (PR #184 / EPIC #174). The Sanctum Stone necklace talisman — which permanently transported the Sanctum from the field — no longer exists; the `talisman/activate` route and `TALISMANS` catalog were removed in code (the talisman framework itself is preserved but empty). Field Sanctum access is now a **natural spiritual ability** (summon the Sanctum to any discovered Anchorage by activating its campfire) per §14.3 / §12.5c — already documented there since PR #167. This entry propagates the retirement to the surviving stale cross-references: (1) the navigation-hub §14 description; (2) the EPIC 8C build-decomposition in §10r — the "Sanctum Stone" spec block and the #81 talisman sub-issue were removed from the 8C plan (Swamp + NPC population remain); and (3) the §10.17 `BaseBiomeScene` architecture diagram, where the stale "talisman" core-mechanic entry is corrected to "campfire (rest + Sanctum summon)" to match what shipped (PR #198). No mechanic changed in this entry — docs-only consistency pass.*

*Document version 5.0 — Updated May 2026*
*v5.0 changes: Spirit gauge becomes the universal teleportation + initiative currency. **§12.7 Short-range Blink** (new) — double-clicking an interaction zone blinks the protagonist onto it and activates it; cost = `max(1, ceil(distance/100))` spirit (BLINK_PX_PER_SPIRIT=100, BLINK_MIN_COST=1, BLINK_MAX_RANGE=600 px); first non-recharge spirit expenditure. **§12.8 Ambush Premium** (new) — spending 5 spirit at duel entry grants first-attack initiative (AMBUSH_SPIRIT_COST=5). **§6.3 Combat hotkeys** updated — Z/C phase-relative aliases added alongside 1/2/3/4 (Z = A1/D1, C = A2/D2). **§6.10 Ambush Initiative** (new) — server-validated at BattleRoom.onJoin; insufficient spirit → default initiative, no spirit spent. **§10.3 Blink approach** added — double-click enemy within range to ambush-initiate a duel. **§10.13 Short-range Blink** (new) — overworld + Sanctum blink mechanics. **§10.14 Overworld Battle-Hand Management** (new) — Tab to open battle-hand overlay from any biome, Esc to close, movement suppressed while open. §10.8 spirit-gate status updated: XP shortcut correction queued in #87. Navigation hub and Quick Reference updated. Implementation tracked in #87.*

*Document version 4.9 — Updated May 2026*
*v4.9 changes: §10.12 updated to reflect 8B.4 shipped (PRs #77/#79 + overworld-fixes) and Phase 8C decomposed (EPIC #80 → #81 Sanctum Stone, #82 Swamp biome, #83 NPC population). 8B.4 outcomes: the three Forest locations are now first-class **Anchorages** (campfire + ground ring, auto-attune on walk-in, no standing stone); the Sanctum exterior sits directly at the Anchorage center (`SANCTUM_OFFSET = 0`); two **discovery waystones** (`forest_north_stone` → Snow Fields, `forest_sw_stone` → Swamp) now exist as standing stones. §14.3 Sanctum Stone corrected: it **permanently transports** the Sanctum to the current Anchorage (physically moves and remains until re-summoned or teleported from within) — the prior "temporary connection" language was wrong. Remaining deviation from §10.8: teleport still gated on aggregate XP, not `spirit_current`.*

*Document version 4.8 — Updated May 2026*
*v4.8 changes: Major design clarification for §10.7, §10.7a, §10.8. Waystones and Anchorages are now distinct concepts. **Waystones** are revelation objects — ancient markers whose attunement reveals their region of origin and opens the path to distant areas; they are **not** teleportation destinations. **Anchorages** (§10.7a, new section) are fixed spiritual-energy concentrations in the world where the Sanctum anchors; discovered by physically walking into them (auto-attune). Teleportation goes to discovered Anchorages, not waystones. The spirit gate for teleportation is now `spirit_current` (restored by sleeping), not aggregate XP — this creates a genuine preparation loop (food → sleep → spirit → teleport). §10.6 anchoring updated to reference Anchorages. §10.9 Key Locations table updated. §10.11 Merchants updated. §10.12 Phase 8B notes updated with design-deviation flag: shipped 8B.1–8B.3 used waystones as stand-in Anchorages and aggregate XP as the gate; 8B.4 EPIC (#70) addresses visual foundation; a subsequent pass will introduce first-class Anchorages and replace the XP gate with spirit_current.*

*Document version 4.7 — Updated May 2026*
*v4.7 changes: §10.12 EPIC 8B expanded from a planning stub into the full build decomposition (EPIC [#60](https://github.com/krisoye/elemental-rings/issues/60)). 8B splits into three sub-issues — 8B.1 Forest biome map + waystone attunement (#61), 8B.2 Compass HUD (#62), 8B.3 Teleportation + Sanctum anchoring (#63). Confirmed implementation decisions: single Forest biome for the MVP; 3 waystones (`forest_entry`/`forest_glade`/`forest_depths`, XP thresholds 0/100/300, tunable); server-DB attunement persistence (`waystone_attunements` table); modal-list teleport UI (stylized world-map screen deferred); script-generated map keeping the `overworld.json` filename + `spawn`/`sanctum_return` coords; waystone metadata in `shared/waystones.ts` with positions in the map (drift-tested for id parity). Per-player overworld unchanged from 8A; shared `WorldRoom` still deferred to 8C+. Issue #14 updated.*

*Document version 4.6 — Updated May 2026*
*v4.6 changes: §10 Phase 8 build decomposition added (§10.12). Phase 8 splits into three EPICs — 8A (spatial engine + walkable Sanctum room, EPIC #54), 8B (overworld world: waystones, compass, teleportation, biome), 8C (world population: NPCs, monsters, detection, shrines). Confirmed implementation decisions: Kenney CC0 placeholder tileset (Tiled JSON pipeline, swappable), per-player overworld for MVP (shared WorldRoom deferred), CampScene key preserved, EncounterScene retained as dev tool, fusion stays in Sanctum ring-wall until shrines land in 8C. Issue #14 updated to reflect EPIC decomposition.*

*Document version 4.5 — Updated May 2026*
*v4.5 changes: Rewrote §5 Fusion System to match the v4 element model. Previous §5 referenced non-existent elements (Lightning, Ice, Metal, Lava, Frost, Ash, Obsidian) and same-element upgrade paths that don't exist in v4. New §5 documents the 10 cross-element Tier 2 fusions (all 5C2 pairs), Tier 3 framework (two maxed Tier 2 parents, recipes deferred), fusion cost (maxed parent rings + shrine access — no fusion stones), and cross-references §3.4 for all combat mechanics. Closed fusion-stone open question.*

*Document version 4.4 — Updated May 2026*
*v4.4 changes: The Sanctum replaces the horse/caravan as the protagonist's mobile home. Waystones (ancient permanent world objects) are touched to attune, adding teleportation destinations to the world map. A spiritual compass guides the protagonist toward nearby undiscovered waystones. Teleportation is initiated from the Sanctum's meditation circle and requires sufficient aggregate ring XP as the spiritual level threshold. Horse food removed — food is now only for sleeping (25 food = full spirit restore). §8 rewritten: protagonist has no independent XP — spirit gauge max is directly derived from aggregate ring XP (Option A). §10 overworld comprehensively rewritten with Sanctum, Waystone, Compass, Teleportation, and updated Key Locations. §12 spirit system updated: spirit gauge vs aggregate XP distinction clarified; teleportation unlocks via aggregate, not spirit gauge. Staking strategic implications documented.*

*Document version 4.3 — Updated May 2026*
*v4.3 changes: New §12 Spirit System — spirit gauge as primary progression stat; spirit capacity = carry capacity (not physical weight); recharge costs 1 spirit unit per use, anywhere in overworld; sleep (25 food) restores full spirit gauge; "Recharge All" prioritizes battle hand first. §8 updated: spirit gauge replaces inventory expansion as progression axis; no hard total inventory cap (camp holds everything). §4.3 updated: recharge costs spirit (not gold). §10 updated: caravan model (§10.5b horse/wagon, branching world map, safe area as micro-hub, camp loop); food/foraging (§10.7 — 25 food/sleep, 100 food/travel day, forage/merchant/boss drop mechanics, starvation). §13: added spirit tuning and food quantity open questions. Gold is now merchants-only — sleep no longer costs gold.*

*Document version 4.2 — Updated May 2026*
*v4.2 changes: (a) Staking — rewrote §9.3 with 5 element-specific Thumb passives (Kindling/Wellspring/Deep Roots/Tailwind/Bulwark); updated §9.1 (Thumb IS loadout slot); added §9.5 gold rewards (50g/win, sleep 50g, recharge 10g/use). (b) Carry system — rewrote §4.1 with inventory/loadout/battle-hand/spare distinction; updated §6.1 (carry loadout context); updated §6.8 (post-battle won-ring prompt with swap/leave/discard options); added §10.7 Merchants (carry cap expansion, garments, wandering merchants, city concept). (c) NPC archetypes — expanded §10.5 with full loadout tables for 4 personalities. (d) Resolved open questions: auto-align, SQLite, auth, fusion names, NPC archetypes, post-battle ring prompt. (e) Closed §3.4 Open Question; fixed §6.4 fusion TBD; updated §11.1 and §11.6.*

*Document version 4.0 — Updated May 2026*
*v4.0 changes: Replaced 5-element pentagon with triangle (Fire/Water/Wood) + asymmetric neutrals (Wind/Earth). Redesigned loadout from free hand selection to 5 named slots (Thumb/A1/A2/D1/D2). Removed off-hand system. Phase-locked input: attack/defense buttons only active in correct phase. Fusion rings are pre-equipped (no chord input). Gauges and statuses reduced to 3 (triangle elements only).*

*Document version 3.1 — Updated May 2026*
*v3.1 changes: GDD consistency pass. Fixed all subsection numbers (were off by 1 vs ToC throughout). Added §6.4 Block Resolution Table expanded row-per-outcome format. Corrected: hearts settled at 3; parry costs 1 use only (volley is free); gauge fills only on uncontested hit. Fixed all cross-references. Split into per-section files; build sequence moved to [GitHub Issue #14](https://github.com/krisoye/elemental-rings/issues/14).*

*Document version 3.0 — Updated May 2026*
*v3.0 changes: Pivoted from Godot 4.x to **Phaser.js + Colyseus** multiplayer stack. Added §2 Tech Stack & Architecture. Rewrote §12 Build Sequence for 9 TypeScript/Playwright phases. Updated §13 Open Questions. Removed all Godot-specific implementation notes.*

*Document version 2.2 — Updated May 2026*
*v2.2 changes: Replaced simultaneous-secret turn model with **active timed-block** model and rally mechanic. Rewrote §6.4 damage rules around timing × element axes. Removed auto-reflect in favour of interactive rally volley chain.*

*Document version 2.1 — Updated May 2026*
*v2.1 changes: Simplified neutral block rules. Rewrote §7 from rolling-window combo system to persistent gauge model. Replaced restrictive status effects with attrition-based effects. Fused rings decompose recursively to base elements.*

*Document version 2.0 — Updated May 2026*
*v2.0 changes: Loadout system, dominant/off hand split, post-battle ring management, recharge timer, biomes, monster flee/steal mechanics, detection and approach system, staking jewelry positions, off hand passive recharge drip, staked ring XP, full NPC category breakdown.*
