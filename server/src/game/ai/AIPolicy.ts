import { counterOf, resolve } from '../ElementSystem';
import { TRIANGLE } from '../Fusions';
import { AttackSlot, DefenseSlot } from '../../../../shared/types';
import { AIProfile, Rng, isLowHearts } from './AIProfiles';

/** Read-only snapshot of one ring in a slot. */
export interface RingView {
  element: number;
  currentUses: number;
  isExtinguished: boolean;
}

/** A named attack slot the AI can fire. */
export interface AttackSlotView {
  key: AttackSlot;
  ring: RingView;
}

/** A named defense slot the AI can fire. */
export interface DefenseSlotView {
  key: DefenseSlot;
  ring: RingView;
}

/**
 * Plain, read-only board snapshot the policy reasons over. Built by
 * `readBoard(state, aiId)` (in AIController) so the policy never touches Colyseus
 * schemas directly and stays trivially unit-testable.
 */
export interface BoardView {
  attackSlots: AttackSlotView[];
  defenseSlots: DefenseSlotView[];
  hearts: number;
  /**
   * The element currently incoming when the AI is the defender (the attacker's
   * thrown / volleyed element). -1 when the AI is the attacker.
   */
  incomingElement: number;
  /**
   * Elements the opponent is known to still hold a usable ring for. Used by
   * Aggressive to throw something the opponent can't strong-counter.
   */
  opponentUsableElements: number[];
  /**
   * The triangle element STATUS_HUNTER has committed to this duel (-1 = none).
   * Persisted across turns by the controller.
   */
  committedElement: number;
}

export interface AttackDecision {
  slot: AttackSlot;
  /** The element STATUS_HUNTER committed to (so the controller can persist it). */
  committedElement: number;
}

export interface DefenseDecision {
  /** The defense slot to commit, or null for a deliberate no-block. */
  slot: DefenseSlot | null;
  /** Intended press offset from impact in ms, or null for a deliberate no-block. */
  pressOffsetMs: number | null;
}

/** Attack slots whose ring can still be thrown. */
function usableAttackSlots(view: BoardView): AttackSlotView[] {
  return view.attackSlots.filter((s) => !s.ring.isExtinguished && s.ring.currentUses > 0);
}

/** Defense slots whose ring can still be used. */
function usableDefenseSlots(view: BoardView): DefenseSlotView[] {
  return view.defenseSlots.filter((s) => !s.ring.isExtinguished && s.ring.currentUses > 0);
}

/** Attack slot with the most remaining uses (ties → first in order). */
function mostUsesAttack(slots: AttackSlotView[]): AttackSlotView {
  let best = slots[0];
  for (const s of slots) if (s.ring.currentUses > best.ring.currentUses) best = s;
  return best;
}

/** Attack slot with the fewest remaining uses (ties → first in order). */
function fewestUsesAttack(slots: AttackSlotView[]): AttackSlotView {
  let best = slots[0];
  for (const s of slots) if (s.ring.currentUses < best.ring.currentUses) best = s;
  return best;
}

/**
 * Pure attack decision. Each personality picks from the two attack slots (a1/a2).
 * Never returns an extinguished slot as long as one usable attack slot exists;
 * the defensive fallback returns 'a1'.
 */
export function decideAttack(view: BoardView, profile: AIProfile, _rng: Rng): AttackDecision {
  const usable = usableAttackSlots(view);
  if (usable.length === 0) return { slot: 'a1', committedElement: view.committedElement };

  const low = isLowHearts(profile, view.hearts);

  switch (profile.personality) {
    case 'AGGRESSIVE':
      return { slot: aggressiveAttackSlot(view, usable), committedElement: view.committedElement };

    case 'DEFENSIVE':
      // Spend the fewest-use ring first; hold high-use rings in reserve.
      return { slot: fewestUsesAttack(usable).key, committedElement: view.committedElement };

    case 'STATUS_HUNTER': {
      // Commit to one TRIANGLE element held in an attack slot, to build its gauge;
      // re-commit only if it can no longer be thrown from a1/a2.
      let committed = view.committedElement;
      let slot = usableSlotForElement(usable, committed);
      if (!slot) {
        slot = pickTriangleAttack(usable) ?? mostUsesAttack(usable);
        committed = TRIANGLE.has(slot.ring.element) ? slot.ring.element : committed;
      }
      return { slot: slot.key, committedElement: committed };
    }

    case 'RESILIENT':
      // Healthy: grind the most-uses attack. Low: borrow Aggressive's unparryable pick.
      return {
        slot: low ? aggressiveAttackSlot(view, usable) : mostUsesAttack(usable).key,
        committedElement: view.committedElement,
      };

    default:
      return { slot: usable[0].key, committedElement: view.committedElement };
  }
}

