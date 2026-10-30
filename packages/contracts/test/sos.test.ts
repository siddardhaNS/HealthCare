import { describe, expect, it } from 'vitest';
import { checkTransition, closeNeedsReason, crewSteps, deskActions, isOpen, nextCrewStep, sosRef, sosStates, type SosActor, type SosState } from '../src/sos';

describe('SOS state machine', () => {
  it('walks the full happy path with the right actor at each step', () => {
    const path: [SosState, SosState, SosActor][] = [
      ['raised', 'dispatching', 'system'],
      ['dispatching', 'accepted', 'system'],
      ['accepted', 'en_route', 'crew'],
      ['en_route', 'on_scene', 'crew'],
      ['on_scene', 'transporting', 'crew'],
      ['transporting', 'handed_over', 'crew'],
      ['handed_over', 'closed', 'desk'],
    ];
    for (const [from, to, by] of path) expect(checkTransition(from, to, by)).toEqual({ ok: true });
  });

  it('refuses skipping steps', () => {
    expect(checkTransition('raised', 'accepted', 'system')).toMatchObject({ code: 'illegal_transition' });
    expect(checkTransition('accepted', 'on_scene', 'crew')).toMatchObject({ code: 'illegal_transition' });
    expect(checkTransition('dispatching', 'handed_over', 'crew')).toMatchObject({ code: 'illegal_transition' });
  });

  it('only the right actor can make a move', () => {
    expect(checkTransition('accepted', 'en_route', 'resident')).toMatchObject({ code: 'not_your_move' });
    expect(checkTransition('dispatching', 'accepted', 'crew')).toMatchObject({ code: 'not_your_move' });
    expect(checkTransition('handed_over', 'closed', 'crew')).toMatchObject({ code: 'not_your_move' });
  });

  it('the desk needs a reason to cancel, reassign or close after treatment on scene', () => {
    expect(checkTransition('dispatching', 'cancelled', 'desk')).toMatchObject({ code: 'reason_required' });
    expect(checkTransition('dispatching', 'cancelled', 'desk', '  ')).toMatchObject({ code: 'reason_required' });
    expect(checkTransition('dispatching', 'cancelled', 'desk', 'Duplicate alert')).toEqual({ ok: true });
    expect(checkTransition('accepted', 'dispatching', 'desk', 'Vehicle breakdown')).toEqual({ ok: true });
    expect(checkTransition('on_scene', 'closed', 'desk', 'Treated at home')).toEqual({ ok: true });
  });

  it('a resident can cancel until a crew is on the way, without a reason', () => {
    expect(checkTransition('raised', 'cancelled', 'resident')).toEqual({ ok: true });
    expect(checkTransition('accepted', 'cancelled', 'resident')).toEqual({ ok: true });
    expect(checkTransition('en_route', 'cancelled', 'resident')).toMatchObject({ code: 'not_your_move' });
  });

  it('a crew can still accept after the 108 prompt', () => {
    expect(checkTransition('dispatching', 'escalated_to_108', 'system')).toEqual({ ok: true });
    expect(checkTransition('escalated_to_108', 'accepted', 'system')).toEqual({ ok: true });
  });

  it('closed and cancelled are final', () => {
    for (const end of ['closed', 'cancelled'] as const) {
      for (const to of sosStates) for (const by of ['resident', 'crew', 'desk', 'system'] as const) expect(checkTransition(end, to, by, 'x').ok).toBe(false);
      expect(isOpen(end)).toBe(false);
    }
  });
});

describe('crew status buttons', () => {
  it('each step is a legal crew move from the state before it, ending at handed over', () => {
    let state: SosState = 'accepted';
    for (const step of crewSteps) {
      expect(nextCrewStep(state)).toBe(step);
      expect(checkTransition(state, step, 'crew').ok).toBe(true);
      state = step;
    }
    expect(nextCrewStep(state)).toBeNull();
  });

  it('no button before a crew has the job or after it is settled', () => {
    for (const s of ['raised', 'dispatching', 'escalated_to_108', 'closed', 'cancelled'] as const) expect(nextCrewStep(s)).toBeNull();
  });
});

describe('command center actions', () => {
  it('each offered action is a legal desk move from that state', () => {
    for (const s of sosStates) {
      const a = deskActions(s);
      if (a.cancel) expect(checkTransition(s, 'cancelled', 'desk', 'x').ok).toBe(true);
      if (a.reassign) expect(checkTransition(s, 'dispatching', 'desk', 'x').ok).toBe(true);
      if (a.handOver) expect(checkTransition(s, 'handed_over', 'desk', 'x').ok).toBe(true);
      if (a.close) expect(checkTransition(s, 'closed', 'desk', 'x').ok).toBe(true);
    }
  });

  it('reassign only while a crew has the job and before arrival; hand-over only while transporting', () => {
    expect(sosStates.filter((s) => deskActions(s).reassign)).toEqual(['accepted', 'en_route']);
    expect(sosStates.filter((s) => deskActions(s).handOver)).toEqual(['transporting']);
    expect(sosStates.filter((s) => deskActions(s).offer)).toEqual(['dispatching', 'escalated_to_108']);
    expect(checkTransition('transporting', 'handed_over', 'desk', '').ok).toBe(false);
  });

  it('closing needs a reason except after hand-over', () => {
    expect(checkTransition('handed_over', 'closed', 'desk').ok).toBe(true);
    expect(closeNeedsReason('handed_over')).toBe(false);
    for (const s of sosStates.filter((x) => x !== 'handed_over' && deskActions(x).close)) {
      expect(closeNeedsReason(s)).toBe(true);
      expect(checkTransition(s, 'closed', 'desk').ok).toBe(false);
    }
  });

  it('short references are stable and readable', () => {
    expect(sosRef('6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11')).toBe('SOS-6F1C2A');
  });
});
