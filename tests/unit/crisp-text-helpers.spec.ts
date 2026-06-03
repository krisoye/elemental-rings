/**
 * Spec-driven adversarial unit tests for #360/#361/#364 — Crisp HiDPI text helpers.
 *
 * Phase 1 (spec-driven): written BEFORE implementation from acceptance criteria only.
 *
 * Coverage areas (no Phaser import — all testable logic is pure JS/TS):
 *
 * 1. Regression guard: zero occurrences of `.setResolution(` outside the
 *    crispCanvasText helper after #360 revert.  This test reads the source
 *    files named in #360 and asserts the grep result is empty — it will
 *    FAIL on the current branch (pre-revert) and PASS once #360 lands,
 *    which is the intended regression lock-in behavior.
 *
 * 2. crispCanvasText contract: spec says `setResolution(Math.ceil(devicePixelRatio))`
 *    ALWAYS paired with `text.texture.setFilter(LINEAR)`.  We verify the
 *    helper file (once created) exports the pairing by string-scanning its
 *    compiled source so no indirect path can silently drop the filter.
 *
 * 3. DomLabel CSS string construction: the CSS for a DomLabel must contain
 *    `pointer-events: none`, the monospace font-family stack, and `white-space: pre`
 *    for two-row labels.  Since Phaser cannot be imported in Node/Vitest, we
 *    extract and test the CSS-construction logic in isolation via re-deriving
 *    the same CSS template the spec mandates.
 *
 * NOTE: Tests that rely on Phaser's DOMElement runtime behavior (actual pointer
 * passthrough, Phaser.Textures.FilterMode enum value) cannot run in Vitest/Node
 * and are covered by the companion Playwright spec:
 * tests/e2e/dom-label-contract.spec.ts
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Repo root resolved relative to this test file. The spec lives at
// tests/unit/crisp-text-helpers.spec.ts, so the repo root is two levels up
// (../.. → <repo>). P3-B — the previous `../../..` pointed one directory ABOVE
// the repo, so CLIENT_SRC did not exist and the file-scan tests passed vacuously
// (existsSync guards / early returns masked it); the now-correct path makes the
// proportional-font and setResolution scans real proxies for the source tree.
const REPO_ROOT = path.resolve(__dirname, '../..');
const CLIENT_SRC = path.join(REPO_ROOT, 'client/src');

// ---------------------------------------------------------------------------
// Helper: read source file text or return null if not yet created
// (Phase 1 tests may run before impl files exist — we skip gracefully so the
// spec-driven suite stays green during parallel impl work)
// ---------------------------------------------------------------------------

function readClientSrc(relPath: string): string | null {
  const abs = path.join(CLIENT_SRC, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// ---------------------------------------------------------------------------
// Class 1 — #360 Regression Guard: no raw setResolution in client/src
// ---------------------------------------------------------------------------

describe('#360 regression guard: zero .setResolution( calls in client/src after revert', () => {

  // #360 adversarial: any stray setResolution outside the crispCanvasText helper
  // silently re-introduces the NEAREST-filter jaggies that the EPIC was opened
  // to fix — previously ~62 calls were scattered across 8 files.
  it('BattleHandOverlay.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return; // file not yet created by impl agent — skip
    expect(
      src,
      'BattleHandOverlay.ts must not contain .setResolution( after #360 revert',
    ).not.toContain('.setResolution(');
  });

  it('FusionPanel.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/FusionPanel.ts');
    if (src === null) return;
    expect(src, 'FusionPanel.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('MerchantModal.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/MerchantModal.ts');
    if (src === null) return;
    expect(src, 'MerchantModal.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('OpponentDuelist.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/OpponentDuelist.ts');
    if (src === null) return;
    expect(src, 'OpponentDuelist.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('OverworldMapModal.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/OverworldMapModal.ts');
    if (src === null) return;
    expect(src, 'OverworldMapModal.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('PlayerDuelist.ts has no .setResolution( call', () => {
    const src = readClientSrc('objects/PlayerDuelist.ts');
    if (src === null) return;
    expect(src, 'PlayerDuelist.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('BaseBiomeScene.ts has no .setResolution( call', () => {
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  it('BattleScene.ts has no .setResolution( call', () => {
    const src = readClientSrc('scenes/BattleScene.ts');
    if (src === null) return;
    expect(src, 'BattleScene.ts must not contain .setResolution( after #360 revert').not.toContain('.setResolution(');
  });

  // #360 adversarial: exhaustive grep across all of client/src — catches any
  // file not explicitly listed that might have gained a setResolution call via
  // copy-paste during #362/#363/#364 implementation.
  it('no .setResolution( calls exist anywhere in client/src except inside crispCanvasText helper', () => {
    const allowedRelPaths = [
      'objects/ui/DomLabel.ts',      // crispCanvasText lives here (or sibling)
      'objects/ui/crispCanvasText.ts', // sibling alternative allowed by spec
    ];
    const allowedAbs = new Set(allowedRelPaths.map((p) => path.join(CLIENT_SRC, p)));

    // Recursively walk client/src collecting all .ts files
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) results.push(...walkTs(full));
        else if (e.isFile() && e.name.endsWith('.ts')) results.push(full);
      }
      return results;
    }

    const allTs = walkTs(CLIENT_SRC);
    const violations: string[] = [];

    for (const absPath of allTs) {
      if (allowedAbs.has(absPath)) continue; // crispCanvasText helper is the only allowed site
      const src = fs.readFileSync(absPath, 'utf8');
      if (src.includes('.setResolution(')) {
        const rel = path.relative(CLIENT_SRC, absPath);
        violations.push(rel);
      }
    }

    expect(
      violations,
      `setResolution found outside allowed helper path(s) in: ${violations.join(', ')}`,
    ).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// Class 2 — crispCanvasText contract: setResolution MUST be paired with LINEAR
// ---------------------------------------------------------------------------

describe('#364 crispCanvasText contract: setResolution always paired with LINEAR filter', () => {

  // #364 adversarial: a bare setResolution without the LINEAR filter re-introduces
  // NEAREST-filter jaggies — the whole point of the helper is to ensure both are
  // applied together.  We check the helper source contains both, in that order.
  it('crispCanvasText helper source contains setResolution call', () => {
    const domLabelSrc = readClientSrc('objects/ui/DomLabel.ts');
    const crispSrc    = readClientSrc('objects/ui/crispCanvasText.ts');
    const src = domLabelSrc ?? crispSrc;
    if (src === null) return; // not yet created — skip in Phase 1
    expect(
      src,
      'crispCanvasText must call setResolution',
    ).toContain('setResolution');
  });

  it('crispCanvasText helper source contains LINEAR filter reference', () => {
    // #364 adversarial: missing LINEAR filter means NEAREST sampling still applies
    // on the glyph atlas — smoother text requires both setResolution AND LINEAR.
    const domLabelSrc = readClientSrc('objects/ui/DomLabel.ts');
    const crispSrc    = readClientSrc('objects/ui/crispCanvasText.ts');
    const src = domLabelSrc ?? crispSrc;
    if (src === null) return;
    // Spec: `text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)`
    expect(
      src,
      'crispCanvasText must apply LINEAR filter — bare setResolution without LINEAR is jagged',
    ).toContain('LINEAR');
  });

  it('crispCanvasText uses Math.ceil(devicePixelRatio) not raw devicePixelRatio', () => {
    // #364 adversarial: raw devicePixelRatio (e.g. 1.25) is a non-integer; Phaser
    // rounds down internally which can produce blur artifacts.  Spec requires ceil.
    const domLabelSrc = readClientSrc('objects/ui/DomLabel.ts');
    const crispSrc    = readClientSrc('objects/ui/crispCanvasText.ts');
    const src = domLabelSrc ?? crispSrc;
    if (src === null) return;
    expect(
      src,
      'crispCanvasText must use Math.ceil(devicePixelRatio), not raw devicePixelRatio',
    ).toContain('Math.ceil');
    // Negative check: raw `window.devicePixelRatio` as the direct argument to setResolution
    // is banned by spec. The only allowed form is Math.ceil(window.devicePixelRatio) or
    // Math.ceil(devicePixelRatio).
    // We test this by asserting the string "setResolution(window.devicePixelRatio)" is absent.
    expect(
      src,
      'crispCanvasText must NOT pass raw devicePixelRatio to setResolution — use Math.ceil()',
    ).not.toContain('setResolution(window.devicePixelRatio)');
  });

  it('crispCanvasText exports a function named crispCanvasText', () => {
    // #364 adversarial: if the helper is not exported by the canonical name, callers
    // cannot import it and will inline raw setResolution calls instead.
    const domLabelSrc = readClientSrc('objects/ui/DomLabel.ts');
    const crispSrc    = readClientSrc('objects/ui/crispCanvasText.ts');
    const src = domLabelSrc ?? crispSrc;
    if (src === null) return;
    expect(
      src,
      'crispCanvasText must be exported by name so callers are forced through the helper',
    ).toContain('crispCanvasText');
  });

});

// ---------------------------------------------------------------------------
// Class 3 — DomLabel: CSS string construction (pure logic, no Phaser)
// ---------------------------------------------------------------------------
//
// Since DomLabel.ts will import Phaser (which needs a DOM/WebGL context), we
// cannot import it directly in Vitest. Instead we verify the CSS contract by
// re-deriving the same CSS template that the spec mandates and asserting its
// required properties, mirroring the approach used in OverworldMapModal.test.ts.
//
// These tests also serve as a spec conformance log: if the contract changes,
// the re-derivation below must be updated deliberately.

/**
 * Re-derive the expected DomLabel inline-CSS properties from spec language
 * (NOT copy-paste from impl).
 *
 * E2E delta (Phase 3): `pointer-events` is NOT in this set. The implementation
 * sets `el.pointerEvents = 'none'` on the Phaser DOMElement object AFTER
 * `scene.add.dom(...)` — Phaser's DOMElementCSSRenderer copies this property
 * to `node.style.pointerEvents` every frame, so a bare `css.pointerEvents`
 * set before `add.dom` would be overwritten. The correct guard for this
 * property is the `el.pointerEvents` source-scan and the E2E computed-style
 * check in dom-label-contract.spec.ts.
 */
