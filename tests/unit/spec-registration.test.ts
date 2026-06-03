import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Spec Registration Guard Test (#374)
 *
 * Ensures every *.spec.ts file in tests/e2e/ is registered in playwright.config.ts
 * in exactly one of SOLO_SPECS or PVP_SPECS, and that no file is double-registered.
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

// Extract PVP_SPECS and SOLO_SPECS blocks. Use a simple regex to find each const block.
const pvpMatch = configText.match(/const\s+PVP_SPECS\s*=\s*\[([\s\S]*?)\];/);
const soloMatch = configText.match(/const\s+SOLO_SPECS\s*=\s*\[([\s\S]*?)\];/);

const PVP_SPECS = pvpMatch ? extractSpecsFromBlock(pvpMatch[1]) : [];
const SOLO_SPECS = soloMatch ? extractSpecsFromBlock(soloMatch[1]) : [];

// Collect all *.spec.ts files from tests/e2e/.
const e2eDir = path.resolve(__dirname, '../../tests/e2e');
const allSpecsOnDisk = readdirSync(e2eDir)
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();

describe('Spec Registration Guard (#374)', () => {
  test('every *.spec.ts in tests/e2e/ is registered in SOLO_SPECS or PVP_SPECS', () => {
    const registeredSet = new Set([...PVP_SPECS, ...SOLO_SPECS]);
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

  test('spec count matches: disk vs registered', () => {
    const totalRegistered = PVP_SPECS.length + SOLO_SPECS.length;
    expect(allSpecsOnDisk.length).toBe(
      totalRegistered,
      `Disk: ${allSpecsOnDisk.length}, Registered: ${totalRegistered}`
    );
  });
});
