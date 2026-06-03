/**
 * Post-implementation regression tests for EPIC #322 — Forest map grid coherence.
 *
 * The B2 coord-collision and unit-step tests already live in waystones.spec.ts.
 * This file locks in acceptance-criteria conformance and adversarial edge cases
 * that the generic structural tests do not cover:
 *
 *   - Spec-pinned assertions for individual screens whose exits were rewritten
 *     (crossroads, briar_pass, root_tangle, boss_clearing, deepwood).
 *   - Adversarial negatives: self-exits, dangling references, fractional coords.
 *   - The circular walk closure test for the core 2×2 cluster.
 *   - Coverage parity: every FOREST_SCREENS id must have a forestMeta entry.
 */

import { describe, it, expect } from 'vitest';
import { FOREST_SCREENS, type ScreenDef } from '../../shared/world/forest';
import { FOREST_SCREEN_META } from '../../client/src/objects/world/forestMeta';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getScreen(id: string): ScreenDef {
  const s = FOREST_SCREENS.find((s) => s.id === id);
  if (!s) throw new Error(`No ScreenDef found for id '${id}'`);
  return s;
}

// ---------------------------------------------------------------------------
// Spec-conformance assertions — tied directly to acceptance criteria in #322
// ---------------------------------------------------------------------------

describe('FOREST_SCREENS spec conformance (#322)', () => {

  it('forest_hidden_alcove has no coord (teleport-only; spec: "forest_hidden_alcove has no coord")', () => {
    const alcove = getScreen('forest_hidden_alcove');
    // Spec explicitly states this room has NO grid coordinate.
    expect(alcove.coord).toBeUndefined();
  });

  it('forest_hidden_alcove has empty exits', () => {
    const alcove = getScreen('forest_hidden_alcove');
    expect(Object.keys(alcove.exits)).toHaveLength(0);
  });

  it('forest_boss_clearing has exactly 2 exits: south and north (spec: "boss_clearing drops to 2 exits: { S: deepwood, N: verdant_descent }")', () => {
    const screen = getScreen('forest_boss_clearing');
    expect(Object.keys(screen.exits).sort()).toEqual(['north', 'south']);
    expect(screen.exits.south).toBe('forest_deepwood');
    expect(screen.exits.north).toBe('forest_verdant_descent');
  });

  it('forest_root_tangle has no north exit (spec: "root_tangle backdoor removed")', () => {
    const screen = getScreen('forest_root_tangle');
    expect((screen.exits as Record<string, string>).north).toBeUndefined();
  });

  it('forest_root_tangle exits are exactly { west: ancient_grove, east: canopy_walk }', () => {
    const screen = getScreen('forest_root_tangle');
    expect(Object.keys(screen.exits).sort()).toEqual(['east', 'west']);
    expect(screen.exits.west).toBe('forest_ancient_grove');
    expect(screen.exits.east).toBe('forest_canopy_walk');
  });

  it('forest_crossroads has no east exit (spec: "briar_pass moves to crossroads west")', () => {
    const screen = getScreen('forest_crossroads');
    expect((screen.exits as Record<string, string>).east).toBeUndefined();
  });

  it('forest_crossroads west exit points to forest_briar_pass', () => {
    const screen = getScreen('forest_crossroads');
    expect(screen.exits.west).toBe('forest_briar_pass');
  });

  it('forest_briar_pass has no south exit and no west exit (spec: "full exit rewrite")', () => {
    const screen = getScreen('forest_briar_pass');
    expect((screen.exits as Record<string, string>).south).toBeUndefined();
    expect((screen.exits as Record<string, string>).west).toBeUndefined();
  });

  it('forest_briar_pass exits are exactly { east: crossroads, north: deepwood }', () => {
    const screen = getScreen('forest_briar_pass');
    expect(Object.keys(screen.exits).sort()).toEqual(['east', 'north']);
    expect(screen.exits.east).toBe('forest_crossroads');
    expect(screen.exits.north).toBe('forest_deepwood');
  });

  it('forest_deepwood has no west exit (spec: "vertical chain: briar_pass→deepwood→boss_clearing")', () => {
    const screen = getScreen('forest_deepwood');
    expect((screen.exits as Record<string, string>).west).toBeUndefined();
  });

  it('forest_deepwood exits are exactly { south: briar_pass, east: ridge, north: boss_clearing }', () => {
    const screen = getScreen('forest_deepwood');
    expect(Object.keys(screen.exits).sort()).toEqual(['east', 'north', 'south']);
    expect(screen.exits.south).toBe('forest_briar_pass');
    expect(screen.exits.east).toBe('forest_ridge');
    expect(screen.exits.north).toBe('forest_boss_clearing');
  });

  it('all 27 screens with exits have a coord (spec: "give every Forest screen an integer coord")', () => {
    const screensWithExits = FOREST_SCREENS.filter(
      (s) => Object.keys(s.exits).length > 0,
    );
    // Exactly 27 screens have exits per the approved coord table.
    expect(screensWithExits).toHaveLength(27);
    for (const s of screensWithExits) {
      expect(
        s.coord,
        `${s.id} has exits but no coord`,
      ).toBeDefined();
    }
  });

});