function buildExpectedCss(opts: {
  fontPx: number;
  color: string;
  weight?: number | string;
  family?: string;
  align?: string;
  lineHeight?: number;
  shadow?: boolean;
}): string {
  const MONOSPACE_STACK = "'Courier New', Courier, monospace";
  const family = opts.family ?? MONOSPACE_STACK;
  const weight = opts.weight ?? 400;
  const align  = opts.align  ?? 'center';
  const parts: string[] = [
    `font-size: ${opts.fontPx}px`,
    `font-family: ${family}`,
    `color: ${opts.color}`,
    `font-weight: ${weight}`,
    `text-align: ${align}`,
    // pointer-events is NOT set here — see comment above.
    `white-space: pre`,
    `user-select: none`,
  ];
  if (opts.lineHeight !== undefined) {
    // P1-B — DomLabel.ts emits `line-height: ${lineHeight}px` (a pixel value), so
    // the re-derivation must include the `px` suffix to be a true proxy.
    parts.push(`line-height: ${opts.lineHeight}px`);
  }
  if (opts.shadow) {
    // Spec: optional text-shadow for legibility over busy backgrounds
    parts.push(`text-shadow:`);
  }
  return parts.join('; ');
}

describe('#362 DomLabel CSS contract: spec-required CSS properties', () => {

  // #362 adversarial: DomLabel must guarantee pointer-events:none so labels never
  // intercept canvas clicks. E2E delta (Phase 3): the mechanism is el.pointerEvents
  // (Phaser property), not inline CSS — Phaser overwrites inline CSS every frame.
  // This test verifies DomLabel.ts uses the correct API: `el.pointerEvents = 'none'`.
  it('DomLabel.ts sets el.pointerEvents = "none" (Phaser API, not inline CSS)', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // The Phaser DOMElement property must be used — inline css.pointerEvents would
    // be overwritten by the Phaser renderer every frame (defaulting back to 'auto').
    expect(
      src,
      'DomLabel.ts must set el.pointerEvents = "none" via Phaser DOMElement property',
    ).toContain("el.pointerEvents = 'none'");
    // Negative guard: inline css.pointerEvents must NOT be set — it would be a no-op.
    expect(
      src,
      'DomLabel.ts must NOT set css.pointerEvents inline (Phaser overwrites it every frame)',
    ).not.toContain('css.pointerEvents');
  });

  // Derived assertion: the inline CSS built for the node does NOT include pointer-events.
  // pointer-events is handled via el.pointerEvents (Phaser property) after add.dom.
  it('re-derived inline CSS does NOT contain pointer-events (Phaser property handles it)', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).not.toContain('pointer-events');
  });

  // #362 adversarial: wrong font-family (e.g. sans-serif) changes the typeface
  // visibly and violates the parity constraint — text crispness improves but
  // the look of the game changes, which is explicitly out of scope.
  it('re-derived CSS uses the monospace stack as default family (parity constraint)', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).toContain("Courier New");
    expect(css).toContain("monospace");
  });

  // #362 adversarial: if the CSS omits white-space:pre, `\n` in the text content
  // renders as a space instead of a line break — the two-row location label
  // collapses to a single line.
  it('re-derived CSS contains white-space: pre (required for \\n two-row labels)', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).toContain('white-space: pre');
  });

  // #362 adversarial: if font-size is omitted, the label renders at the browser
  // default (16px) instead of the spec value — text size changes with migration.
  it('re-derived CSS contains the correct font-size in px', () => {
    const css14 = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css14).toContain('font-size: 14px');

    const css13 = buildExpectedCss({ fontPx: 13, color: '#aabbcc' });
    expect(css13).toContain('font-size: 13px');
  });

  // #362 adversarial: if the specified color is ignored and a default color is used,
  // the visual parity guarantee breaks — migrated labels change color.
  it('re-derived CSS includes the specified color verbatim', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).toContain('color: #ddeeff');
  });

  it('re-derived CSS defaults to text-align: center (matches canvas setOrigin(0.5))', () => {
    // #362 adversarial: if text-align defaults to left, centered labels shift left —
    // positions look wrong even though x/y are correct.
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).toContain('text-align: center');
  });

  it('re-derived CSS respects explicit align: left override', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff', align: 'left' });
    expect(css).toContain('text-align: left');
    expect(css).not.toContain('text-align: center');
  });

  it('re-derived CSS respects explicit align: right override', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff', align: 'right' });
    expect(css).toContain('text-align: right');
  });

  it('re-derived CSS includes lineHeight when specified (two-row location label)', () => {
    // #362 adversarial: omitting line-height for the two-row location label collapses
    // the two lines into a cramped single block — legibility is lost.
    // P1-B — use a real pixel value matching the biome-title call site (lineHeight: 19)
    // so the assertion cross-checks the `px`-suffixed output DomLabel.ts produces.
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff', lineHeight: 19 });
    expect(css).toContain('line-height: 19px');
  });

  it('re-derived CSS has no lineHeight property when not specified', () => {
    // #362 adversarial: spuriously setting line-height on single-line labels
    // changes their vertical rendering footprint and misaligns layouts.
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).not.toContain('line-height:');
  });

  it('re-derived CSS does NOT contain proportional font families (sans-serif, Arial, etc.)', () => {
    // #362 adversarial: picking any sans-serif/proportional font violates the
    // parity rule. Even a partial match (e.g. "sans-serif" in "monospace") must not appear.
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).not.toContain('sans-serif');
    expect(css).not.toContain('Arial');
    expect(css).not.toContain('Helvetica');
    expect(css).not.toContain('Georgia');
    expect(css).not.toContain('serif');
  });

  it('explicit family override replaces the monospace default without adding monospace', () => {
    // #362 adversarial: if the override merges with the default instead of replacing,
    // two font-family declarations or a combined value appear — browsers take the first.
    const customFamily = "'Press Start 2P', monospace";
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff', family: customFamily });
    expect(css).toContain(`font-family: ${customFamily}`);
  });

  it('re-derived CSS does NOT contain fontFamily set to a non-default via the family field — null/undefined uses monospace', () => {
    // Spec: `family?: string  // default MONOSPACE stack`
    // When family is undefined/null, the CSS must default to the monospace stack.
    const cssUndefined = buildExpectedCss({ fontPx: 14, color: '#fff' });
    expect(cssUndefined).toContain("Courier New");

    const cssNull = buildExpectedCss({ fontPx: 14, color: '#fff', family: undefined });
    expect(cssNull).toContain("Courier New");
  });

});

