import { counterOf } from '../ElementSystem';
import { AIProfile, Rng, isLowHearts } from './AIProfiles';

/** Read-only snapshot of one ring in the AI's hand. */
export interface RingView {
  element: number;
  currentUses: number;
  isExtinguished: boolean;
}

/**
 * Plain, read-only board snapshot the policy reasons over. Built by
 * `readBoard(state, aiId)` (in AIController) so the policy never touches
 * Colyseus schemas directly and stays trivially unit-testable.
 */
export interface BoardView {
  hand: RingView[];
  hearts: number;
  /**
   * The element currently incoming when the AI is the defender (the attacker's
   * thrown / volleyed element). -1 when the AI is the attacker.
   */
  incomingElement: number;
  /**
   * Elements the opponent is known to still hold a usable ring for (revealed
   * via prior attacks/defenses). Used by Aggressive to throw something the
   * opponent can't strong-counter. Empty when nothing is revealed yet.
   */
  opponentUsableElements: number[];
  /**
   * The element STATUS_HUNTER has committed to this duel (-1 = not yet chosen).
   * Persisted across turns by the controller.
   */
  committedElement: number;
}

export interface AttackDecision {
  slot: number;
  /** The element STATUS_HUNTER committed to (so the controller can persist it). */
  committedElement: number;
}

export interface DefenseDecision {
  slot: number;
  /** Intended press offset from impact in ms, or null for a deliberate no-block. */
  pressOffsetMs: number | null;
}

/** Indices of rings that can still be thrown/used. */
function usableSlots(hand: RingView[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < hand.length; i++) {
    if (!hand[i].isExtinguished && hand[i].currentUses > 0) out.push(i);
  }
  return out;
}

/** Slot holding the given element if it is still usable, else -1. */
function usableSlotForElement(hand: RingView[], element: number): number {
  if (element < 0) return -1;
  const r = hand[element];
  return r && !r.isExtinguished && r.currentUses > 0 ? element : -1;
}

/** Usable slot with the most remaining uses (ties → lowest slot). */
function mostUsesSlot(hand: RingView[], slots: number[]): number {
  let best = slots[0];
  for (const s of slots) if (hand[s].currentUses > hand[best].currentUses) best = s;
  return best;
}

/** Usable slot with the fewest remaining uses (ties → lowest slot). */
function fewestUsesSlot(hand: RingView[], slots: number[]): number {
  let best = slots[0];
  for (const s of slots) if (hand[s].currentUses < hand[best].currentUses) best = s;
  return best;
}

/**
 * Pure attack decision. Each personality picks a slot from its own hand; the
 * slot index equals the element (hand is element-indexed). Never returns an
 * extinguished/empty ring as long as one usable ring exists.
 */
export function decideAttack(view: BoardView, profile: AIProfile, _rng: Rng): AttackDecision {
  const slots = usableSlots(view.hand);
  // Defensive fallback: no usable ring (shouldn't happen mid-duel) — slot 0.
  if (slots.length === 0) return { slot: 0, committedElement: view.committedElement };

  const low = isLowHearts(profile, view.hearts);

  switch (profile.personality) {
    case 'AGGRESSIVE':
      return { slot: aggressiveAttackSlot(view, slots), committedElement: view.committedElement };

    case 'DEFENSIVE':
      // Spend the fewest-use ring first; hold strong (high-use) rings in reserve.
      return { slot: fewestUsesSlot(view.hand, slots), committedElement: view.committedElement };

    case 'STATUS_HUNTER': {
      // Commit to one element for the whole duel; re-commit only if it can no
      // longer be thrown (extinguished). Build the chosen element's gauge.
      let committed = view.committedElement;
      if (usableSlotForElement(view.hand, committed) < 0) {
        committed = mostUsesSlot(view.hand, slots); // slot index === element
      }
      return { slot: committed, committedElement: committed };
    }

    case 'RESILIENT':
      // Healthy: grind highest-use ring. Low: borrow Aggressive's unparryable pick.
      return {
        slot: low ? aggressiveAttackSlot(view, slots) : mostUsesSlot(view.hand, slots),
        committedElement: view.committedElement,
      };

    default:
      return { slot: slots[0], committedElement: view.committedElement };
  }
}

