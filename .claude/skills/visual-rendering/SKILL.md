---
name: visual-rendering
description: "How to capture any Elemental Rings screen or overlay to a PNG using the parameterized visual capture harness. Includes canonical geometry constants (viewport, modal frame, column x-bands, depth layers) needed for visual QA checks."
---

# Visual Rendering Skill — Elemental Rings

Use the `visual` Playwright project to capture any game screen or overlay to a PNG on demand.
This harness is **never in CI** — invoke it explicitly by project name.

---

## Invocation

```bash
CAPTURE_TARGET=<target> \
  CAPTURE_OUT=<path>.png \
  npx playwright test --project visual --grep "visual-capture"
```

Both environment variables are optional: `CAPTURE_TARGET` defaults to `camp` and `CAPTURE_OUT`
defaults to `/tmp/er-capture-<sanitized-target>.png`.

### Target grammar

| `CAPTURE_TARGET` | What is captured |
|---|---|
| `overlay:field` | BattleHandOverlay open in a ForestScene (forest_anchorage) |
| `overlay:sanctum` | Sanctum ringwall overlay (reliquary modal, ringwall zone) |
| `overlay:fusion` | Camp fusion overlay |
| `screen:<screen_id>` | Any registered ForestScene screen by id (e.g. `screen:forest_anchorage`) |
| `camp` | CampScene at rest |
| `battle:solo` | BattleScene mid-duel (stretch goal — not yet implemented) |

### Complete invocation examples

**Capture the field overlay:**
```bash
CAPTURE_TARGET=overlay:field \
  CAPTURE_OUT=/tmp/er-capture-overlay-field.png \
  npx playwright test --project visual --grep "visual-capture"
```

**Capture the sanctum overlay:**
```bash
CAPTURE_TARGET=overlay:sanctum \
  CAPTURE_OUT=/tmp/er-capture-overlay-sanctum.png \
  npx playwright test --project visual --grep "visual-capture"
```

**Capture the fusion overlay:**
```bash
CAPTURE_TARGET=overlay:fusion \
  CAPTURE_OUT=/tmp/er-capture-overlay-fusion.png \
  npx playwright test --project visual --grep "visual-capture"
```

**Capture a specific forest screen:**
```bash
CAPTURE_TARGET=screen:forest_anchorage \
  CAPTURE_OUT=/tmp/er-capture-screen-forest-anchorage.png \
  npx playwright test --project visual --grep "visual-capture"
```

**Capture CampScene:**
```bash
CAPTURE_TARGET=camp \
  CAPTURE_OUT=/tmp/er-capture-camp.png \
  npx playwright test --project visual --grep "visual-capture"
```

---

## Output path convention

Default output: `/tmp/er-capture-<sanitized-target>.png`

The sanitized target replaces `:` and `/` with `-`:
- `overlay:field` → `/tmp/er-capture-overlay-field.png`
- `screen:forest_anchorage` → `/tmp/er-capture-screen-forest-anchorage.png`

Pass an explicit `CAPTURE_OUT` path to override (e.g. for saving into `docs/maps/references/<screen_id>/`).

---

## When to capture

- After any layout or geometry change to an overlay or HUD
- Before/after a visual-QA review (generate the before-state first)
- When the map-designer agent produces a new screen (capture to verify layer depth and tile placement)
- When a visual-qa agent needs a reference PNG for column-order or depth checks

---

## Canonical Geometry Reference

### Viewport

| Dimension | Value |
|---|---|
| Browser viewport | 1024 × 600 px |
| Modal frame (overlays) | 760 × 500 px |

### Overlay column x-bands

These x-coordinates locate each column in the ring-management overlays
(BattleHandOverlay / reliquary modal). Use them when writing geometry assertions.

| Column | Approximate x |
|---|---|
| LOOT / SPIRIT / FUSE | ≈ 195 |
| BENCH | ≈ 370 |
| HEALTH | 659 |
| COMBAT (left edge) | 759 |
| COMBAT (right edge) | 837 |

### Tilemap depth layers

| Layer | Depth value | Notes |
|---|---|---|
| `ground` | 0 | Base terrain; collision via `collides` property |
| `behind` | 2 | South walls, tree trunks — player walks in front |
| Player / NPC sprites | 3 | Set in `BaseBiomeScene.create` |
| `in-front` | 5 | Roofs, canopy — player walks under these |

Player and NPC depth is **3**, set in `BaseBiomeScene.create`.

---

## Prerequisites

Playwright's `webServer` block auto-starts Colyseus on port 2568 and Vite on port 8090
when you run `npx playwright test --project visual`. If those ports are already bound,
kill the conflicts first:

```bash
lsof -ti:2568,8090 | xargs kill -9
```

---

## Spec file

`tests/e2e/visual-capture.spec.ts`

The spec is registered only in the `visual` Playwright project (`playwright.config.ts`).
It is NOT listed in `SOLO_SPECS` or `PVP_SPECS`, so it never runs in normal CI.
