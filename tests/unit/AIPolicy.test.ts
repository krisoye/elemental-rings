import { describe, test, expect } from 'vitest';
import {
  decideAttack,
  decideDefense,
  decideRecharge,
  BoardView,
  AttackSlotView,
  DefenseSlotView,
} from '../../server/src/game/ai/AIPolicy';
import { AI_PROFILES, makeRng } from '../../server/src/game/ai/AIProfiles';
import { counterOf } from '../../server/src/game/ElementSystem';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

function ring(element: number, currentUses = 3, isExtinguished = false, maxUses = 3) {
  return { element, currentUses, maxUses, isExtinguished };
}

/** Default named-slot board: a1=FIRE, a2=WATER, d1=WOOD, d2=EARTH. */
function attackSlots(a1 = FIRE, a2 = WATER): AttackSlotView[] {
  return [
    { key: 'a1', ring: ring(a1) },
    { key: 'a2', ring: ring(a2) },
  ];
}
function defenseSlots(d1 = WOOD, d2 = EARTH): DefenseSlotView[] {
  return [
    { key: 'd1', ring: ring(d1) },
    { key: 'd2', ring: ring(d2) },
  ];
}

function view(overrides: Partial<BoardView> = {}): BoardView {
  return {
    attackSlots: attackSlots(),
    defenseSlots: defenseSlots(),
    hearts: 3,
    incomingElement: -1,
    opponentUsableElements: [],
    committedElement: -1,
    // EPIC #268 — base boards are NOT double-attack-eligible (a base-thumb AI);
    // double-attack tests opt in via overrides.
    canDoubleAttack: false,
    opponentDefenseSlots: [],
    ...overrides,
  };
}

describe('counterOf (triangle counters)', () => {
  test('WATER counters FIRE', () => expect(counterOf(FIRE)).toBe(WATER));
  test('FIRE counters WOOD', () => expect(counterOf(WOOD)).toBe(FIRE));
  test('WOOD counters WATER', () => expect(counterOf(WATER)).toBe(WOOD));
});

describe('decideAttack selects from a1|a2', () => {
  test('Aggressive: picks an attack the opponent cannot strong-counter', () => {
    // Opponent holds only WATER (the counter to FIRE). Aggressive should avoid
    // throwing FIRE (a1) and pick WATER (a2) — WATER's counter is WOOD, not held.
    const a = decideAttack(view({ opponentUsableElements: [WATER] }), AI_PROFILES.AGGRESSIVE, makeRng(7));
    expect(['a1', 'a2']).toContain(a.slot);
    expect(a.slot).toBe('a2'); // WATER attack
  });

  test('Defensive: spends the fewest-use attack slot', () => {
    const v = view({ attackSlots: [{ key: 'a1', ring: ring(FIRE, 1) }, { key: 'a2', ring: ring(WATER, 3) }] });
    const a = decideAttack(v, AI_PROFILES.DEFENSIVE, makeRng(3));
    expect(a.slot).toBe('a1'); // fewest uses
  });

  test('STATUS_HUNTER: commits to a triangle element and repeats it', () => {
    const a1 = decideAttack(view(), AI_PROFILES.STATUS_HUNTER, makeRng(5));
    expect([FIRE, WATER]).toContain(a1.committedElement); // a triangle element it holds
    const slotEl = a1.slot === 'a1' ? FIRE : WATER;
    expect(slotEl).toBe(a1.committedElement);

    // Next turn carries the committed element forward.
    const a2 = decideAttack(view({ committedElement: a1.committedElement }), AI_PROFILES.STATUS_HUNTER, makeRng(99));
    expect(a2.committedElement).toBe(a1.committedElement);
  });

  test('STATUS_HUNTER: re-commits when the committed element is no longer usable', () => {
    // Committed to FIRE but a1 (FIRE) is extinguished; only WATER (a2) usable.
    const v = view({
      attackSlots: [{ key: 'a1', ring: ring(FIRE, 0, true) }, { key: 'a2', ring: ring(WATER, 3) }],
      committedElement: FIRE,
    });
    const a = decideAttack(v, AI_PROFILES.STATUS_HUNTER, makeRng(5));
    expect(a.slot).toBe('a2');
    expect(a.committedElement).toBe(WATER);
  });

  test('RESILIENT healthy: most-uses attack slot', () => {
    const v = view({ attackSlots: [{ key: 'a1', ring: ring(FIRE, 1) }, { key: 'a2', ring: ring(WATER, 3) }] });
    const a = decideAttack(v, AI_PROFILES.RESILIENT, makeRng(2));
    expect(a.slot).toBe('a2'); // most uses
  });

  test('RESILIENT low-heart: borrows the unparryable Aggressive pick', () => {
    const a = decideAttack(
      view({ hearts: 1, opponentUsableElements: [WATER] }),
      AI_PROFILES.RESILIENT,
      makeRng(8),
    );
    expect(a.slot).toBe('a2'); // avoid FIRE (counter WATER is held)
  });

  test('fallback: no usable attack slot → a1', () => {
    const v = view({
      attackSlots: [{ key: 'a1', ring: ring(FIRE, 0, true) }, { key: 'a2', ring: ring(WATER, 0, true) }],
    });
    const a = decideAttack(v, AI_PROFILES.AGGRESSIVE, makeRng(1));
    expect(a.slot).toBe('a1');
  });
});

