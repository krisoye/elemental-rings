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
    elemental_rings_GDD.md        ← Navigation hub + quick reference
    gdd-06-battle-system.md       ← Combat rules, Block Resolution Table, rally
    gdd-03-element-system.md      ← Pentagon matchups, fused elements, Shadow
    gdd-07-status-effects.md      ← Gauge mechanics, status effects
    gdd-10-overworld.md           ← Biomes, detection, NPCs, Sanctum, waystones, anchorages, teleport
    gdd-10-regions.md             ← World architecture hub, progression overview, biome-scene hierarchy
    gdd-10-{forest,snow,swamp,desert}.md ← Per-region screen manifests
    gdd-0{1,2,4,5,8,9,11}.md     ← All other sections
```

---

## Architecture Rule

**The Colyseus server is the only source of truth.** Never put game logic (timing classification, element relationships, block resolution, rally state) in the Phaser client. Clients call `room.send('selectAttack', {slot})` and `room.send('submitDefense', {slot, pressTime})` — the server resolves and broadcasts `BattleState` diffs.

**Text rendering:** screen-fixed UI text uses `addDomLabel`; DOM-ineligible (Container/world/animated) text uses `crispCanvasText`. See `docs/architecture-overview.md` §7 before adding any UI text.

---

## GDD Reference

The GDD is split into per-section files under `docs/`. Read only the section you need:

| Task | Read |
|------|------|
| Any combat / timing / rally work | `docs/gdd-06-battle-system.md` |
| Element matchups, fused elements, Shadow | `docs/gdd-03-element-system.md` |
| Gauge mechanics, status effects, Shadow curse | `docs/gdd-07-status-effects.md` |
| Ring tiers, uses, XP, recharge | `docs/gdd-04-ring-system.md` |
| Staking, jewelry positions | `docs/gdd-09-staking-economy.md` |
| Overworld, biomes, NPCs, Sanctum, waystones, anchorages, teleport | `docs/gdd-10-overworld.md` |
| World regions architecture, biome-scene hierarchy, world progression overview | `docs/gdd-10-regions.md` |
| Forest region screens (29 screens including forest_volcano_gate) | `docs/gdd-10-forest.md` |
| Snow Mountains region screens | `docs/gdd-10-snow.md` |
| Swamp region screens | `docs/gdd-10-swamp.md` |
| Desert/Canyon and Volcano region screens | `docs/gdd-10-desert.md` |
| Navigation + quick reference | `docs/elemental_rings_GDD.md` |

Always read the relevant section before designing or implementing any game system.

---

## Workspace

`ws start elemental-rings <feature-slug>` is registered and works normally:

```bash
ws start elemental-rings <feature-slug>
# → clones to ~/wip/<session-id>/elemental-rings/
# → follow normal ws workflow: commit, push, gh pr create, ws finish
```

---

## Tiled Map Workflow Skill

Covers the three-layer convention (`ground`/`behind`/`in-front`), tileset rules, how to import a map export, auto-fix logic for common errors, and the `ForestScene` hook API. Read this before editing any Tiled map or wiring a new layer:

```bash
cat .claude/skills/tiled-map-workflow/SKILL.md
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

**Phaser version is 4.1.0** — do not use 3.x APIs. Source is at `client/node_modules/phaser/src/` if you need to verify an API.

---

## Key Game Constants

Canonical values are in `server/src/game/constants.ts`. Quick reference for elements and matchups: `docs/gdd-03-element-system.md`.

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

## GDD is design intent, not status

The GDD (`docs/`) describes the **intended game** — its rules, systems, world, and feel. It is a living document: it evolves as the vision evolves. It is **not** a build tracker.

- **Implementation status lives in GitHub.** What is built, what is in progress, and the EPIC/issue breakdown are owned by [GitHub Issues](https://github.com/krisoye/elemental-rings/issues) and the project board — never the GDD. Do not put issue numbers, PR numbers, "shipped/deferred" flags, or EPIC decomposition tables in the GDD.
- **Code is ground truth for shipped mechanics.** When code and the GDD disagree, that is a bug to resolve **deliberately**: either fix the code to match the intended design, or update the GDD because the intent changed. Never leave a silent divergence, and never reverse-engineer the GDD from code as routine maintenance.
- **The GDD's changelog is a design-change log** — what the game *became* and why — not a list of PRs. Git holds the line-level history.

Before designing or implementing any system, read the relevant GDD section (see the table above) for intent, then verify the current mechanic against the code.

---

## Changelog Fragments

User-visible PRs should include a changelog fragment in `docs/changelog.d/<issue>.md` or `docs/changelog.d/<issue>-<pr>.md`. Do **not** edit `docs/CHANGELOG.md` directly — it is managed by `scripts/compile_changelog.sh`. Read `docs/changelog.d/README.md` for the fragment format and naming convention. During `/pm sweep`, the compile script consolidates all fragments into CHANGELOG.md and deletes the processed fragment files.
