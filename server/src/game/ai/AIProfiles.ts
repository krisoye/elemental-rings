import { AIPersonality } from '../../../../shared/types';
import { MIN_COMBO_GAP_MS } from '../constants';

/**
 * Deterministic PRNG (mulberry32). Seeding the same value reproduces the exact
 * same stream, which makes the integration suite (ai-battle.test.ts) repeatable.
 * Returns floats in [0, 1).
 */
export interface Rng {
  next(): number;
  /** Box-Muller standard normal sample (mean 0, variance 1). */
  normal(): number;
  /** Integer in [min, max] inclusive. */
  intBetween(min: number, max: number): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal(): number {
      // Box-Muller. Guard u1 away from 0 to avoid log(0).
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    intBetween(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}

/**
 * Per-personality tuning. All combat-balance numbers live here as named fields
 * so they are trivially adjustable without touching policy logic.
 *
 * - timingSigmaMs: stddev of the Gaussian timing jitter applied around the
 *   intended press offset. σ=80 → P(|offset|>200ms mistime) ≈ 1%; σ=150 ≈ 18%.
 * - lowHeartTimingSigmaMs: timing σ used when this AI is at or below
 *   lowHeartThreshold hearts (the §10.5 "Resilient sharpens at low health" rule).
 * - noBlockProb / lowHeartNoBlockProb: probability the defender deliberately
 *   takes the hit instead of committing a ring (healthy / low-heart).
 * - thinkDelayMinMs / thinkDelayMaxMs: attacker "decision" pause before throwing
 *   (and the low-heart-narrowed variants).
 * - comboGapMinMs / comboGapMaxMs: EPIC #268 — the [min,max] window (ms) the AI
 *   draws its fusion-thumb double-attack gap from. Only consulted when the AI is
 *   double-attack-eligible (a fused thumb whose A1/A2 are its components — i.e. a
 *   boss with #257's loadout), so the base per-personality profiles default to the
 *   safe minimum (parry-cancel always resolves cleanly). The boss-modified profile
 *   (BattleRoom.buildBossProfile) tightens the window so bosses pick faster combos.
 *   The server re-clamps to [MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS] regardless.
 */
export interface AIProfile {
  personality: AIPersonality;
  timingSigmaMs: number;
  lowHeartTimingSigmaMs: number;
  noBlockProb: number;
  lowHeartNoBlockProb: number;
  thinkDelayMinMs: number;
  thinkDelayMaxMs: number;
  lowHeartThinkDelayMinMs: number;
  lowHeartThinkDelayMaxMs: number;
  lowHeartThreshold: number;
  comboGapMinMs: number;
  comboGapMaxMs: number;
  /**
   * #492 — probability [0,1] that this AI picks a suboptimal (WEAK or NEUTRAL)
   * element instead of the optimal one on a given attack or defense decision.
   * Scaled down by scaleProfileByTier for higher-tier / higher-skill opponents.
   * Per-persona defaults: AGGRESSIVE ≈ 0.05, DEFENSIVE ≈ 0.15,
   *   STATUS_HUNTER ≈ 0.10, RESILIENT ≈ 0.10.
   */
  elementMistakeProb: number;
  /** Probability the AI chooses a charged attack over a tap on its attack turn. */
  chargeAttemptProb: number;
  /** Which sweep (1-based) the AI aims to release on. */
  targetSweep: 1 | 2 | 3;
  /** Standard deviation (degrees) of Gaussian noise applied to the release angle. */
  chargeReleaseSigmaDeg: number;
  /** chargeAttemptProb override when hearts ≤ lowHeartThreshold (RESILIENT). */
  lowHeartChargeAttemptProb?: number;
  /** targetSweep override when hearts ≤ lowHeartThreshold (RESILIENT). */
  lowHeartTargetSweep?: 1 | 2 | 3;
}

export const AI_PROFILES: Record<AIPersonality, AIProfile> = {
  AGGRESSIVE: {
    personality: 'AGGRESSIVE',
    timingSigmaMs: 80,
    lowHeartTimingSigmaMs: 80,
    noBlockProb: 0,
    lowHeartNoBlockProb: 0,
    thinkDelayMinMs: 300,
    thinkDelayMaxMs: 600,
    lowHeartThinkDelayMinMs: 300,
    lowHeartThinkDelayMaxMs: 600,
    lowHeartThreshold: 1,
    comboGapMinMs: MIN_COMBO_GAP_MS,
    comboGapMaxMs: MIN_COMBO_GAP_MS + 100,
    // #492 — AGGRESSIVE chases optimal picks; low baseline mistake probability.
    elementMistakeProb: 0.05,
    chargeAttemptProb: 1.0,
    targetSweep: 3,
    chargeReleaseSigmaDeg: 5,
  },
  DEFENSIVE: {
    personality: 'DEFENSIVE',
    timingSigmaMs: 80,
    lowHeartTimingSigmaMs: 80,
    noBlockProb: 0.3,
    lowHeartNoBlockProb: 0.3,
    thinkDelayMinMs: 900,
    thinkDelayMaxMs: 1500,
    lowHeartThinkDelayMinMs: 900,
    lowHeartThinkDelayMaxMs: 1500,
    lowHeartThreshold: 1,
    comboGapMinMs: MIN_COMBO_GAP_MS,
    comboGapMaxMs: MIN_COMBO_GAP_MS + 100,
    // #492 — DEFENSIVE plays conservatively; higher element-mistake to model
    // deliberate safe picks that are suboptimal offensively.
    elementMistakeProb: 0.15,
    chargeAttemptProb: 0.0,
    targetSweep: 1,
    chargeReleaseSigmaDeg: 999,
  },
  STATUS_HUNTER: {
    personality: 'STATUS_HUNTER',
    timingSigmaMs: 100,
    lowHeartTimingSigmaMs: 100,
    noBlockProb: 0.1,
    lowHeartNoBlockProb: 0.1,
    thinkDelayMinMs: 900,
    thinkDelayMaxMs: 1100,
    lowHeartThinkDelayMinMs: 900,
    lowHeartThinkDelayMaxMs: 1100,
    lowHeartThreshold: 1,
    comboGapMinMs: MIN_COMBO_GAP_MS,
    comboGapMaxMs: MIN_COMBO_GAP_MS + 100,
    // #492 — STATUS_HUNTER focuses on gauge-building; moderate element mistakes
    // from committing to a triangle element over the optimal pick.
    elementMistakeProb: 0.10,
    chargeAttemptProb: 0.2,
    targetSweep: 1,
    chargeReleaseSigmaDeg: 15,
  },
  RESILIENT: {
    personality: 'RESILIENT',
    timingSigmaMs: 150,
    lowHeartTimingSigmaMs: 60,
    noBlockProb: 0.4,
    lowHeartNoBlockProb: 0,
    thinkDelayMinMs: 600,
    thinkDelayMaxMs: 800,
    lowHeartThinkDelayMinMs: 300,
    lowHeartThinkDelayMaxMs: 400,
    lowHeartThreshold: 1,
    comboGapMinMs: MIN_COMBO_GAP_MS,
    comboGapMaxMs: MIN_COMBO_GAP_MS + 100,
    // #492 — RESILIENT plays mixed-element endurance; moderate mistake probability.
    elementMistakeProb: 0.10,
    chargeAttemptProb: 0.0,
    targetSweep: 2,
    chargeReleaseSigmaDeg: 10,
    lowHeartChargeAttemptProb: 0.8,
    lowHeartTargetSweep: 2,
  },
};

/** True when `hearts` is at or below the profile's low-heart sharpening threshold. */
export function isLowHearts(profile: AIProfile, hearts: number): boolean {
  return hearts <= profile.lowHeartThreshold;
}