describe('decideDefense selects from d1|d2', () => {
  test('Aggressive: STRONG defense slot at PARRY timing when available', () => {
    // Incoming WATER; WOOD (d1) beats WATER → STRONG. PARRY timing (offset 0).
    const d = decideDefense(view({ incomingElement: WATER }), AI_PROFILES.AGGRESSIVE, makeRng(1));
    expect(d.slot).toBe('d1'); // WOOD
    expect(d.pressOffsetMs).toBe(0);
  });

  test('Aggressive: no STRONG slot → safe NEUTRAL catch at BLOCK timing', () => {
    // Incoming FIRE; d1=WOOD (WEAK), d2=EARTH (NEUTRAL). Picks EARTH at BLOCK.
    const d = decideDefense(view({ incomingElement: FIRE }), AI_PROFILES.AGGRESSIVE, makeRng(1));
    expect(d.slot).toBe('d2'); // EARTH neutral
    expect(d.pressOffsetMs).toBe(190);
  });

  test('Earth defense is always a safe NEUTRAL catch (never WEAK)', () => {
    // Whatever the incoming triangle element, EARTH (d2) is a valid neutral catch.
    const d = decideDefense(view({ incomingElement: WOOD }), AI_PROFILES.AGGRESSIVE, makeRng(1));
    // WOOD incoming: d1=WOOD NEUTRAL (same), d2=EARTH NEUTRAL. No STRONG → neutral catch.
    expect(['d1', 'd2']).toContain(d.slot);
    expect(d.pressOffsetMs).toBe(190);
  });

  test('avoids WIND defense (always WEAK)', () => {
    // d1=WIND (WEAK), d2=EARTH (NEUTRAL). Must pick EARTH.
    const v = view({ defenseSlots: defenseSlots(WIND, EARTH), incomingElement: FIRE });
    const d = decideDefense(v, AI_PROFILES.AGGRESSIVE, makeRng(1));
    expect(d.slot).toBe('d2'); // EARTH, not WIND
  });

  test('Defensive: never the STRONG slot when it catches (reserves rally), uses BLOCK timing', () => {
    const d = decideDefense(view({ incomingElement: WATER }), AI_PROFILES.DEFENSIVE, makeRng(2));
    if (d.slot === null) {
      expect(d.pressOffsetMs).toBeNull(); // deliberate no-block is valid for Defensive
    } else {
      // WOOD (d1) is STRONG vs WATER; Defensive should take the NEUTRAL EARTH (d2).
      expect(d.slot).toBe('d2');
      expect(d.pressOffsetMs).toBe(190);
    }
  });

  test('Defensive: sometimes deliberately no-blocks across seeds', () => {
    let noBlocks = 0;
    for (let s = 0; s < 200; s++) {
      const d = decideDefense(view({ incomingElement: FIRE }), AI_PROFILES.DEFENSIVE, makeRng(s));
      if (d.slot === null) noBlocks++;
    }
    expect(noBlocks).toBeGreaterThan(0);
    expect(noBlocks).toBeLessThan(200);
  });

  test('no usable defense slot → deliberate no-block', () => {
    const v = view({
      defenseSlots: [{ key: 'd1', ring: ring(WOOD, 0, true) }, { key: 'd2', ring: ring(EARTH, 0, true) }],
      incomingElement: FIRE,
    });
    const d = decideDefense(v, AI_PROFILES.AGGRESSIVE, makeRng(1));
    expect(d.slot).toBeNull();
    expect(d.pressOffsetMs).toBeNull();
  });
});

describe('RESILIENT sharpens at low hearts', () => {
  test('healthy frequently no-blocks; low-heart commits the STRONG slot', () => {
    let healthyNoBlocks = 0;
    for (let s = 0; s < 200; s++) {
      const d = decideDefense(view({ incomingElement: WATER, hearts: 3 }), AI_PROFILES.RESILIENT, makeRng(s));
      if (d.slot === null) healthyNoBlocks++;
    }
    expect(healthyNoBlocks).toBeGreaterThan(0);

    for (let s = 0; s < 50; s++) {
      const d = decideDefense(view({ incomingElement: WATER, hearts: 1 }), AI_PROFILES.RESILIENT, makeRng(s));
      expect(d.slot).toBe('d1'); // WOOD — STRONG parry vs WATER
      expect(d.pressOffsetMs).toBe(0);
    }
  });
});

