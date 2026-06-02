/**
 * #260 — boss status-gauge pressure. The gauge MULTIPLIER is applied in BattleRoom
 * when the boss AI lands an uncontested hit (per orb). BlockResolver itself stays
 * element-pure (it never knows about bosses), so its hitGaugeElements output is the
 * unscaled base — the multiplier is layered on top in the room. These unit tests
 * pin both halves of that contract:
 *   1. BlockResolver emits the unscaled base gauge directives (regression).
 *   2. BOSS_MODIFIERS.gaugeFillMult is the data-driven per-tier multiplier, and
 *      base × mult yields the expected credited gauge (per orb).
 */
import { describe, test, expect } from 'vitest';
import { resolveBlock } from '../../server/src/game/BlockResolver';
import { BOSS_MODIFIERS } from '../../server/src/game/constants';
import { ElementEnum } from '../../shared/types';

/** Minimal Ring stub matching the BlockResolver structural Ring shape. */
function ring(element: number, currentUses = 3, xp = 0) {
  return {
    element,
    tier: 1,
    currentUses,
    maxUses: 3,
    xp,
    isExtinguished: false,
    isFusion: false,
    fusionParents: { length: 0 } as any,
  } as any;
}

describe('#260 — BlockResolver stays unscaled (base gauge math)', () => {
  test('an uncontested WOOD hit emits exactly [WOOD] in hitGaugeElements (base +1)', () => {
    const r = resolveBlock(ring(ElementEnum.WOOD), null, 'NO_BLOCK');
    expect(r.hitGaugeElements).toEqual([ElementEnum.WOOD]);
  });

  test('an uncontested THORNADO (Wood+Wind) hit emits only the WOOD component', () => {
    // BlockResolver needs the fusion flagged to decompose; build a fusion ring stub.
    const thornado = {
      ...ring(ElementEnum.THORNADO),
      isFusion: true,
    } as any;
    const r = resolveBlock(thornado, null, 'NO_BLOCK');
    // Only the triangle component (WOOD) is gauge-bearing; WIND contributes nothing.
    expect(r.hitGaugeElements).toEqual([ElementEnum.WOOD]);
  });
});

describe('#260 — gaugeFillMult applies the per-tier multiplier to the base', () => {
  test('sub-boss ×1.5: a single base +1 hit credits 1.5', () => {
    const base = 1; // BlockResolver hit credit is +1 per triangle component
    expect(base * BOSS_MODIFIERS.sub.gaugeFillMult).toBeCloseTo(1.5, 5);
  });

  test('a double attack lands two orbs → 2 × base × mult', () => {
    // Per-orb application: two uncontested triangle hits at the sub-boss rate.
    const base = 1;
    const perOrb = base * BOSS_MODIFIERS.sub.gaugeFillMult;
    expect(perOrb * 2).toBeCloseTo(3.0, 5);
  });

  test('major / gate bosses do not press the gauge (×1.0)', () => {
    expect(BOSS_MODIFIERS.major.gaugeFillMult).toBe(1.0);
    expect(BOSS_MODIFIERS.gate.gaugeFillMult).toBe(1.0);
  });
});
