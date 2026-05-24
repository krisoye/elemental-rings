import { AIPersonality } from '../../../../shared/types';

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
  },
};

/** True when `hearts` is at or below the profile's low-heart sharpening threshold. */
export function isLowHearts(profile: AIProfile, hearts: number): boolean {
  return hearts <= profile.lowHeartThreshold;
}
