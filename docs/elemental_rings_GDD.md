# Elemental Rings — Game Design Document
**Version 3.1 | Stack: Phaser.js + Colyseus | Multiplayer-first**

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
| 12 | Open Questions | [gdd-13-open-questions.md](gdd-13-open-questions.md) | Unresolved design decisions |
| — | Build Sequence (Phases 1–9) | [GitHub Issue #14](https://github.com/krisoye/elemental-rings/issues/14) | Project management — not game design |

---

## Quick Reference

**Element triangle:** FIRE > WOOD > WATER > FIRE · Wind = neutral attack / weak defense · Earth = weak attack / neutral defense  
**Block Resolution Table:** see [§6.4](gdd-06-battle-system.md)  
**Timing windows:** PARRY ±175 ms · BLOCK ±200 ms · Telegraph 900 ms  
**Hearts per duel:** 3 · **Starting uses per ring:** 3 · **Gauge threshold:** 4  

---

## Changelog

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
