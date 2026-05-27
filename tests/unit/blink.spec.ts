import { describe, test, expect } from 'vitest';
import { blinkCost, BLINK_MIN_COST, BLINK_PX_PER_SPIRIT } from '../../shared/blink';

// ---------------------------------------------------------------------------
// blinkCost — short-range blink spirit cost (#87 Part A). Cost is the distance
// divided by BLINK_PX_PER_SPIRIT, rounded up, floored at BLINK_MIN_COST.
// ---------------------------------------------------------------------------

describe('blinkCost — distance → spirit', () => {
  test('a near-zero blink costs the minimum', () => {
    expect(blinkCost(0)).toBe(BLINK_MIN_COST);
    expect(blinkCost(1)).toBe(BLINK_MIN_COST);
    expect(blinkCost(BLINK_PX_PER_SPIRIT)).toBe(1); // exactly 100px → 1
  });

  test('cost rounds up per BLINK_PX_PER_SPIRIT band', () => {
    expect(blinkCost(101)).toBe(2);
    expect(blinkCost(200)).toBe(2);
    expect(blinkCost(300)).toBe(3); // the spec's reference 300px → 3
    expect(blinkCost(550)).toBe(6);
  });

  test('a negative or non-finite distance clamps to the minimum', () => {
    expect(blinkCost(-50)).toBe(BLINK_MIN_COST);
    expect(blinkCost(Number.NaN)).toBe(BLINK_MIN_COST);
    expect(blinkCost(Infinity)).toBe(BLINK_MIN_COST);
  });
});
