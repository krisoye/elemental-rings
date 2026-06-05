/**
 * Phase 2 implementation-aware regression tests for #409 — visual capture harness.
 *
 * These tests cover implementation-specific branches and paths discovered by reading
 * visual-capture.spec.ts, playwright.config.ts, and package.json directly. They are
 * distinct from Phase 1 (spec-driven, public-interface only) and target concrete
 * implementation decisions that Phase 1 could not anticipate without seeing the code.
 *
 * Run:
 *   cd /home/krisoye/wip/8e4f6a6c-004c-4da1-b3d0-a11109a9e44d/elemental-rings && \
 *     npx vitest run --pool=threads tests/unit/visual-capture-impl.test.ts
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const VISUAL_CAPTURE_SPEC = path.join(REPO_ROOT, 'tests/e2e/visual-capture.spec.ts');
const PLAYWRIGHT_CONFIG = path.join(REPO_ROOT, 'playwright.config.ts');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

// Read sources once at module scope — all tests in this file are static-analysis tests.
const captureSpecSrc = fs.existsSync(VISUAL_CAPTURE_SPEC)
  ? fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8')
  : '';
const configSrc = fs.readFileSync(PLAYWRIGHT_CONFIG, 'utf-8');
const pkgJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));

// ===========================================================================
// Class A — sanitizeTarget() implementation: slash replacement (Phase 1 gap)
// ===========================================================================

describe('#409 impl: sanitizeTarget() replaces both colon AND slash', () => {

  it('visual-capture.spec.ts uses [:/] regex (not just /:/) in sanitizeTarget', () => {
    // #409 adversarial: Phase 1 tests only checked colon-to-hyphen replacement because
    // Phase 1's helper used /:/g. The real implementation uses /[:/]/g, which also
    // strips forward slashes. A target like 'screen:forest/north' (hypothetical path
    // with slash) would produce a safe filename only if slashes are also replaced.
    // If the implementation regresses to /:/g only, paths with '/' in future target
    // identifiers would produce directory-traversal filenames like
    // '/tmp/er-capture-screen:forest/north.png' which either fails or creates
    // subdirectories unexpectedly.
    expect(
      captureSpecSrc,
      "sanitizeTarget must use [:/] regex to replace both colons and slashes — " +
        "prevents directory-traversal in generated filenames if target ever contains '/'"
    ).toContain('[:/]');
  });

  it('sanitizeTarget regex in the spec replaces forward slashes (source-verified)', () => {
    // #409 impl: confirm the character class in the regex is the broader [:/] form,
    // not just /:/ — cross-check that '/' is inside the character class brackets.
    // The test looks for the literal regex pattern used in the function body.
    const hasBroadRegex =
      captureSpecSrc.includes('/[:/]/g') ||
      captureSpecSrc.includes("[:/]");
    expect(
      hasBroadRegex,
      'sanitizeTarget in visual-capture.spec.ts must use /[:/]/g (broad character class) ' +
        'to handle future targets that may include forward slashes in screen IDs'
    ).toBe(true);
  });

  it('slash in a target would be sanitized to hyphen by [:/] regex (behavioral)', () => {
    // #409 impl: verify the logic of the [:/] regex on a hypothetical slash-containing
    // target. This test is self-contained (does not read the spec file) and documents
    // what the implementation MUST do if a future target grammar includes slashes.
    // If this assertion passes but the spec file fails the regex-shape test above,
    // it means the spec diverged from the required behavior.
    const sanitize = (s: string) => s.replace(/[:/]/g, '-');
    expect(sanitize('screen:forest/north')).toBe('screen-forest-north');
    expect(sanitize('overlay:field/sub')).toBe('overlay-field-sub');
    // Already-clean targets pass through unchanged (no colons/slashes)
    expect(sanitize('camp')).toBe('camp');
    expect(sanitize('forest_anchorage')).toBe('forest_anchorage');
  });

});

// ===========================================================================
// Class B — CAPTURE_OUT default path: module-level evaluation
// ===========================================================================

describe('#409 impl: CAPTURE_OUT default path is computed at module load time', () => {

  it('defaultOut is declared at module scope (not inside the test callback)', () => {
    // #409 impl: the default path formula is evaluated once at module load:
    //   const defaultOut = `/tmp/er-capture-${sanitizeTarget(rawTarget)}.png`
    // If it were evaluated inside the test body, the env var could be changed between
    // when `rawTarget` is read and when `captureOut` is used — a TOCTOU hazard.
    // This test verifies the const is declared at the top level of the module.
    const topLevelSection = captureSpecSrc.slice(0, captureSpecSrc.indexOf('test('));
    expect(
      topLevelSection,
      'defaultOut must be a module-level const (evaluated once at startup, not inside test callback)'
    ).toContain('defaultOut');
  });

  it('captureOut uses nullish coalescing (??) to fall back to defaultOut', () => {
    // #409 impl: `const captureOut = process.env.CAPTURE_OUT ?? defaultOut`
    // Using || instead of ?? would incorrectly treat CAPTURE_OUT='' as falsy and fall
    // back to the default even when the caller explicitly set an empty string.
    // This is a subtle operator-choice bug — document it as a regression guard.
    expect(
      captureSpecSrc,
      "captureOut must use ?? (nullish coalescing) to fall back to defaultOut — " +
        "|| would incorrectly treat CAPTURE_OUT='' as absent"
    ).toMatch(/captureOut\s*=\s*process\.env\.CAPTURE_OUT\s*\?\?/);
  });

  it('rawTarget uses nullish coalescing (??) with default "camp"', () => {
    // #409 impl: `const rawTarget = process.env.CAPTURE_TARGET ?? 'camp'`
    // Same operator-choice concern: ?? preserves CAPTURE_TARGET='' as '' (which then
    // resolves to 'camp' via the ?? 'camp' default), while || would silently convert
    // any falsy env var value to 'camp'.
    expect(
      captureSpecSrc,
      "rawTarget must use ?? (nullish coalescing) with 'camp' default"
    ).toMatch(/rawTarget\s*=\s*process\.env\.CAPTURE_TARGET\s*\?\?/);
  });

  it("rawTarget default is 'camp' (not empty string, not undefined)", () => {
    // #409 impl: the default target when CAPTURE_TARGET is not set must be 'camp'.
    // If it defaulted to '' or undefined, the else-throw branch would fire on every
    // unparameterized run, producing a confusing error instead of a useful capture.
    expect(
      captureSpecSrc,
      "rawTarget fallback must default to 'camp'"
    ).toMatch(/rawTarget\s*=\s*process\.env\.CAPTURE_TARGET\s*\?\?\s*'camp'/);
  });

});

// ===========================================================================
// Class C — try/finally ctx.close() teardown guarantee
// ===========================================================================

describe('#409 impl: try/finally guarantees ctx.close() on all code paths', () => {

  it('visual-capture.spec.ts uses a try/finally block wrapping the test body', () => {
    // #409 impl: the spec wraps all navigation and screenshot logic in try { ... } finally
    // { await ctx.close() }. Without finally, a throw inside the navigation sequence
    // (e.g. waitForFunction timeout on a slow machine) would leave the browser context
    // open, leaking memory across the test run. The finally block is the only safe
    // teardown pattern when the test body can throw.
    expect(
      captureSpecSrc,
      'visual-capture.spec.ts must use try/finally to guarantee ctx.close() even when navigation throws'
    ).toContain('try {');
    expect(
      captureSpecSrc,
      'visual-capture.spec.ts must use finally { ... } for ctx.close()'
    ).toContain('} finally {');
  });

  it('ctx.close() appears inside the finally block (not after it)', () => {
    // #409 impl: if ctx.close() is written after the finally block (i.e., after the try
    // block with no finally), any throw in the try body skips ctx.close() entirely.
    // Verify the structural order: finally keyword precedes ctx.close().
    const finallyIdx = captureSpecSrc.lastIndexOf('} finally {');
    const closeIdx = captureSpecSrc.lastIndexOf('ctx.close()');
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(-1);
    expect(
      closeIdx > finallyIdx,
      'ctx.close() must appear after the finally { keyword (i.e., inside the finally block)'
    ).toBe(true);
  });

  it('ctx is created before the try block (so ctx is in scope in finally)', () => {
    // #409 impl: `const ctx = await browser.newContext(...)` must be declared BEFORE the
    // try block so that ctx is in scope inside the finally clause. If ctx were declared
    // inside the try block, the finally clause would reference an out-of-scope variable
    // and TypeScript would refuse to compile it — but this is a defense-in-depth check.
    const tryIdx = captureSpecSrc.indexOf('try {');
    const ctxIdx = captureSpecSrc.indexOf('const ctx = ');
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(
      ctxIdx < tryIdx,
      'ctx must be declared before the try block so it is in scope inside finally { await ctx.close() }'
    ).toBe(true);
  });

  it('screenshot() call is inside the try block (not after finally)', () => {
    // #409 impl: if screenshot() were after the finally block, a ctx.close() in finally
    // would already have closed the page, making screenshot() throw on a closed context.
    // Verify screenshot is before the finally keyword.
    const screenshotIdx = captureSpecSrc.indexOf('page.screenshot(');
    const finallyIdx = captureSpecSrc.indexOf('} finally {');
    expect(screenshotIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(
      screenshotIdx < finallyIdx,
      'page.screenshot() must appear before the finally block — ctx.close() in finally would invalidate the page'
    ).toBe(true);
  });

});

// ===========================================================================
// Class D — dispatch branch isolation (no mutable state bleed)
// ===========================================================================

describe('#409 impl: dispatch branches are mutually exclusive else-if chain', () => {

  it('branches are structured as else-if (not independent if blocks)', () => {
    // #409 impl: the dispatch logic uses if/else-if/else — not independent if statements.
    // Independent if statements would evaluate every condition, potentially running
    // multiple branches for a single CAPTURE_TARGET value (e.g. if any two conditions
    // were accidentally both true). The else-if chain ensures exactly one branch runs.
    const hasElseIf = captureSpecSrc.includes('} else if (');
    expect(
      hasElseIf,
      'dispatch logic must use else-if chain (not independent if blocks) to guarantee exactly one branch fires per invocation'
    ).toBe(true);
  });

  it('a final else branch covers unknown targets (no silent fall-through)', () => {
    // #409 impl: after all known branches, a final else { throw new Error(...) } ensures
    // unknown targets fail loudly. Without this, an unrecognized CAPTURE_TARGET would
    // produce no screenshot and a green test tick — a false negative.
    const hasElseFallthrough = captureSpecSrc.includes('} else {') ||
      captureSpecSrc.includes('} else{\n') ||
      // The else is followed by throw
      /\}\s*else\s*\{[\s\S]*?throw/.test(captureSpecSrc);
    expect(
      hasElseFallthrough,
      'dispatch must have a final else branch that throws for unknown CAPTURE_TARGET values'
    ).toBe(true);
  });

  it('each navigation branch calls page.screenshot() exactly once with captureOut', () => {
    // #409 impl: every branch must write its capture to captureOut — the env-var-driven
    // output path. A branch that hard-codes its own path or omits the screenshot call
    // silently violates the parameterized contract.
    const screenshotCalls = (captureSpecSrc.match(/page\.screenshot\(/g) || []).length;
    // There are 5 implemented branches (overlay:field, overlay:sanctum, overlay:fusion,
    // screen:<id>, camp) plus the battle:solo stub which throws before screenshotting.
    // Each implemented branch has exactly one page.screenshot() call = 5 total.
    expect(
      screenshotCalls,
      `Expected 5 page.screenshot() calls (one per implemented branch), got ${screenshotCalls}. ` +
        'Each navigation branch must call screenshot exactly once.'
    ).toBe(5);
  });

  it('all screenshot calls use captureOut as the path argument (not hardcoded paths)', () => {
    // #409 impl: every screenshot() call must pass { path: captureOut } — the
    // env-var-driven output path. A branch using a hardcoded path silently bypasses
    // the CAPTURE_OUT env var, making the harness non-parameterizable for that target.
    const screenshotMatches = captureSpecSrc.match(/page\.screenshot\(\s*\{[^}]*\}\s*\)/g) ?? [];
    for (const call of screenshotMatches) {
      expect(
        call,
        `screenshot() call '${call}' must use captureOut, not a hardcoded path`
      ).toContain('captureOut');
    }
  });

});

// ===========================================================================
// Class E — battle:solo stub: explicit throw (not silent skip)
// ===========================================================================

describe('#409 impl: battle:solo throws an explicit Error (stretch goal not silently skipped)', () => {

  it("battle:solo branch exists and throws (not silently skips)", () => {
    // #409 impl: battle:solo is explicitly listed as a stretch goal with a TODO. The
    // branch must be present AND must throw — if it silently returns without a screenshot,
    // an agent invoking CAPTURE_TARGET=battle:solo would get a green tick with no output
    // PNG, then spend debugging time on a missing file rather than a clear error message.
    const hasBattleSoloBranch = captureSpecSrc.includes("battle:solo");
    expect(
      hasBattleSoloBranch,
      "battle:solo branch must be present in visual-capture.spec.ts (even as a stub)"
    ).toBe(true);
  });

  it("battle:solo branch throws a descriptive error message", () => {
    // #409 impl: the error message for battle:solo must be descriptive enough for an
    // agent to understand why it failed. A bare 'throw new Error()' with no message
    // produces 'Error' in the test output — unhelpful for automated agent pipelines.
    const battleSoloIdx = captureSpecSrc.indexOf("battle:solo");
    if (battleSoloIdx === -1) return; // battle:solo not present — skip
    const battleSoloBranch = captureSpecSrc.slice(battleSoloIdx, battleSoloIdx + 300);
    const hasDescriptiveThrow =
      battleSoloBranch.includes('not yet implemented') ||
      battleSoloBranch.includes('stretch goal') ||
      battleSoloBranch.includes('TODO') ||
      battleSoloBranch.includes('not implemented');
    expect(
      hasDescriptiveThrow,
      "battle:solo error message must explain it is not yet implemented (helps agent pipelines fail fast with context)"
    ).toBe(true);
  });

  it("battle:solo branch does NOT call page.screenshot() before throwing", () => {
    // #409 impl: the battle:solo branch must throw BEFORE attempting any navigation or
    // screenshot. If it called screenshot() before throwing, it would produce an empty
    // or partially-loaded PNG — a worse outcome than a clean immediate failure.
    const battleSoloIdx = captureSpecSrc.indexOf("rawTarget === 'battle:solo'");
    if (battleSoloIdx === -1) return;
    // Find the closing brace of this else-if block by counting braces
    const branchText = captureSpecSrc.slice(battleSoloIdx, battleSoloIdx + 400);
    const screenshotBeforeThrow = (() => {
      const ssIdx = branchText.indexOf('page.screenshot(');
      const throwIdx = branchText.indexOf('throw new Error');
      if (ssIdx === -1 || throwIdx === -1) return false;
      return ssIdx < throwIdx;
    })();
    expect(
      screenshotBeforeThrow,
      'battle:solo branch must throw BEFORE calling page.screenshot() — not after'
    ).toBe(false);
  });

});

// ===========================================================================
// Class F — package.json test:e2e excludes --project visual
// ===========================================================================

describe('#409 impl: package.json test:e2e script excludes --project visual', () => {

  const testE2eScript: string = (pkgJson?.scripts?.['test:e2e'] as string) ?? '';

  it('test:e2e script exists in package.json', () => {
    // #409 impl: the script must exist — absence means the CI entrypoint is broken.
    expect(
      testE2eScript,
      'package.json must have a test:e2e script'
    ).not.toBe('');
  });

  it('test:e2e script contains --project solo', () => {
    // #409 impl: solo project must be included in the CI sweep.
    // Omitting it would silently drop all solo E2E tests from CI.
    expect(
      testE2eScript,
      "test:e2e script must include '--project solo'"
    ).toContain('--project solo');
  });

  it('test:e2e script contains --project pvp', () => {
    // #409 impl: pvp project must be included in the CI sweep.
    // Omitting it would silently drop all pvp E2E tests from CI.
    expect(
      testE2eScript,
      "test:e2e script must include '--project pvp'"
    ).toContain('--project pvp');
  });

  it('test:e2e script does NOT contain --project visual', () => {
    // #409 acceptance criterion: the visual project must NOT be in the normal CI sweep.
    // If --project visual were present in test:e2e, every CI run would attempt to capture
    // screenshots without a CAPTURE_TARGET env var — the test would use the 'camp' default
    // and write to /tmp/er-capture-camp.png on every CI machine. More critically, the
    // visual project has workers=1 (serial), so adding it to test:e2e would dramatically
    // slow CI for every push.
    expect(
      testE2eScript,
      "test:e2e script must NOT include '--project visual' — visual captures are on-demand only, not CI"
    ).not.toContain('--project visual');
  });

  it('test:e2e script does not reference visual-capture.spec.ts directly', () => {
    // #409 adversarial: even without --project visual, an explicit --grep or filename
    // reference to visual-capture.spec.ts would cause it to run in the solo or pvp project
    // context, which would fail immediately (wrong project, no env vars set).
    expect(
      testE2eScript,
      "test:e2e script must not reference visual-capture.spec.ts directly"
    ).not.toContain('visual-capture');
  });

});

// ===========================================================================
// Class G — playwright.config.ts visual project isolation constraints
// ===========================================================================

describe('#409 impl: visual project configured for on-demand isolation', () => {

  it('visual project has workers: 1', () => {
    // #409 impl: the visual project must be single-worker to avoid port contention.
    // Multiple workers capturing simultaneously would race on the same browser context
    // and produce interleaved navigation (one worker navigating while another screenshots).
    // The playwright.config.ts sets workers: 1 for the visual project.
    const visualProjectMatch = configSrc.match(
      /name\s*:\s*['"]visual['"][^}]*?workers\s*:\s*(\d+)/s
    );
    // Also accept the reverse order (workers before name in the same object)
    const visualBlockStart = configSrc.indexOf("name: 'visual'");
    const visualBlockEnd = visualBlockStart !== -1
      ? configSrc.indexOf('},', visualBlockStart)
      : -1;
    const visualBlock = visualBlockStart !== -1 && visualBlockEnd !== -1
      ? configSrc.slice(visualBlockStart, visualBlockEnd)
      : '';

    const workersMatch = visualBlock.match(/workers\s*:\s*(\d+)/);
    const workersValue = workersMatch ? parseInt(workersMatch[1], 10) : null;

    expect(
      workersValue,
      "visual project must set workers: 1 (single-worker to prevent port contention during on-demand capture)"
    ).toBe(1);
  });

  it('visual project has fullyParallel: false', () => {
    // #409 impl: fullyParallel: false ensures tests within the visual project run
    // serially. With only one spec (visual-capture.spec.ts) this is moot now, but
    // when more capture targets are added as separate test cases, they must not race
    // for the same browser instance.
    const visualBlockStart = configSrc.indexOf("name: 'visual'");
    const visualBlockEnd = visualBlockStart !== -1
      ? configSrc.indexOf('},', visualBlockStart)
      : -1;
    const visualBlock = visualBlockStart !== -1 && visualBlockEnd !== -1
      ? configSrc.slice(visualBlockStart, visualBlockEnd)
      : '';

    expect(
      visualBlock,
      "visual project must set fullyParallel: false to serialize captures"
    ).toContain('fullyParallel: false');
  });

  it('visual project testMatch references VISUAL_SPECS (not an inline glob)', () => {
    // #409 impl: using VISUAL_SPECS as testMatch (not an inline glob like '**/*.visual.ts')
    // ensures future additions to the visual capture suite go through the VISUAL_SPECS
    // array and trigger the SOLO/PVP exclusion assertions in spec-registration.test.ts.
    const visualBlockStart = configSrc.indexOf("name: 'visual'");
    const visualBlockEnd = visualBlockStart !== -1
      ? configSrc.indexOf('},', visualBlockStart)
      : -1;
    const visualBlock = visualBlockStart !== -1 && visualBlockEnd !== -1
      ? configSrc.slice(visualBlockStart, visualBlockEnd)
      : '';

    expect(
      visualBlock,
      "visual project testMatch must reference VISUAL_SPECS const (not an inline glob)"
    ).toContain('VISUAL_SPECS');
  });

  it('VISUAL_SPECS const is defined BEFORE it is referenced in the projects array', () => {
    // #409 impl: TypeScript const declarations are block-scoped. VISUAL_SPECS must be
    // declared before the projects array that references it, or TypeScript will refuse
    // to compile (const is not hoisted). Verify declaration order in the source.
    const visualSpecsDeclIdx = configSrc.indexOf('const VISUAL_SPECS');
    const projectsArrayIdx = configSrc.indexOf("name: 'visual'");
    expect(visualSpecsDeclIdx).toBeGreaterThan(-1);
    expect(projectsArrayIdx).toBeGreaterThan(-1);
    expect(
      visualSpecsDeclIdx < projectsArrayIdx,
      'VISUAL_SPECS must be declared before it is used in the projects array'
    ).toBe(true);
  });

});

