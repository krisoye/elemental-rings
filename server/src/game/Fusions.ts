// Pure fusion data + helpers now live in shared/ so the Phaser client (whose
// tsconfig only sees src + ../shared) can import the SAME ordering/component
// logic the server uses — no duplicate fusion tables (#263). This module
// re-exports them unchanged so every existing server import path is preserved.
export {
  TRIANGLE,
  NEUTRAL,
  isFusion,
  fusionOf,
  fusionParents,
  componentsOf,
  triangleComponentsOf,
} from '../../../shared/fusions';
