// Single source of truth for element display names, plus a re-export of the
// canonical loadout-slot keys/type. Both the Colyseus server and the Phaser
// client import from here so the strings derived from ElementEnum live in
// exactly one place (EPIC #291 / #292 — DRY remediation). Game logic still lives
// entirely on the server; ELEMENT_NAMES here is display-only.
import { ElementEnum } from './types';

// Re-exported from types.ts (the canonical source) so consumers can pull element
// names and slot keys from one module.
export { SLOT_KEYS, type SlotKey } from './types';

/**
 * Display names for every element, indexed by ElementEnum value (0-15). Derived
 * from the ElementEnum reverse mapping so the names can never drift from the
 * enum. Frozen so consumers cannot mutate the shared table.
 */
export const ELEMENT_NAMES: readonly string[] = Object.freeze(
  Array.from({ length: ElementEnum.SHADOW + 1 }, (_, i) => ElementEnum[i]),
);
