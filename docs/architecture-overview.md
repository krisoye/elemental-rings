# Architecture Overview

This document is the single-page engineering reference for `elemental-rings`. Read this when you need a map of how the system fits together — for design intent and game rules, read the GDD files under `docs/`.

---

## 1. System Purpose

`elemental-rings` is a browser-based multiplayer game built on a Phaser 4 (4.1.0) client and a Colyseus 0.17 server. The server is authoritative — all game logic (timing classification, element relationships, block resolution, rally state, player persistence) runs server-side; clients send inputs and render broadcasted state only. Players on the LAN access the game at `http://192.168.4.140:8080`.

---

## 2. Repository Layout

```
elemental-rings/
  server/              ← Colyseus game server (battle logic, schemas, rooms)
    src/
      game/            ← Pure logic: ElementSystem, BlockResolver, constants
      schemas/         ← @Schema classes: Ring, PlayerState, BattleState
      rooms/           ← BattleRoom (one Room instance per duel)
      api/             ← Express REST API routes (auth, persistence, encounter)
      persistence/     ← SQLite access layer (PlayerRepo)
    index.ts           ← createServer() + listen(2567)
  client/              ← Phaser 4 browser client
    src/
      scenes/          ← BattleScene, CampScene, LobbyScene, BaseBiomeScene,
                          ForestScene, SwampScene, SnowScene, DualCameraScene
      objects/         ← Slot cards, orb, HUD components, DomLabel, etc.
  shared/              ← Types shared between client and server
    types.ts           ← ElementEnum, PhaseType, payload interfaces
  tests/
    unit/              ← Vitest: ElementSystem, BlockResolver, SOLO_SPECS guard
    e2e/               ← Playwright: test-harness.html + spec files
  .claude/
    skills/phaser/     ← Official Phaser 4 SKILL.md files
  docs/                ← GDD sections + this file
```

| Directory | Role |
|-----------|------|
| `server/src/game/` | Pure logic modules — no Colyseus imports, no I/O |
| `server/src/schemas/` | Colyseus `@Schema` classes broadcast as state diffs |
| `server/src/rooms/` | Room lifecycle: one `BattleRoom` per duel |
| `server/src/api/` | Express REST API (auth, player data, encounter, waystones) |
| `server/src/persistence/` | SQLite access via `PlayerRepo` |
| `client/src/scenes/` | Phaser scene hierarchy (see §5) |
| `client/src/objects/` | Reusable GameObjects and HUD components |
| `shared/types.ts` | Cross-boundary types (see §8) |
| `tests/unit/` | Vitest pure-logic tests |
| `tests/e2e/` | Playwright full-stack tests |

---

## 3. Architecture Rule

**The Colyseus server is the only source of truth.** Never put game logic (timing classification, element relationships, block resolution, rally state) in the Phaser client. Clients call `room.send('selectAttack', {slot})` and `room.send('submitDefense', {slot, pressTime})` — the server resolves and broadcasts `BattleState` diffs. The client's sole responsibilities are rendering the broadcasted state and forwarding player inputs.

---

## 4. Server Architecture

### Colyseus Room Lifecycle

`BattleRoom` (`server/src/rooms/`) manages one duel per Room instance:

1. `onCreate` — room initialised; initial state built from `@Schema` classes
2. Message handlers registered — `selectAttack`, `submitDefense`, and related inputs received from clients
3. `onLeave` / `onDispose` — cleanup; Room torn down when the duel ends or both clients disconnect

### Pure Logic Layer

`server/src/game/` contains modules with no Colyseus imports and no I/O:

- `ElementSystem` — element matchup resolution
- `BlockResolver` — block/damage calculation
- `constants.ts` — canonical game constants (timings, element values, etc.)

These are the only modules tested by `tests/unit/` Vitest specs.

### Schema Layer

`server/src/schemas/` holds the Colyseus `@Schema` classes that are serialised and broadcast as binary state diffs: `Ring`, `PlayerState`, `BattleState`. Clients receive diffs and render them; they never compute derived game state.

### Express REST API

`server/src/api/routes.ts` mounts the Express REST endpoints covering authentication, player persistence, overworld NPC roster, waystone attunement, encounter gating, talisman loadout, forage nodes, and merchant interactions. See `docs/api-reference.md` for the full endpoint enumeration.

### Persistence

`server/src/persistence/PlayerRepo.ts` is the sole SQLite access layer. All player state reads and writes go through this module. The E2E suite uses a separate `data/e2e.db` file (set via `DB_PATH` env var) to isolate test state.

---

## 5. Client Architecture

### Scene Hierarchy

```
Phaser.Scene
  └── DualCameraScene          (abstract) — dual-camera split infrastructure
        ├── CampScene          — Sanctum interior, ring management, crafting
        └── BaseBiomeScene     (abstract) — shared spatial-biome engine
              ├── ForestScene  — Forest region (multi-screen, 16px tiles at 2×)
              ├── SwampScene   — Swamp biome
              └── SnowScene    — Snow biome
  BattleScene                  — duel UI (does not extend DualCameraScene)
  LobbyScene                   — pre-game lobby / matchmaking
  EncounterScene               — overworld NPC encounter routing
  LoginScene                   — authentication
```

