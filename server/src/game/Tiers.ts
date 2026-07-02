// Ring tier math lives in shared/tiers.ts (EPIC #511) so the Phaser client can
// import the `force` helper without depending on server-only code. This file
// re-exports it so every existing `from './Tiers'` / `from '../game/Tiers'`
// import resolves unchanged with zero call-site churn.
export { tierStartXp, tierForXp, naturalMaxUses, force, forceFromTier1 } from '../../../shared/tiers';
