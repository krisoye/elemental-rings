// CLI wrapper for the RPG Maker VX/Ace A2 autotile decoder (8D.1).
//
// Reads the Starter Village A2 autotile sheet, decodes block (0,0) into the
// 48-variant flat strip, and writes it to
// client/public/assets/tiles/decoded-autotile.png for inspection.
//
// This PNG is committed for visual reference only — it is NOT referenced by any
// map JSON or scene. Output is deterministic/byte-stable.
//
// Run from the client/ directory:  node scripts/decode-autotile.mjs
// (or `npm run gen:decode-autotile`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { STARTER_VILLAGE_A2 } from './asset-sources.mjs';
import { decodeAutotile } from './lib/rpgmaker-autotile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'decoded-autotile.png');

const sourcePng = PNG.sync.read(readFileSync(STARTER_VILLAGE_A2));
const output = decodeAutotile(sourcePng, { blockX: 0, blockY: 0, nativeSize: 32 });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(output));
console.log(`Wrote ${output.width}x${output.height} autotile strip → ${outPath}`);
