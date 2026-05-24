## 13. Open Questions

**Game design (engine-agnostic):**
- Full element relationship web — all matchups documented for all 11 named elements
- Ring passive and active abilities unlocked at XP milestones
- ~~Exact heart count per duel~~ → settled: **3 hearts**
- Exact catalyst (fusion stone) costs per tier
- Tier 4 triple fusion full details
- NPC personality tuning and difficulty progression curve
- Inventory expansion milestones and exact costs
- Shadow ring drop rate and underground area density
- Whether heavily depleted rings take two game days to recharge (vs always one)
- Monster respawn cycle — real time vs in-game day cycle
- Named/boss monster design and unique ring rewards
- Environmental passives per biome — flagged for a later design pass
- Nature/Bloom fusion — final name TBD
- Whether monster stolen rings retain their specific position in the world (trackable) or just re-enter the monster loot pool
- Status gauge threshold scaling formula with player XP and augmentations
- Playtesting tune for status severity now that gauges persist indefinitely (Burning at 1 full heart/turn especially)

**Tech / multiplayer:**
- Database choice for persistent player state (PostgreSQL vs Redis vs file-backed JSON for Phase 4)
- Internet matchmaking provider (self-hosted VPS vs Fly.io vs Colyseus Cloud) and timing relative to LAN-first phases
- Account system — username/password, OAuth (Google/Discord), or anonymous session with optional persistence
- Touch input layout for mobile — full slot-card tap vs dedicated P1/P2 split screen for local co-op on a tablet
- Spectator mode — open observation or invite-only
- Art asset sourcing strategy — itch.io top-down packs as placeholder, custom art for release

---

*Document version 3.1 — Updated May 2026*
*v3.1 changes: GDD consistency pass. Fixed all subsection numbers (were off by 1 vs ToC throughout). Added §6.4 Block Resolution Table expanded row-per-outcome format. Corrected: hearts settled at 3 (was TBD); parry costs 1 use only (volley is free); gauge fills only on uncontested hit, not on caught attacks including fused rings (removed erroneous "perfect counter decrements gauges" note). Updated Phase 1 build description to reflect Vitest/@colyseus/testing (not Playwright/Godot). Updated Phase 2 keyboard layout (each player uses 1–5 in own window). Fixed all §-cross-references (§5.4→§6.4, §6→§7 for status effects, §8→§9 for staking). Removed duplicate combined v2.0/2.1 changelog entry. Marked hearts open question as resolved.*

*Document version 3.0 — Updated May 2026*
*v3.0 changes: Pivoted from Godot 4.x to **Phaser.js + Colyseus** multiplayer stack. Added §2 Tech Stack & Architecture (server-authoritative model, LAN deployment on game-da-god, Playwright E2E testing, Capacitor/Electron distribution). Rewrote §12 Build Sequence for 9 TypeScript/Playwright phases replacing Godot GDScript prompts. Updated §13 Open Questions to include tech/multiplayer items. Removed all Godot-specific implementation notes (EventBus, GDScript, Godot TileMap) from body text. Game design content (§3–§11) unchanged.*

*Document version 2.2 — Updated May 2026*
*v2.2 changes: Replaced the simultaneous-secret turn model (§6.3) with the **active timed-block** model and added the rally mechanic (§6.4). Rewrote §6.4 damage rules around two axes (timing: parry/block/mistime/no-block; element: strong/neutral/weak). Removed auto-reflect in favour of interactive rally volley chain walking the pentagon.*

*Document version 2.1 — Updated May 2026*
*v2.1 changes: Simplified §5.5 neutral block rules (removed first/second neutral distinction and the neutral recharge bonus). Rewrote §6 from rolling-window combo system to persistent gauge model — gauges change ±1 per base element component on strong hits / perfect counters, neutrals don't move gauges. Replaced restrictive status effects (Petrified, Scattered, Entangled) with attrition-based effects that never restrict ring choice. Eliminated separate fusion statuses (§6.2) — fused rings now decompose recursively to base elements (Lightning = Fire ×2, Frost = Water ×2 + Wind ×1, etc). Burning now deals 1 full heart per turn. Updated Phase 4 build prompt accordingly.*

*Document version 2.0 — Updated May 2026*
*v2.0 changes: Loadout system, dominant/off hand split, post-battle ring management, recharge timer, biomes, monster flee/steal mechanics, detection and approach system, staking jewelry position system (bracelet dominant / bracelet off / necklace), neutral recharge bonus, off hand passive recharge drip, staked ring XP, full NPC category breakdown, expanded Claude Code build prompts*
