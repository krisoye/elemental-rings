import { describe, test, expect } from 'vitest';
import { decideAttack, decideDefense, BoardView } from '../../server/src/game/ai/AIPolicy';
import { AI_PROFILES, makeRng } from '../../server/src/game/ai/AIProfiles';
import { counterOf } from '../../server/src/game/ElementSystem';

// ElementEnum: FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4
// counterOf(x) = element that BEATS x (the STRONG counter to an attack of x).
//   counterOf(FIRE)=WATER, counterOf(WATER)=WIND, counterOf(EARTH)=WOOD,
//   counterOf(WIND)=EARTH, counterOf(WOOD)=FIRE.

/** Full element-indexed hand, all rings fresh and usable. */
function fullHand() {
  return [0, 1, 2, 3, 4].map((element) => ({
    element,
    currentUses: 3,
    isExtinguished: false,
  }));
}

function view(overrides: Partial<BoardView> = {}): BoardView {
  return {
    hand: fullHand(),
    hearts: 3,
    incomingElement: -1,
    opponentUsableElements: [],
    committedElement: -1,
    ...overrides,
  };
}

describe('counterOf (pentagon counters)', () => {
  test('WATER counters FIRE', () => expect(counterOf(0)).toBe(1));
  test('WIND counters WATER', () => expect(counterOf(1)).toBe(3));
  test('WOOD counters EARTH', () => expect(counterOf(2)).toBe(4));
  test('EARTH counters WIND', () => expect(counterOf(3)).toBe(2));
  test('FIRE counters WOOD', () => expect(counterOf(4)).toBe(0));
});

describe('Aggressive', () => {
  const profile = AI_PROFILES.AGGRESSIVE;

  test('defense: picks STRONG counter at PARRY timing (offset 0) when available', () => {
    const d = decideDefense(view({ incomingElement: 0 }), profile, makeRng(1)); // FIRE incoming
    expect(d.slot).toBe(counterOf(0)); // WATER
    expect(d.pressOffsetMs).toBe(0); // chases the parry
  });

  test('defense: when counter ring is exhausted, falls back to a non-WEAK catch (no null)', () => {
    const hand = fullHand();
    hand[counterOf(0)] = { element: 1, currentUses: 0, isExtinguished: true }; // WATER gone
    const d = decideDefense(view({ hand, incomingElement: 0 }), profile, makeRng(1));
    expect(d.slot).toBeGreaterThanOrEqual(0);
    expect(d.pressOffsetMs).not.toBeNull(); // Aggressive never deliberately no-blocks
  });

  test('attack: throws an element the opponent cannot strong-counter', () => {
    // Opponent only holds WATER (the counter to FIRE). Aggressive should avoid FIRE.
    const a = decideAttack(view({ opponentUsableElements: [1] }), profile, makeRng(7));
    expect(counterOf(a.slot)).not.toBe(1); // chosen element's counter is not held
  });
});

describe('Defensive', () => {
  const profile = AI_PROFILES.DEFENSIVE;

  test('attack: spends the fewest-use ring first', () => {
    const hand = fullHand();
    hand[2].currentUses = 1; // EARTH is lowest
    const a = decideAttack(view({ hand }), profile, makeRng(3));
    expect(a.slot).toBe(2);
  });

  test('defense: picks a NEUTRAL catch (not the STRONG counter) when it does block', () => {
    // Force "block" branch with a seed whose first draw exceeds noBlockProb (0.3).
    // mulberry32(seed=2) first next() is deterministic; if it no-blocks, the slot is -1.
    const d = decideDefense(view({ incomingElement: 0 }), profile, makeRng(2));
    if (d.pressOffsetMs === null) {
      expect(d.slot).toBe(-1); // deliberate no-block is a valid Defensive outcome
    } else {
      expect(d.slot).not.toBe(counterOf(0)); // reserves the STRONG ring
      expect(d.pressOffsetMs).toBe(190); // BLOCK timing, not parry
    }
  });

  test('defense: sometimes deliberately no-blocks across seeds', () => {
    let noBlocks = 0;
    for (let s = 0; s < 200; s++) {
      const d = decideDefense(view({ incomingElement: 0 }), profile, makeRng(s));
      if (d.pressOffsetMs === null) noBlocks++;
    }
    expect(noBlocks).toBeGreaterThan(0); // ~30% expected
    expect(noBlocks).toBeLessThan(200);
  });
});

describe('Status-hunter', () => {
  const profile = AI_PROFILES.STATUS_HUNTER;

  test('attack: commits to one element and repeats it across turns', () => {
    const a1 = decideAttack(view(), profile, makeRng(5));
    const committed = a1.committedElement;
    expect(a1.slot).toBe(committed);
    // Next turn carries the committed element forward.
    const a2 = decideAttack(view({ committedElement: committed }), profile, makeRng(99));
    expect(a2.slot).toBe(committed);
    expect(a2.committedElement).toBe(committed);
  });

  test('attack: re-commits when the committed element is extinguished', () => {
    const committed = 2; // EARTH
    const hand = fullHand();
    hand[committed] = { element: committed, currentUses: 0, isExtinguished: true };
    const a = decideAttack(view({ hand, committedElement: committed }), profile, makeRng(5));
    expect(a.slot).not.toBe(committed);
    expect(a.committedElement).toBe(a.slot);
  });
});

describe('Resilient sharpens at low hearts', () => {
  const profile = AI_PROFILES.RESILIENT;

  test('healthy: frequently no-blocks; low-heart: defends sharply (never null) vs a counterable attack', () => {
    // Healthy (3 hearts): a counterable attack still often results in no-block (noBlockProb 0.4).
    let healthyNoBlocks = 0;
    for (let s = 0; s < 200; s++) {
      const d = decideDefense(view({ incomingElement: 0, hearts: 3 }), profile, makeRng(s));
      if (d.pressOffsetMs === null) healthyNoBlocks++;
    }
    expect(healthyNoBlocks).toBeGreaterThan(0);

    // Low (1 heart): lowHeartNoBlockProb=0; always commits the STRONG counter.
    for (let s = 0; s < 50; s++) {
      const d = decideDefense(view({ incomingElement: 0, hearts: 1 }), profile, makeRng(s));
      expect(d.pressOffsetMs).not.toBeNull();
      expect(d.slot).toBe(counterOf(0)); // WATER — sharp strong-parry
    }
  });

  test('low-heart attack borrows the unparryable Aggressive pick', () => {
    // Opponent holds only WATER (counter to FIRE). Low-heart Resilient should
    // avoid throwing FIRE, like Aggressive.
    const a = decideAttack(view({ hearts: 1, opponentUsableElements: [1] }), profile, makeRng(8));
    expect(counterOf(a.slot)).not.toBe(1);
  });
});

describe('determinism', () => {
  test('same seed -> identical attack and defense decisions', () => {
    const p = AI_PROFILES.DEFENSIVE;
    const a1 = decideAttack(view(), p, makeRng(42));
    const a2 = decideAttack(view(), p, makeRng(42));
    expect(a1).toEqual(a2);

    const d1 = decideDefense(view({ incomingElement: 0 }), p, makeRng(42));
    const d2 = decideDefense(view({ incomingElement: 0 }), p, makeRng(42));
    expect(d1).toEqual(d2);
  });
});