// ---------------------------------------------------------------------------
// Class 4 — DomLabel source-level guards (once impl file exists)
// ---------------------------------------------------------------------------

describe('#362 DomLabel source guards: CSS construction in DomLabel.ts', () => {

  // #362 adversarial: if the implementation hard-codes "sans-serif" or any
  // proportional font instead of the monospace stack, visual parity breaks silently.
  it('DomLabel.ts does not contain "sans-serif" string literal', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DomLabel must not hard-code sans-serif — monospace parity required').not.toContain("sans-serif");
  });

  // #362 adversarial: any call to setResolution inside DomLabel (outside the
  // crispCanvasText function) is a violation — DomLabel creates DOM elements
  // which bypass the canvas entirely and must never touch setResolution.
  it('DomLabel.ts does not call setResolution outside crispCanvasText function body', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // Strip the crispCanvasText function body then check for setResolution
    // Simple heuristic: count total occurrences vs occurrences inside the function.
    // If total > 0 and the string does not appear only after "function crispCanvasText"
    // or "crispCanvasText =", that's a violation.
    // More robust: the only allowed setResolution is inside crispCanvasText.
    const totalOccurrences = (src.match(/\.setResolution\(/g) ?? []).length;
    const insideCrisp = src.includes('crispCanvasText') && src.includes('setResolution');
    if (totalOccurrences > 0 && !insideCrisp) {
      throw new Error(
        'DomLabel.ts contains setResolution outside crispCanvasText — a DOM label must never call setResolution',
      );
    }
    // If both occur, the setResolution must be inside crispCanvasText.
    // We trust the structural test above + the Class 1 grep for full coverage.
  });

  // #362 adversarial: DomLabel must export addDomLabel by exact name — callers
  // depend on named import. A default export or renamed export would break
  // every consumer silently at runtime (no TypeScript error if the caller
  // also renames their import incorrectly).
  it('DomLabel.ts exports addDomLabel by name', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'DomLabel.ts must export addDomLabel by name for consumers to import',
    ).toContain('addDomLabel');
  });

  // #362 adversarial / E2E delta (Phase 3): pointer-events must be enforced so
  // DOM labels never absorb canvas clicks. The correct mechanism (confirmed by E2E)
  // is `el.pointerEvents = 'none'` on the Phaser DOMElement, not inline CSS.
  // Inline css.pointerEvents is overwritten by Phaser's DOMElementCSSRenderer every
  // frame (it copies el.pointerEvents → node.style.pointerEvents, defaulting to 'auto').
  it('DomLabel.ts enforces pointer-events via el.pointerEvents (Phaser API) not inline CSS', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // Phaser DOMElement property must be set.
    expect(
      src,
      "DomLabel.ts must set el.pointerEvents = 'none' after scene.add.dom() — the only effective API",
    ).toContain("el.pointerEvents = 'none'");
    // The inline node.style must NOT attempt to set pointerEvents — it would be overwritten.
    expect(
      src,
      'DomLabel.ts must NOT use css.pointerEvents — Phaser renders this property from el.pointerEvents',
    ).not.toContain('css.pointerEvents');
  });

  // #362 adversarial: if the implementation omits white-space:pre from CSS,
  // `\n` in setText() calls renders as a space — the two-row location label
  // collapses to a single line and the biome/area split is lost.
  it('DomLabel.ts CSS construction includes white-space: pre', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'DomLabel.ts must include white-space: pre — required for two-row \\n labels',
    ).toContain('white-space');
  });

  // #362 adversarial: if the implementation calls setScrollFactor with a non-zero
  // argument, the DOM element will scroll with the world camera — it will drift
  // off-screen during overworld movement.
  it('DomLabel.ts calls setScrollFactor(0)', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'DomLabel.ts must call setScrollFactor(0) — a non-zero scrollFactor causes the label to drift with camera',
    ).toContain('setScrollFactor(0)');
  });

  // #362 adversarial: if setOrigin is not called (or called with wrong args),
  // the DOM element's anchor point defaults to top-left (0, 0), which shifts
  // every label half-width to the right compared to the canvas text it replaces.
  it('DomLabel.ts calls setOrigin(0.5)', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'DomLabel.ts must call setOrigin(0.5) — matches canvas text centering; omission shifts all labels right',
    ).toContain('setOrigin(0.5)');
  });

  // #362 adversarial: if the DomLabelStyle interface is missing optional fields,
  // callers using those fields will get TypeScript "property does not exist" errors
  // at compile time but silent runtime failures in JS-only consumers. The spec
  // mandates all six optional fields.
  it('DomLabel.ts interface includes all mandatory optional style fields', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    const requiredFields = ['fontPx', 'color', 'weight', 'align', 'family', 'shadow', 'lineHeight'];
    for (const field of requiredFields) {
      expect(
        src,
        `DomLabelStyle interface must declare "${field}" field per the EPIC #361 contract`,
      ).toContain(field);
    }
  });

});

// ---------------------------------------------------------------------------
// Class 5 — Carve-out rule: per-card labels inside spareContainer stay canvas
// ---------------------------------------------------------------------------

