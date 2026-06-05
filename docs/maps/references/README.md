# Map Reference Images

This folder holds **design-time reference artifacts** for map authoring — concept art,
photo references, neighbor-screen captures, and visual-QA screenshots.

---

## Folder convention

One subdirectory per screen, named by screen id:

```
docs/maps/references/
  forest_anchorage/       <- references for the Forest Anchorage screen
  forest_north_road/      <- references for the Forest North Road screen
  <screen_id>/            <- one folder per screen
```

Drop reference images here before invoking the map-designer agent so it can load them
as visual context. Agents also accept absolute file paths at invocation time
(e.g. `/mnt/t/OneDrive/...` mounts on small-boss).

---

## What belongs here

- Concept art or photo references that inform the visual style of a screen
- Captures from neighbor screens (for edge-matching tile alignment)
- Visual-QA screenshots produced by the capture harness (`visual-rendering` skill)
- Annotated screenshots marking intended tile placement or NPC positions

---

## What does NOT belong here

- Shipped game assets (`client/public/assets/` is the correct location for those)
- Source tilesets or sprite sheets (keep those in `client/public/assets/terrain/` etc.)
- Tiled `.tmx` or exported `.json` map files (those live in `client/public/assets/maps/`)

---

## Producing a reference capture

Use the `visual-rendering` skill to capture any screen:

```bash
CAPTURE_TARGET=screen:forest_anchorage \
  CAPTURE_OUT=docs/maps/references/forest_anchorage/capture.png \
  npx playwright test --project visual --grep "visual-capture"
```

See `.claude/skills/visual-rendering/SKILL.md` for the full invocation reference,
target grammar, and canonical geometry constants.

---

## Not shipped

Files under `docs/maps/references/` are **not** included in the production build.
They are excluded from `client/public/assets/` (the Vite asset root), so they never
reach the browser bundle. Keep them here freely without worrying about bundle size.
