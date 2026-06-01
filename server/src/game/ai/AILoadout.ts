import { AIPersonality, SlotKey } from '../../../../shared/types';
import { ElementEnum } from '../../../../shared/types';
import { Rng } from './AIProfiles';
import { tierForXp, naturalMaxUses } from '../Tiers';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

export interface SlotSpec {
  element: number;
  tier: number;
  currentUses: number;
  maxUses: number;
  xp: number;
}

/** Element-per-slot template (thumb = staked ring). */
type LoadoutTemplate = Record<SlotKey, number>;

/**
 * Per-personality starting XP on the AI's thumb (stake) ring. Tougher
 * personalities stake a more-seasoned ring, so beating them transfers more XP
 * (and thus a larger spirit_max boost). Only the thumb carries this XP; all
 * other AI slots start at 0.
 */
const PERSONALITY_THUMB_XP: Record<AIPersonality, number> = {
  AGGRESSIVE: 10,
  DEFENSIVE: 20,
  STATUS_HUNTER: 30,
  RESILIENT: 40,
};

/**
 * #196/#244 — per-personality difficulty multiplier applied to the player's
 * battle-hand weighted-average XP to scale an NPC's effective XP. Tougher personalities field more-seasoned
 * loadouts (higher ring tiers / uses) so beating them transfers more XP. Tuned so
 * a matched-difficulty opponent (DEFENSIVE) tracks the player's level 1:1, while
 * AGGRESSIVE undercuts it and RESILIENT exceeds it.
 */
const PERSONALITY_MULTIPLIER: Record<AIPersonality, number> = {
  AGGRESSIVE: 0.8,
  DEFENSIVE: 1.0,
  STATUS_HUNTER: 1.1,
  RESILIENT: 1.3,
};

/**
 * The NPC's effective XP for a personality, scaled to the player's battle-hand
 * weighted-average XP (#244). A player with an empty/zero-XP hand yields 0 here;
 * the floor at PERSONALITY_THUMB_XP keeps such opponents non-trivial.
 */
export function npcEffectiveXp(
  personality: AIPersonality,
  playerBattleHandAvgXp: number,
): number {
  return Math.round(playerBattleHandAvgXp * PERSONALITY_MULTIPLIER[personality]);
}

/**
 * Per-personality loadout archetypes. Each entry is a valid, strategically
 * coherent variant; the RNG picks one per duel. Thumb is the staked ring.
 *
 * Design notes (GDD §10.5):
 *  AGGRESSIVE  — opens with strongest, burns uses. Fire-Aggressor's all-in setup
 *                passive dumps the thumb's uses onto Fire a1; Wind-Aggressor's
 *                Tailwind self-charges to chain uncounterable hits.
 *  DEFENSIVE   — conserves, exhausts opponent. Earth-Defender's Precision Parry
 *                refunds defense uses on perfect timing; Wood-Defender's all-in
 *                setup passive front-loads its Wood defense ring.
 *  STATUS_HUNTER — builds single-element gauge to trigger status effects. Uses
 *                triple same-element attack + the counter in defense so the
 *                opponent can't STRONG-block and trigger a rally against them.
 *  RESILIENT   — mixed elements, WIND always in a1 (uncounterable baseline).
 *                Dangerous at low health (handled by AIPolicy). Stakes vary
 *                across all 5 base elements.
 */
export const TEMPLATES: Record<AIPersonality, LoadoutTemplate[]> = {
  AGGRESSIVE: [
    // Fire-Aggressor: all-in setup dumps thumb uses onto Fire a1; Wind a2 uncounterable
    { thumb: FIRE, a1: FIRE, a2: WIND, d1: EARTH, d2: WATER },
    // Wind-Aggressor: Tailwind self-charges; both attack slots uncounterable
    { thumb: WIND, a1: WIND, a2: FIRE, d1: EARTH, d2: WOOD  },
  ],
  DEFENSIVE: [
    // Earth-Defender: Precision Parry refunds defense uses on perfect timing
    { thumb: EARTH, a1: WATER, a2: WIND, d1: EARTH, d2: EARTH },
    // Wood-Defender: all-in setup front-loads its Wood defense ring
    { thumb: WOOD,  a1: WATER, a2: WIND, d1: WOOD,  d2: EARTH },
  ],
  STATUS_HUNTER: [
    // Fire-Hunter: all-in setup pours thumb uses across the Fire attack pair for gauge; Wood blocks Water counter
    { thumb: FIRE,  a1: FIRE,  a2: FIRE,  d1: WOOD,  d2: EARTH },
    // Water-Hunter: all-in setup front-loads the Water attack pair; Fire blocks Wood counter
    { thumb: WATER, a1: WATER, a2: WATER, d1: FIRE,  d2: EARTH },
    // Wood-Hunter: all-in setup front-loads the Wood attack pair; Water blocks Fire counter
    { thumb: WOOD,  a1: WOOD,  a2: WOOD,  d1: WATER, d2: EARTH },
  ],
  RESILIENT: [
    // Mixed endurance; Wind a1 = uncounterable baseline across all variants
    { thumb: FIRE,  a1: WIND, a2: WATER, d1: EARTH, d2: WOOD  },
    { thumb: WATER, a1: WIND, a2: FIRE,  d1: EARTH, d2: WOOD  },
    { thumb: EARTH, a1: WIND, a2: WATER, d1: EARTH, d2: WOOD  },
    { thumb: WIND,  a1: FIRE, a2: WATER, d1: EARTH, d2: WOOD  },
    { thumb: WOOD,  a1: WIND, a2: FIRE,  d1: EARTH, d2: WATER },
  ],
};

