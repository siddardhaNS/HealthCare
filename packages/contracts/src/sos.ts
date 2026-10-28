// SOS state machine (dependency-free; shared by API, console and apps).
// docs/plans/phase-3-sos.md §2. "countdown" lives only on the phone.

export const sosStates = [
  'raised',
  'dispatching',
  'accepted',
  'en_route',
  'on_scene',
  'transporting',
  'handed_over',
  'closed',
  'cancelled',
  'escalated_to_108',
] as const;
export type SosState = (typeof sosStates)[number];

/** Who causes a transition. `system` is the API / escalation workflow. */
export type SosActor = 'resident' | 'crew' | 'desk' | 'system';

interface Edge {
  to: SosState;
  by: readonly SosActor[];
  /** A reason must be recorded (shown in the timeline). */
  reason?: boolean;
}

const edges: Record<SosState, readonly Edge[]> = {
  raised: [
    { to: 'dispatching', by: ['system'] },
    { to: 'cancelled', by: ['resident'] },
    { to: 'cancelled', by: ['desk'], reason: true },
    { to: 'escalated_to_108', by: ['system'] },
  ],
  dispatching: [
    { to: 'accepted', by: ['system'] },
    { to: 'escalated_to_108', by: ['system'] },
    { to: 'cancelled', by: ['resident'] },
    { to: 'cancelled', by: ['desk'], reason: true },
  ],
  accepted: [
    { to: 'en_route', by: ['crew'] },
    // Reassign: the desk takes the job back from a crew (e.g. vehicle breakdown).
    { to: 'dispatching', by: ['desk'], reason: true },
    { to: 'cancelled', by: ['resident'] },
    { to: 'cancelled', by: ['desk'], reason: true },
  ],
  en_route: [
    { to: 'on_scene', by: ['crew'] },
    { to: 'dispatching', by: ['desk'], reason: true },
    { to: 'cancelled', by: ['desk'], reason: true },
  ],
  on_scene: [
    { to: 'transporting', by: ['crew'] },
    // Treated at home, no transport needed.
    { to: 'closed', by: ['desk'], reason: true },
  ],
  transporting: [{ to: 'handed_over', by: ['crew'] }],
  handed_over: [{ to: 'closed', by: ['desk'] }],
  // Dispatch continues after the 108 prompt: a crew may still accept.
  escalated_to_108: [
    { to: 'accepted', by: ['system'] },
    { to: 'cancelled', by: ['resident'] },
    { to: 'closed', by: ['desk'], reason: true },
  ],
  closed: [],
  cancelled: [],
};

export type TransitionCheck = { ok: true } | { ok: false; code: 'illegal_transition' | 'not_your_move' | 'reason_required' };

export function checkTransition(from: SosState, to: SosState, actor: SosActor, reason?: string | null): TransitionCheck {
  const options = edges[from].filter((e) => e.to === to);
  if (options.length === 0) return { ok: false, code: 'illegal_transition' };
  const edge = options.find((e) => e.by.includes(actor));
  if (!edge) return { ok: false, code: 'not_your_move' };
  if (edge.reason && !reason?.trim()) return { ok: false, code: 'reason_required' };
  return { ok: true };
}

/** States in which the incident still needs attention. */
export const openSosStates: readonly SosState[] = ['raised', 'dispatching', 'accepted', 'en_route', 'on_scene', 'transporting', 'handed_over', 'escalated_to_108'];
export const isOpen = (s: SosState) => openSosStates.includes(s);

/** A crew has the job (patient details visible to them, location streaming on). */
export const crewActiveStates: readonly SosState[] = ['accepted', 'en_route', 'on_scene', 'transporting'];

/** The crew's job steps, in order: each status button moves to the next one. */
export const crewSteps = ['en_route', 'on_scene', 'transporting', 'handed_over'] as const;
export type CrewStep = (typeof crewSteps)[number];

/** The step a crew takes next from `state`, or null when it is not theirs to move. */
export function nextCrewStep(state: SosState): CrewStep | null {
  return ({ accepted: 'en_route', en_route: 'on_scene', on_scene: 'transporting', transporting: 'handed_over' } as Partial<Record<SosState, CrewStep>>)[state] ?? null;
}

/** Escalation thresholds (seconds). Plan ⚑2: defaults 30 / 90, per site within these bounds. */
export const sosThresholds = { widenDefault: 30, escalateDefault: 90, widenMin: 15, widenMax: 60, escalateMin: 60, escalateMax: 180 } as const;
