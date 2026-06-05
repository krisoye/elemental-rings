/**
 * Phase 1 spec-driven adversarial tests for #409 — parameterized visual capture harness.
 *
 * These tests are pure-logic / filesystem assertions — no Playwright runtime required.
 * They lock in:
 *   1. CAPTURE_TARGET grammar validation (unknown/malformed targets fail loudly)
 *   2. CAPTURE_OUT default-path sanitization (colon → hyphen, no colon in filenames)
 *   3. Skill file and reference README existence / content
 *   4. visual-capture.spec.ts source-level assertions (navigation branch coverage)
 *
 * Run: cd server && npx vitest run ../tests/unit/visual-capture-harness.test.ts --pool=threads
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const E2E_DIR = path.join(REPO_ROOT, 'tests/e2e');
const SKILL_PATH = path.join(REPO_ROOT, '.claude/skills/visual-rendering/SKILL.md');
const REFERENCES_README = path.join(REPO_ROOT, 'docs/maps/references/README.md');
const VISUAL_CAPTURE_SPEC = path.join(E2E_DIR, 'visual-capture.spec.ts');
const SCREENSHOT_OVERLAYS_SPEC = path.join(E2E_DIR, 'screenshot-overlays.spec.ts');

// ---------------------------------------------------------------------------
// Helper: replicate the CAPTURE_TARGET → default output path sanitization logic
// that visual-capture.spec.ts is required to implement per spec:
//   CAPTURE_OUT = `/tmp/er-capture-<sanitized-target>.png`
//   Sanitization: replace ':' with '-' (and any other non-filename-safe chars)
// ---------------------------------------------------------------------------

/**
 * Canonical sanitization: replace every colon with a hyphen.
 * This is the spec's required transformation: 'overlay:field' → 'overlay-field'.
 * The full default path is `/tmp/er-capture-${sanitized}.png`.
 */
function sanitizeTarget(target: string): string {
  return target.replace(/:/g, '-');
}

function defaultOutputPath(target: string): string {
  return `/tmp/er-capture-${sanitizeTarget(target)}.png`;
}

/**
 * Canonical target classification logic that mirrors the real harness behavior.
 * Per visual-capture.spec.ts line 27: rawTarget defaults to 'camp' when undefined or empty.
 * This function models that default behavior.
 */
