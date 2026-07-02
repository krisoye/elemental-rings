// GDD §4.2 — Ring tiers as a pure function of XP.
//
// Tier is derived from XP alone (no element count, no fusion history, no caps).
// Tier n starts at 250·n·(n+1) XP — the triangular number T(n) = n(n+1)/2 scaled
// by 500, so each tier's range is 500 wider than the previous.
//
//   Thresholds: T0=0, T1=500, T2=1500, T3=3000, T4=5000, T5=7500.
//
// This module is pure (no DB, no side effects) so it can be unit-tested directly
// and imported by both server and client code without coupling. It imports
// nothing under `server/` — the Phaser client (RingCard force display, EPIC
// #511) needs `force` and cannot import server-only modules.

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

/**
 * Force scalar as a function of the 1-indexed tier (Contract A, EPIC #511).
 * This is the single load-bearing arithmetic — both the player path (via
 * `force`) and the AI path normalize their own tier indexing to 1-indexed
 * before calling this, so there is exactly one place the Contract A formula
 * lives.
 *
 *   forceFromTier1(1)=1, (2)=2, (3)=2, (4)=3, (5)=3, (6)=4, (7)=4, (8)=5, (9)=5, (10)=6.
 */
export function forceFromTier1(tier1: number): number {
  return Math.floor((tier1 + 2) / 2);
}

/**
 * Force scalar for a ring of the given XP (Contract A). `tierForXp` is
 * 0-indexed; `+1` normalizes to the 1-indexed convention `forceFromTier1` is
 * defined on. Always ≥ 1 (no divide-by-zero at the call sites that use
 * `1 / force(xp)`).
 */
export function force(xp: number): number {
  return forceFromTier1(tierForXp(xp) + 1);
}