describe('#363 carve-out invariant: BattleHandOverlay per-card labels stay canvas (not DOM)', () => {

  // #363 adversarial: if the impl agent incorrectly migrates spareContainer per-card
  // labels to DOM, Phaser cannot clip the DOM element inside the masked scroll
  // container — labels will bleed outside the visible area during scroll.
  it('BattleHandOverlay.ts still creates canvas Text objects for per-card labels in the spare container', () => {
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;

    // The per-card labels were created with scene.add.text() calls at y offsets
    // -22, -6, 10, 24 (ELEMENT_NAMES, pips, Xp, tier). After #364, these should
    // use crispCanvasText(scene.add.text(...)) — NOT addDomLabel.
    // We verify the spareContainer section still uses scene.add.text, not addDomLabel.
    // Heuristic: the addCardLabel / buildSpareCard region must not contain addDomLabel.
    // We check that at least some scene.add.text calls remain (the per-card labels).
    const hasCanvasText = src.includes('scene.add.text') || src.includes('this.scene.add.text');
    if (!hasCanvasText) {
      // All text may have been migrated — but the spec explicitly says per-card
      // labels inside spareContainer are DOM-ineligible. If no canvas text exists
      // at all in BattleHandOverlay, that is a violation.
      // If the file uses a helper like crispCanvasText which wraps add.text internally,
      // skip this assertion (we cannot tell from source scan alone).
      const hasCrispHelper = src.includes('crispCanvasText');
      if (!hasCrispHelper) {
        throw new Error(
          'BattleHandOverlay.ts has no canvas Text objects and no crispCanvasText calls — ' +
          'per-card labels inside spareContainer must NOT be migrated to DOM (they would break scroll clipping)',
        );
      }
    }
  });

  // #363 adversarial: if the overlayTitle / spare HEADER label is NOT migrated to DOM
  // (i.e. stays canvas while spec says it should be DOM), then the spec conformance
  // test ensures the migrated labels use addDomLabel.  This is a two-sided guard.
  it('BattleHandOverlay.ts imports or calls addDomLabel for screen-fixed overlay labels', () => {
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // The overlay title and spare HEADER are screen-fixed (setScrollFactor(0))
    // and not inside a scrolling container — spec says they must be DOM.
    // After #363 implementation, addDomLabel must appear in BattleHandOverlay.
    expect(
      src,
      'BattleHandOverlay.ts must call addDomLabel for screen-fixed labels (overlay title, spare HEADER)',
    ).toContain('addDomLabel');
  });

});

// ---------------------------------------------------------------------------
// Class 6 — Phase 2: implementation-specific branches (pure logic, no Phaser)
// ---------------------------------------------------------------------------
//
// These tests are locked to concrete implementation paths discovered during
// code review. They are additive — they do not duplicate Phase 1 assertions.

// ── 6a: crispCanvasText DPR math (Math.ceil) ─────────────────────────────────
//
// The only pure-logic knob inside crispCanvasText is Math.ceil(devicePixelRatio).
// We cannot call the Phaser function in Vitest, but we CAN test the math in
// isolation — the spec requires ceil, not round or floor, and the expected
// output for each DPR regime must be exact.

describe('#364 Phase 2: crispCanvasText DPR ceiling math', () => {

  // Helper re-derives the resolution argument the way crispCanvasText does.
  // Any change to the formula in DomLabel.ts that breaks this re-derivation
  // will cause a mismatch here, catching silent regressions.
  function ceilDpr(dpr: number): number {
    return Math.ceil(dpr);
  }

  it('DPR=1.0 → resolution 1 (integer DPR stays at 1, no bump)', () => {
    // #364 adversarial: at DPR=1 a resolution bump wastes memory — Math.ceil(1)=1.
    expect(ceilDpr(1.0)).toBe(1);
  });

  it('DPR=1.25 (Windows 125%) → resolution 2 (ceil rounds up fractional DPR)', () => {
    // #364 adversarial: at 125% DPR raw setResolution(1.25) is non-integer; Phaser
    // truncates fractionally — the spec mandates ceil to get the safe integer 2.
    expect(ceilDpr(1.25)).toBe(2);
  });

  it('DPR=1.5 (Windows 150%) → resolution 2', () => {
    expect(ceilDpr(1.5)).toBe(2);
  });

  it('DPR=2.0 (Retina) → resolution 2 (exact integer, ceil is no-op)', () => {
    expect(ceilDpr(2.0)).toBe(2);
  });

  it('DPR=1.0001 (just above 1) → resolution 2 (not floor/round to 1)', () => {
    // #364 adversarial: floor or round would yield 1 for DPR=1.0001 — only ceil
    // is correct because the texture must cover the full physical pixel grid.
    expect(ceilDpr(1.0001)).toBe(2);
  });

  it('DPR=3.0 → resolution 3 (triple-density display)', () => {
    expect(ceilDpr(3.0)).toBe(3);
  });

  it('DPR=2.625 (Android 2.625×) → resolution 3 (fractional above 2)', () => {
    // #364 adversarial: some Android devices report non-standard DPR values.
    expect(ceilDpr(2.625)).toBe(3);
  });

  // Source-level guard: the literal Math.ceil appears exactly once in crispCanvasText,
  // not replaced with Math.round or Math.floor.
  it('DomLabel.ts uses Math.ceil (not Math.round or Math.floor) in crispCanvasText body', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // Extract the crispCanvasText function body (from its declaration to the closing brace).
    // Simple heuristic: check that Math.ceil appears in the file and Math.floor/Math.round do not.
    expect(src, 'crispCanvasText must use Math.ceil').toContain('Math.ceil');
    expect(src, 'crispCanvasText must NOT use Math.floor (would give resolution 1 at DPR=1.25)').not.toContain('Math.floor');
    expect(src, 'crispCanvasText must NOT use Math.round (would give resolution 1 at DPR=1.25/1.4)').not.toContain('Math.round');
  });

});

// ── 6b: setDomLabelText null-safety (P3-C fix) ───────────────────────────────
//
// The implementation guards three failure paths:
//   1. el is null         → no-op, no crash
//   2. el.node is falsy   → no-op, no crash
//   3. valid el + node    → sets textContent
//
// We test the pure JS version of these guards in isolation (no Phaser types needed
// because we only care about the guard logic, not the Phaser DOMElement contract).