/**
 * Aggressive attack rule: throw an element the opponent can't STRONG-counter
 * (their counter ring is exhausted/unrevealed-as-usable). If every usable
 * element is counterable, fall back to the AI's own most-uses ring.
 */
function aggressiveAttackSlot(view: BoardView, slots: number[]): number {
  if (view.opponentUsableElements.length > 0) {
    for (const s of slots) {
      const counter = counterOf(view.hand[s].element);
      if (!view.opponentUsableElements.includes(counter)) return s;
    }
  }
  return mostUsesSlot(view.hand, slots);
}

/**
 * Pure defense decision. Returns the ring slot to commit and the intended press
 * offset (ms from impact), or pressOffsetMs=null to deliberately not block.
 * The controller adds Gaussian jitter and converts the offset to a wall-clock
 * timer; this function only states the *intent*.
 */
export function decideDefense(view: BoardView, profile: AIProfile, rng: Rng): DefenseDecision {
  const slots = usableSlots(view.hand);
  const low = isLowHearts(profile, view.hearts);
  const noBlockProb = low ? profile.lowHeartNoBlockProb : profile.noBlockProb;

  // No usable ring → cannot block.
  if (slots.length === 0) return { slot: -1, pressOffsetMs: null };

  const incoming = view.incomingElement;
  const counterEl = counterOf(incoming);
  const counterSlot = usableSlotForElement(view.hand, counterEl);

  switch (profile.personality) {
    case 'AGGRESSIVE':
      // Chase the rally: STRONG counter at PARRY timing if available.
      if (counterSlot >= 0) return { slot: counterSlot, pressOffsetMs: 0 };
      // No counter available — safe NEUTRAL catch at BLOCK timing.
      return neutralCatch(view, slots, incoming);

    case 'DEFENSIVE':
      // Sometimes take the hit rather than waste a ring; otherwise safe NEUTRAL
      // catch that denies the attacker a rally.
      if (rng.next() < noBlockProb) return { slot: -1, pressOffsetMs: null };
      return neutralCatch(view, slots, incoming);

    case 'STATUS_HUNTER':
      if (rng.next() < noBlockProb) return { slot: -1, pressOffsetMs: null };
      return neutralCatch(view, slots, incoming);

    case 'RESILIENT':
      if (low) {
        // Sharp strong-parry when cornered.
        if (counterSlot >= 0) return { slot: counterSlot, pressOffsetMs: 0 };
        return neutralCatch(view, slots, incoming);
      }
      // Loose / frequently no-block when healthy.
      if (rng.next() < noBlockProb) return { slot: -1, pressOffsetMs: null };
      return neutralCatch(view, slots, incoming);

    default:
      return neutralCatch(view, slots, incoming);
  }
}

/**
 * Pick a NEUTRAL (or worst-case non-WEAK) ring and catch at BLOCK timing so the
 * attacker gets no rally. Avoids WEAK (would cost a heart) and avoids the STRONG
 * counter at PARRY (which would feed the attacker — but a NEUTRAL catch is the
 * intent here). Falls back to fewest-use usable ring.
 */
function neutralCatch(view: BoardView, slots: number[], incoming: number): DefenseDecision {
  // Prefer a NEUTRAL ring: not the counter (STRONG) and not one we are WEAK to.
  const counterEl = counterOf(incoming);
  const neutral: number[] = [];
  for (const s of slots) {
    const el = view.hand[s].element;
    if (el === counterEl) continue; // STRONG — reserve it
    // WEAK for the defender means the incoming element beats our ring: counterOf(el) === incoming.
    if (counterOf(el) === incoming) continue;
    neutral.push(s);
  }
  const pool = neutral.length > 0 ? neutral : slots;
  // Catch just inside the BLOCK shell (post-impact) — a safe, non-parry catch.
  // BLOCK_WINDOW=200, PARRY_WINDOW=175 → +190ms is BLOCK, not PARRY, not MISTIME.
  return { slot: fewestUsesViewSlot(view, pool), pressOffsetMs: 190 };
}

function fewestUsesViewSlot(view: BoardView, slots: number[]): number {
  let best = slots[0];
  for (const s of slots) if (view.hand[s].currentUses < view.hand[best].currentUses) best = s;
  return best;
}
