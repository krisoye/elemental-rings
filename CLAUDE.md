# Elemental Rings — Claude Code Context

Multiplayer browser game: Phaser.js 4 client + Colyseus 0.17 server. Server is authoritative — all game logic runs on the Colyseus side; clients send inputs and render broadcasted state only.

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Client | Phaser.js, TypeScript, Vite | 4.1.0 |
| Server | Colyseus, Node.js, TypeScript | 0.17.x |
| Testing | Playwright (E2E), Vitest (unit) | latest |
| Deployment | game-da-god (192.168.4.140) | systemd service |

---

## Repository Layout

```
elemental-rings/
  server/              ← Colyseus game server (battle logic, schemas, rooms)
    src/
      game/            ← Pure logic: ElementSystem, BlockResolver, constants
      schemas/         ← @Schema classes: Ring, PlayerState, BattleState
      rooms/           ← BattleRoom (one Room per duel)
    index.ts           ← createServer() + listen(2567)
  client/              ← Phaser 4 browser client (Phase 2+)
    src/
      scenes/          ← BattleScene, LobbyScene, etc.
      objects/         ← Slot card, orb, HUD components
  shared/              ← Types shared between client and server
    types.ts           ← ElementEnum, PhaseType, payload interfaces
  tests/
    unit/              ← Vitest: ElementSystem, BlockResolver (pure logic)
    e2e/               ← Playwright: test-harness.html + spec files
  .claude/
    skills/phaser/     ← Official Phaser 4 SKILL.md files (28 skills)
  docs/
    elemental_rings_GDD.md   ← Canonical game design document
```

---

## Architecture Rule

**The Colyseus server is the only source of truth.** Never put game logic (timing classification, element relationships, block resolution, rally state) in the Phaser client. Clients call `room.send('selectAttack', {slot})` and `room.send('submitDefense', {slot, pressTime})` — the server resolves and broadcasts `BattleState` diffs.

---

## GDD Reference

All game mechanics — battle rules, element pentagon, timing windows, rally chain, ring tiers — are in:

```
docs/elemental_rings_GDD.md
```

Always read the relevant GDD section before designing or implementing any game system.

## Godot Prototype Reference

The combat logic being ported to TypeScript was fully implemented and debugged in the Godot prototype at `krisoye/elemental_rings`. The verified GDScript implementations of `BlockResolver`, `ElementSystem`, and `BattleManager` are the canonical source for the port:

```bash
# Read the verified Godot implementations (read-only reference)
cat /home/deploy/prod/elemental_rings/scripts/battle/block_resolver.gd
cat /home/deploy/prod/elemental_rings/scripts/battle/element_system.gd
cat /home/deploy/prod/elemental_rings/scripts/battle/battle_manager.gd
```

Key lessons from the Godot prototype:
- `last_block_result` must be reset to `null` before any early return (stale-read bug)
- `on_attack_selected()` must return `bool` so callers don't advance state on failure
- Defend window must extend **past** impact by `BLOCK_WINDOW_MS` — not just to impact (one-sided window bug)
- `classifyTiming` uses `Math.abs(offset)` — both early and late presses within the window are valid

---

## Workspace Note

`ws start elemental-rings` is **not yet registered** with dev-tools. Use manual clone instead:

```bash
SESSION="er-$(date +%s)"
mkdir -p ~/wip/$SESSION
git clone git@github.com:krisoye/elemental-rings.git ~/wip/$SESSION/elemental-rings
cd ~/wip/$SESSION/elemental-rings
git checkout -b feature/<slug>
```

---

## Colyseus Skill

A hand-written Colyseus 0.17 skill covering `@Schema`, Room lifecycle, `ArraySchema`/`MapSchema`, message handlers, timers, client connection, and the Phase 1 Playwright test-harness pattern:

```bash
cat .claude/skills/colyseus/SKILL.md
```

Read this before implementing **any** server-side Colyseus code.

---

## Phaser 4 Skills

Official Phaser 4 SKILL.md files are installed at `.claude/skills/phaser/`. Read the relevant skill before writing any client code:

```bash
cat .claude/skills/phaser/input-keyboard-mouse-touch/SKILL.md   # keys, touch, pointer
cat .claude/skills/phaser/tweens/SKILL.md                        # orb animation, pulses
cat .claude/skills/phaser/scenes/SKILL.md                        # scene lifecycle
cat .claude/skills/phaser/groups-and-containers/SKILL.md         # slot cards, HUD
cat .claude/skills/phaser/text-and-bitmaptext/SKILL.md           # labels
cat .claude/skills/phaser/game-setup-and-config/SKILL.md         # Game config, scale
```

Also available: animations, audio-and-sound, cameras, particles, physics-arcade, tilemaps, v3-to-v4-migration.

**Phaser version is 4.1.0** — do not use 3.x APIs. Source is at `~/refs/phaser/src/` if you need to verify an API.

---

## Key Game Constants (Phase 1)

| Constant | Value | Meaning |
|---|---|---|
| `TELEGRAPH_MS` | 900 | Orb travel time (ms) = impact offset from attack commit |
| `BLOCK_WINDOW_MS` | 180 | Valid block window around impact (±180ms) |
| `PARRY_WINDOW_MS` | 70 | Tight inner window for PARRY (±70ms) |
| `STARTING_HEARTS` | 3 | Hearts per player per duel |

**Defend window = TELEGRAPH_MS + BLOCK_WINDOW_MS = 1080ms** (extends past impact to allow post-arrival presses).

## Element Pentagon

```
FIRE(0) > WOOD(4) > EARTH(2) > WIND(3) > WATER(1) > FIRE
BEATS = [4, 0, 3, 1, 2]   // BEATS[x] = element x defeats
```

P1 keyboard: keys 1–5 → slots 0–4 (KeyCodes.ONE=49 … FIVE=53)
P2 keyboard: keys 6–0 → slots 0–4 (KeyCodes.SIX=54 … ZERO=48)

---

## Dev Commands

```bash
# Start Colyseus server (port 2567)
cd server && npm run dev

# Start Phaser client (port 8080, Phase 2+)
cd client && npm run dev

# Unit tests
cd server && npx vitest run

# E2E tests (requires server + static server running)
npx playwright test
```

---

## Deployment (game-da-god)

Server runs as a systemd service on game-da-god (192.168.4.140). Any LAN device opens `http://192.168.4.140:8080` in a browser to play. Follow the same `ws deploy` pattern as other services.

---

## Build Phases (GDD §12)

| Phase | Description | Status |
|---|---|---|
| 1 | Colyseus BattleRoom — all battle logic, no client | Issue #3 |
| 2 | Phaser 4 client — orb, hand UI, HUD, keyboard+touch | — |
| 3 | NPC AI — server-side bot in same BattleRoom | — |
| 4 | Ring inventory + persistent player state | — |
| 5 | Staking economy | — |
| 6 | Status effects (gauge system) | — |
| 7 | Fusion system | — |
| 8 | Overworld | — |
| 9 | Capacitor (mobile) + Electron (Steam) | — |