/**
 * Pick a loadout variant for the given personality using the supplied RNG and
 * convert to a SlotSpec map (tier/uses/xp can be overridden for higher-level AI).
 *
 * #244 — when `playerBattleHandAvgXp > 0`, the AI's ring tier, max uses, and thumb
 * XP are scaled to the player's carried battle hand instead of the fixed
 * `tier`/`maxUses` defaults. The input is already a weighted average of the
 * carried hand (thumb 1/3, attack pair 1/3, defense pair 1/3), so it feeds
 * tierForXp directly — there is no /5 division (the old #196 formula divided a
 * Reliquary sum across five rings; this one starts from an average):
 *   npcEffectiveXp = round(playerBattleHandAvgXp · PERSONALITY_MULTIPLIER)
 *   tier           = tierForXp(npcEffectiveXp)            (GDD §4.2)
 *   maxUses        = naturalMaxUses(tier) = 3 + tier
 *   thumb XP       = max(PERSONALITY_THUMB_XP, npcEffectiveXp) (floor at hardcoded)
 * A player with an empty/zero hand (avg 0) leaves the defaults untouched, so all
 * existing call sites that omit `playerBattleHandAvgXp` are unaffected.
 */
export function generateAILoadout(
  personality: AIPersonality,
  rng: Rng,
  tier = 1,
  maxUses = 3,
  xp = 0,
  thumbElement?: number,
  playerBattleHandAvgXp = 0,
): Partial<Record<SlotKey, SlotSpec>> {
  // #244 — XP-aware scaling. The input is the player's battle-hand weighted
  // average, so npcEffectiveXp feeds tierForXp directly (no /5). The thumb's XP is
  // floored at the hardcoded value so weak-hand opponents still stake a
  // non-trivial ring.
  const scaled = playerBattleHandAvgXp > 0;
  const npcXp = scaled ? npcEffectiveXp(personality, playerBattleHandAvgXp) : 0;
  const effectiveTier = scaled ? tierForXp(npcXp) : tier;
  const effectiveMaxUses = scaled ? naturalMaxUses(effectiveTier) : maxUses;
  const effectiveThumbXp = scaled
    ? Math.max(PERSONALITY_THUMB_XP[personality], npcXp)
    : PERSONALITY_THUMB_XP[personality];

  const all = TEMPLATES[personality];
  // #199 — when the caller knows the intended staked element (threaded from the
  // overworld NPC's spawn data), restrict the variant pool to templates whose
  // thumb matches so the duel's stake element equals the overworld marker.
  // Fall back to all templates if none match (defensive — should not happen with
  // consistent spawn data).
  const candidates =
    thumbElement !== undefined ? all.filter((t) => t.thumb === thumbElement) : all;
  const pool = candidates.length > 0 ? candidates : all;
  const template = pool[rng.intBetween(0, pool.length - 1)];
  const spec: Partial<Record<SlotKey, SlotSpec>> = {};
  for (const [slot, element] of Object.entries(template) as [SlotKey, number][]) {
    // The thumb carries personality-based XP (XP-floored when scaled); every other
    // slot stays at `xp` (0 by default). Beating the AI transfers the thumb XP to
    // the winner, so a scaled thumb yields a proportionally larger reward.
    const slotXp = slot === 'thumb' ? effectiveThumbXp : xp;
    spec[slot] = {
      element,
      tier: effectiveTier,
      currentUses: effectiveMaxUses,
      maxUses: effectiveMaxUses,
      xp: slotXp,
    };
  }
  return spec;
}

/**
 * Return just the thumb (stake) element for a personality preview without
 * creating a full room. Uses a fresh RNG call so previews are independent of
 * combat RNG.
 */
export function previewStakeElement(personality: AIPersonality, rng: Rng): number {
  const templates = TEMPLATES[personality];
  return templates[rng.intBetween(0, templates.length - 1)].thumb;
}

/**
 * Full opponent preview for the encounter screen (#78 ③): the staked thumb ring
 * element/tier/XP plus the loadout's total XP across all five slots. Generates
 * the same loadout the BattleRoom will (identical RNG seed) so the preview
 * matches the duel exactly. Tier 1 and per-slot XP come straight from
 * generateAILoadout (only the thumb carries PERSONALITY_THUMB_XP; the rest are
 * 0), so totalXp equals the thumb XP under the default tier/uses/xp.
 */
export function previewOpponent(
  personality: AIPersonality,
  rng: Rng,
  playerBattleHandAvgXp = 0,
): { element: number; stakeTier: number; stakeXp: number; totalXp: number; npcEffectiveXp: number } {
  const loadout = generateAILoadout(
    personality,
    rng,
    undefined,
    undefined,
    undefined,
    undefined,
    playerBattleHandAvgXp,
  );
  const thumb = loadout.thumb;
  const element = thumb?.element ?? 0;
  const stakeTier = thumb?.tier ?? 1;
  const stakeXp = thumb?.xp ?? 0;
  const totalXp = Object.values(loadout).reduce((sum, slot) => sum + (slot?.xp ?? 0), 0);
  return {
    element,
    stakeTier,
    stakeXp,
    totalXp,
    npcEffectiveXp: npcEffectiveXp(personality, playerBattleHandAvgXp),
  };
}

/** All base personalities in display order (excludes PvP). */
export const AI_PERSONALITIES: AIPersonality[] = [
  'AGGRESSIVE',
  'DEFENSIVE',
  'STATUS_HUNTER',
  'RESILIENT',
];
