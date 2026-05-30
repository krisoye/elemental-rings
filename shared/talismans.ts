// Talisman catalog (GDD §14) — the single source of truth for talisman METADATA:
// id, display name, equipment slot, charge ceiling, and description. Talismans
// are utility items distinct from rings; they occupy separate equipment slots
// (§14.2) and have no combat function. The only implemented talisman in 8C.1 is
// the Sanctum Stone (§14.3), a necklace that relocates the player's Sanctum to an
// attuned Anchorage and refills its charges on sleep.
//
// This module is shared: the server imports it (PlayerRepo seeds the empty
// loadout, routes validate equip requests) and the client may import the def for
// display copy. Charge counts and equip state live in the talisman_loadout table,
// NOT here — the catalog is pure static metadata.

/** Static metadata for one talisman. */
export interface TalismanDef {
  /** Stable identifier; the value stored in talisman_loadout.necklace_id. */
  id: string;
  /** Display name shown in the necklace slot / activation prompt. */
  name: string;
  /** Equipment slot the talisman occupies (§14.2). */
  slot: 'necklace' | 'bracelet';
  /** Charge ceiling — the value charges reset to on equip and on sleep. */
  maxCharges: number;
  /** Player-facing description of the talisman's effect. */
  description: string;
}

/**
 * The canonical talisman catalog. The Sanctum Stone (#81, GDD §14.3) has been
 * retired: re-anchoring is now a natural ability via POST /api/sanctum/summon
 * (#180, GDD §12 / §14). The framework (TalismanDef, getTalisman, necklace slot)
 * is preserved for future talisman items; the catalog is intentionally empty.
 */
export const TALISMANS: TalismanDef[] = [];

/** Look up a talisman definition by id, or undefined if the id is unknown. */
export function getTalisman(id: string): TalismanDef | undefined {
  return TALISMANS.find((t) => t.id === id);
}
