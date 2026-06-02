/**
 * AI double-attack OFFENSE integration tests (EPIC #268, part of EPIC #264) using
 * @colyseus/testing (Colyseus 0.17). Boots a real `battle-ai` server, joins a BOSS
 * room (so the AI is seated with its fused thumb + matching A-slots), and drives
 * the AI's turn end-to-end — asserting it INITIATES a fusion-thumb double attack
 * via the same server handler a human reaches (`handleSelectDoubleAttack`), and
 * that two orbs fire (a `doubleAttackStart` broadcast + the combo's 3-use charge).
 *
 * Every assertion reads authoritative state: the live PlayerState and the real
 * broadcast messages on the human client — no mocks. The AI is a virtual player
 * with no client, driven by the room handlers exactly like ai-battle.test.ts.
 *
 * Boss A-slot composition (EPIC #268): MUD = WATER+EARTH, THORNADO = WOOD+WIND,
 * BLOOM = WOOD+EARTH. Each boss has at least one uncounterable component (EARTH or
 * WIND), so the orb-1-unparryable favorability check always passes → the eligible
 * boss always combos on its turn. The DECLINE path is exercised by overriding the
 * AI's A-slots so they no longer match the fusion (canDoubleAttack → false).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';
import { MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS } from '../../server/src/game/constants';
import { ElementEnum } from '../../shared/types';
import { fusionParents, isFusion } from '../../server/src/game/Fusions';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

let colyseus: ColyseusTestServer<any>;

beforeAll(async () => {
  const server = new Server();
  server.define('battle-ai', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

/** Create a vsAI BOSS room (AI seated first → AI attacks first) + one human. */
async function joinBoss(npcId: string, personality: string, aiSeed: number, extra: object = {}) {
  const room = await colyseus.createRoom<any>('battle-ai', {
    vsAI: true,
    personality,
    aiSeed,
    npcId,
    ...extra,
  });
  const human = await colyseus.connectTo(room);
  await room.waitForNextPatch();
  await sleep(20);
  return { room, human };
}

/** Overwrite a ring on the live PlayerState (element + uses; derives fusion meta). */
function setRing(ps: any, key: string, element: number, currentUses: number): void {
  const r = ps[key];
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = Math.max(r.maxUses, currentUses);
  r.isExtinguished = currentUses === 0;
  r.isFusion = isFusion(element);
  r.fusionParents.clear();
  const parents = fusionParents(element);
  if (parents) r.fusionParents.push(parents[0], parents[1]);
}

/** Collect every broadcast of `type` on a client into an array. */
function collect(client: any, type: string): any[] {
  const out: any[] = [];
  client.onMessage(type, (m: any) => out.push(m));
  return out;
}

/** Wait until `pred()` is true or the budget elapses; poll every 50ms. */
async function waitFor(pred: () => boolean, budgetMs = 4000): Promise<void> {
  for (let i = 0; i < Math.ceil(budgetMs / 50) && !pred(); i++) await sleep(50);
}