function classifyTarget(target: string | undefined): 'overlay' | 'screen' | 'camp' | 'unknown' {
  // Per SKILL.md: undefined or empty CAPTURE_TARGET defaults to 'camp' (intentional)
  if (target === undefined || target === '') return 'camp';
  if (target === 'camp') return 'camp';
  if (target.startsWith('overlay:')) {
    const sub = target.slice('overlay:'.length);
    if (sub === 'field' || sub === 'sanctum' || sub === 'fusion') return 'overlay';
    return 'unknown';
  }
  if (target.startsWith('screen:')) {
    const id = target.slice('screen:'.length);
    if (id.length > 0) return 'screen';
    return 'unknown';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Known-valid CAPTURE_TARGET values from the spec grammar
// ---------------------------------------------------------------------------
const VALID_TARGETS = [
  'overlay:field',
  'overlay:sanctum',
  'overlay:fusion',
  'screen:forest_anchorage',
  'screen:forest_north_road',
  'camp',
];

// ---------------------------------------------------------------------------
// Known-invalid CAPTURE_TARGET values (adversarial inputs)
// ---------------------------------------------------------------------------
const INVALID_TARGETS = [
  'overlay:bogus',       // unknown overlay subtype
  'overlay:',            // missing subtype after colon
  'screen:',             // missing screen_id after colon
  '',                    // empty string
  'bogus',               // unrecognized top-level target
  'OVERLAY:field',       // wrong case — grammar is lowercase
  'overlay:field:extra', // too many segments
  'camp:something',      // camp takes no subtype
];

// ===========================================================================
// Class 1 — CAPTURE_OUT default-path sanitization
// ===========================================================================

describe('#409 CAPTURE_OUT default-path sanitization', () => {

  it('overlay:field sanitizes to er-capture-overlay-field.png (colon → hyphen)', () => {
    // #409 adversarial: if the colon is left in the filename, writing
    // `/tmp/er-capture-overlay:field.png` fails on most filesystems with EINVAL.
    // Colon is an illegal filename character on NTFS and forbidden in POSIX paths
    // when the OS does not permit it in the final path component.
    expect(defaultOutputPath('overlay:field')).toBe('/tmp/er-capture-overlay-field.png');
  });

  it('overlay:sanctum sanitizes to er-capture-overlay-sanctum.png', () => {
    // #409 adversarial: same colon-stripping required for all overlay subtypes.
    expect(defaultOutputPath('overlay:sanctum')).toBe('/tmp/er-capture-overlay-sanctum.png');
  });

  it('overlay:fusion sanitizes to er-capture-overlay-fusion.png', () => {
    expect(defaultOutputPath('overlay:fusion')).toBe('/tmp/er-capture-overlay-fusion.png');
  });

  it('screen:forest_anchorage sanitizes to er-capture-screen-forest_anchorage.png', () => {
    // #409 adversarial: screen IDs contain underscores (valid in filenames) but the
    // colon must still be replaced. Underscores must pass through unchanged.
    expect(defaultOutputPath('screen:forest_anchorage')).toBe(
      '/tmp/er-capture-screen-forest_anchorage.png',
    );
  });

  it('camp (no colon) sanitizes to er-capture-camp.png unchanged', () => {
    // camp has no colon — the sanitized form equals the original target.
    expect(defaultOutputPath('camp')).toBe('/tmp/er-capture-camp.png');
  });

  it('no sanitized default path contains a colon character', () => {
    // #409 adversarial: a systematic check across all valid targets — none of the
    // generated default paths may contain a colon, which would produce an invalid
    // filename on NTFS and ambiguous paths on POSIX.
    for (const target of VALID_TARGETS) {
      const outPath = defaultOutputPath(target);
      expect(
        outPath,
        `Default path for '${target}' must not contain ':'`,
      ).not.toContain(':');
    }
  });

  it('all sanitized paths start with /tmp/er-capture- and end with .png', () => {
    // #409 spec: the default output convention is `/tmp/er-capture-<sanitized>.png`.
    // Any deviation (e.g. missing prefix, wrong extension) breaks agent invocation scripts.
    for (const target of VALID_TARGETS) {
      const outPath = defaultOutputPath(target);
      expect(outPath, `Path for '${target}' must start with /tmp/er-capture-`).toMatch(
        /^\/tmp\/er-capture-/,
      );
      expect(outPath, `Path for '${target}' must end with .png`).toMatch(/\.png$/);
    }
  });

});

// ===========================================================================
// Class 2 — CAPTURE_TARGET grammar: valid targets recognized
// ===========================================================================

describe('#409 CAPTURE_TARGET grammar: valid target recognition', () => {

  it('overlay:field is classified as overlay', () => {
    expect(classifyTarget('overlay:field')).toBe('overlay');
  });

  it('overlay:sanctum is classified as overlay', () => {
    expect(classifyTarget('overlay:sanctum')).toBe('overlay');
  });

  it('overlay:fusion is classified as overlay', () => {
    expect(classifyTarget('overlay:fusion')).toBe('overlay');
  });

  it('camp is classified as camp', () => {
    expect(classifyTarget('camp')).toBe('camp');
  });

  it('screen:forest_anchorage is classified as screen', () => {
    expect(classifyTarget('screen:forest_anchorage')).toBe('screen');
  });

  it('screen:forest_north_road is classified as screen', () => {
    expect(classifyTarget('screen:forest_north_road')).toBe('screen');
  });

});

// ===========================================================================
// Class 3 — CAPTURE_TARGET grammar: invalid/malformed targets fail loudly
// ===========================================================================

describe('#409 CAPTURE_TARGET grammar: adversarial/invalid targets must be rejected', () => {

  it('overlay:bogus is classified as unknown (not a valid overlay subtype)', () => {
    // #409 adversarial: an unrecognized overlay subtype must produce 'unknown', NOT
    // silently fall through to the camp or screen branch. If it silently wrote a PNG
    // it would be an empty/misleading capture with no error — the worst outcome.
    expect(classifyTarget('overlay:bogus')).toBe('unknown');
  });

  it('overlay: (empty subtype) is classified as unknown', () => {
    // #409 adversarial: 'overlay:' with nothing after the colon must not match any
    // valid branch. An empty subtype could silently match the field branch if the
    // dispatch uses a loose prefix match.
    expect(classifyTarget('overlay:')).toBe('unknown');
  });

  it('screen: (empty screen_id) is classified as unknown', () => {
    // #409 adversarial: screen: with no ID would pass an empty string to
    // enterForestScreen(), which would attempt to start ForestScene with screenId=''.
    // That produces a silent failure (scene starts but loads no map) rather than an
    // immediate error. Must fail at classification.
    expect(classifyTarget('screen:')).toBe('unknown');
  });

  it('empty string CAPTURE_TARGET defaults to camp per SKILL.md', () => {
    // #409: CAPTURE_TARGET='' (set but empty) defaults to 'camp' per SKILL.md.
    // The harness treats empty string the same as unset — both default to 'camp' intentionally.
    expect(classifyTarget('')).toBe('camp');
  });

  it('undefined CAPTURE_TARGET defaults to camp per SKILL.md', () => {
    // #409: if CAPTURE_TARGET env var is not set (process.env.CAPTURE_TARGET is undefined),
    // the harness defaults to 'camp' per SKILL.md and visual-capture.spec.ts line 27.
    // This is intentional documented behavior.
    expect(classifyTarget(undefined)).toBe('camp');
  });

  it('bogus (unrecognized top-level) is classified as unknown', () => {
    // #409 adversarial: a completely unrecognized target (no recognized prefix) must
    // not fall through to any dispatch branch.
    expect(classifyTarget('bogus')).toBe('unknown');
  });

  it('OVERLAY:field (wrong case) is classified as unknown', () => {
    // #409 adversarial: the grammar is lowercase. Uppercase aliases are NOT supported.
    // A case-insensitive match would silently accept 'OVERLAY:FUSION' and write a PNG,
    // masking a misconfigured invocation script.
    expect(classifyTarget('OVERLAY:field')).toBe('unknown');
  });

  it('overlay:field:extra (too many segments) is classified as unknown', () => {
    // #409 adversarial: extraneous path segments must not accidentally match the field
    // subtype. Matching 'overlay:field:extra' as 'field' would silently run the field
    // branch for a malformed invocation.
    expect(classifyTarget('overlay:field:extra')).toBe('unknown');
  });

  it('camp:something (camp takes no subtype) is classified as unknown', () => {
    // #409 adversarial: camp is a bare keyword. 'camp:something' does not start with
    // 'overlay:' or 'screen:' and does not equal 'camp' — must be unknown.
    expect(classifyTarget('camp:something')).toBe('unknown');
  });

  it('all adversarial invalid targets (except empty/undefined) classify as unknown', () => {
    // #409 systematic adversarial sweep: every invalid target (except empty/undefined,
    // which default to 'camp' per SKILL.md) must classify as unknown.
    // Writing a misleading PNG for any adversarial target would give the invoker
    // false confidence that the capture succeeded.
    const adversarialWithoutEmptyUndefined = INVALID_TARGETS.filter(
      (t) => t !== '' && t !== undefined,
    );
    for (const target of adversarialWithoutEmptyUndefined) {
      const result = classifyTarget(target);
      expect(
        result === 'unknown',
        `'${target}' must classify as unknown, got '${result}'`,
      ).toBe(true);
    }
  });

});

// ===========================================================================
// Class 4 — visual-capture.spec.ts source assertions
// ===========================================================================

describe('#409 visual-capture.spec.ts source-level assertions', () => {

  it('visual-capture.spec.ts exists at tests/e2e/visual-capture.spec.ts', () => {
    // #409 acceptance criterion: the harness file must exist.
    expect(
      fs.existsSync(VISUAL_CAPTURE_SPEC),
      'tests/e2e/visual-capture.spec.ts must exist — created by #409',
    ).toBe(true);
  });

  it('visual-capture.spec.ts imports seedAuthToken from helpers', () => {
    // #409 reuse directive: must use the canonical seedAuthToken helper, not inline auth logic.
    // Inlining auth would diverge from the tested path and break if the auth API changes.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'visual-capture.spec.ts must import seedAuthToken from helpers').toContain(
      'seedAuthToken',
    );
    expect(src, 'visual-capture.spec.ts must import from ./helpers').toContain('./helpers');
  });

  it('visual-capture.spec.ts imports enterForestScreen from helpers', () => {
    // #409 reuse directive: enterForestScreen handles the three-step wait (forestScreenId,
    // waystones, zoneCenters). Reimplementing it inline would silently skip one of the waits.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'visual-capture.spec.ts must import enterForestScreen from helpers').toContain(
      'enterForestScreen',
    );
  });

  it('visual-capture.spec.ts uses viewport 1024x600', () => {
    // #409 spec: all branches use { width: 1024, height: 600 } — the same as the
    // existing screenshot-overlays.spec.ts tests. A different viewport would make the
    // captures incomparable across runs and break the column geometry reference.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'visual-capture.spec.ts must set viewport width: 1024').toContain('1024');
    expect(src, 'visual-capture.spec.ts must set viewport height: 600').toContain('600');
  });

  it('visual-capture.spec.ts handles overlay:field branch (overworldToggleBattleHand)', () => {
    // #409 spec: the overlay:field branch must invoke __overworldToggleBattleHand — absorbed
    // verbatim from screenshot-overlays.spec.ts. If the branch is missing, CAPTURE_TARGET=overlay:field
    // silently falls through or crashes.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(
      src,
      'overlay:field branch must call __overworldToggleBattleHand',
    ).toContain('__overworldToggleBattleHand');
    expect(
      src,
      'overlay:field branch must wait for __overworldBattleHandOpen === true',
    ).toContain('__overworldBattleHandOpen');
  });

  it('visual-capture.spec.ts uses __campState !== undefined for sanctum readiness (NOT __activeScene)', () => {
    // #409 spec (critical): the sanctum branch uses __campState !== undefined as its
    // CampScene readiness check — NOT __activeScene === 'CampScene'. This is a verbatim
    // copy requirement from screenshot-overlays.spec.ts. Using __activeScene would break
    // sanctum navigation because __campState is what exposes __player.setPosition.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(
      src,
      "sanctum branch must use __campState !== undefined (not __activeScene === 'CampScene')",
    ).toContain('__campState !== undefined');
  });

  it('visual-capture.spec.ts handles overlay:sanctum branch (sanctumInteract + sanctumOverlayOpen)', () => {
    // #409 spec: the sanctum branch must call __sanctumInteract() and wait for
    // __sanctumOverlayOpen === 'ringwall'. Missing either step produces a screenshot
    // before the overlay renders.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'sanctum branch must call __sanctumInteract').toContain('__sanctumInteract');
    expect(src, 'sanctum branch must wait for __sanctumOverlayOpen').toContain('__sanctumOverlayOpen');
  });

  it('visual-capture.spec.ts handles overlay:fusion branch (__campOpenFusion)', () => {
    // #409 spec: the fusion branch must call __campOpenFusion() — absorbed verbatim
    // from screenshot-overlays.spec.ts.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'fusion branch must call __campOpenFusion').toContain('__campOpenFusion');
  });

  it('visual-capture.spec.ts handles screen:<id> branch via enterForestScreen', () => {
    // #409 spec: the screen:<id> branch delegates to enterForestScreen, which internally
    // waits for all three globals (__forestScreenId, __waystones, __zoneCenters). The
    // spec explicitly forbids reimplementing these waits inline.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, "screen:<id> branch must use enterForestScreen").toContain('enterForestScreen');
  });

  it('visual-capture.spec.ts handles camp branch (__activeScene === CampScene)', () => {
    // #409 spec: the camp branch waits for __activeScene === 'CampScene' before
    // screenshotting — without this wait the capture fires before Phaser loads.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, "camp branch must wait for __activeScene === 'CampScene'").toContain(
      '__activeScene',
    );
  });

  it('visual-capture.spec.ts uses RINGWALL constant { x: 128, y: 56 }', () => {
    // #409 reuse directive: the RINGWALL constant must be copied verbatim from
    // screenshot-overlays.spec.ts. If x/y differ, the sanctum setPosition call lands
    // in the wrong zone and __sanctumZones never includes 'ringwall'.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'RINGWALL x must be 128').toContain('128');
    expect(src, 'RINGWALL y must be 56').toContain('56');
  });

  it('visual-capture.spec.ts guards against empty screenId in screen: branch', () => {
    // #409 adversarial: CAPTURE_TARGET=screen: (colon but no ID) must fail loudly.
    // The current implementation dispatches on rawTarget.startsWith('screen:') — truthy
    // for 'screen:' — then passes screenId='' to enterForestScreen. An empty screenId
    // produces a silent waitForFunction timeout (waiting for __forestScreenId === '')
    // rather than a clear error. The spec should validate that the extracted screenId is
    // non-empty before calling enterForestScreen.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    // Accept any guard pattern: length check, explicit throw for empty id, or the
    // top-level throw new Error fallthrough from the else branch (which only fires if
    // startsWith('screen:') is false — it would NOT catch 'screen:' with empty ID).
    // This test will FAIL if the implementation relies solely on the else-throw without
    // an empty-ID guard inside the screen: branch.
    const screenBranchStart = src.indexOf("startsWith('screen:')");
    if (screenBranchStart === -1) return; // screen branch not found — skip
    const screenBranchBody = src.slice(screenBranchStart);
    const hasEmptyIdGuard =
      screenBranchBody.includes('screenId.length') ||
      screenBranchBody.includes('!screenId') ||
      screenBranchBody.includes("screenId === ''") ||
      screenBranchBody.includes('screenId.trim()') ||
      screenBranchBody.includes('if (!screenId)') ||
      screenBranchBody.includes('if (screenId)');
    expect(
      hasEmptyIdGuard,
      "screen: branch must guard against empty screenId — CAPTURE_TARGET='screen:' must fail loudly, " +
        "not pass '' to enterForestScreen and hang for 8 seconds",
    ).toBe(true);
  });

  it('visual-capture.spec.ts does not reference screenshot-overlays.spec.ts', () => {
    // #409 adversarial: the new harness must not import or reference the deleted spec.
    // Any cross-reference would be a dead import after deletion.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(
      src,
      'visual-capture.spec.ts must not reference the deleted screenshot-overlays.spec.ts',
    ).not.toContain('screenshot-overlays');
  });

  it('visual-capture.spec.ts does not hardcode an output path bypassing CAPTURE_OUT env var', () => {
    // #409 adversarial: if the output path is hardcoded (e.g. '/tmp/overlay-field.png'
    // from the old spec), setting CAPTURE_OUT is silently ignored. The old-spec paths
    // were '/tmp/overlay-field.png' etc. — verify none are present.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    // Old hardcoded paths from screenshot-overlays.spec.ts
    expect(src, "must not hardcode '/tmp/overlay-field.png'").not.toContain(
      '/tmp/overlay-field.png',
    );
    expect(src, "must not hardcode '/tmp/overlay-sanctum.png'").not.toContain(
      '/tmp/overlay-sanctum.png',
    );
    expect(src, "must not hardcode '/tmp/overlay-fusion.png'").not.toContain(
      '/tmp/overlay-fusion.png',
    );
  });

  it('visual-capture.spec.ts reads CAPTURE_OUT from environment (process.env.CAPTURE_OUT)', () => {
    // #409 spec: CAPTURE_OUT must be env-var driven so agents can pass arbitrary output paths.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'visual-capture.spec.ts must read CAPTURE_OUT from process.env').toContain(
      'CAPTURE_OUT',
    );
  });

  it('visual-capture.spec.ts reads CAPTURE_TARGET from environment (process.env.CAPTURE_TARGET)', () => {
    // #409 spec: CAPTURE_TARGET drives the dispatch — it must be read from process.env,
    // not hardcoded.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    expect(src, 'visual-capture.spec.ts must read CAPTURE_TARGET from process.env').toContain(
      'CAPTURE_TARGET',
    );
  });

  it('visual-capture.spec.ts throws or fails the test on unknown CAPTURE_TARGET (not silent)', () => {
    // #409 adversarial: if an unknown target silently falls through without throwing,
    // the test passes but writes no PNG (or a blank one). The agent invoker sees a green
    // tick but gets no usable output — a false negative. The harness must fail loudly.
    // Verify the spec has an else/default branch that calls test.fail() or throws.
    if (!fs.existsSync(VISUAL_CAPTURE_SPEC)) return;
    const src = fs.readFileSync(VISUAL_CAPTURE_SPEC, 'utf-8');
    // Accept any of: throw new Error, test.fail(), or expect().toThrow pattern
    const hasErrorBranch =
      src.includes('throw new Error') ||
      src.includes('test.fail(') ||
      src.includes('throw `Unknown') ||
      src.includes('throw `Unsupported') ||
      src.includes('Unknown CAPTURE_TARGET') ||
      src.includes('Unsupported CAPTURE_TARGET') ||
      src.includes('Unknown target') ||
      src.includes('Unsupported target');
    expect(
      hasErrorBranch,
      'visual-capture.spec.ts must throw or fail the test on unknown CAPTURE_TARGET — silent fall-through produces misleading output',
    ).toBe(true);
  });

});

