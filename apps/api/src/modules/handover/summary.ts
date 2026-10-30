import type { HandoverSummary } from '@repo/contracts';
import type { HandoverRow } from './repo';

/** Where the patient goes and which items were shared, never their contents. */
export function toSummary(h: HandoverRow): HandoverSummary {
  return {
    hospital: { id: h.hospitalId, name: h.hospitalName, erPhone: h.erPhone },
    items: h.items,
    chosenBy: h.chosenBy,
    preferred: h.preferred,
    reason: h.choiceReason,
    createdAt: h.createdAt.toISOString(),
    expiresAt: h.expiresAt.toISOString(),
    confirmedAt: h.confirmedAt?.toISOString() ?? null,
  };
}