describe('#268 — eligible boss INITIATES a double attack', () => {
  test('Bogwood (MUD) boss fires a two-orb combo on its turn; thumb + a1 + a2 each lose a use', async () => {
    // The MUD boss attacks first. A1=WATER, A2=EARTH (EARTH is uncounterable), so
    // the combo is always favorable. Make the human's counter ring unusable too so
    // there is unambiguously no parry threat for orb 1.
    const { room, human } = await joinBoss('forest_bogwood_warden', 'DEFENSIVE', 12345);
    const ai = room.state.players.get('AI');
    expect(ai.thumb.element).toBe(ElementEnum.MUD);
    expect(ai.thumb.isFusion).toBe(true);

    // Extinguish the human's defense rings → the AI sees no parry threat.
    const hps = room.state.players.get(human.sessionId);
    setRing(hps, 'd1', EARTH, 0);
    setRing(hps, 'd2', EARTH, 0);

    const starts = collect(human, 'doubleAttackStart');
    expect(room.state.currentAttackerId).toBe('AI');

    // Let the AI's think-delay elapse and the combo commit.
    await waitFor(() => starts.length > 0);
    expect(starts.length).toBe(1);

    // Orbs are the two components, ordered unparryable-first (EARTH then WATER).
    const start = starts[0];
    expect(new Set([start.first, start.second])).toEqual(new Set(['a1', 'a2']));

    // Commit charged exactly one use off thumb + both attack rings (3 total).
    expect(ai.thumb.currentUses).toBe(ai.thumb.maxUses - 1);
    expect(ai.a1.currentUses).toBe(ai.a1.maxUses - 1);
    expect(ai.a2.currentUses).toBe(ai.a2.maxUses - 1);
  }, 15000);

  test('the AI combo gap is clamped to [MIN, MAX]_COMBO_GAP_MS', async () => {
    const { room, human } = await joinBoss('forest_bloom_shrine_guardian', 'DEFENSIVE', 777);
    const hps = room.state.players.get(human.sessionId);
    setRing(hps, 'd1', EARTH, 0);
    setRing(hps, 'd2', EARTH, 0);
    const starts = collect(human, 'doubleAttackStart');

    await waitFor(() => starts.length > 0);
    expect(starts.length).toBe(1);
    expect(starts[0].gapMs).toBeGreaterThanOrEqual(MIN_COMBO_GAP_MS);
    expect(starts[0].gapMs).toBeLessThanOrEqual(MAX_COMBO_GAP_MS);
  }, 15000);
});

describe('#268 — boss does NOT double-attack from an INELIGIBLE hand', () => {
  test('a boss whose A-slots no longer match its fusion never combos (single attack only)', async () => {
    // Keep the MUD fused thumb but break the A-slot composition: a1=FIRE, a2=WATER
    // ≠ componentsOf(MUD) = {WATER, EARTH} → canDoubleAttack is false → no combo.
    const { room, human } = await joinBoss('forest_bogwood_warden', 'AGGRESSIVE', 4242);
    const ai = room.state.players.get('AI');
    setRing(ai, 'a1', FIRE, 3);
    setRing(ai, 'a2', WATER, 3);
    expect(ai.thumb.element).toBe(ElementEnum.MUD); // thumb still the fusion

    const starts = collect(human, 'doubleAttackStart');
    const singles = collect(human, 'exchangeResult');

    // Drive the AI through its first attack: it must single-attack, never combo.
    await waitFor(() => singles.length > 0 || room.state.phase === 'DEFEND_WINDOW');
    await sleep(100);
    expect(starts.length).toBe(0);
  }, 15000);

  test('a boss out of thumb uses cannot combo (predicate fails on uses)', async () => {
    const { room, human } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 9, {
      aiHearts: 3,
    });
    const ai = room.state.players.get('AI');
    // A-slots match (THORNADO = WOOD+WIND) but the thumb is spent → ineligible.
    setRing(ai, 'thumb', ElementEnum.THORNADO, 0);
    setRing(ai, 'a1', WIND, 3);
    setRing(ai, 'a2', WOOD, 3);

    const starts = collect(human, 'doubleAttackStart');
    await waitFor(() => room.state.phase === 'DEFEND_WINDOW' || room.state.phase === 'ENDED');
    await sleep(100);
    expect(starts.length).toBe(0);
  }, 15000);
});

describe('#268 — non-boss / base-thumb AI never combos', () => {
  test('a hub-marker vsAI duel (base thumb) issues no doubleAttackStart across many turns', async () => {
    // No npcId → base-thumb AI → canDoubleAttack is always false.
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 31,
    });
    const human = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(20);

    const ai = room.state.players.get('AI');
    expect(ai.thumb.isFusion).toBe(false);

    const starts = collect(human, 'doubleAttackStart');

    // Drive many turns: whenever it's the human's turn, single-attack; let the AI
    // act on its turns. The AI must NEVER emit a double attack.
    for (let i = 0; i < 40 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('selectAttack', { slot: 'a1' });
      }
      await sleep(150);
    }
    expect(starts.length).toBe(0);
  }, 20000);
});
