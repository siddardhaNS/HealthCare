import { describe, expect, it } from 'vitest';
import { checkAppointmentTransition, generateSlots, recordsWindowOpen, refundFor, type WeeklyHours } from '../src/consults';

describe('appointment state machine', () => {
  it('a paid hold becomes booked; an unpaid one expires; only the system does either', () => {
    expect(checkAppointmentTransition('held', 'booked', 'system')).toEqual({ ok: true });
    expect(checkAppointmentTransition('held', 'expired_hold', 'system')).toEqual({ ok: true });
    expect(checkAppointmentTransition('held', 'booked', 'resident')).toEqual({ ok: false, code: 'not_your_move' });
  });

  it('the doctor cancels only with a reason; finished states go nowhere', () => {
    expect(checkAppointmentTransition('booked', 'cancelled_by_doctor', 'doctor')).toEqual({ ok: false, code: 'reason_required' });
    expect(checkAppointmentTransition('booked', 'cancelled_by_doctor', 'doctor', 'Emergency surgery')).toEqual({ ok: true });
    expect(checkAppointmentTransition('completed', 'booked', 'system')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(checkAppointmentTransition('in_call', 'completed', 'resident')).toEqual({ ok: false, code: 'not_your_move' });
  });
});

describe('refunds (⚑2)', () => {
  const startsAt = new Date('2026-12-22T10:00:00+05:30');
  it('the doctor cancelling or not joining refunds in full', () => {
    expect(refundFor({ cause: 'cancelled_by_doctor', at: startsAt, startsAt })).toBe('full');
    expect(refundFor({ cause: 'no_show_doctor', at: startsAt, startsAt })).toBe('full');
  });
  it('the resident: full at least 2 h before, none later or for a no-show', () => {
    expect(refundFor({ cause: 'cancelled_by_resident', at: new Date('2026-12-22T08:00:00+05:30'), startsAt })).toBe('full');
    expect(refundFor({ cause: 'cancelled_by_resident', at: new Date('2026-12-22T08:00:01+05:30'), startsAt })).toBe('none');
    expect(refundFor({ cause: 'no_show_resident', at: startsAt, startsAt })).toBe('none');
  });
});

describe('records window (⚑5)', () => {
  const startsAt = new Date('2026-12-22T10:00:00+05:30');
  it('opens 15 min before and closes 24 h after the start', () => {
    expect(recordsWindowOpen(startsAt, new Date('2026-12-22T09:44:59+05:30'))).toBe(false);
    expect(recordsWindowOpen(startsAt, new Date('2026-12-22T09:45:00+05:30'))).toBe(true);
    expect(recordsWindowOpen(startsAt, new Date('2026-12-23T10:00:00+05:30'))).toBe(true);
    expect(recordsWindowOpen(startsAt, new Date('2026-12-23T10:00:01+05:30'))).toBe(false);
  });
});

describe('slots (⚑3), in IST', () => {
  // 2026-12-21 is a Monday.
  const mon: WeeklyHours = { weekday: 1, start: '09:00', end: '10:00', types: ['video', 'audio'] };
  const now = new Date('2026-12-20T00:00:00+05:30');
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

  it('weekly hours cut into slots, in IST whatever the server clock', () => {
    const s = generateSlots({ hours: [mon], slotMinutes: 15, from: '2026-12-21', to: '2026-12-21', now });
    expect(s.map((x) => ist(x.startsAt))).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(s[0]!.startsAt.toISOString()).toBe('2026-12-21T03:30:00.000Z');
  });

  it('leave removes the day; extra hours add slots; taken and too-soon slots are left out', () => {
    expect(generateSlots({ hours: [mon], exceptions: [{ from: '2026-12-21', to: '2026-12-21', kind: 'off' }], slotMinutes: 15, from: '2026-12-21', to: '2026-12-21', now })).toEqual([]);
    const extra = generateSlots({ hours: [], exceptions: [{ from: '2026-12-22', to: '2026-12-22', kind: 'extra', start: '18:00', end: '18:30' }], slotMinutes: 15, from: '2026-12-22', to: '2026-12-22', now });
    expect(extra.map((x) => ist(x.startsAt))).toEqual(['18:00', '18:15']);
    const taken = generateSlots({ hours: [mon], slotMinutes: 15, from: '2026-12-21', to: '2026-12-21', taken: [new Date('2026-12-21T09:15:00+05:30')], now: new Date('2026-12-21T08:40:00+05:30') });
    // 09:00 is within the 30 min lead; 09:15 is taken.
    expect(taken.map((x) => ist(x.startsAt))).toEqual(['09:30', '09:45']);
  });

  it('filters by consult type', () => {
    const clinic: WeeklyHours = { weekday: 1, start: '17:00', end: '17:30', types: ['clinic'] };
    const s = generateSlots({ hours: [mon, clinic], slotMinutes: 30, from: '2026-12-21', to: '2026-12-21', now, type: 'clinic' });
    expect(s.map((x) => [ist(x.startsAt), x.types])).toEqual([['17:00', ['clinic']]]);
  });
});
