import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { PNG } from 'pngjs';
// The decoder + source-path constants are plain ESM .mjs modules under
// client/scripts; vitest resolves them directly (no transpile needed).
import { STARTER_VILLAGE_A2 } from '../../client/scripts/asset-sources.mjs';
import { decodeAutotile } from '../../client/scripts/lib/rpgmaker-autotile.mjs';

describe('RPG Maker autotile decoder', () => {
  it('produces correct output dimensions (48 tiles × 32×32)', () => {
    const src = PNG.sync.read(readFileSync(STARTER_VILLAGE_A2));
    const out = decodeAutotile(src, { blockX: 0, blockY: 0, nativeSize: 32 });
    expect(out.width).toBe(48 * 32);
    expect(out.height).toBe(32);
  });

  it('variant 0 center pixels are non-transparent (solid fill)', () => {
    const src = PNG.sync.read(readFileSync(STARTER_VILLAGE_A2));
    const out = decodeAutotile(src, { blockX: 0, blockY: 0, nativeSize: 32 });
    // Center pixel of variant 0 (first tile in strip): pixel at (16, 16).
    const idx = (16 * out.width + 16) * 4;
    expect(out.data[idx + 3]).toBeGreaterThan(200); // alpha > 200 (opaque)
  });

  it('throws on malformed source buffer', () => {
    const tiny = new PNG({ width: 4, height: 4 });
    expect(() => decodeAutotile(tiny, { blockX: 0, blockY: 0, nativeSize: 32 })).toThrow();
  });
});
