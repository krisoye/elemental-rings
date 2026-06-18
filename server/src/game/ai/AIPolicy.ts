import { counterOf, resolve } from '../ElementSystem';
import { TRIANGLE } from '../Fusions';
import { AttackSlot, DefenseSlot } from '../../../../shared/types';
import { AIProfile, Rng, isLowHearts } from './AIProfiles';
import { MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS } from '../constants';

/** Read-only snapshot of one ring in a slot. */
export interface RingView {
  element: number;
  currentUses: number;
  maxUses: number;
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
  /**
   * EPIC #268 — true when THIS AI's hand satisfies the server `canDoubleAttack`
   * predicate (a fused thumb whose A1/A2 are its two components, all three rings
   * lit). Computed by the controller from the authoritative PlayerState; the pure
   * policy only reads it. False for every base-thumb AI, so non-boss AI can never
   * double-attack (the `decideAttack` double branch is gated on this flag).
   */
  canDoubleAttack: boolean;
  /**
   * EPIC #268 — read-only views of the OPPONENT's defense rings (d1/d2), so the
   * policy can judge whether a double attack is favorable: if the defender holds no
   * usable ring STRONG against orb 1's element, an orb-1 parry (which would cancel
   * orb 2 and flip the turn) is impossible — a safe combo. Empty when the opponent
   * is not yet seated (defensive; the controller always populates it in a duel).
   */
  opponentDefenseSlots: DefenseSlotView[];
  /** Remaining NPC spirit pool. 0 means no more recharges available; attacks exhausted + spirit 0 → forfeit. */
  spirit: number;
}

/** EPIC #268 — a fusion-thumb double-attack: orb `first` fires, then `second` after `gapMs`. */
export interface DoubleAttackDecision {
  first: AttackSlot;
  second: AttackSlot;
  /** Held-gap (ms) between the two orbs; the server re-clamps to [MIN,MAX]_COMBO_GAP_MS. */
  gapMs: number;
}

export interface AttackDecision {
  slot: AttackSlot;
  /** The element STATUS_HUNTER committed to (so the controller can persist it). */
  committedElement: number;
  /**
   * EPIC #268 — when set, the AI commits a fusion-thumb DOUBLE attack instead of a
   * single throw from `slot`. Only ever set when `view.canDoubleAttack` and the
   * policy judges the combo favorable; otherwise undefined (normal single attack).
   * The controller dispatches `handleSelectDoubleAttack` when this is present.
   */
  double?: DoubleAttackDecision;
  /** #493 — when set, the AI throws a charged attack on this slot. */
  charge?: { targetSweep: 1 | 2 | 3 };
}

export interface DefenseDecision {
  /** The defense slot to commit, or null for a deliberate no-block. */
  slot: DefenseSlot | null;
  /** Intended press offset from impact in ms, or null for a deliberate no-block. */
  pressOffsetMs: number | null;
}