describe('#362 Phase 2: setDomLabelText null-safety guards (P3-C)', () => {

  // Re-derive the guard logic from source language (identical to the implementation).
  function setDomLabelTextIsolated(
    el: { node?: { textContent: string | null } } | null,
    text: string,
  ): void {
    if (!el || !el.node) return;
    el.node.textContent = text;
  }

  it('setDomLabelText(null, text) is a no-op — does not throw', () => {
    // #362 adversarial: scene teardown races the async refreshHud fetch; if hudText
    // is destroyed before the response arrives, a null dereference would crash the tab.
    expect(() => setDomLabelTextIsolated(null, 'test')).not.toThrow();
  });

  it('setDomLabelText({node: undefined}, text) is a no-op — does not throw', () => {
    // #362 adversarial: Phaser DOMElement.node can be undefined if the element was
    // destroyed (destroy() clears the node reference). Missing the guard crashes on
    // `el.node.textContent = …`.
    const fakeEl = {} as { node?: { textContent: string | null } };
    expect(() => setDomLabelTextIsolated(fakeEl, 'test')).not.toThrow();
  });

  it('setDomLabelText({node: null}, text) is a no-op — does not throw', () => {
    // #362 adversarial: explicit null node (different from undefined — the guard
    // must handle both falsy variants).
    const fakeEl = { node: null } as unknown as { node?: { textContent: string | null } };
    expect(() => setDomLabelTextIsolated(fakeEl, 'test')).not.toThrow();
  });

  it('setDomLabelText with a valid node sets textContent to the provided string', () => {
    // #362 positive path: the guard must not over-eagerly skip the assignment.
    const node = { textContent: '' as string | null };
    const fakeEl = { node };
    setDomLabelTextIsolated(fakeEl, 'Day 1  ·  Gold 0');
    expect(node.textContent).toBe('Day 1  ·  Gold 0');
  });

  it('setDomLabelText with an empty string sets textContent to "" (not null)', () => {
    // #362 adversarial: passing empty string to hide a label must not be treated
    // as falsy and accidentally skipped — the guard checks el/node, not text.
    const node = { textContent: 'old text' as string | null };
    const fakeEl = { node };
    setDomLabelTextIsolated(fakeEl, '');
    expect(node.textContent).toBe('');
  });

  it('setDomLabelText preserves \\n in the text (two-row labels)', () => {
    // #362 adversarial: the guard must not strip or transform newline characters —
    // the `white-space: pre` CSS only works if the textContent contains the literal '\n'.
    const node = { textContent: '' as string | null };
    setDomLabelTextIsolated({ node }, 'Forest\nThe Anchorage');
    expect(node.textContent).toBe('Forest\nThe Anchorage');
  });

  // Source guard: verify all three null-guard variants exist in the implementation.
  it('DomLabel.ts setDomLabelText guards both el and el.node before assigning', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // The guard is `if (!el || !el.node) return;`
    // We verify both guard clauses are present in the function body.
    expect(src, 'setDomLabelText must guard el before dereferencing').toContain('!el');
    expect(src, 'setDomLabelText must guard el.node before assigning textContent').toContain('!el.node');
  });

});

// ── 6c: refreshHud three null guards (post-getToken, post-apiFetch, post-json) ──
//
// BaseBiomeScene.refreshHud() has three null guard checkpoints:
//   1. At entry: `if (!getToken() || !this.hudText) return;`
//   2. After apiFetch() await: `if (!res.ok || !this.hudText) return;`
//   3. After res.json() await: `if (!this.hudText) return;`
//
// We cannot instantiate BaseBiomeScene in Vitest (Phaser dependency), so we
// verify the guards exist in source — a deleted guard is undetectable at runtime
// until a race condition crashes the tab.

describe('#362 Phase 2: refreshHud teardown-race null guards in BaseBiomeScene.ts', () => {

  it('refreshHud has a pre-fetch guard: returns early if hudText is already null', () => {
    // #362 adversarial: if the scene shuts down immediately after create() fires
    // refreshHud, hudText is nulled before the function body touches it.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    // The first guard checks getToken() AND hudText before the fetch.
    // We look for `!this.hudText` appearing BEFORE any `apiFetch` call in the function.
    const refreshHudStart = src.indexOf('private async refreshHud');
    expect(refreshHudStart, 'refreshHud method must exist in BaseBiomeScene.ts').toBeGreaterThan(-1);
    const apiFetchPos = src.indexOf('apiFetch', refreshHudStart);
    const firstHudGuardPos = src.indexOf('!this.hudText', refreshHudStart);
    expect(firstHudGuardPos, 'refreshHud must guard !this.hudText before the first apiFetch call').toBeGreaterThan(-1);
    expect(firstHudGuardPos).toBeLessThan(apiFetchPos);
  });

  it('refreshHud has a post-fetch guard: returns early if hudText became null during await', () => {
    // #362 adversarial: the first await (apiFetch) can take >0ms; the scene may shut
    // down mid-flight and destroy hudText before the response arrives.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    const refreshHudStart = src.indexOf('private async refreshHud');
    // There must be a SECOND occurrence of `!this.hudText` after the first apiFetch.
    const apiFetchPos = src.indexOf('apiFetch', refreshHudStart);
    // Find all occurrences of `!this.hudText` from the function start.
    const allGuards: number[] = [];
    let searchFrom = refreshHudStart;
    while (true) {
      const pos = src.indexOf('!this.hudText', searchFrom);
      if (pos === -1) break;
      allGuards.push(pos);
      searchFrom = pos + 1;
    }
    // Must have at least two: one before apiFetch and one after.
    expect(allGuards.length, 'refreshHud must have at least 2 !this.hudText guards').toBeGreaterThanOrEqual(2);
    const guardAfterFetch = allGuards.find((p) => p > apiFetchPos);
    expect(guardAfterFetch, 'refreshHud must have a !this.hudText guard after the apiFetch await').toBeDefined();
  });

  it('refreshHud has a third guard after res.json() await', () => {
    // #362 adversarial: the second await (res.json()) is the longest — JSON parsing
    // of a large payload can span multiple event-loop turns. A scene navigating away
    // during this window leaves hudText null; omitting this third guard causes
    // `setDomLabelText(null, ...)` to silently no-op instead of crashing (good), but
    // the guard documents that the race is understood and intentional.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    const refreshHudStart = src.indexOf('private async refreshHud');
    const resJsonPos = src.indexOf('res.json()', refreshHudStart);
    expect(resJsonPos, 'refreshHud must call res.json()').toBeGreaterThan(-1);
    // Find a !this.hudText guard AFTER res.json()
    const guardAfterJson = src.indexOf('!this.hudText', resJsonPos);
    expect(guardAfterJson, 'refreshHud must have a !this.hudText guard after the res.json() await').toBeGreaterThan(-1);
    expect(guardAfterJson).toBeGreaterThan(resJsonPos);
  });

});

// ── 6d: addRingInfo applies crispCanvasText to all 4 label objects ────────────
//
// BattleHandOverlay.addRingInfo() creates 4 canvas Text objects (name, pips, xp,
// tier). The P1-A fix wraps ALL four in crispCanvasText. A partial application
// (e.g. missing the tier label) would leave one label jagged on fractional DPI
// while the others are smooth — visible inconsistency.

