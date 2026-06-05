import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Spec Registration Guard Test (#374, extended for #409)
 *
 * Ensures every *.spec.ts file in tests/e2e/ is registered in playwright.config.ts
 * in exactly one of SOLO_SPECS, PVP_SPECS, or VISUAL_SPECS, and that no file is
 * double-registered. Also asserts #409 harness-level invariants: screenshot-overlays.spec.ts
 * deleted, visual-capture.spec.ts in VISUAL_SPECS only, visual project isolation.
 */

// Read playwright.config.ts as text to extract the arrays via regex (do NOT import it).
const configPath = path.resolve(__dirname, '../../playwright.config.ts');
const configText = readFileSync(configPath, 'utf-8');

/**
 * Extract spec filenames from a const array block in the config file.
 * Looks for patterns like 'filename.spec.ts' or "filename.spec.ts" within a block.
 * Returns the array of bare filenames (e.g., ['auth.spec.ts', 'camp.spec.ts']).
 */
function extractSpecsFromBlock(blockText: string): string[] {
  const specs: string[] = [];
  // Match both 'filename.spec.ts' and "filename.spec.ts" literals.
  const regex = /['"]([^'"]+\.spec\.ts)['"]/g;
  let match;
  while ((match = regex.exec(blockText)) !== null) {
    const filename = match[1];
    // Normalize: if the match is 'tests/e2e/auth.spec.ts', extract just the basename.
    const basename = filename.includes('/') ? filename.split('/').pop()! : filename;
    specs.push(basename);
  }
  return specs;
}

// Extract PVP_SPECS, SOLO_SPECS, and VISUAL_SPECS blocks.
const pvpMatch = configText.match(/const\s+PVP_SPECS\s*=\s*\[([\s\S]*?)\];/);
const soloMatch = configText.match(/const\s+SOLO_SPECS\s*=\s*\[([\s\S]*?)\];/);
const visualMatch = configText.match(/const\s+VISUAL_SPECS\s*=\s*\[([\s\S]*?)\];/);

const PVP_SPECS = pvpMatch ? extractSpecsFromBlock(pvpMatch[1]) : [];
const SOLO_SPECS = soloMatch ? extractSpecsFromBlock(soloMatch[1]) : [];
// #409: VISUAL_SPECS is a new project array — may be empty if dev has not yet implemented.
const VISUAL_SPECS = visualMatch ? extractSpecsFromBlock(visualMatch[1]) : [];

// Collect all *.spec.ts files from tests/e2e/.
const e2eDir = path.resolve(__dirname, '../../tests/e2e');
const allSpecsOnDisk = readdirSync(e2eDir)
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();

describe('Spec Registration Guard (#374)', () => {
  test('every *.spec.ts in tests/e2e/ is registered in SOLO_SPECS, PVP_SPECS, or VISUAL_SPECS', () => {
    // #409: visual-capture.spec.ts lives in VISUAL_SPECS — not SOLO_SPECS/PVP_SPECS.
    // The guard must tolerate a third project array so the visual spec is not flagged
    // as unregistered.
    const registeredSet = new Set([...PVP_SPECS, ...SOLO_SPECS, ...VISUAL_SPECS]);
    const unregistered = allSpecsOnDisk.filter((spec) => !registeredSet.has(spec));
    expect(unregistered).toEqual(
      [],
      unregistered.length > 0
        ? `Unregistered specs: ${unregistered.join(', ')}`
        : 'All specs are registered'
    );
  });

  test('no spec appears in both SOLO_SPECS and PVP_SPECS', () => {
    const pvpSet = new Set(PVP_SPECS);
    const doubleRegistered = SOLO_SPECS.filter((spec) => pvpSet.has(spec));
    expect(doubleRegistered).toEqual(
      [],
      doubleRegistered.length > 0
        ? `Double-registered specs: ${doubleRegistered.join(', ')}`
        : 'No specs are double-registered'
    );
  });

  test('spec count matches: disk vs registered (SOLO + PVP + VISUAL)', () => {
    // #409 adversarial: the count check must include VISUAL_SPECS or visual-capture.spec.ts
    // will appear as an extra disk file that inflates allSpecsOnDisk without a matching
    // registration, triggering a false "count mismatch" alarm.
    const totalRegistered = PVP_SPECS.length + SOLO_SPECS.length + VISUAL_SPECS.length;
    expect(allSpecsOnDisk.length).toBe(
      totalRegistered,
      `Disk: ${allSpecsOnDisk.length}, Registered: ${totalRegistered} (solo=${SOLO_SPECS.length} pvp=${PVP_SPECS.length} visual=${VISUAL_SPECS.length})`
    );
  });
});

// ===========================================================================
// #409: Visual capture harness spec-registration invariants
// ===========================================================================

describe('#409 visual-capture harness: spec registration and isolation', () => {

  test('screenshot-overlays.spec.ts must not exist on disk (deleted, absorbed by visual-capture)', () => {
    // #409 adversarial: screenshot-overlays.spec.ts is the stale predecessor. Leaving it
    // on disk while visual-capture.spec.ts also exists means both run if a dev
    // accidentally adds screenshot-overlays.spec.ts back to SOLO_SPECS — the
    // ad-hoc file with its "temporarily add to SOLO_SPECS" comment would fire in CI.
    const staleSpec = path.join(e2eDir, 'screenshot-overlays.spec.ts');
    expect(
      existsSync(staleSpec),
      'screenshot-overlays.spec.ts must be deleted — its three tests are absorbed by visual-capture.spec.ts (#409)',
    ).toBe(false);
  });

  test('screenshot-overlays.spec.ts is not referenced in SOLO_SPECS', () => {
    // #409 adversarial: even if the file is deleted, a dangling SOLO_SPECS entry
    // causes Playwright to search for a non-existent file and either error or silently
    // skip — both are bad. The entry must be absent.
    expect(SOLO_SPECS).not.toContain('screenshot-overlays.spec.ts');
  });

  test('screenshot-overlays.spec.ts is not referenced in PVP_SPECS', () => {
    // #409 adversarial: belt-and-suspenders — it was never in PVP_SPECS, but verify it
    // stays absent even after refactoring.
    expect(PVP_SPECS).not.toContain('screenshot-overlays.spec.ts');
  });

  test('visual-capture.spec.ts is NOT in SOLO_SPECS', () => {
    // #409 acceptance criterion: the visual harness must not run in the normal CI
    // `--project solo` sweep. Adding it to SOLO_SPECS would cause the spec to try to
    // run without CAPTURE_TARGET set, producing a misleading error or empty PNG.
    expect(SOLO_SPECS).not.toContain('visual-capture.spec.ts');
  });

  test('visual-capture.spec.ts is NOT in PVP_SPECS', () => {
    // #409 adversarial: a misrouted visual spec would open two browser contexts and
    // fail loudly — verify it cannot accidentally land in PVP_SPECS.
    expect(PVP_SPECS).not.toContain('visual-capture.spec.ts');
  });

  test('VISUAL_SPECS array exists in playwright.config.ts', () => {
    // #409 acceptance criterion: the visual project requires a named VISUAL_SPECS const.
    // If the const is absent the visual project is wired via an inline array — any
    // future add/remove requires touching the project definition itself, which is fragile.
    expect(
      visualMatch,
      'playwright.config.ts must declare const VISUAL_SPECS = [...] for the visual project',
    ).not.toBeNull();
  });

  test('VISUAL_SPECS contains visual-capture.spec.ts', () => {
    // #409 acceptance criterion: the harness must be wired into the visual project.
    expect(VISUAL_SPECS).toContain('visual-capture.spec.ts');
  });

  test('visual project definition appears in playwright.config.ts projects array', () => {
    // #409 adversarial: VISUAL_SPECS could be defined but never wired into a project.
    // A detached array is inert — the visual project would never run.
    expect(
      configText,
      "playwright.config.ts must have a project named 'visual'",
    ).toMatch(/name\s*:\s*['"]visual['"]/);
  });

  test('visual project uses VISUAL_SPECS as its testMatch', () => {
    // #409 adversarial: if the visual project uses a glob pattern instead of the
    // VISUAL_SPECS const, visual-capture.spec.ts might match solo/pvp glob too,
    // causing it to run in CI. Verify the project references VISUAL_SPECS.
    expect(
      configText,
      "visual project must reference VISUAL_SPECS in its testMatch (not an inline glob that could overlap solo/pvp)",
    ).toMatch(/VISUAL_SPECS/);
  });

  test('no spec in SOLO_SPECS or PVP_SPECS is also in VISUAL_SPECS (no cross-project bleed)', () => {
    // #409 adversarial: if any SOLO or PVP spec accidentally landed in VISUAL_SPECS,
    // it would run twice — once in its home project and once in visual. The visual
    // project is workers=1 / fullyParallel=false, so a duplicated spec would serialize
    // CI and inflate wall time silently.
    const visualSet = new Set(VISUAL_SPECS);
    const bleedFromSolo = SOLO_SPECS.filter((s) => visualSet.has(s));
    const bleedFromPvp = PVP_SPECS.filter((s) => visualSet.has(s));
    expect(bleedFromSolo, 'No SOLO spec must be in VISUAL_SPECS').toEqual([]);
    expect(bleedFromPvp, 'No PVP spec must be in VISUAL_SPECS').toEqual([]);
  });

});
