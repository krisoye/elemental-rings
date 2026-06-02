/**
 * AIController double-attack defense scheduling (EPIC #265). Unit-level: drives a
 * fake AIRoomHandle (no real Colyseus server) so the test is deterministic and
 * fast. Proves that when the AI is the DEFENDER of a fusion-thumb double attack
 * (comboInFlight=true), `onPhaseEnter('DEFEND_WINDOW')` schedules a SEPARATE
 * defense press for EACH orb — one against impact1, one against impact2 (which
 * becomes known gapMs after orb 1, mirroring the live room).
 *
 * Uses an AGGRESSIVE profile (noBlockProb=0 → always presses) so both scheduled
 * decisions resolve to an actual submitDefense. Fake timers drive the schedule.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIController, AIRoomHandle } from '../../server/src/game/ai/AIController';
import { BattleState } from '../../server/src/schemas/BattleState';
import { PlayerState } from '../../server/src/schemas/PlayerState';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';

const { WATER, EARTH, WOOD } = ElementEnum;
const AI_ID = 'AI';
const HUMAN_ID = 'HUMAN';

function makeRing(element: number, currentUses = 3): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = Math.max(currentUses, 3);
  r.isExtinguished = currentUses === 0;
  return r;
}

/** A minimal fake room handle the AIController drives. */
class FakeRoom implements AIRoomHandle {
  state = new BattleState();
  currentImpactTime = 0;
  comboInFlight = false;
  currentImpact2Time = 0;
  defenseCalls: { id: string; slot: string }[] = [];

  constructor() {
    const ai = new PlayerState();
    ai.playerId = AI_ID;
    // The AI defends with WOOD (d1) and EARTH (d2) — both usable.
    ai.d1 = makeRing(WOOD);
    ai.d2 = makeRing(EARTH);
    ai.a1 = makeRing(WATER);
    ai.a2 = makeRing(EARTH);
    ai.hearts = 3;

    const human = new PlayerState();
    human.playerId = HUMAN_ID;
    human.a1 = makeRing(WATER);
    human.a2 = makeRing(EARTH);

    this.state.players.set(AI_ID, ai);
    this.state.players.set(HUMAN_ID, human);
    this.state.currentAttackerId = HUMAN_ID; // human attacks → AI defends
    this.state.attackerSlot = 'a1';
  }

  handleSelectAttack(): void {}
  handleSubmitDefense(id: string, payload: { slot: string }): void {
    this.defenseCalls.push({ id, slot: payload.slot });
  }
  handleRecharge(): void {}
  handleForfeit(): void {}
}

describe('AIController — double-attack defense scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('AI defender of a double attack schedules a press for BOTH orbs', () => {
    const room = new FakeRoom();
    const now = Date.now();
    // Orb 1 impact ~900ms out; orb 2 not airborne yet (impact2 = 0).
    room.currentImpactTime = now + 900;
    room.comboInFlight = true;
    room.currentImpact2Time = 0;

    const ai = new AIController(room, AI_ID, 'AGGRESSIVE', 99);
    // Defender enters DEFEND_WINDOW for orb 1.
    ai.onPhaseEnter('DEFEND_WINDOW');

    // Orb 2 launches gapMs (here 300ms) after orb 1 — i.e. BEFORE orb 1 lands —
    // exactly as the live room does (gap ≤ 600ms < the 900ms telegraph). Advance
    // partway so the AI's deferred poll observes orb 2 airborne and schedules it.
    vi.advanceTimersByTime(300);
    room.currentImpact2Time = Date.now() + 900; // impact2 = (start+300) + telegraph

    // Advance past BOTH impacts → both presses fire (orb1 ~@900, orb2 ~@1200).
    vi.advanceTimersByTime(1200);

    expect(room.defenseCalls.length).toBe(2);
    // Both presses came from the AI seat.
    expect(room.defenseCalls.every((c) => c.id === AI_ID)).toBe(true);
  });

  test('single attack (comboInFlight=false) schedules exactly ONE press', () => {
    const room = new FakeRoom();
    const now = Date.now();
    room.currentImpactTime = now + 900;
    room.comboInFlight = false;
    room.currentImpact2Time = 0;

    const ai = new AIController(room, AI_ID, 'AGGRESSIVE', 99);
    ai.onPhaseEnter('DEFEND_WINDOW');

    vi.advanceTimersByTime(2000);
    expect(room.defenseCalls.length).toBe(1);
  });

  test('orb 1 parry/KO cancels the combo before orb 2 → no second press scheduled', () => {
    const room = new FakeRoom();
    const now = Date.now();
    room.currentImpactTime = now + 900;
    room.comboInFlight = true;
    room.currentImpact2Time = 0;

    const ai = new AIController(room, AI_ID, 'AGGRESSIVE', 99);
    ai.onPhaseEnter('DEFEND_WINDOW');

    // Combo ends (orb 1 parried/KO'd) BEFORE orb 2 ever launches: the orb-2 poll
    // bails because comboInFlight flipped false while impact2 was still 0.
    vi.advanceTimersByTime(100);
    room.comboInFlight = false;

    // Orb 1 press still fires (already scheduled); orb 2 never does.
    vi.advanceTimersByTime(2000);
    expect(room.defenseCalls.length).toBe(1);
  });
});
