# Elemental Rings — Game Design Document
**Version 4.5 | Stack: Phaser.js + Colyseus | Multiplayer-first**

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
| 6 | Battle System | [gdd-06-battle-system.md](gdd-06-battle-system.md) | **Block Resolution Table, timing, rally** — read for any combat work |
| 7 | Status Effects | [gdd-07-status-effects.md](gdd-07-status-effects.md) | Gauge mechanics, statuses, Shadow curse |
| 8 | Player Progression | [gdd-08-player-progression.md](gdd-08-player-progression.md) | Player XP, world gating, inventory |
| 9 | Staking Economy | [gdd-09-staking-economy.md](gdd-09-staking-economy.md) | Stake rules, jewelry positions, self-regulation |
| 10 | Overworld | [gdd-10-overworld.md](gdd-10-overworld.md) | Biomes, detection, NPC types, locations |
| 11 | UI and Information Display | [gdd-11-ui.md](gdd-11-ui.md) | HUD, ring reveal, status display |
| 12 | Spirit System | [gdd-12-spirit-system.md](gdd-12-spirit-system.md) | Spirit gauge, carry capacity, ring recharge, food/sleep |
| 13 | Open Questions | [gdd-13-open-questions.md](gdd-13-open-questions.md) | Unresolved design decisions |
| 14 | Talisman System | [gdd-14-talismans.md](gdd-14-talismans.md) | Sanctum Stone, necklace/bracelet slots, future talismans |
| — | Build Sequence (Phases 1–9) | [GitHub Issue #14](https://github.com/krisoye/elemental-rings/issues/14) | Project management — not game design |

---

## Quick Reference

**Element triangle:** FIRE > WOOD > WATER > FIRE · Wind = neutral attack / weak defense · Earth = weak attack / neutral defense  
**Block Resolution Table:** see [§6.4](gdd-06-battle-system.md)  
**Timing windows:** PARRY ±175 ms · BLOCK ±200 ms · Telegraph 900 ms  
**Hearts per duel:** 3 · **Starting uses per ring:** 3 · **Gauge threshold:** 4  

---

## Changelog

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
