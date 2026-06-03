/**
 * Post-implementation regression tests for #335 — Snow biome v1 (Frost Sentinel
 * gate warden + Snow Fields screen).
 *
 * These are unit/data-layer tests that lock in server-side and manifest behavior
 * verified during E2E (snow-biome.spec.ts in tests/e2e/). They are
 * complementary to — not a replacement for — the Playwright E2E suite.
 *
 * Two test classes:
 *   SpecConformance   — assertions tied 1:1 to acceptance criteria from the issue.
 *   AdversarialNegatives — edge cases and referential-integrity checks exposing
 *                          bugs that the happy-path E2E scenarios would not catch.
 */

import { describe, it, expect } from 'vitest';
import { NPC_SPAWNS } from '../../server/src/persistence/NpcSpawns';
import { ElementEnum } from '../../shared/types';
import { BOSS_WARDENS, FOREST_SCREENS } from '../../shared/world/forest';
import { SNOW_SCREENS } from '../../shared/world/snow';
import { WAYSTONES, getWaystone } from '../../shared/waystones';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNpc(id: string) {
  const entry = NPC_SPAWNS.find((n) => n.id === id);
  if (!entry) throw new Error(`NPC_SPAWNS has no entry for id '${id}'`);
  return entry;
}

function getSnowScreen(id: string) {
  const screen = SNOW_SCREENS.find((s) => s.id === id);
  if (!screen) throw new Error(`SNOW_SCREENS has no entry for id '${id}'`);
  return screen;
}

// ---------------------------------------------------------------------------
// Class 1: SpecConformance
// Assertions tied directly to the #335 acceptance criteria, via public interfaces.
// These fail if the implementation diverges from the spec even if E2E passed.
// ---------------------------------------------------------------------------