describe('decideRecharge (#197)', () => {
  // Both attack rings spent → must recharge, never null, for every personality.
  test('both attack rings spent → forced recharge (never null) for all personalities', () => {
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(FIRE, 0, true) },
        { key: 'a2', ring: ring(WATER, 0, true) },
      ],
    });
    for (const p of Object.values(AI_PROFILES)) {
      const d = decideRecharge(v, p);
      expect(d).not.toBeNull();
      expect(['a1', 'a2']).toContain(d!.slot);
    }
  });

  test('forced recharge picks the MOST-depleted attack slot', () => {
    // a1 missing 1 use (maxUses 3, current 2 — but extinguished only at 0). Make
    // both spent but with different maxUses so depletion differs.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(FIRE, 0, true, 2) }, // depletion 2
        { key: 'a2', ring: ring(WATER, 0, true, 5) }, // depletion 5 (most)
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.AGGRESSIVE)!.slot).toBe('a2');
  });

  test('attack available → null (attack normally) when defense is healthy', () => {
    for (const p of Object.values(AI_PROFILES)) {
      expect(decideRecharge(view(), p)).toBeNull();
    }
  });

  test('AGGRESSIVE never recharges defense even when both d-slots are spent', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true) },
        { key: 'd2', ring: ring(EARTH, 0, true) },
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.AGGRESSIVE)).toBeNull();
  });

  test('STATUS_HUNTER never recharges defense even when both d-slots are spent', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true) },
        { key: 'd2', ring: ring(EARTH, 0, true) },
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.STATUS_HUNTER)).toBeNull();
  });

  test('DEFENSIVE recharges a depleted defense ring (more-depleted first)', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true, 3) }, // depletion 3
        { key: 'd2', ring: ring(EARTH, 0, true, 5) }, // depletion 5 (most)
      ],
    });
    const d = decideRecharge(v, AI_PROFILES.DEFENSIVE);
    expect(d).not.toBeNull();
    expect(d!.slot).toBe('d2');
  });

  test('DEFENSIVE: one depleted defense ring → recharges it', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true) },
        { key: 'd2', ring: ring(EARTH, 3) },
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.DEFENSIVE)!.slot).toBe('d1');
  });

  test('RESILIENT recharges the more-depleted depleted defense ring', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true, 5) }, // depletion 5 (most)
        { key: 'd2', ring: ring(EARTH, 0, true, 3) }, // depletion 3
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.RESILIENT)!.slot).toBe('d1');
  });

  test('defense merely low (not at 0) does not trigger a defense recharge', () => {
    const v = view({
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 1) }, // low but usable
        { key: 'd2', ring: ring(EARTH, 1) },
      ],
    });
    expect(decideRecharge(v, AI_PROFILES.DEFENSIVE)).toBeNull();
    expect(decideRecharge(v, AI_PROFILES.RESILIENT)).toBeNull();
  });

  test('forced attack recharge takes priority over defense recharge', () => {
    // Both attack AND both defense rings spent → DEFENSIVE still recharges attack.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(FIRE, 0, true) },
        { key: 'a2', ring: ring(WATER, 0, true) },
      ],
      defenseSlots: [
        { key: 'd1', ring: ring(WOOD, 0, true) },
        { key: 'd2', ring: ring(EARTH, 0, true) },
      ],
    });
    const d = decideRecharge(v, AI_PROFILES.DEFENSIVE);
    expect(['a1', 'a2']).toContain(d!.slot);
  });
});

describe('determinism', () => {
  test('same seed → identical attack and defense decisions', () => {
    const p = AI_PROFILES.DEFENSIVE;
    expect(decideAttack(view(), p, makeRng(42))).toEqual(decideAttack(view(), p, makeRng(42)));
    expect(decideDefense(view({ incomingElement: FIRE }), p, makeRng(42))).toEqual(
      decideDefense(view({ incomingElement: FIRE }), p, makeRng(42)),
    );
  });
});

