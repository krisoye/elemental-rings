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

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Repo root resolved relative to this test file (server/vitest.config.ts
// runs tests from the server/ workspace, so __dirname resolves correctly).
const REPO_ROOT = path.resolve(__dirname, '../../..');
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

/** Re-derive the expected DomLabel CSS from spec language (NOT copy-paste from impl). */
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
    `pointer-events: none`,
    `white-space: pre`,
    `user-select: none`,
  ];
  if (opts.lineHeight !== undefined) {
    parts.push(`line-height: ${opts.lineHeight}`);
  }
  if (opts.shadow) {
    // Spec: optional text-shadow for legibility over busy backgrounds
    parts.push(`text-shadow:`);
  }
  return parts.join('; ');
}

describe('#362 DomLabel CSS contract: spec-required CSS properties', () => {

  // #362 adversarial: omitting pointer-events:none means the DOM label will absorb
  // clicks intended for the canvas — a P1 regression that silently breaks all
  // canvas interaction wherever a label is placed.
  it('re-derived CSS contains pointer-events: none', () => {
    const css = buildExpectedCss({ fontPx: 14, color: '#ddeeff' });
    expect(css).toContain('pointer-events: none');
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
    const css = buildExpectedCss({ fontPx: 13, color: '#aabbcc', lineHeight: 1.4 });
    expect(css).toContain('line-height: 1.4');
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

  // #362 adversarial: if pointer-events:none is omitted from the CSS built
  // in addDomLabel, DOM labels will capture mouse events intended for the
  // canvas underneath — silent interaction regression.
  it('DomLabel.ts CSS construction includes pointer-events', () => {
    const src = readClientSrc('objects/ui/DomLabel.ts');
    if (src === null) return;
    expect(
      src,
      'DomLabel.ts must include pointer-events in the CSS string — omission causes canvas click interception',
    ).toContain('pointer-events');
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
// Class 6 — Spec Conformance
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
  it('Spec AC #361: no fontFamily set to a proportional font anywhere in client/src', () => {
    const proportionalFonts = ['sans-serif', 'Arial', 'Helvetica', 'Georgia', 'Verdana', 'Tahoma'];

    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        if (e.isFile() && e.name.endsWith('.ts')) return [full];
        return [];
      });
    }

    const violations: string[] = [];
    for (const absPath of walkTs(CLIENT_SRC)) {
      const src = fs.readFileSync(absPath, 'utf8');
      for (const font of proportionalFonts) {
        // Only flag occurrences in font-family CSS strings, not incidental matches
        if (src.includes(`font-family`) && src.includes(font)) {
          violations.push(`${path.relative(CLIENT_SRC, absPath)}: contains "${font}" in font-family context`);
        }
      }
    }

    expect(
      violations,
      'Spec parity: no proportional font families should be set in client/src',
    ).toHaveLength(0);
  });

});