describe('SpecConformance (#335)', () => {

  // ── Frost Sentinel NPC descriptor ─────────────────────────────────────────

  it('Frost Sentinel entry exists in NPC_SPAWNS and has boss tier "gate"', () => {
    // Spec: promote forest_frost_sentinel to boss: { tier: 'gate', ... }
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.boss).toBeDefined();
    expect(sentinel.boss!.tier).toBe('gate');
  });

  it('Frost Sentinel boss name is "Frost Sentinel" (fixes missing-name bug)', () => {
    // Spec: boss.name is the display label; fixing this eliminates "Wind monster" fallback.
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.boss!.name).toBe('Frost Sentinel');
  });

  it('Frost Sentinel fusedThumb is ElementEnum.WIND', () => {
    // Spec: fusedThumb: ElementEnum.WIND (WIND is the fused thumb staked in battle)
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.boss!.fusedThumb).toBe(ElementEnum.WIND);
  });

  // ── BOSS_WARDENS wiring ────────────────────────────────────────────────────

  it('BOSS_WARDENS maps forest_snow_gate to forest_frost_sentinel', () => {
    // Spec: "add forest_snow_gate: 'forest_frost_sentinel' to BOSS_WARDENS in shared/world/forest.ts"
    // This is the linchpin: without it BaseBiomeScene never renders the warden or adds the collider.
    expect(BOSS_WARDENS['forest_snow_gate']).toBe('forest_frost_sentinel');
  });

  // ── SNOW_SCREENS manifest ─────────────────────────────────────────────────

  it('SNOW_SCREENS contains exactly 1 screen', () => {
    // Spec: single-screen Snow biome ("Snow Fields") mirroring single-screen Swamp.
    expect(SNOW_SCREENS).toHaveLength(1);
  });

  it('SNOW_SCREENS[0] has id "snow_entry"', () => {
    // Spec: "id: 'snow_entry'" is the canonical screen id.
    expect(SNOW_SCREENS[0].id).toBe('snow_entry');
  });

  it('snow_entry has danger level 2', () => {
    // Spec: "danger: 2" — mid-tier threat matching the Snow Fields design intent.
    const screen = getSnowScreen('snow_entry');
    expect(screen.danger).toBe(2);
  });

  it('snow_entry exits.south points to forest_snow_gate', () => {
    // Spec: "exits: { south: 'forest_snow_gate' }" — return path to forest.
    const screen = getSnowScreen('snow_entry');
    expect(screen.exits.south).toBe('forest_snow_gate');
  });

  it('snow_entry biomeExit direction is south and target is ForestScene', () => {
    // Spec: "biomeExit: { dir: 'south', target: 'ForestScene' }" — biome transition back to forest.
    const screen = getSnowScreen('snow_entry');
    expect(screen.biomeExit).toBeDefined();
    expect(screen.biomeExit!.dir).toBe('south');
    expect(screen.biomeExit!.target).toBe('ForestScene');
  });

  // ── forest_snow_gate biomeExit (in FOREST_SCREENS) ───────────────────────

  it('forest_snow_gate ScreenDef has biomeExit pointing north to SnowScene', () => {
    // Spec: "add biomeExit: { dir: 'north', target: 'SnowScene' } to forest_snow_gate ScreenDef"
    const gateScreen = FOREST_SCREENS.find((s) => s.id === 'forest_snow_gate');
    expect(gateScreen).toBeDefined();
    expect(gateScreen!.biomeExit).toBeDefined();
    expect(gateScreen!.biomeExit!.dir).toBe('north');
    expect(gateScreen!.biomeExit!.target).toBe('SnowScene');
  });

  // ── snow_anchor_1 waystone ────────────────────────────────────────────────

  it('snow_anchor_1 exists in the WAYSTONES catalog', () => {
    // Spec: "add snow_anchor_1 to shared/waystones.ts"
    const def = getWaystone('snow_anchor_1');
    expect(def).toBeDefined();
  });

  it('snow_anchor_1 has a non-empty name', () => {
    const def = getWaystone('snow_anchor_1');
    expect(def!.name).toBeTruthy();
    expect(def!.name.trim().length).toBeGreaterThan(0);
  });

  it('snow_anchor_1 has a positive spiritCost', () => {
    // Spec: mid-tier spirit cost (Snow is further than Forest, similar to Swamp's 8–10 range).
    const def = getWaystone('snow_anchor_1');
    expect(def!.spiritCost).toBeGreaterThan(0);
  });

  // ── Snow roamers in NPC_SPAWNS ────────────────────────────────────────────

  it('there are exactly 2 snow roamer NPC entries', () => {
    // Spec: "2 entries in NpcSpawns.ts, biome:'snow', screen:'snow_entry', respawnDays:1"
    const snowRoamers = NPC_SPAWNS.filter((n) => n.biome === 'snow');
    expect(snowRoamers).toHaveLength(2);
  });

  it('both snow roamers are on screen snow_entry', () => {
    const snowRoamers = NPC_SPAWNS.filter((n) => n.biome === 'snow');
    for (const roamer of snowRoamers) {
      expect(roamer.screen).toBe('snow_entry');
    }
  });

  it('both snow roamers have respawnDays === 1 (daily periodic, not permanent)', () => {
    // Spec: respawnDays:1 matches the danger-2 roamer convention (permanent = 0).
    const snowRoamers = NPC_SPAWNS.filter((n) => n.biome === 'snow');
    for (const roamer of snowRoamers) {
      expect(roamer.respawnDays).toBe(1);
    }
  });

  // ── World Map modal data — via source data that drives RENDER_NODES/DERIVED_EDGES ──
  // RENDER_NODES and DERIVED_EDGES are module-private in OverworldMapModal.ts.
  // We test the underlying data sources they are derived from, which is the
  // correct public interface for these properties.

  it('FOREST_SCREENS contains forest_snow_gate with a coord (it becomes a RENDER_NODE)', () => {
    // RENDER_NODES is derived from FOREST_SCREENS.filter(s => s.coord). forest_snow_gate
    // must have a coord so it appears as a node in the modal.
    const gateScreen = FOREST_SCREENS.find((s) => s.id === 'forest_snow_gate');
    expect(gateScreen!.coord).toBeDefined();
  });

  it('BOSS_WARDENS entry for forest_snow_gate means the modal renders the Sentinel as a gate boss', () => {
    // The modal reads BOSS_WARDENS to derive the gate boss tier on each node.
    // This test confirms the chain: BOSS_WARDENS key exists AND the referenced NPC has boss.tier=gate.
    const wardenId = BOSS_WARDENS['forest_snow_gate'];
    expect(wardenId).toBeDefined();
    const warden = NPC_SPAWNS.find((n) => n.id === wardenId);
    expect(warden).toBeDefined();
    expect(warden!.boss?.tier).toBe('gate');
  });

  it('SNOW_SCREENS provides the data behind the snow_entry RENDER_NODE (id and biome)', () => {
    // OverworldMapModal hardcodes SNOW_NODE with id='snow_entry' and biome='snow'.
    // snow_entry must exist in SNOW_SCREENS so the node is backed by real data.
    const snowEntry = SNOW_SCREENS.find((s) => s.id === 'snow_entry');
    expect(snowEntry).toBeDefined();
    // The biome is not on ScreenDef — it is inferred from the module (snow.ts).
    // We assert the id is correct; biome correctness is confirmed by NPC_SPAWNS below.
    expect(snowEntry!.id).toBe('snow_entry');
  });

  it('the forest_snow_gate ↔ snow_entry biome edge is derivable from FOREST_SCREENS and SNOW_SCREENS', () => {
    // OverworldMapModal statically pushes { a:'forest_snow_gate', b:'snow_entry', type:'biome' }.
    // Confirm the two endpoints exist in their respective manifests so the edge is valid.
    const gateExists = FOREST_SCREENS.some((s) => s.id === 'forest_snow_gate');
    const snowExists = SNOW_SCREENS.some((s) => s.id === 'snow_entry');
    expect(gateExists).toBe(true);
    expect(snowExists).toBe(true);
    // And the gate's biomeExit points north to SnowScene — confirming edge direction.
    const gate = FOREST_SCREENS.find((s) => s.id === 'forest_snow_gate')!;
    expect(gate.biomeExit?.target).toBe('SnowScene');
  });

});