// ---------------------------------------------------------------------------
// Circular walk closure — the core 2×2 cluster must form a closed loop
// ---------------------------------------------------------------------------

describe('FOREST_SCREENS circular walk (#322)', () => {

  it('crossroads W→briar_pass N→deepwood E→ridge S→crossroads closes the 2×2 cluster', () => {
    // Start at crossroads (2,1)
    const walk: Array<{ from: string; via: 'north' | 'south' | 'east' | 'west'; to: string }> = [
      { from: 'forest_crossroads',  via: 'west',  to: 'forest_briar_pass' },
      { from: 'forest_briar_pass',  via: 'north', to: 'forest_deepwood' },
      { from: 'forest_deepwood',    via: 'east',  to: 'forest_ridge' },
      { from: 'forest_ridge',       via: 'south', to: 'forest_crossroads' },
    ];
    for (const step of walk) {
      const screen = getScreen(step.from);
      expect(
        screen.exits[step.via],
        `${step.from}.${step.via} should lead to ${step.to}`,
      ).toBe(step.to);
    }
    // Verify coordinates are exactly a unit-step clockwise around a 2×2 cell
    const expectedCoords: Record<string, { x: number; y: number }> = {
      forest_crossroads: { x: 2, y: 1 },
      forest_briar_pass: { x: 1, y: 1 },
      forest_deepwood:   { x: 1, y: 2 },
      forest_ridge:      { x: 2, y: 2 },
    };
    for (const [id, coord] of Object.entries(expectedCoords)) {
      const s = getScreen(id);
      expect(s.coord, `${id} must have a coord`).toBeDefined();
      expect(s.coord!.x).toBe(coord.x);
      expect(s.coord!.y).toBe(coord.y);
    }
  });

});

// ---------------------------------------------------------------------------
// Adversarial negatives
// ---------------------------------------------------------------------------

describe('FOREST_SCREENS adversarial negatives (#322)', () => {

  it('all coordinated screens have integer (not fractional) coordinates', () => {
    for (const s of FOREST_SCREENS) {
      if (!s.coord) continue;
      expect(
        Number.isInteger(s.coord.x),
        `${s.id}.coord.x (${s.coord.x}) is not an integer`,
      ).toBe(true);
      expect(
        Number.isInteger(s.coord.y),
        `${s.id}.coord.y (${s.coord.y}) is not an integer`,
      ).toBe(true);
    }
  });

  it('no screen has an exit to itself', () => {
    for (const s of FOREST_SCREENS) {
      for (const [dir, targetId] of Object.entries(s.exits)) {
        expect(
          targetId,
          `${s.id}.${dir} exits to itself`,
        ).not.toBe(s.id);
      }
    }
  });

  it('all exit targets resolve to a known screen id (no dangling references)', () => {
    const knownIds = new Set(FOREST_SCREENS.map((s) => s.id));
    for (const s of FOREST_SCREENS) {
      for (const [dir, targetId] of Object.entries(s.exits)) {
        expect(
          knownIds.has(targetId),
          `${s.id}.${dir} targets '${targetId}' which does not exist in FOREST_SCREENS`,
        ).toBe(true);
      }
    }
  });

});

// ---------------------------------------------------------------------------
// Coverage parity — forestMeta must cover all FOREST_SCREENS ids
// ---------------------------------------------------------------------------

describe('FOREST_SCREEN_META coverage (#322)', () => {

  it('every FOREST_SCREENS id has an entry in FOREST_SCREEN_META', () => {
    // This prevents screens being added to forest.ts without a matching meta entry,
    // which would cause OverworldMapModal to silently omit the node's label/boss glyph.
    for (const s of FOREST_SCREENS) {
      expect(
        FOREST_SCREEN_META[s.id],
        `FOREST_SCREEN_META is missing an entry for '${s.id}'`,
      ).toBeDefined();
    }
  });

  it('FOREST_SCREEN_META has no orphan entries not in FOREST_SCREENS', () => {
    // Inverse check: no stale meta entries left behind after a screen is removed.
    const knownIds = new Set(FOREST_SCREENS.map((s) => s.id));
    for (const metaId of Object.keys(FOREST_SCREEN_META)) {
      expect(
        knownIds.has(metaId),
        `FOREST_SCREEN_META has an entry for '${metaId}' which does not exist in FOREST_SCREENS`,
      ).toBe(true);
    }
  });

  it('forest_hidden_alcove meta entry has isolated: true', () => {
    // The alcove is teleport-only — the modal must flag it as isolated.
    expect(FOREST_SCREEN_META['forest_hidden_alcove']?.isolated).toBe(true);
  });

  it('forest_boss_clearing meta entry has a boss tier defined', () => {
    // The boss clearing is a major boss encounter — the modal glyph must render.
    expect(FOREST_SCREEN_META['forest_boss_clearing']?.boss).toBeDefined();
  });

});