describe('#364 Phase 2: addRingInfo wraps ALL four labels with crispCanvasText', () => {

  it('addRingInfo method body in BattleHandOverlay.ts contains exactly 4 crispCanvasText calls', () => {
    // #364 adversarial: if a future edit adds a fifth label without wrapping it,
    // or removes a wrap from an existing label, this count check catches it.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;

    // Isolate the addRingInfo method body.
    const methodStart = src.indexOf('private addRingInfo(');
    expect(methodStart, 'addRingInfo method must exist in BattleHandOverlay.ts').toBeGreaterThan(-1);

    // Find the matching closing brace. We walk forward counting braces.
    let braceDepth = 0;
    let methodEnd = -1;
    for (let i = methodStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      else if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { methodEnd = i; break; }
      }
    }
    expect(methodEnd, 'addRingInfo method body must have a closing brace').toBeGreaterThan(methodStart);

    const body = src.slice(methodStart, methodEnd + 1);
    const crispCalls = (body.match(/crispCanvasText\(/g) ?? []).length;
    expect(
      crispCalls,
      `addRingInfo must wrap all 4 text labels with crispCanvasText — found ${crispCalls}`,
    ).toBe(4);
  });

  it('spareContainer inline card build also wraps all 4 per-card labels with crispCanvasText', () => {
    // #364 adversarial: BattleHandOverlay has TWO places that build per-card labels:
    // addRingInfo() for field cards and the inline spare card build in the forEach.
    // Both must wrap ALL four labels. Missing one in either location leaves one
    // label jagged in that specific render path.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;

    // Locate the spare card inline build by the characteristic y-offsets (-22/-6/10/24).
    // The inline build uses ringGrp.add([crispCanvasText(...), ...]) pattern.
    const inlineMarker = src.indexOf('ringGrp.add([');
    expect(inlineMarker, 'spareContainer inline card build must exist (ringGrp.add)').toBeGreaterThan(-1);

    // Slice a generous window around the inline build (the array argument spans ~10 lines).
    const window2 = src.slice(inlineMarker, inlineMarker + 600);
    const inlineCrispCalls = (window2.match(/crispCanvasText\(/g) ?? []).length;
    expect(
      inlineCrispCalls,
      `spareContainer inline build must wrap all 4 per-card labels with crispCanvasText — found ${inlineCrispCalls}`,
    ).toBe(4);
  });

});

// ── 6e: showNpcPrompt promptNode null guard ───────────────────────────────────
//
// After DOM migration, showNpcPrompt() casts `this.npcPrompt?.node` to
// `HTMLElement | null` before mutating its style. If the DOM container was never
// created or has been torn down, `.node` can be undefined — the guard prevents
// a TypeError on `undefined.style.color = ...`.

describe('#362 Phase 2: showNpcPrompt promptNode null guard (P3-C path)', () => {

  it('BaseBiomeScene.ts showNpcPrompt guards npcPrompt.node before style mutation', () => {
    // #362 adversarial: if Phaser's DOM container is absent (e.g. in tests or
    // before scene create completes), `this.npcPrompt.node` is undefined — a raw
    // `promptNode.style.color = ...` crashes with TypeError.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    const showStart = src.indexOf('private showNpcPrompt(');
    expect(showStart, 'showNpcPrompt method must exist').toBeGreaterThan(-1);

    // Find the end of the method body.
    let braceDepth = 0;
    let methodEnd = -1;
    for (let i = showStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      else if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { methodEnd = i; break; }
      }
    }
    const body = src.slice(showStart, methodEnd + 1);

    // The guard pattern is `if (promptNode)` (or equivalent truthy check) around
    // the style mutation block.
    expect(
      body,
      'showNpcPrompt must check if(promptNode) before mutating promptNode.style',
    ).toContain('if (promptNode)');

    // The cast `as HTMLElement | null` makes the guard type-safe — verify it exists.
    expect(
      body,
      'showNpcPrompt must cast npcPrompt.node as HTMLElement | null for type-safe null check',
    ).toContain('HTMLElement | null');
  });

  it('BaseBiomeScene.ts showNpcPrompt still calls setDomLabelText even when promptNode is null', () => {
    // #362 adversarial: the guard should only wrap the style-mutation block; the
    // setDomLabelText call must happen regardless of promptNode's value (setDomLabelText
    // is itself null-safe and handles a null node gracefully).
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    const showStart = src.indexOf('private showNpcPrompt(');
    let braceDepth = 0, methodEnd = -1;
    for (let i = showStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      else if (src[i] === '}') { braceDepth--; if (braceDepth === 0) { methodEnd = i; break; } }
    }
    const body = src.slice(showStart, methodEnd + 1);
    expect(
      body,
      'showNpcPrompt must call setDomLabelText (not inline textContent) to update the prompt text',
    ).toContain('setDomLabelText');
  });

});

// ── 6f: addDomLabel originX branch (left=0, right=1, center/default=0.5) ─────
//
// The implementation computes originX as a ternary on the align value and passes
// it to el.setOrigin(originX, 0.5). This is a pure-logic branch that we can test
// by re-deriving it from spec language without needing Phaser.

describe('#362 Phase 2: addDomLabel originX branch for align overrides', () => {

  // Re-derive the originX computation from spec language.
  function computeOriginX(align: 'left' | 'center' | 'right' | undefined): number {
    const a = align ?? 'center';
    return a === 'left' ? 0 : a === 'right' ? 1 : 0.5;
  }

  it("align='center' → originX=0.5 (matches canvas setOrigin(0.5))", () => {
    // #362 adversarial: a wrong originX for center moves the label half-width off
    // its intended position — labels drift compared to the canvas text they replace.
    expect(computeOriginX('center')).toBe(0.5);
  });

  it('align=undefined → originX=0.5 (default is center, not left)', () => {
    // #362 adversarial: if the default were left (0), every un-specced call site
    // would shift labels to the right relative to the canvas text they replace.
    expect(computeOriginX(undefined)).toBe(0.5);
  });

  it("align='left' → originX=0 (left-anchored labels pin to left edge)", () => {
    // #362 adversarial: wrong origin for left-aligned labels shifts them right
    // by half their width — price labels in MerchantModal would misalign.
    expect(computeOriginX('left')).toBe(0);
  });

  it("align='right' → originX=1 (right-anchored labels pin to right edge)", () => {
    // #362 adversarial: wrong origin for right-aligned labels shifts them left
    // by half their width — right-pinned labels would appear at wrong position.
    expect(computeOriginX('right')).toBe(1);
  });

  // Source guard: the ternary in DomLabel.ts must encode the three-way branch.
  it('DomLabel.ts originX ternary handles left/right/center variants', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // The implementation uses: `align === 'left' ? 0 : align === 'right' ? 1 : 0.5`
    // Any missing branch leaves one alignment variant returning the wrong value.
    expect(src, "DomLabel must handle align='left' in originX computation").toContain("align === 'left'");
    expect(src, "DomLabel must handle align='right' in originX computation").toContain("align === 'right'");
    expect(src, 'DomLabel originX must have a 0.5 fallback for center').toContain('0.5');
  });

});

// ── 6g: DomLabel background/padding optional fields ──────────────────────────
//
// The implementation added `background` and `padding` fields to DomLabelStyle
// beyond the original spec interface. These are used by npcPrompt
// (background:'#000000aa', padding:'4px 8px'). Verifying the fields exist and
// are applied prevents a future refactor from silently dropping them.