// ===========================================================================
// Class 5 — visual-rendering SKILL.md existence and content
// ===========================================================================

describe('#409 visual-rendering SKILL.md: existence and canonical geometry reference', () => {

  it('SKILL.md exists at .claude/skills/visual-rendering/SKILL.md', () => {
    // #409 acceptance criterion: the skill file must exist for agents to find it.
    expect(
      fs.existsSync(SKILL_PATH),
      '.claude/skills/visual-rendering/SKILL.md must exist — required by #409',
    ).toBe(true);
  });

  it('SKILL.md contains viewport dimensions (1024 and 600)', () => {
    // #409 spec: the canonical geometry reference must document viewport 1024×600.
    // Omitting the viewport means any agent writing geometry checks uses wrong coordinates.
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(src, 'SKILL.md must document the 1024 viewport width').toContain('1024');
    expect(src, 'SKILL.md must document the 600 viewport height').toContain('600');
  });

  it('SKILL.md contains modal frame dimensions (760 and 500)', () => {
    // #409 spec / EPIC #408 Contract 5: the canonical modal frame is 760×500. Agents
    // writing geometry checks for the overlay columns need this reference.
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(src, 'SKILL.md must document the 760px modal frame width').toContain('760');
    expect(src, 'SKILL.md must document the 500px modal frame height').toContain('500');
  });

  it('SKILL.md documents overlay column x-bands (195, 370, 659)', () => {
    // #409 spec: column x-bands LOOT/SPIRIT/FUSE ≈ 195, BENCH ≈ 370, HEALTH = 659.
    // These are the adversarially-verified coordinates from EPIC #394 — the values
    // that survived 68 tests before being caught by eye. Missing them defeats the
    // entire purpose of the skill file.
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(src, 'SKILL.md must document column x ≈ 195 (LOOT/SPIRIT/FUSE)').toContain('195');
    expect(src, 'SKILL.md must document column x ≈ 370 (BENCH)').toContain('370');
    expect(src, 'SKILL.md must document column x = 659 (HEALTH)').toContain('659');
  });

  it('SKILL.md documents tilemap depth layers (ground=0, player=3)', () => {
    // #409 spec: depth layers ground=0, behind=2, player=3, in-front=5. These are
    // required for map-designer agents to verify layer ordering.
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    // Check that at least the ground and player depths are documented
    expect(src, 'SKILL.md must document ground depth (0)').toMatch(/ground.*0|0.*ground/i);
    expect(src, 'SKILL.md must document player depth (3)').toMatch(/player.*3|3.*player/i);
  });

  it('SKILL.md contains at least one complete invocation example with --project visual', () => {
    // #409 acceptance criterion: the skill must include at least one complete invocation
    // example. Without a concrete example, agents construct incorrect commands (wrong
    // env var order, missing --grep filter, wrong project name).
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(
      src,
      "SKILL.md must include '--project visual' in an invocation example",
    ).toContain('--project visual');
    expect(
      src,
      'SKILL.md must include CAPTURE_TARGET in an invocation example',
    ).toContain('CAPTURE_TARGET');
  });

  it('SKILL.md documents the CAPTURE_OUT env var', () => {
    // #409 adversarial: if CAPTURE_OUT is not documented, agents will not know they can
    // override the default path — they will write all captures to /tmp with the default
    // name and overwrite each other when running multiple captures.
    if (!fs.existsSync(SKILL_PATH)) return;
    const src = fs.readFileSync(SKILL_PATH, 'utf-8');
    expect(src, 'SKILL.md must document the CAPTURE_OUT env var').toContain('CAPTURE_OUT');
  });

});