// ---------------------------------------------------------------------------
// Class 2: AdversarialNegatives
// Edge cases and referential-integrity checks that expose bugs the happy-path
// E2E scenarios would not exercise (wrong wiring, silently misplaced data).
// ---------------------------------------------------------------------------

describe('AdversarialNegatives (#335)', () => {

  // ── Anchorage string matches the registered waystone id ───────────────────

  it('snow_entry.anchorage === "snow_anchor_1" (matches the registered waystone id)', () => {
    // A mismatch here causes a silent "waystone not found" at runtime when the
    // anchorage object broadcasts its waystoneId — no error is thrown, but the
    // player can never attune in Snow Fields.
    const screen = getSnowScreen('snow_entry');
    expect(screen.anchorage).toBe('snow_anchor_1');
    // Confirm the id is also present in the catalog (referential integrity).
    expect(getWaystone('snow_anchor_1')).toBeDefined();
  });

  // ── Sentinel is NOT accidentally wired to the swamp gate ─────────────────

  it('BOSS_WARDENS does NOT map forest_swamp_gate to forest_frost_sentinel', () => {
    // Guard against copy-paste: the sentinel belongs only to forest_snow_gate.
    // If both gates point to the sentinel, the Bogwood battle is replaced and
    // the swamp exit is never properly guarded by the Bogwood Warden.
    expect(BOSS_WARDENS['forest_swamp_gate']).not.toBe('forest_frost_sentinel');
  });

  it('BOSS_WARDENS forest_swamp_gate still points to forest_bogwood_warden (not displaced)', () => {
    // Confirm the Bogwood Warden was not accidentally overwritten.
    expect(BOSS_WARDENS['forest_swamp_gate']).toBe('forest_bogwood_warden');
  });

  // ── Sentinel remains in biome:'forest', screen:'forest_snow_gate' ─────────

  it('Frost Sentinel biome is "forest" (not accidentally moved to "snow")', () => {
    // The sentinel lives ON the forest_snow_gate screen — a forest screen.
    // Moving it to biome:'snow' would put it on the wrong NPC roster, so the
    // client never spawns it as a warden and the gate is never blocked.
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.biome).toBe('forest');
  });

  it('Frost Sentinel screen is "forest_snow_gate" (not "snow_entry" or any other screen)', () => {
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.screen).toBe('forest_snow_gate');
  });

  // ── Snow roamers have no foodDrop (they are daily respawners, not mini-bosses) ──

  it('snow roamers have no foodDrop field set', () => {
    // Daily respawning roamers (respawnDays > 0) drop no food cache.
    // A mistakenly set foodDrop would grant the player infinite food by
    // repeatedly farming the same roamers each day.
    const snowRoamers = NPC_SPAWNS.filter((n) => n.biome === 'snow');
    for (const roamer of snowRoamers) {
      // foodDrop must be absent or explicitly 0 — either is acceptable.
      const foodDrop = (roamer as { foodDrop?: number }).foodDrop;
      expect(foodDrop == null || foodDrop === 0).toBe(true);
    }
  });

  // ── Snow roamers have no boss descriptor (they are plain roamers) ────────

  it('snow roamers have no boss descriptor', () => {
    // Roamers must not carry a boss field. If one is accidentally promoted to
    // boss tier the battle engine would give it fused-thumb loadouts, boss
    // modifiers, and enrage — turning a mild roamer into a full mini-boss.
    const snowRoamers = NPC_SPAWNS.filter((n) => n.biome === 'snow');
    for (const roamer of snowRoamers) {
      expect(roamer.boss).toBeUndefined();
    }
  });

  // ── SNOW_SCREENS referential integrity: every anchorage id exists in WAYSTONES ──

  it('every anchorage id in SNOW_SCREENS exists in the WAYSTONES catalog', () => {
    // A screen can reference an anchorage that doesn't exist — the player walks
    // past the anchorage object and nothing happens (no attune, no teleport).
    const catalogIds = new Set(WAYSTONES.map((w) => w.id));
    for (const screen of SNOW_SCREENS) {
      if (screen.anchorage) {
        expect(
          catalogIds.has(screen.anchorage),
          `${screen.id}.anchorage '${screen.anchorage}' is not in the WAYSTONES catalog`,
        ).toBe(true);
      }
    }
  });

  // ── BOSS_WARDENS referential integrity: warden id exists in NPC_SPAWNS ───

  it('BOSS_WARDENS[forest_snow_gate] references an NPC id that exists in NPC_SPAWNS', () => {
    // If the warden id in BOSS_WARDENS has no matching NPC_SPAWNS entry, the
    // client calls getNpcById and gets undefined — the collider is never added
    // and the gate is trivially passable on day 1.
    const wardenId = BOSS_WARDENS['forest_snow_gate'];
    const npcExists = NPC_SPAWNS.some((n) => n.id === wardenId);
    expect(npcExists).toBe(true);
  });

  // ── No SNOW_SCREENS screen has an exits field pointing to a non-existent forest screen ──

  it('snow_entry south exit forest_snow_gate exists in FOREST_SCREENS', () => {
    // A dangling exit causes an edge-transition attempt to a screen that never
    // loads, hanging the scene transition silently.
    const snowEntry = getSnowScreen('snow_entry');
    const southTarget = (snowEntry.exits as Record<string, string>).south;
    const existsInForest = FOREST_SCREENS.some((s) => s.id === southTarget);
    expect(existsInForest).toBe(true);
  });

  // ── Frost Sentinel is respawnDays 0 (permanent gate boss, not a daily roamer) ──

  it('Frost Sentinel has respawnDays === 0 (permanent gate warden, not a daily roamer)', () => {
    // Gate wardens must be permanent — respawnDays:0. A respawn cadence > 0
    // would let the sentinel respawn after defeat and re-block the path,
    // trapping players who have already earned access to the Snow Fields.
    const sentinel = getNpc('forest_frost_sentinel');
    expect(sentinel.respawnDays).toBe(0);
  });

  // ── BOSS_WARDENS has exactly 3 entries (no accidental extras added) ───────

  it('BOSS_WARDENS has exactly 3 warden entries (swamp gate, boss clearing, snow gate)', () => {
    // Guard against accidentally adding a 4th entry via copy-paste.
    const keys = Object.keys(BOSS_WARDENS);
    expect(keys).toHaveLength(3);
    expect(keys).toContain('forest_swamp_gate');
    expect(keys).toContain('forest_boss_clearing');
    expect(keys).toContain('forest_snow_gate');
  });

  // ── snow_entry has exactly 1 exit: south only (no phantom north/east/west) ──

  it('snow_entry has exactly 1 exit and it is south (no phantom exits)', () => {
    // Extra exits on a single-screen biome entry would cause the client to try
    // loading non-existent map files when the player approaches an empty edge.
    const screen = getSnowScreen('snow_entry');
    const dirs = Object.keys(screen.exits);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe('south');
  });

  // ── Frost Sentinel has a foodDrop set (one-time cache, like Bogwood) ──────

  it('Frost Sentinel has a positive foodDrop (one-time food cache on first defeat)', () => {
    // Gate bosses (respawnDays:0) must carry a foodDrop so the player is
    // rewarded on first defeat. An absent or zero foodDrop silently breaks the
    // food-cache economy for the Snow gate fight.
    const sentinel = getNpc('forest_frost_sentinel');
    expect(typeof sentinel.foodDrop).toBe('number');
    expect(sentinel.foodDrop!).toBeGreaterThan(0);
  });

});