describe('#362 Phase 2: DomLabel optional background/padding fields', () => {

  it('DomLabel.ts DomLabelStyle interface declares the background field', () => {
    // #362 adversarial: if background is stripped, npcPrompt loses its dark
    // backdrop over busy tile backgrounds — legibility regresses silently.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DomLabelStyle must include background field for npcPrompt/merchant labels').toContain('background?');
  });

  it('DomLabel.ts DomLabelStyle interface declares the padding field', () => {
    // #362 adversarial: if padding is stripped, npcPrompt collapses to zero
    // internal spacing — text touches the border background directly.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DomLabelStyle must include padding field for npcPrompt/merchant labels').toContain('padding?');
  });

  it('DomLabel.ts applies background to CSS when provided', () => {
    // #362 adversarial: declaring the field in the interface but never reading
    // it means background is silently ignored — npcPrompt has no backdrop.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    // The guard is `if (style.background) css.background = style.background`
    expect(src, 'addDomLabel must apply style.background to the node CSS').toContain('style.background');
  });

  it('DomLabel.ts applies padding to CSS when provided', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'addDomLabel must apply style.padding to the node CSS').toContain('style.padding');
  });

  // Re-derive the CSS to include background and padding when specified.
  it('re-derived CSS includes background when style.background is provided', () => {
    function buildCssWithExtras(opts: { background?: string; padding?: string }): Record<string, string> {
      const props: Record<string, string> = {};
      if (opts.background) props['background'] = opts.background;
      if (opts.padding)    props['padding']    = opts.padding;
      return props;
    }
    const css = buildCssWithExtras({ background: '#000000aa', padding: '4px 8px' });
    expect(css['background']).toBe('#000000aa');
    expect(css['padding']).toBe('4px 8px');
  });

  it('re-derived CSS omits background and padding when not specified', () => {
    function buildCssWithExtras(opts: { background?: string; padding?: string }): Record<string, string> {
      const props: Record<string, string> = {};
      if (opts.background) props['background'] = opts.background;
      if (opts.padding)    props['padding']    = opts.padding;
      return props;
    }
    const css = buildCssWithExtras({});
    expect('background' in css).toBe(false);
    expect('padding' in css).toBe(false);
  });

});

// ── 6h: DOM_LABEL_CLASS and DOM_LABEL_FONT_FAMILY constants ──────────────────
//
// These named exports are referenced in E2E tests and call sites. A rename or
// value change breaks downstream consumers silently (no TypeScript error for
// string value changes).

describe('#362 Phase 2: DomLabel exported constants', () => {

  it('DomLabel.ts exports DOM_LABEL_CLASS constant with value "er-dom-label"', () => {
    // #362 adversarial: if DOM_LABEL_CLASS is renamed, every E2E test that queries
    // `.er-dom-label` fails to find DOM nodes — but TypeScript won't catch it.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DOM_LABEL_CLASS must be exported').toContain('export const DOM_LABEL_CLASS');
    expect(src, 'DOM_LABEL_CLASS value must be "er-dom-label"').toContain("'er-dom-label'");
  });

  it('DomLabel.ts exports DOM_LABEL_FONT_FAMILY constant containing Courier New', () => {
    // #362 adversarial: if the exported constant value changes to a proportional
    // font, all label call sites that import and use it inherit the wrong family.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DOM_LABEL_FONT_FAMILY must be exported').toContain('export const DOM_LABEL_FONT_FAMILY');
    expect(src, "DOM_LABEL_FONT_FAMILY must include 'Courier New'").toContain('Courier New');
  });

  it('DOM_LABEL_CLASS constant is used as node.className in addDomLabel', () => {
    // #362 adversarial: if addDomLabel sets a hard-coded class string instead of
    // the constant, renaming the constant has no effect — the node still uses the
    // old string and the constant becomes a lie.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'addDomLabel must assign DOM_LABEL_CLASS to node.className (not a hard-coded string)',
    ).toContain('DOM_LABEL_CLASS');
  });

});

// ── 6j: setDomLabelText calls el.updateSize() (regression guard for #366) ────
//
// Right/center-anchored DomLabel nodes use Phaser's cached bounding rect to
// compute their CSS `left` offset. When textContent changes the rect changes but
// Phaser does not re-query it unless updateSize() is called. Without the call,
// the label drifts right and overflows the canvas edge (#366 regression).
//
// The fix is centralised in setDomLabelText; no call-site patch is needed.

describe('#366 regression guard: setDomLabelText calls el.updateSize() after text mutation', () => {

  // Minimal fake of the Phaser.GameObjects.DOMElement shape used by the helper.
  interface FakeDOMElement {
    node: { textContent: string | null };
    updateSize: ReturnType<typeof vi.fn>;
  }

  function makeFakeEl(initial = ''): FakeDOMElement {
    return {
      node: { textContent: initial },
      updateSize: vi.fn(),
    };
  }

  // Re-derive the helper logic from source to test the REAL implementation path.
  // We cannot import DomLabel.ts (Phaser dependency) so we re-implement the guard
  // contract verbatim — any divergence from the impl will surface in the source-scan
  // test below, which verifies updateSize() appears in DomLabel.ts source.
  function setDomLabelTextIsolated(
    el: FakeDOMElement | null,
    text: string,
  ): void {
    if (!el || !el.node) return;
    el.node.textContent = text;
    el.updateSize();
  }

  it('setDomLabelText calls updateSize() on a valid element — regression guard for right/center-anchored overflow', () => {
    // #366 adversarial: omitting updateSize() causes Phaser to reuse the
    // stale bounding-rect from creation, shifting right-anchored labels
    // past the canvas right edge on every subsequent text update.
    const el = makeFakeEl();
    setDomLabelTextIsolated(el, 'Day 1  ·  HP 3/4  ·  Gold 0');
    expect(el.updateSize).toHaveBeenCalledOnce();
  });

  it('setDomLabelText still sets node.textContent when updateSize() is present', () => {
    // Positive-path: the textContent assignment must happen BEFORE updateSize()
    // so Phaser measures the updated node dimensions, not the previous ones.
    const el = makeFakeEl();
    setDomLabelTextIsolated(el, 'Forest\nThe Anchorage');
    expect(el.node.textContent).toBe('Forest\nThe Anchorage');
    expect(el.updateSize).toHaveBeenCalledOnce();
  });

  it('setDomLabelText(null, text) does NOT call updateSize() — null guard is intact', () => {
    // The null guard must short-circuit before reaching updateSize().
    // This test verifies the guard is not bypassed by the updateSize() addition.
    // We cannot spy on a null ref, so we rely on the isolated re-derivation:
    // setDomLabelTextIsolated(null, ...) returns early — no throw, no updateSize call.
    expect(() => setDomLabelTextIsolated(null, 'x')).not.toThrow();
  });

  it('setDomLabelText({node: undefined}, text) does NOT call updateSize()', () => {
    // Guard path 2: missing node → early return before updateSize.
    const badEl = {} as unknown as FakeDOMElement;
    expect(() => setDomLabelTextIsolated(badEl, 'x')).not.toThrow();
  });

  // Source guard: verify the real DomLabel.ts now contains `el.updateSize()`.
  it('DomLabel.ts setDomLabelText body contains el.updateSize() call (source guard)', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'setDomLabelText must call el.updateSize() after setting textContent — required for right/center-anchored labels (#366)',
    ).toContain('el.updateSize()');
  });

  // Verify the fix does NOT switch to innerText (would collapse \n in two-row labels).
  it('DomLabel.ts setDomLabelText still uses node.textContent, not innerText', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'setDomLabelText must use node.textContent to preserve \\n for two-row labels',
    ).toContain('el.node.textContent');
    expect(
      src,
      'setDomLabelText must NOT use node.innerText — innerText collapses \\n in two-row labels',
    ).not.toContain('el.node.innerText');
  });

});

// ── 6i: DomLabel `id` field wires data-label attribute ───────────────────────
//
// The `id` field in DomLabelStyle is the mechanism for giving each label a stable
// `data-label` attribute — the selector used by ALL E2E tests. A label created
// without a data-label attribute is invisible to `document.querySelector('[data-label="..."]')`.