/** First usable attack slot holding `element` (a usable TRIANGLE element), else null. */
function usableSlotForElement(usable: AttackSlotView[], element: number): AttackSlotView | null {
  if (element < 0) return null;
  return usable.find((s) => s.ring.element === element) ?? null;
}

/** First usable attack slot holding a triangle element (for STATUS_HUNTER commit). */
function pickTriangleAttack(usable: AttackSlotView[]): AttackSlotView | null {
  return usable.find((s) => TRIANGLE.has(s.ring.element)) ?? null;
}

/**
 * Aggressive attack rule: throw an element the opponent cannot STRONG-counter
 * (their counter ring is exhausted/unrevealed-as-usable). If every usable element
 * is counterable, fall back to the most-uses attack slot.
 */
function aggressiveAttackSlot(view: BoardView, usable: AttackSlotView[]): AttackSlot {
  if (view.opponentUsableElements.length > 0) {
    for (const s of usable) {
      const counter = counterOf(s.ring.element); // -1 for WIND/EARTH/fusions (uncounterable)
      if (counter < 0 || !view.opponentUsableElements.includes(counter)) return s.key;
    }
  }
  return mostUsesAttack(usable).key;
}

/**
 * Pure defense decision over d1/d2. Returns the slot to commit and the intended
 * press offset (ms from impact), or {slot:null, pressOffsetMs:null} for a
 * deliberate no-block. The controller adds Gaussian jitter and converts the
 * offset to a wall-clock timer; this function only states the *intent*.
 *
 * Element reasoning uses role-aware resolve('defense'): a STRONG slot vs the
 * incoming element enables a parry→rally; a NEUTRAL slot is a safe catch; WEAK is
 * avoided (loses a heart). Earth defense is always NEUTRAL (safe); Wind defense is
 * always WEAK (avoid).
 */
export function decideDefense(view: BoardView, profile: AIProfile, rng: Rng): DefenseDecision {
  const usable = usableDefenseSlots(view);
  const low = isLowHearts(profile, view.hearts);
  const noBlockProb = low ? profile.lowHeartNoBlockProb : profile.noBlockProb;

  if (usable.length === 0) return { slot: null, pressOffsetMs: null };

  const incoming = view.incomingElement;
  const strong = strongSlot(usable, incoming);

  switch (profile.personality) {
    case 'AGGRESSIVE':
      // Chase the rally: STRONG slot at PARRY timing if available.
      if (strong) return { slot: strong.key, pressOffsetMs: 0 };
      return neutralCatch(usable, incoming);

    case 'DEFENSIVE':
      if (rng.next() < noBlockProb) return { slot: null, pressOffsetMs: null };
      return neutralCatch(usable, incoming);

    case 'STATUS_HUNTER':
      if (rng.next() < noBlockProb) return { slot: null, pressOffsetMs: null };
      return neutralCatch(usable, incoming);

    case 'RESILIENT':
      if (low) {
        if (strong) return { slot: strong.key, pressOffsetMs: 0 };
        return neutralCatch(usable, incoming);
      }
      if (rng.next() < noBlockProb) return { slot: null, pressOffsetMs: null };
      return neutralCatch(usable, incoming);

    default:
      return neutralCatch(usable, incoming);
  }
}

/** First usable defense slot that is STRONG against `incoming` (enables a rally). */
function strongSlot(usable: DefenseSlotView[], incoming: number): DefenseSlotView | null {
  if (incoming < 0) return null;
  return usable.find((s) => resolve(incoming, s.ring.element, 'defense') === 'STRONG') ?? null;
}

/**
 * Pick a NEUTRAL defense slot (safe catch) and press at BLOCK timing so the
 * attacker gets no rally. Avoids WEAK (would cost a heart). Falls back to the
 * fewest-use usable slot when no NEUTRAL slot exists.
 */
function neutralCatch(usable: DefenseSlotView[], incoming: number): DefenseDecision {
  const neutral = usable.filter((s) => resolve(incoming, s.ring.element, 'defense') === 'NEUTRAL');
  const pool = neutral.length > 0 ? neutral : usable;
  let best = pool[0];
  for (const s of pool) if (s.ring.currentUses < best.ring.currentUses) best = s;
  // +190ms: |190| > PARRY_WINDOW(175) but <= BLOCK_WINDOW(200) → BLOCK, not PARRY/MISTIME.
  return { slot: best.key, pressOffsetMs: 190 };
}