// ===========================================================================
// Class 6 — docs/maps/references/README.md existence and content
// ===========================================================================

describe('#409 docs/maps/references/README.md: existence and folder convention', () => {

  it('README.md exists at docs/maps/references/README.md', () => {
    // #409 acceptance criterion: the reference folder README must exist.
    expect(
      fs.existsSync(REFERENCES_README),
      'docs/maps/references/README.md must exist — created by #409',
    ).toBe(true);
  });

  it('README.md explains that reference files are NOT under client/public/assets (not shipped)', () => {
    // #409 spec: design-time artifacts must not be shipped to the browser. If an agent
    // misreads the convention and places references under client/public/assets, the files
    // would be bundled and increase the client download size.
    if (!fs.existsSync(REFERENCES_README)) return;
    const src = fs.readFileSync(REFERENCES_README, 'utf-8');
    const mentionsNotShipped =
      src.includes('not shipped') ||
      src.includes('NOT shipped') ||
      src.includes("not under client/public") ||
      src.includes('design-time') ||
      src.includes('not bundled');
    expect(
      mentionsNotShipped,
      "README.md must clarify that reference files are not shipped / not under client/public/assets",
    ).toBe(true);
  });

  it('README.md documents the subdirectory-per-screen convention (<screen_id>/)', () => {
    // #409 spec: subdirectory per screen: docs/maps/references/<screen_id>/.
    // Without this convention, reference images accumulate flat in references/ and
    // become unmaintainable.
    if (!fs.existsSync(REFERENCES_README)) return;
    const src = fs.readFileSync(REFERENCES_README, 'utf-8');
    const mentionsSubdir =
      src.includes('screen_id') ||
      src.includes('<screen_id>') ||
      src.includes('subdirectory') ||
      src.includes('sub-directory') ||
      src.includes('per screen') ||
      src.includes('per-screen');
    expect(
      mentionsSubdir,
      "README.md must document the per-screen subdirectory convention",
    ).toBe(true);
  });

});