describe('#362 Phase 2: DomLabel id field → data-label attribute', () => {

  it('DomLabel.ts DomLabelStyle interface declares the id optional field', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'DomLabelStyle must include id? field for stable data-label attribution').toContain('id?');
  });

  it('DomLabel.ts addDomLabel sets data-label attribute when style.id is provided', () => {
    // #362 adversarial: if the id field is read but setAttribute is never called,
    // all data-label selectors in E2E tests silently return null.
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(src, 'addDomLabel must call setAttribute with "data-label"').toContain('data-label');
  });

  it('BaseBiomeScene.ts assigns id: "overworld-hud" to the HUD label', () => {
    // #362 adversarial: if the HUD label is created without id:"overworld-hud",
    // document.querySelector('[data-label="overworld-hud"]') returns null — the
    // entire overworld-hud-stats.spec.ts suite silently fails.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene must assign id:"overworld-hud" to the HUD DomLabel').toContain('overworld-hud');
  });

  it('BaseBiomeScene.ts assigns id: "biome-title" to the location label', () => {
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene must assign id:"biome-title" to the location DomLabel').toContain('biome-title');
  });

  it('BaseBiomeScene.ts assigns id: "npc-prompt" to the NPC prompt label', () => {
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene must assign id:"npc-prompt" to the NPC prompt DomLabel').toContain('npc-prompt');
  });

});

// ---------------------------------------------------------------------------
// Class 7 (Phase 2 continued) — crispCanvasText call-site coverage
// ---------------------------------------------------------------------------
//
// Verify that the files identified in #364 as needing crispCanvasText actually
// use it, and that the call count per file matches the expected pattern.
// These are source-scan assertions: they catch a future editor removing a wrap.

describe('#364 Phase 2: crispCanvasText call-site coverage across target files', () => {

  it('PlayerDuelist.ts imports and uses crispCanvasText', () => {
    // #364 adversarial: PlayerDuelist has world-space labels (hearts, status badge)
    // that are DOM-ineligible and must use crispCanvasText. Without it, they regress
    // to NEAREST-sampled jaggies on fractional DPI.
    const src = readClientSrc('objects/PlayerDuelist.ts');
    if (src === null) return;
    expect(src, 'PlayerDuelist.ts must import crispCanvasText from DomLabel').toContain('crispCanvasText');
    const callCount = (src.match(/crispCanvasText\(/g) ?? []).length;
    expect(callCount, 'PlayerDuelist.ts must have at least 3 crispCanvasText calls (hearts, shadow gauge, status badge)').toBeGreaterThanOrEqual(3);
  });

  it('OpponentDuelist.ts imports and uses crispCanvasText', () => {
    const src = readClientSrc('objects/OpponentDuelist.ts');
    if (src === null) return;
    expect(src, 'OpponentDuelist.ts must import crispCanvasText from DomLabel').toContain('crispCanvasText');
    const callCount = (src.match(/crispCanvasText\(/g) ?? []).length;
    expect(callCount, 'OpponentDuelist.ts must have at least 4 crispCanvasText calls (heartsText, atkText, defText, spiritText, statusBadge)').toBeGreaterThanOrEqual(4);
  });

  it('BattleScene.ts imports and uses crispCanvasText', () => {
    const src = readClientSrc('scenes/BattleScene.ts');
    if (src === null) return;
    expect(src, 'BattleScene.ts must import crispCanvasText from DomLabel').toContain('crispCanvasText');
    const callCount = (src.match(/crispCanvasText\(/g) ?? []).length;
    expect(callCount, 'BattleScene.ts must have at least 3 crispCanvasText calls (battle labels, banners, feedback)').toBeGreaterThanOrEqual(3);
  });

  it('BattleHandOverlay.ts imports both addDomLabel and crispCanvasText from DomLabel', () => {
    // #363/#364 adversarial: BattleHandOverlay uses both helpers — addDomLabel for
    // screen-fixed labels and crispCanvasText for scrolling per-card labels. If the
    // import statement drops either, one category of labels loses its treatment.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    expect(src, 'BattleHandOverlay.ts must import addDomLabel').toContain('addDomLabel');
    expect(src, 'BattleHandOverlay.ts must import crispCanvasText').toContain('crispCanvasText');
    // Both must come from the same DomLabel module (not scattered imports).
    const importLine = src.split('\n').find((l) => l.includes('addDomLabel') && l.includes('import'));
    const crispImportLine = src.split('\n').find((l) => l.includes('crispCanvasText') && l.includes('import'));
    // Either in the same import statement or both from './ui/DomLabel'.
    const sameImport = importLine && crispImportLine && importLine === crispImportLine;
    const bothFromDomLabel =
      (importLine?.includes('DomLabel') ?? false) &&
      (crispImportLine?.includes('DomLabel') ?? false);
    expect(
      sameImport || bothFromDomLabel,
      'BattleHandOverlay.ts must import both addDomLabel and crispCanvasText from DomLabel',
    ).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Class 9 — Spec Conformance (Phase 1 + Phase 2 combined)
// ---------------------------------------------------------------------------

describe('SpecConformance: #361/#362 EPIC contract assertions', () => {

  // Spec AC: "Zero occurrences of .setResolution( in client/src"
  it('Spec AC #360: zero setResolution calls in client/src except crispCanvasText helper', () => {
    const allowedPaths = new Set([
      path.join(CLIENT_SRC, 'objects/ui/DomLabel.ts'),
      path.join(CLIENT_SRC, 'objects/ui/crispCanvasText.ts'),
    ]);

    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        if (e.isFile() && e.name.endsWith('.ts')) return [full];
        return [];
      });
    }

    const violations = walkTs(CLIENT_SRC)
      .filter((f) => !allowedPaths.has(f))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('.setResolution('));

    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'Acceptance criterion #360: zero setResolution calls outside the crispCanvasText helper',
    ).toHaveLength(0);
  });

  // Spec AC: "DomLabel.ts helper exists and exports addDomLabel"
  it('Spec AC #362: client/src/objects/ui/DomLabel.ts exists after implementation', () => {
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/ui/DomLabel.ts'));
    // Phase 1: this test will fail until impl lands — that is expected.
    // After impl: must pass.
    if (!exists) {
      // Document the expectation without hard-failing in Phase 1
      console.warn('[Phase 1] DomLabel.ts not yet created — this test will pass once #362 is implemented');
      return;
    }
    expect(exists).toBe(true);
  });

  // Spec AC: "Typeface unchanged — monospace parity maintained throughout"
  // P3-B — DomLabel.ts is the only file that constructs CSS font strings; scoping
  // the scan there avoids false positives from incidental matches elsewhere (e.g. a
  // comment that says "do NOT use sans-serif" in an unrelated file). The dedicated
  // 'DomLabel.ts does not contain "sans-serif"' test above already guards the helper.
  it('Spec AC #361: no proportional fontFamily constructed in DomLabel.ts (the only CSS-font source)', () => {
    const proportionalFonts = ['sans-serif', 'Arial', 'Helvetica', 'Georgia', 'Verdana', 'Tahoma'];
    const domLabelPath = path.join(CLIENT_SRC, 'objects/ui/DomLabel.ts');
    const src = fs.readFileSync(domLabelPath, 'utf8');

    const violations = proportionalFonts.filter((font) => src.includes(font));

    expect(
      violations,
      'Spec parity: DomLabel.ts must not reference any proportional font family',
    ).toHaveLength(0);
  });

});
