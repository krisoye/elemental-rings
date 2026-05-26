import { AIPersonality, SlotKey } from '../../../../shared/types';
import { ElementEnum } from '../../../../shared/types';
import { Rng } from './AIProfiles';

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
 * Per-personality loadout archetypes. Each entry is a valid, strategically
 * coherent variant; the RNG picks one per duel. Thumb is the staked ring.
 *
 * Design notes (GDD §10.5):
 *  AGGRESSIVE  — opens with strongest, burns uses. Stake on dominant bracelet
 *                (Kindling/Tailwind passive). Fire-Aggressor gets +1 use on
 *                Fire a1 from Kindling; Wind-Aggressor chains uncounterable hits.
 *  DEFENSIVE   — conserves, exhausts opponent. Earth-Defender gets Bulwark (+1
 *                use on both Earth defense rings); Wood-Defender Deep Roots
 *                (thumb absorbs heart-loss).
 *  STATUS_HUNTER — builds single-element gauge to trigger status effects. Uses
 *                triple same-element attack + the counter in defense so the
 *                opponent can't STRONG-block and trigger a rally against them.
 *  RESILIENT   — mixed elements, WIND always in a1 (uncounterable baseline).
 *                Dangerous at low health (handled by AIPolicy). Stakes vary
 *                across all 5 base elements.
 */
const TEMPLATES: Record<AIPersonality, LoadoutTemplate[]> = {
  AGGRESSIVE: [
    // Fire-Aggressor: Kindling +1 use on Fire a1; Wind a2 uncounterable
    { thumb: FIRE, a1: FIRE, a2: WIND, d1: EARTH, d2: WATER },
    // Wind-Aggressor: Tailwind self-charges; both attack slots uncounterable
    { thumb: WIND, a1: WIND, a2: FIRE, d1: EARTH, d2: WOOD  },
  ],
  DEFENSIVE: [
    // Earth-Defender: Bulwark adds +1 use to both Earth defense rings
    { thumb: EARTH, a1: WATER, a2: WIND, d1: EARTH, d2: EARTH },
    // Wood-Defender: Deep Roots thumb absorbs heart-loss
    { thumb: WOOD,  a1: WATER, a2: WIND, d1: WOOD,  d2: EARTH },
  ],
  STATUS_HUNTER: [
    // Fire-Hunter: Kindling +1 on a1; triple Fire for gauge; Wood blocks Water counter
    { thumb: FIRE,  a1: FIRE,  a2: FIRE,  d1: WOOD,  d2: EARTH },
    // Water-Hunter: Wellspring refunds defense use; Fire blocks Wood counter
    { thumb: WATER, a1: WATER, a2: WATER, d1: FIRE,  d2: EARTH },
    // Wood-Hunter: Deep Roots; Water blocks Fire counter
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
 */
export function generateAILoadout(
  personality: AIPersonality,
  rng: Rng,
  tier = 1,
  maxUses = 3,
  xp = 0,
): Partial<Record<SlotKey, SlotSpec>> {
  const templates = TEMPLATES[personality];
  const template = templates[rng.intBetween(0, templates.length - 1)];
  const spec: Partial<Record<SlotKey, SlotSpec>> = {};
  for (const [slot, element] of Object.entries(template) as [SlotKey, number][]) {
    // The thumb carries personality-based XP; every other slot stays at `xp`
    // (0 by default). Beating the AI transfers that thumb XP to the winner.
    const slotXp = slot === 'thumb' ? PERSONALITY_THUMB_XP[personality] : xp;
    spec[slot] = { element, tier, currentUses: maxUses, maxUses, xp: slotXp };
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

/** All base personalities in display order (excludes PvP). */
export const AI_PERSONALITIES: AIPersonality[] = [
  'AGGRESSIVE',
  'DEFENSIVE',
  'STATUS_HUNTER',
  'RESILIENT',
];
