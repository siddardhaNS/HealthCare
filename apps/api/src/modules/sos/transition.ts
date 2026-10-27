// State changes through the state machine. Kept free of other modules (only
// the dependency-free @repo/contracts/sos) because workflow steps import it.
import { checkTransition, type SosActor, type SosState } from '@repo/contracts/sos';
import type { IncidentRow, SosRepo } from './repo';

export type SosFailure = { error: 'not_found' | 'forbidden' | 'illegal_transition' | 'not_your_move' | 'reason_required' | 'conflict'; message: string };
export const fail = (error: SosFailure['error'], message: string): SosFailure => ({ error, message });
export const isSosFailure = (x: unknown): x is SosFailure => typeof x === 'object' && x !== null && 'error' in x;

/** Applies a state change through the state machine (compare-and-set against concurrent changes). */
export async function move(
  sos: SosRepo,
  incident: IncidentRow,
  to: SosState,
  actor: { id: string | null; role: SosActor },
  reason: string | null,
  assign?: { crewId: string },
): Promise<IncidentRow | SosFailure> {
  const check = checkTransition(incident.state, to, actor.role, reason);
  if (!check.ok) {
    const message = { illegal_transition: `An SOS that is ${incident.state} cannot become ${to}.`, not_your_move: 'You cannot make this change.', reason_required: 'Give a reason for this change.' }[check.code];
    return fail(check.code, message);
  }
  const next = await sos.transition(incident.id, incident.state, to, actor, reason, assign);
  return next ?? fail('conflict', 'The SOS changed meanwhile. Refresh and try again.');
}
