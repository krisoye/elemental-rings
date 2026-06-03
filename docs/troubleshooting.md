# Troubleshooting

Engineering reference for recurring gotchas in the elemental-rings repo. Each entry lists a concrete symptom, its root cause, and the correct fix. Do not add design intent or GDD content here — those belong in `docs/gdd-*.md`.

---

## 1. Playwright E2E fails with "port already in use" or `TypeError: fetch failed` cascade

**Symptom:** The E2E run aborts immediately after Playwright launches, or many tests emit `mint-token 404` / `TypeError: fetch failed` errors before a single assertion runs.

**Cause:** The `webServer` block in `playwright.config.ts` binds to two fixed ports: 2568 (Colyseus) and 8090 (Vite). Both entries set `reuseExistingServer: true`. When another workspace's E2E run is already bound to those ports, Playwright attaches to the wrong server instance. If that foreign server tears down mid-run, every pending request collapses into the fetch-failed cascade. Note: the production Vite dev server runs on port 8080; E2E deliberately uses 8090 to avoid colliding with it, but there is no such separation between concurrent E2E workspaces.

**Solution/Workaround:** Run the E2E suite on an otherwise-idle host — no other workspace should have `npm run dev` bound to ports 2568 or 8090. Confirm before starting:

```bash
lsof -i :2568 -i :8090
```

If either port is occupied, kill the occupying process or switch to a different machine. Do not attempt to work around this by changing the ports in `playwright.config.ts` without updating all env injection blocks (`PORT`, `VITE_SERVER_URL`, `VITE_PORT`) consistently.

---

## 2. `ws start` does not run `npm install` — fresh workspace has missing `node_modules`

**Symptom:** In a freshly cloned workspace, `npx tsc`, `npx vitest`, or Playwright fail with `Cannot find module` or missing binary errors.

**Cause:** `ws start` performs a thin clone of the repo. It does not run `npm install`. Because `node_modules/` is gitignored, the directory does not exist in a fresh workspace. `elemental-rings` is an npm workspace (`root package.json` declares `"workspaces": ["server"]`), so a single root-level `npm install` covers both the root and the `server/` workspace. The `client/` directory is a separate package and requires its own install.

**Solution/Workaround:** After `ws start`, install before running any TypeScript tooling or tests:

```bash
npm install
cd client && npm install
```

Spawn prompts for implementation agents must prepend the following guard to any `npx tsc` or Playwright invocation:

```bash
ls node_modules &>/dev/null || npm install && (cd client && ls node_modules &>/dev/null || npm install)
```

---

## 3. Flaky E2E: do NOT lower Playwright `workers` to fix physics-timing failures

**Symptom:** Some physics or movement specs fail intermittently. A developer lowers `workers` in `playwright.config.ts` hoping to reduce CPU contention, but failures increase or the run slows dramatically.

**Cause:** The residual failures at `workers=4` (solo project) are genuine assertion or coordinate bugs — not worker-count starvation. The wall-collision and movement physics specs pass at both `workers=1` and `workers=4`. At `workers=1` the solo suite fails *more* (approximately 80 failures versus approximately 59 at `workers=4`), not fewer. Lowering workers does not help and makes the suite run approximately 5x slower. See the inline `#312` comment in `playwright.config.ts` lines 136–148 for the full partition analysis.

**Solution/Workaround:** Do not change `workers` in `playwright.config.ts` to chase flakes. Isolate the specific failing spec, read the assertion, and fix the coordinate assumption or timing condition that is wrong. If the failure is intermittent under load, add a targeted `waitForFunction` or tighten the test preconditions rather than serializing the entire suite.

---

## 4. New E2E spec silently skipped — not registered in `SOLO_SPECS` or `PVP_SPECS`

**Symptom:** A newly created spec file in `tests/e2e/` never appears in Playwright output. It is not run, not failed, not reported — it is simply absent.

**Cause:** `playwright.config.ts` uses explicit `testMatch` arrays (`SOLO_SPECS` for single-context tests, `PVP_SPECS` for two-browser live battle room tests). Playwright only runs files listed in one of those arrays. Any spec file that exists on disk but is absent from both arrays is silently ignored — Playwright does not warn about unmatched files.

**Solution/Workaround:** Add the new spec filename to exactly one of `SOLO_SPECS` or `PVP_SPECS` in `playwright.config.ts`:

- `SOLO_SPECS` — single browser context, no live opponent (vsAI, overworld, UI)
- `PVP_SPECS` — two browser contexts, keyed battle room, live PvP logic

Run the Vitest guard test (`tests/unit/spec-registration.test.ts`) after adding a new spec file to catch registration gaps at CI time before a silent skip reaches a PR.

---

## 5. DomLabel `updateSize()` width-staleness after text update

**Symptom:** After calling `setDomLabelText(el, newWiderText)`, code that immediately reads `el.width` for layout (for example, sizing a background panel behind the label or computing a right-edge offset) sees the old, narrower width from the previous text value.

**Cause:** Phaser's `DOMElement` caches the measured bounding rect of its DOM node. After `node.textContent` is mutated, the browser DOM has reflowed and the node is wider, but Phaser's `el.width` is not updated until `el.updateSize()` is called. The `setDomLabelText` helper in `DomLabel.ts` already calls `el.updateSize()` internally, so callers using that helper are protected. The bug surfaces when code bypasses the helper and mutates `el.node.textContent` directly, or reads `el.width` before `setDomLabelText` has returned.

**Solution/Workaround:** Always update label text through `setDomLabelText(el, newText)` rather than writing `el.node.textContent` directly. If you must read `el.width` for layout after a text change and cannot use the helper, call `el.updateSize()` first:

```typescript
setDomLabelText(el, newWiderText);
// el.width is now accurate — safe to use for panel sizing or offset math
const labelWidth = el.width;
```

If you write `el.node.textContent` directly, you must call `el.updateSize()` before reading any dimension.

---

## 6. `setResolution` outside `crispCanvasText` — do not scatter this call

**Symptom:** Canvas text looks soft or blurry on HiDPI displays, prompting a developer to add `text.setResolution(window.devicePixelRatio)` inline. After the change, other canvas text (or the overall rendering pipeline) regresses — glyphs look wrong, font size appears inconsistent, or pixel-art elements lose crispness. (This was the failure mode that required reverting #357.)

**Cause:** The game runs `render: { pixelArt: true }` (configured in `client/src/main.ts`), which forces `gl.NEAREST` filtering and `image-rendering: pixelated` on the canvas. Under this pipeline, `setResolution` interacts with the nearest-upscaling path in non-obvious ways. Calling it on individual text objects without pairing it with the correct texture filter introduces per-object inconsistencies that are hard to isolate and can cascade across scene reloads.

**Solution/Workaround:** The ONLY intentional `setResolution` call site is `crispCanvasText(textObj)` in `client/src/objects/ui/DomLabel.ts` (lines 156–162). That function always pairs `setResolution(Math.ceil(window.devicePixelRatio))` with `Phaser.Textures.FilterMode.LINEAR`, which is the accepted ceiling for canvas text on fractional DPI. Do not add `setResolution` calls anywhere else.

For screen-fixed UI text (HP, XP, location labels, HUD elements), use `addDomLabel(...)` instead — DOM text is composited by the browser at native physical resolution and is natively crisp at any DPR without touching the canvas pipeline.

Use `crispCanvasText` only for text that is genuinely ineligible for DOM rendering: objects inside scrolling or masked containers, camera/world-space labels, or anything that must interleave in depth with canvas sprites.
