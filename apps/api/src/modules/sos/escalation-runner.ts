import { resumeHook, start } from 'workflow/api';
import { escalationToken, type EscalationRunner } from './escalation-service';
import { sosEscalation } from './escalation';

export function workflowEscalation(): EscalationRunner {
  return {
    async start(incidentId) {
      const run = await start(sosEscalation, [incidentId]);
      return run.runId;
    },
    async signal(incidentId, signal) {
      try {
        await resumeHook(escalationToken(incidentId), signal);
      } catch {
        // The run already finished (or never started): nothing is waiting.
      }
    },
  };
}