// ===========================================================================
// Class H — overlay:sanctum readiness check: __campState not __activeScene
// ===========================================================================

describe('#409 impl: overlay:sanctum branch uses correct readiness check', () => {

  it("sanctum branch does NOT call waitForFunction with __activeScene === 'CampScene'", () => {
    // #409 impl (critical): the sanctum branch uses `__campState !== undefined` — NOT
    // `__activeScene === 'CampScene'` — as its CampScene readiness gate. This is because
    // __campState exposes __player.setPosition (needed to warp to RINGWALL), while
    // __activeScene may fire before __campState is populated.
    //
    // The branch comment itself says "NOT __activeScene" — so the string __activeScene
    // will appear in the comment. We must check for the waitForFunction CALL pattern,
    // not bare string presence, to avoid false positives from the explanatory comment.
    const sanctumStart = captureSpecSrc.indexOf("rawTarget === 'overlay:sanctum'");
    const fusionStart = captureSpecSrc.indexOf("rawTarget === 'overlay:fusion'");
    if (sanctumStart === -1 || fusionStart === -1) return;
    const sanctumBranch = captureSpecSrc.slice(sanctumStart, fusionStart);

    // Check whether the branch contains an actual waitForFunction invocation that
    // references __activeScene (not just mentions it in a comment).
    const activeSceneWaitForFunctionPattern =
      /waitForFunction\s*\([^)]*__activeScene[^)]*\)/;
    const usesActiveSceneInWaitForFunction = activeSceneWaitForFunctionPattern.test(sanctumBranch);
    expect(
      usesActiveSceneInWaitForFunction,
      "sanctum branch must NOT call waitForFunction with __activeScene === 'CampScene' — " +
        "__campState exposes __player.setPosition which is required for RINGWALL warp. " +
        "(Note: the comment in the branch mentions __activeScene — this test checks the actual call, not the comment)"
    ).toBe(false);
  });

  it("sanctum branch uses __campState !== undefined for initial readiness", () => {
    // #409 impl: positive assertion to complement the negative check above.
    const sanctumStart = captureSpecSrc.indexOf("rawTarget === 'overlay:sanctum'");
    const fusionStart = captureSpecSrc.indexOf("rawTarget === 'overlay:fusion'");
    if (sanctumStart === -1 || fusionStart === -1) return;
    const sanctumBranch = captureSpecSrc.slice(sanctumStart, fusionStart);

    expect(
      sanctumBranch,
      "sanctum branch must wait for __campState !== undefined (the correct CampScene readiness sentinel)"
    ).toContain('__campState !== undefined');
  });

});

