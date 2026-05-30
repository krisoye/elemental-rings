// GDD §4.2 — Ring tiers as a pure function of XP.
//
// Tier is derived from XP alone (no element count, no fusion history, no caps).
// Tier n starts at 250·n·(n+1) XP — the triangular number T(n) = n(n+1)/2 scaled
// by 500, so each tier's range is 500 wider than the previous.
//
//   Thresholds: T0=0, T1=500, T2=1500, T3=3000, T4=5000, T5=7500.
//
// This module is pure (no DB, no side effects) so it can be unit-tested directly
// and imported by both persistence and runtime code without coupling.

/** The XP at which tier `n` begins: 250·n·(n+1) (GDD §4.2). */
export function tierStartXp(n: number): number {
  return 250 * n * (n + 1);
}

/**
 * The tier a ring of the given XP currently sits in.
 *
 * Solves 250·n·(n+1) ≤ xp for the largest n, seeding from the closed-form
 * quadratic root then correcting in both directions so floating-point error at a
 * boundary can never misclassify (exactly-on-threshold lands in the higher tier;
 * one XP below lands in the lower).
 */
export function tierForXp(xp: number): number {
  if (xp < 0) return 0;
  // 250·n·(n+1) ≤ xp  ⇒  n ≤ (-1 + sqrt(1 + xp/62.5)) / 2
  let n = Math.floor((-1 + Math.sqrt(1 + xp / 62.5)) / 2);
  while (tierStartXp(n + 1) <= xp) n++; // correct float undershoot
  while (n > 0 && tierStartXp(n) > xp) n--; // correct float overshoot
  return n;
}

/**
 * Natural ring max uses at a given tier (GDD §4.2): 3 + tier. "Natural" means the
 * ring earned its way to the tier through battle XP; fusion rings land at a tier
 * without this per-tier +1 history and set max_uses explicitly (see §4.6).
 */
export function naturalMaxUses(tier: number): number {
  return 3 + tier;
}