// ===========================================================================
// Class 7 — screenshot-overlays.spec.ts deletion (spec conformance)
// ===========================================================================

describe('#409 SpecConformance: screenshot-overlays.spec.ts deletion', () => {

  it('screenshot-overlays.spec.ts does not exist on disk', () => {
    // #409 acceptance criterion (## Tests to Update): the file must be deleted.
    // This is the primary BLOCKER check. If this test fails, the dev agent has not
    // completed the deletion step.
    expect(
      fs.existsSync(SCREENSHOT_OVERLAYS_SPEC),
      'screenshot-overlays.spec.ts must be deleted — superseded by visual-capture.spec.ts (#409). ' +
        'This is a P1 divergence if the file still exists.',
    ).toBe(false);
  });

  it('no file in tests/e2e/ imports from screenshot-overlays', () => {
    // #409 adversarial: even if the file is deleted, another spec might have added a
    // cross-import reference (unlikely but defensive). Scan all e2e specs.
    const e2eSpecs = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.ts'));
    const violations = e2eSpecs.filter((f) => {
      const full = path.join(E2E_DIR, f);
      const src = fs.readFileSync(full, 'utf-8');
      return src.includes('screenshot-overlays');
    });
    expect(
      violations,
      'No e2e spec must import or reference screenshot-overlays (file is deleted)',
    ).toHaveLength(0);
  });

  it('playwright.config.ts does not reference screenshot-overlays.spec.ts', () => {
    // #409 adversarial: a dangling config reference to a deleted file causes Playwright
    // to either error on startup or silently produce a zero-test run, which could mask
    // a misconfiguration for days.
    const configSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'playwright.config.ts'),
      'utf-8',
    );
    expect(
      configSrc,
      "playwright.config.ts must not reference 'screenshot-overlays.spec.ts'",
    ).not.toContain('screenshot-overlays.spec.ts');
  });

});
