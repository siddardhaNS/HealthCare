// Consults: appointment state machine, slot generation and refund rules
// (dependency-free; shared by API, console and apps). docs/plans/phase-4-consults-calling.md.

export const consultTypes = ['video', 'audio', 'clinic'] as const;
export type ConsultType = (typeof consultTypes)[number];

export const appointmentStates = [
  'held',
  'booked',
  'in_waiting_room',
  'in_call',
  'completed',
  'cancelled_by_resident',
  'cancelled_by_doctor',
  'no_show_doctor',
  'no_show_resident',
  'expired_hold',
] as const;
export type AppointmentState = (typeof appointmentStates)[number];

/** Who causes a transition. `system` is the API: payments, hold expiry, no-show timers. */
export type AppointmentActor = 'resident' | 'doctor' | 'ops' | 'system';

interface Edge {
  to: AppointmentState;
  by: readonly AppointmentActor[];
  reason?: boolean;
}

const edges: Record<AppointmentState, readonly Edge[]> = {
  // The slot is held while the resident pays (⚑2).
  held: [
    { to: 'booked', by: ['system'] },
    { to: 'expired_hold', by: ['system'] },
    { to: 'cancelled_by_resident', by: ['resident'] },
  ],
  booked: [
    { to: 'in_waiting_room', by: ['resident', 'doctor'] },
    // In-clinic visits have no call: the doctor completes them after the visit.
    { to: 'completed', by: ['doctor'] },
    { to: 'cancelled_by_resident', by: ['resident'] },
    { to: 'cancelled_by_doctor', by: ['doctor', 'ops'], reason: true },
    { to: 'no_show_doctor', by: ['system'] },
    { to: 'no_show_resident', by: ['doctor'] },
  ],
  in_waiting_room: [
    { to: 'in_call', by: ['system'] },
    { to: 'cancelled_by_doctor', by: ['doctor', 'ops'], reason: true },
    { to: 'no_show_doctor', by: ['system'] },
    { to: 'no_show_resident', by: ['doctor'] },
  ],
  in_call: [
    { to: 'completed', by: ['doctor'] },
    // Dropped and never rejoined: back to the waiting room, so either side can return.
    { to: 'in_waiting_room', by: ['system'] },
  ],
  completed: [],
  cancelled_by_resident: [],
  cancelled_by_doctor: [],
  no_show_doctor: [],
  no_show_resident: [],
  expired_hold: [],
};

export type AppointmentCheck = { ok: true } | { ok: false; code: 'illegal_transition' | 'not_your_move' | 'reason_required' };

export function checkAppointmentTransition(from: AppointmentState, to: AppointmentState, actor: AppointmentActor, reason?: string | null): AppointmentCheck {
  const options = edges[from].filter((e) => e.to === to);
  if (options.length === 0) return { ok: false, code: 'illegal_transition' };
  const edge = options.find((e) => e.by.includes(actor));
  if (!edge) return { ok: false, code: 'not_your_move' };
  if (edge.reason && !reason?.trim()) return { ok: false, code: 'reason_required' };
  return { ok: true };
}

/** States that keep the slot taken (unique per doctor and start time). */
export const slotTakingStates: readonly AppointmentState[] = ['held', 'booked', 'in_waiting_room', 'in_call', 'completed'];

// ── Rules (⚑2, ⚑5) ───────────────────────────────────────────────────────

export const consultRules = {
  /** How long a slot is held while the resident pays. */
  holdMinutes: 10,
  /** The doctor must join within this many minutes of the start, or it is a no-show with a full refund. */
  doctorJoinGraceMinutes: 15,
  /** A resident who cancels at least this long before the start gets a full refund. */
  freeCancelHours: 2,
  /** Shared records are visible to the doctor from this long before the start… */
  recordsBeforeMinutes: 15,
  /** …until this long after the start. */
  recordsAfterHours: 24,
  /** Slots closer than this to now are not offered. */
  bookingLeadMinutes: 30,
  slotMinutesAllowed: [10, 15, 20, 30] as const,
} as const;

export type RefundOutcome = 'full' | 'none';

/** ⚑2: the doctor's cancellation or no-show refunds in full; the resident's, only if early enough. */
export function refundFor(c: { cause: 'cancelled_by_doctor' | 'no_show_doctor' | 'cancelled_by_resident' | 'no_show_resident'; at: Date; startsAt: Date }): RefundOutcome {
  if (c.cause === 'cancelled_by_doctor' || c.cause === 'no_show_doctor') return 'full';
  if (c.cause === 'no_show_resident') return 'none';
  return c.startsAt.getTime() - c.at.getTime() >= consultRules.freeCancelHours * 3_600_000 ? 'full' : 'none';
}

/** ⚑5: whether the doctor may see the shared records at `now`. */
export function recordsWindowOpen(startsAt: Date, now: Date): boolean {
  const t = now.getTime();
  return t >= startsAt.getTime() - consultRules.recordsBeforeMinutes * 60_000 && t <= startsAt.getTime() + consultRules.recordsAfterHours * 3_600_000;
}

// ── Slots (⚑3) ───────────────────────────────────────────────────────────

/** India has one time zone and no daylight saving: IST is always UTC+05:30. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

export interface WeeklyHours {
  /** 0 = Sunday … 6 = Saturday (in IST). */
  weekday: number;
  /** "HH:MM" in IST, start inclusive, end exclusive. */
  start: string;
  end: string;
  types: readonly ConsultType[];
}

export interface HoursException {
  /** "YYYY-MM-DD" in IST, inclusive. */
  from: string;
  to: string;
  /** `off`: no slots those days (leave). `extra`: these hours in addition. */
  kind: 'off' | 'extra';
  start?: string;
  end?: string;
  types?: readonly ConsultType[];
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  types: ConsultType[];
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** The UTC instant of `hhmm` IST on the IST date `day`. */
const atIst = (day: string, mins: number) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + mins * 60_000);

/**
 * Bookable slots between `from` and `to` (IST dates, inclusive): weekly hours,
 * minus days off, plus extra hours; without slots already taken or too soon.
 */
export function generateSlots(o: {
  hours: readonly WeeklyHours[];
  exceptions?: readonly HoursException[];
  slotMinutes: number;
  from: string;
  to: string;
  taken?: readonly Date[];
  now: Date;
  type?: ConsultType;
}): Slot[] {
  const taken = new Set((o.taken ?? []).map((d) => d.getTime()));
  const earliest = o.now.getTime() + consultRules.bookingLeadMinutes * 60_000;
  const out = new Map<number, Slot>();
  for (let day = o.from; day <= o.to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const ex = (o.exceptions ?? []).filter((e) => e.from <= day && day <= e.to);
    if (ex.some((e) => e.kind === 'off')) continue;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const windows = [
      ...o.hours.filter((h) => h.weekday === weekday),
      ...ex.filter((e) => e.kind === 'extra' && e.start && e.end).map((e) => ({ start: e.start!, end: e.end!, types: e.types ?? (['video', 'audio'] as const) })),
    ];
    for (const w of windows) {
      for (let m = minutes(w.start); m + o.slotMinutes <= minutes(w.end); m += o.slotMinutes) {
        const startsAt = atIst(day, m);
        const t = startsAt.getTime();
        if (t < earliest || taken.has(t)) continue;
        if (o.type && !w.types.includes(o.type)) continue;
        const existing = out.get(t);
        const types = [...new Set([...(existing?.types ?? []), ...w.types])];
        out.set(t, { startsAt, endsAt: new Date(t + o.slotMinutes * 60_000), types });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export { istDay };
