## 13. Open Questions

**Game design (engine-agnostic):**
- Full element relationship web — all matchups documented for all 11 named elements
- Ring passive and active abilities unlocked at XP milestones
- ~~Exact heart count per duel~~ → settled: **3 hearts**
- ~~Exact catalyst (fusion stone) costs per tier~~ → settled: **no fusion stones** — maxed parent rings + shrine access (§5.5)
- Tier 3 fusion recipe names and which shrines unlock them (§5.3 deferred to Phase 8)
- Tier 4 triple fusion full details
- ~~NPC personality tuning and difficulty progression curve~~ → settled: **4 archetypes with 10 randomized loadout templates** (see §10.5)
- Inventory expansion milestones and exact costs
- Shadow ring drop rate and underground area density
- Whether heavily depleted rings take two game days to recharge (vs always one)
- Monster respawn cycle — real time vs in-game day cycle
- Named/boss monster design and unique ring rewards
- Environmental passives per biome — flagged for a later design pass
- ~~Nature/Bloom fusion — final name TBD~~ → settled: **BLOOM** (Wood + Earth); **THORNADO** (Wood + Wind)
- Whether monster stolen rings retain their specific position in the world (trackable) or just re-enter the monster loot pool
- Status gauge threshold scaling formula with player XP and augmentations
- Playtesting tune for status severity now that gauges persist indefinitely (Burning at 1 full heart/turn especially)
- ~~Post-battle "place won ring" UI~~ → settled: **prompt appears when carry is full; player swaps, leaves at camp, or discards** (§6.8; tracked in issue #40)
- Fused Thumb ring passives — what happens when a fusion ring is staked (currently: no passive)
- Additional jewelry body positions (off-hand bracelet, necklace) and their passive archetypes (flagged Phase 7+)
- Carry cap expansion cost curve — how much gold per +1 slot, and what is the maximum cap?
- Wandering merchant patrol routes and trade window duration
- ~~Spirit gauge formula: exact mapping of aggregate ring XP → spirit max (linear? logarithmic? stepped?)~~ → settled: **`spirit_max = SPIRIT_BASE + floor(aggregate_ring_xp / XP_SCALER)`** — constants in `server/src/game/constants.ts` (§12.1)
- ~~Starting aggregate XP / spirit max at game start (before any battles)~~ → settled: **SPIRIT_BASE** (with 0 ring XP) — see `server/src/game/constants.ts`
- Exact ratio: spirit max to carry capacity (e.g. every N spirit units = 1 carry slot) — carry cap currently fixed at 10; growth curve deferred to Phase 8
- Food quantities tuning: forage yield per node, boss drop amount, merchant buy/sell prices
- Future food segmentation: fruits, vegetables, grains, meats — different effects? Or purely cosmetic variety?
- Waystone density per biome (how many waystones? which are boss-guarded?)
- Compass range in world units and how strength/intensity is communicated to the player
- Teleportation spiritual level thresholds per biome/waystone (tuning)
- Sanctum visual style and customization — does the sanctum change appearance as the protagonist grows?
- Chapter city task design — what kinds of tasks complete a chapter? (deferred)

**Tech / multiplayer:**
- ~~Database choice for persistent player state~~ → settled: **SQLite via better-sqlite3** (synchronous, server-side)
- Internet matchmaking provider (self-hosted VPS vs Fly.io vs Colyseus Cloud) and timing relative to LAN-first phases
- ~~Account system — username/password, OAuth, or anonymous~~ → settled: **username/password with JWT** (Phase 4+5.1)
- Touch input layout for mobile — full slot-card tap vs dedicated P1/P2 split screen for local co-op on a tablet
- Spectator mode — open observation or invite-only
- Art asset sourcing strategy — itch.io top-down packs as placeholder, custom art for release
- ~~Fusion-vs-fusion component assignment~~ → settled: **greedy auto-align** (§3.4)

---

## 13.1 Alternative Designs (Not Adopted)

> ⚠️ **This is NOT the current system.** Everything in §13.1 is a parked design alternative kept for reference — the live ring-progression and fusion rules are in **§4** and **§5**, and the live Thumb passives are in **§9.3**. Nothing here is implemented or planned. If one of these is ever adopted, move its rules into the relevant section and delete it from here.

### Retired Thumb passives (parked)

Earlier Thumb-passive designs replaced by the §9.3 set. Kept for reference only.

- **Bulwark (Earth) — setup aura.** Fired once at duel start: distributed +1 current use to Earth rings in the battle hand in the order D1→D2→A1→A2, spending 1 Thumb use per ring buffed (max uses raised to match; stops when the Thumb runs out). Replaced by **Precision Parry** — a reactive, timing-gated refund (§9.3) — so Earth's identity became "reward disciplined defense" rather than a second flavor of the setup aura.
- **Deep Roots (Wood) — heart guard.** Reactive: when the player would lose a heart, the Wood Thumb absorbed the blow by spending 1 use instead (the heart was not lost). Retired because Wood folded into the shared all-in setup archetype (§9.3) alongside Fire and Water, and an un-counterable heart-saver was hard to read across the Thumb's visible use count during a fast exchange.

### Decoupled XP / Tier progression (parked)

An alternative ring-progression model considered as a way to make three trade-offs more deliberate: (1) leaving high-XP rings in the Reliquary for spirit vs. carrying them for combat capacity, (2) whether to fuse at all, and (3) avoiding passive power-creep where the loadout fills with strong rings automatically.

**How it differs from the current system:**

| | Current system (§4/§5) | Parked alternative |
|---|---|---|
| Tier source | Derived from XP — `tierForXp(xp)`, thresholds 500 / 1500 / 3000 | A stored counter that **only fusion** increments |
| Crossing 500 XP | Auto-promotes to Tier 1, grants +1 use | Nothing automatic — a ring can sit at Tier 0 with 2,000 XP |
| Only way to gain uses / tier | XP accrual crosses thresholds | **Fusion only** |
| Fused ring XP | Sum of both parents | Sum of both parents **minus 2 × 500** (shave the 500-XP eligibility toll off each parent) |
| Fused ring uses | `max(1, min(parents) − 1)` | `min(parents) + 1` (tier-up grants a use) |
| Same-element fusion | Not allowed (cross-element only) | Allowed — Fire+Fire → higher-tier Fire; cross-element still yields the §5.2 fusion |

**Worked examples (alternative only):**
- 501-XP Tier 0 Fire + 602-XP Tier 0 Fire → **103-XP Tier 1 Fire, 4 uses**
- 501-XP Tier 2 Water + 603-XP Tier 2 Fire → **104-XP Tier 3 Steam, 6 uses**

**Why it was interesting:** The 500-XP fusion gate and the 500-XP-per-parent toll are the same number, so two minimum-eligible rings fuse to exactly 0 XP (never negative) — XP becomes a fuel you spend to fuse. Because spirit is sourced only from Reliquary rings (`spirit_max = SPIRIT_BASE + floor(reliquary_xp / XP_SCALER)`, §12), decoupling would put the "spirit battery" role (high-XP, low-tier) and the "fighter" role (high-tier, low-XP after the fusion toll) on genuinely different rings — sharpening the existing Reliquary-vs-loadout placement choice. Fusing a ring would also destroy most of its spirit value, making "fuse or not" a clean combat-power-vs-spirit trade.

**Why it's parked:** Not being pursued at this time. Open risks if revisited: the same-element/cross-element lineage rules need full definition (e.g. what happens when a fusion element like Steam tries to fuse again); the cost may compound too hard (a Tier 3 needs 8 base rings, plus the XP toll, plus fused rings landing near 0 XP and being re-grind-gated to 500 before they can fuse again); and it removes the "my ring grew as I used it" feedback loop in favor of a colder "I forged this ring" loop.

---

*Document version 3.3 — Updated June 2026*
*v3.3 changes: A loss by depletion (hearts reach 0) now permanently destroys the loser's heart ring (§6.3, §6.7, §6.8); a forfeit with hearts still > 0 preserves it. Retired the never-implemented §6.9 note that a monster win steals a random ring from the player's full inventory — a monster win now claims only the staked Thumb ring, like any opponent.*

*Document version 3.2 — Updated May 2026*
*v3.2 changes: Marked spirit gauge formula and starting spirit max as settled (see `SPIRIT_BASE` and `XP_SCALER` in `server/src/game/constants.ts`; §12.1). Noted carry-cap growth curve remains open and deferred to Phase 8.*

*Document version 3.1 — Updated May 2026*
*v3.1 changes: GDD consistency pass. Fixed all subsection numbers (were off by 1 vs ToC throughout). Added §6.4 Block Resolution Table expanded row-per-outcome format. Corrected: hearts settled at 3 (was TBD); parry costs 1 use only (volley is free); gauge fills only on uncontested hit, not on caught attacks including fused rings (removed erroneous "perfect counter decrements gauges" note). Updated Phase 1 build description to reflect Vitest/@colyseus/testing (not Playwright/Godot). Updated Phase 2 keyboard layout (each player uses 1–5 in own window). Fixed all §-cross-references (§5.4→§6.4, §6→§7 for status effects, §8→§9 for staking). Removed duplicate combined v2.0/2.1 changelog entry. Marked hearts open question as resolved.*

*Document version 3.0 — Updated May 2026*
*v3.0 changes: Pivoted from Godot 4.x to **Phaser.js + Colyseus** multiplayer stack. Added §2 Tech Stack & Architecture (server-authoritative model, LAN deployment on game-da-god, Playwright E2E testing, Capacitor/Electron distribution). Rewrote §12 Build Sequence for 9 TypeScript/Playwright phases replacing Godot GDScript prompts. Updated §13 Open Questions to include tech/multiplayer items. Removed all Godot-specific implementation notes (EventBus, GDScript, Godot TileMap) from body text. Game design content (§3–§11) unchanged.*

*Document version 2.3 — Updated June 2026*
*v2.3 changes: Introduced the **initiative model** in §6.3 — one player holds initiative and chooses attack/recharge/forfeit; the other is the reactor. After any counter-chain resolves, initiative always passes to the non-holder, regardless of rally depth or who scored hits. Fixed a server bug where a neutrally-absorbed rally volley incorrectly returned initiative to the original attacker. §6.4 rally updated to clarify that counters extend the current initiative phase, not transfer it.*

*Document version 2.2 — Updated May 2026*
*v2.2 changes: Replaced the simultaneous-secret turn model (§6.3) with the **active timed-block** model and added the rally mechanic (§6.4). Rewrote §6.4 damage rules around two axes (timing: parry/block/mistime/no-block; element: strong/neutral/weak). Removed auto-reflect in favour of interactive rally volley chain walking the pentagon.*

*Document version 2.1 — Updated May 2026*
*v2.1 changes: Simplified §5.5 neutral block rules (removed first/second neutral distinction and the neutral recharge bonus). Rewrote §6 from rolling-window combo system to persistent gauge model — gauges change ±1 per base element component on strong hits / perfect counters, neutrals don't move gauges. Replaced restrictive status effects (Petrified, Scattered, Entangled) with attrition-based effects that never restrict ring choice. Eliminated separate fusion statuses (§6.2) — fused rings now decompose recursively to base elements (Lightning = Fire ×2, Frost = Water ×2 + Wind ×1, etc). Burning now deals 1 full heart per turn. Updated Phase 4 build prompt accordingly.*

*Document version 2.0 — Updated May 2026*
*v2.0 changes: Loadout system, dominant/off hand split, post-battle ring management, recharge timer, biomes, monster flee/steal mechanics, detection and approach system, staking jewelry position system (bracelet dominant / bracelet off / necklace), neutral recharge bonus, off hand passive recharge drip, staked ring XP, full NPC category breakdown, expanded Claude Code build prompts*