// ── EPIC #268 — AI double-attack OFFENSE policy ─────────────────────────────
// decideAttack upgrades a single throw to a fusion-thumb double attack only when
// (a) the board is double-attack-eligible (view.canDoubleAttack — set by the
// controller from the authoritative canDoubleAttack predicate) AND (b) the combo
// is favorable (the defender cannot PARRY orb 1). Deterministic — no RNG branch.
describe('decideAttack double-attack (EPIC #268)', () => {
  /** Opponent defense pair as DefenseSlotView[] (for the favorability check). */
  function oppDef(d1: number, d2: number, d1Uses = 3, d2Uses = 3): DefenseSlotView[] {
    return [
      { key: 'd1', ring: ring(d1, d1Uses, d1Uses === 0) },
      { key: 'd2', ring: ring(d2, d2Uses, d2Uses === 0) },
    ];
  }

  test('eligible + favorable (defender cannot parry orb 1) → double attack, gap clamped', () => {
    // Eligible MUD hand: a1=WATER, a2=EARTH (EARTH is uncounterable → never
    // parryable). Defender holds WOOD (STRONG vs WATER) + EARTH, so orb 1 must be
    // the unparryable EARTH (a2); WATER (a1) becomes orb 2.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(WATER) },
        { key: 'a2', ring: ring(EARTH) },
      ],
      canDoubleAttack: true,
      opponentDefenseSlots: oppDef(WOOD, EARTH),
    });
    const d = decideAttack(v, AI_PROFILES.RESILIENT, makeRng(7));
    expect(d.double).toBeDefined();
    expect(d.double!.first).toBe('a2'); // unparryable EARTH fires first
    expect(d.double!.second).toBe('a1'); // WATER second
    // Gap is drawn from the profile and clamped to the engine window.
    expect(d.double!.gapMs).toBeGreaterThanOrEqual(200); // MIN_COMBO_GAP_MS
    expect(d.double!.gapMs).toBeLessThanOrEqual(600); // MAX_COMBO_GAP_MS
  });

  test('eligible but UNFAVORABLE (defender can parry BOTH A-slot elements) → single attack', () => {
    // Construct an eligible-but-fully-counterable hand: a1=FIRE, a2=WATER (both
    // triangle). Defender holds WATER (STRONG vs FIRE) and WOOD (STRONG vs WATER)
    // with uses → either orb could be parried-and-cancelled → take the safe single.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(FIRE) },
        { key: 'a2', ring: ring(WATER) },
      ],
      canDoubleAttack: true,
      opponentDefenseSlots: oppDef(WATER, WOOD),
    });
    const d = decideAttack(v, AI_PROFILES.RESILIENT, makeRng(7));
    expect(d.double).toBeUndefined(); // declined — single attack
    expect(['a1', 'a2']).toContain(d.slot);
  });

  test('unfavorable becomes favorable once the defender PARRY counter is extinguished', () => {
    // Same FIRE/WATER eligible hand, but the WOOD ring (the WATER-counter) is spent
    // (0 uses → extinguished). Now WATER (a2) is unparryable → favorable; it fires
    // first, FIRE (a1) second.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(FIRE) },
        { key: 'a2', ring: ring(WATER) },
      ],
      canDoubleAttack: true,
      opponentDefenseSlots: oppDef(WATER, WOOD, 3, 0), // WOOD counter extinguished
    });
    const d = decideAttack(v, AI_PROFILES.RESILIENT, makeRng(7));
    expect(d.double).toBeDefined();
    expect(d.double!.first).toBe('a2'); // unparryable WATER first
    expect(d.double!.second).toBe('a1');
  });

  test('NOT eligible (base-thumb AI: canDoubleAttack=false) → never doubles', () => {
    // Even with an unparryable, favorable board, a non-eligible hand single-attacks.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(WATER) },
        { key: 'a2', ring: ring(EARTH) },
      ],
      canDoubleAttack: false, // base thumb — predicate failed on the controller side
      opponentDefenseSlots: oppDef(EARTH, EARTH),
    });
    for (const p of [AI_PROFILES.AGGRESSIVE, AI_PROFILES.DEFENSIVE, AI_PROFILES.RESILIENT]) {
      const d = decideAttack(v, p, makeRng(3));
      expect(d.double).toBeUndefined();
    }
  });

  test('eligible but an A-slot is spent (< 2 usable) → single attack (no combo)', () => {
    // a2 EARTH is extinguished → only one usable attack slot → cannot combo.
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(WATER) },
        { key: 'a2', ring: ring(EARTH, 0, true) },
      ],
      canDoubleAttack: true, // (a stale flag; the policy still guards on usable count)
      opponentDefenseSlots: oppDef(EARTH, EARTH),
    });
    const d = decideAttack(v, AI_PROFILES.RESILIENT, makeRng(7));
    expect(d.double).toBeUndefined();
    expect(d.slot).toBe('a1'); // the only usable attack
  });

  test('double-attack decision is deterministic for a fixed seed', () => {
    const v = view({
      attackSlots: [
        { key: 'a1', ring: ring(WATER) },
        { key: 'a2', ring: ring(EARTH) },
      ],
      canDoubleAttack: true,
      opponentDefenseSlots: oppDef(WOOD, EARTH),
    });
    expect(decideAttack(v, AI_PROFILES.RESILIENT, makeRng(99))).toEqual(
      decideAttack(v, AI_PROFILES.RESILIENT, makeRng(99)),
    );
  });
});
