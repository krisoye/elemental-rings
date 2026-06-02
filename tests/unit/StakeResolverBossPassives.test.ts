/**
 * #261 — boss unique passives (StakeResolver). The SEAT-TIME half is pure and
 * unit-tested here: Bulwark adds +1 use to both defense rings; Heartwood returns
 * its charge count for BattleRoom to track. Guardians (no table row) are a no-op.
 * The Heartwood REDIRECT itself lives in BattleRoom (heart-loss path) and is
 * covered by the boss-combat integration test.
 */
import { describe, test, expect } from 'vitest';
import { applyBossSetupPassive, BOSS_PASSIVES } from '../../server/src/game/StakeResolver';
import { PlayerState } from '../../server/src/schemas/PlayerState';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';

function makeRing(element: number, currentUses: number, maxUses?: number): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = maxUses ?? currentUses;
  r.isExtinguished = currentUses === 0;
  return r;
}

function makePS(): PlayerState {
  const ps = new PlayerState();
  ps.thumb = makeRing(ElementEnum.THORNADO, 3);
  ps.thumb.isFusion = true;
  ps.a1 = makeRing(ElementEnum.WIND, 3);
  ps.a2 = makeRing(ElementEnum.WOOD, 3);
  ps.d1 = makeRing(ElementEnum.WOOD, 3);
  ps.d2 = makeRing(ElementEnum.EARTH, 3);
  return ps;
}

describe('#261 — Bogwood "Bulwark" (+1 use on both defense rings)', () => {
  test('both defense rings gain +1 use (current and max)', () => {
    const ps = makePS();
    const charges = applyBossSetupPassive(ps, 'forest_bogwood_warden');
    expect(charges).toBe(0); // Bogwood has no Heartwood
    expect(ps.d1.currentUses).toBe(4);
    expect(ps.d1.maxUses).toBe(4);
    expect(ps.d2.currentUses).toBe(4);
    expect(ps.d2.maxUses).toBe(4);
    // Attack rings and thumb are untouched.
    expect(ps.a1.currentUses).toBe(3);
    expect(ps.a2.currentUses).toBe(3);
    expect(ps.thumb.currentUses).toBe(3);
  });
});

describe('#261 — Thornwood "Heartwood" (returns absorb charges)', () => {
  test('returns 2 charges and does not alter the seat', () => {
    const ps = makePS();
    const charges = applyBossSetupPassive(ps, 'forest_thornwood_warden');
    expect(charges).toBe(2);
    // Heartwood has no seat-time ring change.
    expect(ps.d1.currentUses).toBe(3);
    expect(ps.d2.currentUses).toBe(3);
  });
});

describe('#261 — guardians and non-bosses have no passive', () => {
  test('a guardian id is a no-op (0 charges, no ring change)', () => {
    const ps = makePS();
    const charges = applyBossSetupPassive(ps, 'forest_thornado_shrine_guardian');
    expect(charges).toBe(0);
    expect(ps.d1.currentUses).toBe(3);
    expect(ps.d2.currentUses).toBe(3);
  });

  test('an unknown / non-boss id is a no-op', () => {
    const ps = makePS();
    expect(applyBossSetupPassive(ps, 'forest_npc_1')).toBe(0);
    expect(ps.d1.currentUses).toBe(3);
  });
});

describe('#261 — passive table is data-driven', () => {
  test('BOSS_PASSIVES holds the curated rows; guardians absent', () => {
    expect(BOSS_PASSIVES.forest_thornwood_warden).toEqual({
      heartwoodCharges: 2,
      bulwarkDefenseBonus: 0,
    });
    expect(BOSS_PASSIVES.forest_bogwood_warden).toEqual({
      heartwoodCharges: 0,
      bulwarkDefenseBonus: 1,
    });
    expect(BOSS_PASSIVES.forest_thornado_shrine_guardian).toBeUndefined();
    expect(BOSS_PASSIVES.forest_bloom_shrine_guardian).toBeUndefined();
  });
});