### DualCameraScene

`client/src/scenes/DualCameraScene.ts` is the shared abstract base that establishes the two-camera split (see §6). It provides:

- `initDualCamera()` — builds `uiRoot` and `uiCam`; call from `create()` after any `cameras.main.setZoom()`
- `routeToUi(...objs)` — excludes scene-root objects from `cameras.main` so they render at 1:1 through `uiCam`
- `ignoreWorldObjects(objs)` — tells `uiCam` to ignore world objects so they render only through the world camera
- `unignoreMain(...objs)` — clears the per-object main-camera filter bit before a transient UI object is destroyed

### BaseBiomeScene

`client/src/scenes/BaseBiomeScene.ts` is the shared spatial-biome engine. Every biome is a thin subclass. The base owns: tilemap construction, collision, Player spawn, camera follow and bounds, waystone/anchorage markers (`GET /api/waystones`), compass HUD, Sanctum exterior placement, overworld NPC roster and detection (`GET /api/overworld/npcs`), double-click blink controller, Tab battle-hand overlay, edge-transition system (screen-to-screen walk-through), forage nodes, and merchant NPCs.

**Subclass contract** — a concrete biome scene must:

1. Set `this.screenId` (and optionally `this.screenDef`) in `init()` before `create()` runs.
2. Implement `tilesetKey(): string` — returns the Phaser texture key for the ground tileset (e.g. `'forest'`, `'swamp-tiles'`).
3. Implement `mapKeyForScreen(id: string): string` — returns the Phaser tilemap cache key for the given screen id.
4. Implement `preload()` — loads the biome tileset image and the screen's map JSON; calls `loadCommonAssets()` for the shared decoration/structure atlases.
5. Optionally override `biomeVisuals()` for fog/snow/tint applied after tilemap construction.
6. Optionally override `onEnterScreen()` for per-screen decoration placement and screen-specific interaction zones.
7. Optionally override `detectionRadius()` to shrink NPC detection range (e.g. the Swamp uses fog).

---

## 6. Camera vs uiCam Routing

This is a load-bearing invariant. Getting it wrong causes UI elements to drift with the world, or world objects to double-render at a fixed screen position.

### Two Cameras

`DualCameraScene.initDualCamera()` establishes:

| Camera | Field | Zoom | Follow | Clips to |
|--------|-------|------|--------|----------|
| World camera | `this.cameras.main` | Per-scene (`worldZoom()`) | Player | Map bounds |
| UI camera | `this.uiCam` | Always 1 | None (`setScroll(0,0)`) | Full viewport |

`uiCam` is added AFTER `cameras.main` so it draws on top — correct for UI occluding the world.

### Routing Rules

- **World objects** (tilemaps, Player, NPCs, decorations, waystone markers, campfire sprites, Sanctum exterior, forage/merchant display objects): pass through `cameras.main` only. Register them with `ignoreWorldObjects(objs)` so `uiCam` skips them and they are not double-rendered.
- **Screen-fixed HUD** (compass container, persistent resource HUD — `uiRoot` children): added into `uiRoot`; `cameras.main` ignores the whole `uiRoot` subtree once via `cameras.main.ignore(this.uiRoot)`, so anything added later is automatically excluded from the world camera.
- **Modal overlays** (BattleHandOverlay, MerchantModal, barrier/toast text): kept at the scene root (not inside `uiRoot`) so single-level E2E `flatMap` traversal reaches their children. Each modal container is individually excluded from `cameras.main` via `routeToUi(container)` when it is created.

### DomLabel Exception

`addDomLabel(...)` (from `client/src/objects/ui/DomLabel.ts`) creates a Phaser `DOMElement` with `setScrollFactor(0)`. DOM elements always composite above the entire WebGL canvas — they bypass both cameras entirely. `setDepth` on a DomLabel only orders DOM elements relative to each other, not against canvas content. See §7.

---

## 7. DOM-Overlay vs Canvas-Text Carve-Out

### Background

The game runs `render: { pixelArt: true }` (in `client/src/main.ts`), which forces `gl.NEAREST` filtering and `image-rendering: pixelated` on the canvas. On fractional-DPR displays the whole canvas is nearest-upscaled to physical pixels, making any in-canvas text irrecoverably soft regardless of how cleanly it was drawn.

### Rule: Screen-Fixed UI Text Uses addDomLabel

Screen-fixed UI text **must** use `addDomLabel(scene, x, y, text, style)` from `client/src/objects/ui/DomLabel.ts` instead of `scene.add.text(...)`. The browser composites DOM text at native physical resolution — perfectly crisp at any DPR — while the pixel-art canvas is untouched.

`addDomLabel` sets `setScrollFactor(0)` on the returned `DOMElement` (making it screen-fixed), sets `pointerEvents = 'none'` (so labels never intercept canvas clicks), and sets `setDepth(10_000)` so DOM ordering is stable relative to other DOM elements.