/** A turn-consuming recharge action: restore uses to one combat slot (a1/a2/d1/d2). */
export interface RechargeDecision {
  slot: AttackSlot | DefenseSlot;
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
 * #492 — Pick a usable attack slot that is SUBOPTIMAL against the opponent
 * (WEAK or NEUTRAL). Used when elementMistakeProb fires to simulate an AI
 * picking the wrong element. If every usable slot is optimal (no weak/neutral
 * alternative found) fall back to the first usable slot so we always return.
 */
function suboptimalAttackSlot(
  usable: AttackSlotView[],
  opponentUsableElements: number[],
): AttackSlot {
  // Prefer a slot the opponent can STRONG-counter (WEAK for the AI = poor choice).
  for (const s of usable) {
    const counter = counterOf(s.ring.element);
    if (counter >= 0 && opponentUsableElements.includes(counter)) return s.key;
  }
  // Fall back to the last usable slot (at minimum different order from optimal).
  return usable[usable.length - 1].key;
}

/**
 * #492 — Pick a usable defense slot that is WEAK against the incoming element
 * (a poor/incorrect choice). Used when elementMistakeProb fires. Falls back to
 * the first usable slot when no genuinely WEAK slot is available.
 */
function weakDefenseSlot(
  usable: DefenseSlotView[],
  incoming: number,
): DefenseSlotView {
  for (const s of usable) {
    if (incoming >= 0 && resolve(incoming, s.ring.element, 'defense') === 'WEAK') return s;
  }
  // If no slot is outright WEAK, return the last one (suboptimal ordering).
  return usable[usable.length - 1];
}

/**
 * Pure attack decision. Computes the per-personality single-attack pick, then —
 * when this AI's hand is double-attack-eligible (a boss fused thumb; `view.
 * canDoubleAttack`) AND a combo is favorable — upgrades it to a fusion-thumb
 * double attack via `maybeDoubleAttack`. Non-eligible (base-thumb) AI never
 * double-attacks: `view.canDoubleAttack` is false, so the upgrade is skipped and
 * behaviour is identical to before EPIC #268.
 *
 * Never returns an extinguished slot as long as one usable attack slot exists;
 * the defensive fallback returns 'a1'.
 */
export function decideAttack(view: BoardView, profile: AIProfile, rng: Rng): AttackDecision {
  // #493 — charge branch: outermost gate, skips double-attack path entirely.
  // Guard on > 0 avoids consuming an RNG draw for non-charging personas (prob=0).
  // Fast path on >= 1.0 avoids an unnecessary draw for always-charging personas
  // (e.g. AGGRESSIVE) so the RNG stream stays consistent regardless of prob value.
  const low = isLowHearts(profile, view.hearts);
  const chargeProb = low && profile.lowHeartChargeAttemptProb !== undefined
    ? profile.lowHeartChargeAttemptProb
    : profile.chargeAttemptProb;
  if (chargeProb > 0 && (chargeProb >= 1.0 || rng.next() < chargeProb)) {
    const single = singleAttackDecision(view, profile, rng);
    const targetSweep = low && profile.lowHeartTargetSweep !== undefined
      ? profile.lowHeartTargetSweep
      : profile.targetSweep;
    return { ...single, charge: { targetSweep } };
  }

  const single = singleAttackDecision(view, profile, rng);

  // EPIC #268 — fusion-thumb double attack. Only eligible bosses reach this; a
  // base-thumb AI has view.canDoubleAttack === false and falls straight through to
  // the single attack (an explicit guard so non-boss AI can never combo).
  if (view.canDoubleAttack) {
    const double = maybeDoubleAttack(view, profile, rng);
    if (double) return { ...single, double };
  }
  return single;
}

/**
 * Per-personality single-attack pick over a1/a2 (the pre-EPIC-#268 behaviour).
 * Never returns an extinguished slot as long as one usable attack slot exists;
 * the defensive fallback returns 'a1'.
 *
 * #492 — when elementMistakeProb fires, skips the personality pick and instead
 * chooses a suboptimal (WEAK or NEUTRAL) slot so higher-tier / higher-skill
 * opponents make fewer mistakes.
 */
function singleAttackDecision(view: BoardView, profile: AIProfile, rng: Rng): AttackDecision {
  const usable = usableAttackSlots(view);
  if (usable.length === 0) return { slot: 'a1', committedElement: view.committedElement };

  // #492 — element-mistake branch: before personality logic, check if the AI
  // should pick a suboptimal ring this turn. Guard on > 0 so NPCs scaled to
  // elementMistakeProb=0 by scaleProfileByTier never consume an extra RNG draw,
  // preserving the pre-#492 RNG stream for personality and timing draws.
  if (profile.elementMistakeProb > 0 && rng.next() < profile.elementMistakeProb) {
    return {
      slot: suboptimalAttackSlot(usable, view.opponentUsableElements),
      committedElement: view.committedElement,
    };
  }

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

/**
 * EPIC #268 — decide whether to upgrade a single attack to a fusion-thumb DOUBLE
 * attack, and if so order the two orbs. Returns the combo decision, or null to
 * keep the single attack. Deterministic (no RNG branch) — the rng only seeds the
 * gap pick, so the same board always reaches the same favorable/unfavorable call.
 *
 * Eligibility is the caller's gate (`view.canDoubleAttack`); here we only judge
 * FAVORABILITY and the orb order:
 *  - Both attack slots must be usable (lit, >0 uses). `canDoubleAttack` already
 *    guarantees this, but we re-check defensively so the policy stands alone.
 *  - Favorable when the defender cannot PARRY orb 1 — i.e. at least one A-slot
 *    element has no usable opponent defense ring STRONG against it. Firing that
 *    "unparryable-first" orb removes the parry-cancel-and-flip risk (EPIC #264:
 *    an orb-1 PARRY cancels orb 2 and hands the turn to the defender). The other
 *    A-slot becomes the second orb.
 *  - Unfavorable (defender can parry BOTH A-slot elements with a usable, STRONG
 *    ring) → null: take the safe single attack and avoid gifting a turn.
 */
function maybeDoubleAttack(
  view: BoardView,
  profile: AIProfile,
  rng: Rng,
): DoubleAttackDecision | null {
  const usable = usableAttackSlots(view);
  if (usable.length < 2) return null; // need both A-slots lit for a combo

  // Order orbs so the UNPARRYABLE one fires first (defender can't parry-cancel it).
  const safeFirst = usable.find((s) => !defenderCanParry(view, s.ring.element));
  if (!safeFirst) return null; // defender can parry either orb → unfavorable, single-attack

  const second = usable.find((s) => s.key !== safeFirst.key)!;
  return { first: safeFirst.key, second: second.key, gapMs: pickComboGap(profile, rng) };
}

/**
 * True when the opponent holds a usable defense ring that is STRONG against
 * `orbElement` (role-aware) — i.e. they could PARRY an orb of that element and
 * start a rally. WIND attacks (and fusion components that resolve NEUTRAL) are
 * never parryable, so an uncounterable orb returns false here.
 */
function defenderCanParry(view: BoardView, orbElement: number): boolean {
  return view.opponentDefenseSlots.some(
    (s) =>
      !s.ring.isExtinguished &&
      s.ring.currentUses > 0 &&
      resolve(orbElement, s.ring.element, 'defense') === 'STRONG',
  );
}

/**
 * Draw the double-attack gap (ms) from the profile's [comboGapMinMs, comboGapMaxMs]
 * window and clamp to the engine's [MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS]. Bosses set
 * a tight window (BattleRoom.buildBossProfile), so they pick fast combos; the
 * server re-clamps the value regardless of what the policy emits.
 */
function pickComboGap(profile: AIProfile, rng: Rng): number {
  const lo = Math.min(profile.comboGapMinMs, profile.comboGapMaxMs);
  const hi = Math.max(profile.comboGapMinMs, profile.comboGapMaxMs);
  const drawn = rng.intBetween(lo, hi);
  return Math.min(MAX_COMBO_GAP_MS, Math.max(MIN_COMBO_GAP_MS, drawn));
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

/** Uses missing from a slot's ring (how much a full recharge would restore). */
function depletion(slot: AttackSlotView | DefenseSlotView): number {
  return Math.max(0, slot.ring.maxUses - slot.ring.currentUses);
}

/** True when a slot's ring is fully spent (no uses left). */
function isSlotDepleted(slot: AttackSlotView | DefenseSlotView): boolean {
  return slot.ring.isExtinguished || slot.ring.currentUses <= 0;
}

/** The slot with the highest depletion (most uses missing); ties → first in order. */
function mostDepleted<T extends AttackSlotView | DefenseSlotView>(slots: T[]): T {
  let best = slots[0];
  for (const s of slots) if (depletion(s) > depletion(best)) best = s;
  return best;
}

/**
 * Pure recharge decision, evaluated before decideAttack(). Returns the combat
 * slot to recharge (consuming the turn), or null to attack normally / forfeit instead.
 *
 * Priority:
 *   1. Both attack rings spent AND spirit > 0 → MUST recharge the most-depleted attack slot.
 *   1a. Both attack rings spent AND spirit = 0 → return null; caller (scheduleAttack) forfeits.
 *   2. Attack rings available but a defense ring is at 0 uses → personality-gated:
 *      AGGRESSIVE / STATUS_HUNTER never sacrifice an attack turn for defense;
 *      DEFENSIVE recharges a defense ring if either d-slot is at 0;
 *      RESILIENT recharges the more-depleted defense ring if either is at 0.
 *      Defense recharge is also skipped when spirit = 0.
 *   3. Otherwise → null (attack normally).
 */
export function decideRecharge(view: BoardView, profile: AIProfile): RechargeDecision | null {
  const attackSpent = view.attackSlots.every(isSlotDepleted);
  if (attackSpent) {
    // Spirit depleted: cannot recharge. Caller detects no usable attacks → forfeit.
    if (view.spirit <= 0) return null;
    // Forced recharge: pick the attack slot missing the most uses.
    return { slot: mostDepleted(view.attackSlots).key };
  }

  // No spirit left — skip optional defense recharges too.
  if (view.spirit <= 0) return null;

  // Attack rings are available — defense recharge is a personality choice.
  const depletedDefense = view.defenseSlots.filter(isSlotDepleted);
  if (depletedDefense.length === 0) return null;

  switch (profile.personality) {
    case 'DEFENSIVE':
      // Restore whichever depleted defense ring is more depleted.
      return { slot: mostDepleted(depletedDefense).key };

    case 'RESILIENT':
      // Balanced posture: recharge a depleted defense ring (more-depleted first).
      return { slot: mostDepleted(depletedDefense).key };

    case 'AGGRESSIVE':
    case 'STATUS_HUNTER':
    default:
      // Never trade an attack turn for defense; keep up the pressure.
      return null;
  }
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

  // #492 — element-mistake branch: before personality logic, check if the AI
  // should pick a suboptimal defense ring this turn. +190ms = BLOCK timing so
  // the defender still commits (not a no-block) but with the wrong element.
  // Guard on > 0 so NPCs with elementMistakeProb=0 never consume an extra RNG
  // draw, preserving the RNG stream for personality logic and no-block draws.
  if (profile.elementMistakeProb > 0 && rng.next() < profile.elementMistakeProb) {
    const weak = weakDefenseSlot(usable, incoming);
    return { slot: weak.key, pressOffsetMs: 190 };
  }

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
