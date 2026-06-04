# Elemental Rings — Game Design Document
**Stack: Phaser.js + Colyseus | Multiplayer-first | Living design document**

---

## Navigation

Each section lives in its own file. Read only what you need.

| # | Section | File | Notes |
|---|---------|------|-------|
| 1 | Game Overview | [gdd-01-overview.md](gdd-01-overview.md) | Core loop, tone |
| 2 | Tech Stack & Architecture | [gdd-02-tech-stack.md](gdd-02-tech-stack.md) | Server-authoritative model, LAN deployment |
| 3 | Element System | [gdd-03-element-system.md](gdd-03-element-system.md) | Triangle (Fire/Water/Wood), Wind/Earth asymmetry, fusions |
| 4 | Ring System | [gdd-04-ring-system.md](gdd-04-ring-system.md) | Tiers, uses, XP, recharge |
| 5 | Fusion System | [gdd-05-fusion-system.md](gdd-05-fusion-system.md) | Recipes, eligibility, fused rings, shrines |
| 6 | Battle System | [gdd-06-battle-system.md](gdd-06-battle-system.md) | **Initiative model, Block Resolution Table, timing, rally** — read for any combat work; §6.3 initiative + Z/C hotkeys; §6.4 rally chain + initiative transfer; §6.10 ambush initiative |
| 7 | Status Effects | [gdd-07-status-effects.md](gdd-07-status-effects.md) | Gauge mechanics, statuses, Shadow curse |
| 8 | Player Progression | [gdd-08-player-progression.md](gdd-08-player-progression.md) | Player XP, world gating, inventory |
| 9 | Staking Economy | [gdd-09-staking-economy.md](gdd-09-staking-economy.md) | Stake rules, jewelry positions, self-regulation |
| 10 | Overworld | [gdd-10-overworld.md](gdd-10-overworld.md) | Biomes, detection, NPC types, Sanctum, waystones, anchorages, teleportation; §10.13 short-range blink; §10.14 overworld battle-hand (Tab) |
| 10r | World Regions | [gdd-10-regions.md](gdd-10-regions.md) | Overworld architecture, Forest region screen manifest (§10.15), terrain/asset approach, biome-scene architecture |
| 11 | UI and Information Display | [gdd-11-ui.md](gdd-11-ui.md) | HUD, ring reveal, status display |
| 12 | Spirit System | [gdd-12-spirit-system.md](gdd-12-spirit-system.md) | Spirit gauge, carry capacity, ring recharge, food/sleep; §12.7 short-range blink cost; §12.8 ambush premium |
| 13 | Open Questions | [gdd-13-open-questions.md](gdd-13-open-questions.md) | Unresolved design decisions |
| 14 | Talisman System | [gdd-14-talismans.md](gdd-14-talismans.md) | Sanctum summoning (natural ability), necklace/bracelet slots, future talismans |

> **Implementation status lives in GitHub, not here.** This GDD describes the *intended game* — its rules, systems, world, and feel. What is built, what is in progress, and the EPIC/issue breakdown are tracked on the [GitHub Issues board](https://github.com/krisoye/elemental-rings/issues) and the project board. When code and the GDD disagree, that is a bug to resolve deliberately — never a silent divergence.

---

## Quick Reference

**Element triangle:** FIRE > WOOD > WATER > FIRE · Wind = neutral attack / weak defense · Earth = weak attack / neutral defense  
**Block Resolution Table:** see [§6.4](gdd-06-battle-system.md)  
**Timing windows:** PARRY ±175 ms · BLOCK ±200 ms · Telegraph 900 ms  
**Hearts per duel:** 3 · **Starting uses per ring:** 3 · **Gauge threshold:** 4  
**Combat hotkeys:** `1/2/3/4` = A1/A2/D1/D2 (absolute) · `Z` = slot-1-of-phase (A1 or D1) · `C` = slot-2-of-phase (A2 or D2)  
**Blink cost:** `max(1, ceil(distance / 100))` spirit · `Tab` = overworld battle-hand overlay · `AMBUSH_SPIRIT_COST` = 5  

---

## Design-Change Log

This log records **how the game's design has evolved** — the decisions that changed what Elemental Rings *is*. It is deliberately not a build log: implementation status, PRs, and EPIC breakdowns live in GitHub, and the line-level history of these documents lives in git.

- **2026-06-04 — Fusion drops the same-tier requirement.** Fusion no longer requires both parents to share a tier; it keeps the per-parent ≥ 500 XP (Tier 1) gate and the valid-element-pair rule, and now explicitly bars re-fusing a ring that is already a fusion. This lets a player combine a deeply leveled ring with a compatible fresh Tier-1 ring instead of having to grind a second ring up to the same tier first. (Supersedes the same-tier phrasing in the *Fusion is XP-driven and tier-emergent* entry below.)
- **Spirit is the universal travel + initiative currency.** The spirit gauge gates long-range Sanctum teleportation (spend `spiritCost` per destination), powers short-range **blink** (double-click an interaction zone to teleport onto it; cost scales with distance), and buys **ambush initiative** (spend at duel entry for the first attack). This creates the core preparation loop: forage → sleep to restore spirit → travel / ambush.
- **Field Sanctum access is a natural ability.** The protagonist summons the Sanctum to any discovered Anchorage by activating its campfire. (An earlier "Sanctum Stone" talisman that did this was retired; the talisman framework remains for future talismans.)
- **Waystones and Anchorages are distinct.** *Anchorages* are spiritual-energy sites the Sanctum can anchor to — discovered by walking in, and the destinations of teleportation. *Waystones* are revelation markers — attuning one reveals a distant region — not teleport destinations.
- **Biome gates are bosses, not attunement.** Passage between biomes is held by a boss NPC that physically blocks the exit until defeated, rather than by a waystone the player must attune.
- **Fusion is XP-driven and tier-emergent.** Two rings of different base elements, each at ≥ Tier 1 (the same-tier requirement was dropped 2026-06-04), fuse into a dual-element ring whose XP is the sum of its parents; the result's tier follows from that total. A fusion ring cannot be fused again. Fusion happens at the Sanctum ring-wall, and at in-world **Fusion Shrines** that unlock specific recipes as a world-progression reward.
- **The overworld is a multi-screen biome graph.** Biomes are graphs of discrete tilemap screens connected by walkable edges; the Forest is the first full region (28 screens, §10.15). The Sanctum is a walkable interior home.
- **Combat uses an initiative model with active timed-block and rally chains.** One player holds initiative and chooses to attack, recharge, or forfeit; the other reacts. A STRONG PARRY fires a counter-volley, extending the current initiative phase. After any chain resolves — regardless of rally depth or who scored hits — initiative passes strictly to the other player. (Replaced an earlier simultaneous-secret turn model.)
- **Element model is a triangle + asymmetric neutrals.** Fire > Wood > Water > Fire, with Wind (strong attack / weak defense) and Earth (weak attack / neutral defense) as neutrals — replacing the earlier five-element pentagon. Status effects are the three triangle gauges.
- **Five-slot named loadout.** Thumb / A1 / A2 / D1 / D2, with phase-locked input (attack slots active only in the attack phase, defense slots in the defense phase). Replaced free-hand selection and the dominant/off-hand split.
- **Stack is Phaser.js + Colyseus, server-authoritative.** All game logic runs server-side; clients send inputs and render broadcast state. (Pivoted from an earlier Godot prototype.)
- **Bosses are not an exception to staking.** Defeating a boss or shrine guardian transfers its staked **fused thumb** to the winner exactly like any duel — there is no boss carve-out. The only stake-free duel is a practice rematch against an already-beaten boss.