`DOM_LABEL_FONT_FAMILY` is a monospace stack matching Phaser's default canvas font — do not change the typeface (parity rule).

### Carve-Out: DOM-Ineligible Text Uses crispCanvasText

DOM elements always composite above all canvas content. Text that **cannot** move to DOM:

- Text that must sit behind a canvas sprite in depth
- Text inside a scrolling or masked Phaser container
- World-space labels (positioned in world coordinates, not screen coordinates)

For these cases use `crispCanvasText(textObj)` from `DomLabel.ts`. This is the **only** intentional `setResolution` call site post-revert. It raises the glyph-texture resolution to `Math.ceil(window.devicePixelRatio)` and switches the texture filter to `LINEAR`. Always pair both — never scatter raw `setResolution` calls elsewhere. `crispCanvasText` re-applies the `LINEAR` filter on **every** re-render (`setText`/`setColor`), so dynamically-updated labels stay crisp; this is why it overrides the Text instance's `updateText` (Phaser's `updateText` re-uploads the canvas to the GPU and would otherwise discard the filter on the first mutation).

### DomLabel updateSize() Width-Staleness Invariant

After calling `setDomLabelText(el, newText)` where the new text is wider than the text at creation time, the `DOMElement`'s measured width is stale until `el.updateSize()` is called. `setDomLabelText` always calls `el.updateSize()` internally, so callers that use this wrapper are safe. Any layout code that reads `el.width` directly for positioning (e.g. to size a background panel to the label width) must call `el.updateSize()` first. Failing to do so causes right- and center-anchored labels to overflow their intended edge. (The two-row location label in `BaseBiomeScene` demonstrated this regression: the background panel was sized from a stale pre-update width.)

---

## 8. Shared Module

`shared/types.ts` is the single cross-boundary type file. It defines:

- `ElementEnum` — the element identifiers used across server game logic and client rendering
- `PhaseType` — turn phase identifiers
- Payload interfaces for Colyseus messages (e.g. `selectAttack`, `submitDefense` payloads)

This module must not import Node.js-only or browser-only APIs. It is consumed by both the Colyseus server (TypeScript/Node) and the Phaser client (TypeScript/browser/Vite).

---

## 9. Testing

### Unit Tests (`tests/unit/`)

Vitest runs pure-logic tests with no Colyseus or Phaser dependencies:

- `ElementSystem` — element matchup resolution
- `BlockResolver` — block/damage calculation
- `constants` — canonical value checks
- `SOLO_SPECS guard` — verifies that every `tests/e2e/*.spec.ts` file on disk is registered in either `SOLO_SPECS` or `PVP_SPECS` in `playwright.config.ts` (see below)

Run with: `cd server && npx vitest run`

### E2E Tests (`tests/e2e/`)

Playwright runs full-stack tests via the `webServer` harness:

- Server at port **2568** (`E2E_TEST_ROUTES=1`, `E2E_FAST=1`, `DB_PATH=./data/e2e.db`)
- Client at port **8090** (`VITE_SERVER_URL=ws://localhost:2568`)

Both servers use `reuseExistingServer: true`. Run the solo suite on an otherwise-idle host — a concurrently-running workspace bound to the same ports causes cross-contamination.

### SOLO_SPECS / PVP_SPECS Registration Gotcha

`playwright.config.ts` partitions specs into two arrays:

- `SOLO_SPECS` — single-context tests (4 parallel workers); includes single-context vs-AI duels via `driveAiDuel`
- `PVP_SPECS` — two-context live `battle` room tests (2 parallel workers)

Each Playwright project uses `testMatch` set to the corresponding array. **A spec file not in either array is silently skipped by the test runner — it will never run.** When adding a new `tests/e2e/*.spec.ts`, it must be added to one of these arrays. The `SOLO_SPECS guard` unit test in `tests/unit/` catches this at CI time.

---

## 10. Deployment

The Colyseus server runs as a systemd service on **game-da-god** (192.168.4.140). The Phaser client is served as a static Vite build on the same host at port 8080. Any LAN device opens `http://192.168.4.140:8080` to play.

| Component | Port | Access |
|-----------|------|--------|
| Colyseus server (prod) | 2567 | LAN |
| Phaser client (prod) | 8080 | LAN |
| Colyseus server (E2E) | 2568 | localhost only |
| Phaser client (E2E) | 8090 | localhost only |

Deploy via the `ws deploy elemental-rings` pattern documented in the home `CLAUDE.md`. Agents cannot modify `/home/deploy/prod/` directly — deployment requires a human with the deploy password.

**Dev commands:**

```bash
# Colyseus server (dev)
# Set DB_PATH to a writable throwaway file — when unset it defaults to
# /var/lib/elemental-rings/elemental.db (the sandbox-writable prod path), which
# a regular dev user typically cannot create. See server/src/persistence/dbPath.ts.
cd server && DB_PATH=./data/dev.db npm run dev

# Phaser client (dev)
cd client && npm run dev

# Unit tests
cd server && npx vitest run

# E2E tests (requires server on 2568 + client on 8090)
npx playwright test
```
