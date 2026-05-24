## 12. Build Sequence for Claude Code

Build in phases so the game is playable and testable at each stage before moving to the next. All phases use **Phaser.js (client) + Colyseus (server) + TypeScript**. Playwright provides E2E test coverage at each phase — actual browser interaction, real key presses, real timings.

### Phase 1 — Battle Core (Colyseus Server)

Build the authoritative Colyseus `BattleRoom` in TypeScript. All battle logic runs here: ElementSystem (pentagon matchup table), BlockResolver (timing classification, relationship, resolve), the state machine (attack-select → defend-window → resolve), and the rally chain (§6.4). No client yet — test with Vitest unit tests (ElementSystem, BlockResolver) and `@colyseus/testing` integration tests (two SDK clients driving real server exchanges). Deliverable: all timing classifications (PARRY / BLOCK / MISTIME / NO_BLOCK) and all element relationships produce correct outcomes across all 8 Block Resolution Table combinations; a full 3-heart KO sequence resolves correctly.

### Phase 2 — Phaser Client

Build the browser client. Telegraph orb (element-colored Phaser tween crossing from attacker sprite to defender sprite over 0.9 s). Battle hand UI (5 slot cards, highlight on press). HUD (hearts, ring use counts, role labels ATTACKING / DEFENDING). Keyboard input: each player uses keys 1-5 in their own browser window; touch input: tap the slot card. Client renders whatever the server broadcasts — it holds no game state of its own. Playwright tests: assert orb appears on attack, assert slot highlights on keypress, assert HUD updates after resolution. Deliverable: two browser tabs on the LAN produce a visually complete playable exchange.

### Phase 3 — NPC AI Opponents

Add AI bots as server-side Colyseus clients. The AI runs inside the `BattleRoom` — it receives the same state messages a human would and calls the same `submitMove(slot, pressTime)` method. Personality types (§10.5): Aggressive, Defensive, Status-hunter, Resilient. Deliverable: a human player on one tab can complete a full battle against an AI opponent; the AI makes contextually appropriate decisions and feels like a distinct opponent.

### Phase 4 — Ring Inventory and Loadout System

Persistent player state: JWT auth, ring inventory stored server-side (PostgreSQL or file-backed JSON). Pre-duel loadout selection screen (pick 5 from 10). Off hand passive recharge drip (§6.6). Post-battle ring management screen (keep won ring, return one to inventory). Ring XP tracking. Camp scene: sleep to recharge all rings. Deliverable: a player can carry persistent rings across multiple sessions, level them up, and manage a real loadout.

### Phase 5 — Staking Economy

Jewelry position selection before each duel (dominant hand bracelet / off hand bracelet / necklace) with corresponding passive buffs (§9). Stake escrow during duel, ring transfer on loss. Stake lock-in once player enters detection range. Deliverable: full staking loop playable end-to-end between two human players.

### Phase 6 — Status Effects (Gauge System)

Five per-player element gauges (§7). Gauge increments on uncontested hit (no-block or mistime); threshold triggers status effects (Burning, Drowning, Petrified, Scattered, Entangled). Shadow passive (25% Cursed). Gauge display in battle HUD. Deliverable: status effects fire correctly and influence battle outcomes.

### Phase 7 — Fusion System

Shrine mechanic: fuse two maxed parent rings into a higher-tier ring at a shrine location (§5). Recipe discovery gated by defeating fusion-type opponents. Deliverable: player can discover and execute all Tier 2 fusion recipes.

### Phase 8 — Overworld

Browser-rendered top-down overworld (Phaser tilemap, Zelda: A Link to the Past visual style, placeholder art from itch.io). Player movement, collision, at least two biomes (Forest, Swamp). Detection radius triggers (§10.3), camp location, shrine locations, underground caves for Shadow drops. NPCs and monsters placed in the world. Deliverable: a navigable world where organic encounters lead into duels.

### Phase 9 — Distribution

Android/iOS packaging via Capacitor (wrap Phaser client as native WebView app). Steam/desktop packaging via Electron + Greenworks SDK (achievements, cloud saves). Internet matchmaking via public Colyseus server (VPS or Fly.io). Deliverable: submittable builds for Google Play, App Store, and Steam.

---