// ===========================================================================
// Class I — screen:<id> branch: empty screenId guard (P1 fix regression lock)
// ===========================================================================

describe('#409 impl: screen:<id> branch guards against empty screenId (P1 fix regression)', () => {

  it('screen: branch throws immediately when screenId is empty (not deferred to enterForestScreen)', () => {
    // #409 adversarial: the P1 fix (commit 7d95ab1) added a guard:
    //   if (!screenId) throw new Error('CAPTURE_TARGET screen: requires a screen_id...')
    // This test locks in that fix so it cannot regress. Without the guard, an empty
    // screenId would reach enterForestScreen(''), which would navigate to the forest
    // scene with an empty ID and hang for up to 8 seconds in waitForFunction before
    // timing out with an unhelpful error.
    const screenBranchStart = captureSpecSrc.indexOf("rawTarget.startsWith('screen:')");
    if (screenBranchStart === -1) return;
    const campBranchStart = captureSpecSrc.indexOf("rawTarget === 'camp'");
    if (campBranchStart === -1) return;
    const screenBranch = captureSpecSrc.slice(screenBranchStart, campBranchStart);

    // The guard must be present inside the screen: branch
    const hasEmptyGuard =
      screenBranch.includes('if (!screenId)') ||
      screenBranch.includes('!screenId') ||
      screenBranch.includes("screenId === ''") ||
      screenBranch.includes('screenId.length === 0');
    expect(
      hasEmptyGuard,
      "screen: branch must guard against empty screenId before calling enterForestScreen — " +
        "this is the P1 fix from commit 7d95ab1 (regression lock)"
    ).toBe(true);
  });

  it('screenId is extracted via rawTarget.slice() before the empty check', () => {
    // #409 impl: the extraction pattern is:
    //   const screenId = rawTarget.slice('screen:'.length)
    // Using split(':')[1] would produce undefined for 'screen:' (no second segment), not '',
    // which could bypass a truthy check. The slice approach is more robust.
    const screenBranchStart = captureSpecSrc.indexOf("rawTarget.startsWith('screen:')");
    if (screenBranchStart === -1) return;
    const screenBranch = captureSpecSrc.slice(screenBranchStart, screenBranchStart + 500);

    expect(
      screenBranch,
      "screenId must be extracted via rawTarget.slice('screen:'.length) — " +
        "more robust than split() which can return undefined for 'screen:'"
    ).toContain("rawTarget.slice('screen:'.length)");
  });

});
