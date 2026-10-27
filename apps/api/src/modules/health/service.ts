import { bmi, checkVital, vitalStatus, vitalUnits, type Allergy, type Condition, type HealthSummary, type Medication, type VitalReading, type VitalReadingInput, type VitalType } from '@repo/contracts';
import { decryptJson, encryptJson } from '../../lib/crypto';
import type { AllergyRow, ConditionRow, DoseRow, HealthData, MedicationRow, ProfileRow, ReadingRow } from './repo';

// The service runs in India only; medicine schedules are local (IST) times.
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY = 86_400_000;

/** YYYY-MM-DD of an instant, in IST. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** The instant of a local IST date + HH:MM. */
export const istSlot = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - IST_OFFSET_MS);

export function toReading(r: ReadingRow, subject: string, heightCm: number | null): VitalReading {
  return {
    id: r.id,
    type: r.type as VitalType,
    value: r.value,
    value2: r.value2,
    unit: r.unit,
    context: r.context,
    source: r.source,
    takenAt: r.takenAt.toISOString(),
    status: vitalStatus(r.type as VitalType, r.value, r.value2, heightCm),
    enteredByOther: r.enteredBy !== subject,
  };
}

export type ReadingCheck = { ok: true; row: Omit<ReadingRow, 'id' | 'enteredBy'> } | { ok: false; code: string; message: string };

/** Validates a reading and shapes the row (unit from the type, source manual). */
export function prepareReading(input: VitalReadingInput, now = new Date()): ReadingCheck {
  const problem = checkVital(input.type, input.value, input.value2);
  if (problem) {
    const message = {
      out_of_range: 'That value is outside what a reading can be. Check it and enter it again.',
      needs_diastolic: 'Enter both numbers of the blood pressure (e.g. 120 / 80).',
      unexpected_second_value: 'Only blood pressure has a second number.',
    }[problem];
    return { ok: false, code: problem, message };
  }
  const takenAt = input.takenAt ? new Date(input.takenAt) : now;
  if (takenAt.getTime() > now.getTime() + 5 * 60_000) return { ok: false, code: 'future', message: 'The reading time is in the future.' };
  return {
    ok: true,
    row: { type: input.type, value: input.value, value2: input.type === 'bp' ? (input.value2 ?? null) : null, unit: vitalUnits[input.type], context: input.type === 'sugar' ? (input.context ?? 'random') : null, source: 'manual', takenAt },
  };
}

export function age(dateOfBirth: string | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const today = istDate(now).split('-').map(Number) as [number, number, number];
  return today[0] - y - (today[1] < m || (today[1] === m && today[2] < d) ? 1 : 0);
}

/** Taken ÷ scheduled (0–100) over the last 30 days, counting only slots already due. */
export function adherence30(med: MedicationRow, doses: DoseRow[], now = new Date()): number | null {
  if (med.schedule.length === 0) return null;
  const from = Math.max(now.getTime() - 30 * DAY, med.startDate ? istSlot(med.startDate, '00:00').getTime() : -Infinity);
  const until = Math.min(now.getTime(), med.endDate ? istSlot(med.endDate, '23:59').getTime() : Infinity);
  const mine = doses.filter((d) => d.medicationId === med.id && d.status === 'taken');
  let due = 0;
  let taken = 0;
  for (let day = istDate(new Date(from)); day <= istDate(new Date(until)); day = istDate(new Date(istSlot(day, '12:00').getTime() + DAY))) {
    for (const t of med.schedule) {
      const slot = istSlot(day, t).getTime();
      if (slot < from || slot > until) continue;
      due++;
      if (mine.some((d) => d.scheduledAt.getTime() === slot)) taken++;
    }
  }
  return due === 0 ? null : Math.round((taken / due) * 100);
}

export function toMedication(m: MedicationRow, doses: DoseRow[], now = new Date()): Medication {
  const today = istDate(now);
  return {
    id: m.id,
    name: m.name,
    strength: m.strength,
    dose: m.dose,
    frequency: m.frequency,
    schedule: m.schedule,
    startDate: m.startDate,
    endDate: m.endDate,
    active: m.active,
    adherence30: adherence30(m, doses, now),
    today: m.schedule.map((time) => {
      const slot = istSlot(today, time).getTime();
      const d = doses.find((x) => x.medicationId === m.id && x.scheduledAt.getTime() === slot);
      return { time, status: (d?.status as 'taken' | 'skipped' | 'missed' | undefined) ?? 'due' };
    }),
  };
}

export const encNotes = (key: Buffer, notes: string | undefined | null) => (notes ? encryptJson(key, notes) : null);
export const decNotes = (key: Buffer, enc: string | null) => (enc ? decryptJson<string>(key, enc) : null);

export const toCondition = (c: ConditionRow, key: Buffer): Condition => ({ id: c.id, name: c.name, status: c.status as Condition['status'], diagnosedOn: c.diagnosedOn, notes: decNotes(key, c.notesEnc) });
export const toAllergy = (a: AllergyRow): Allergy => ({ id: a.id, substance: a.substance, severity: a.severity as Allergy['severity'], reaction: a.reaction });

const emptyProfile: ProfileRow = { bloodGroup: null, heightCm: null, dateOfBirth: null, sex: null };

export function toSummary(subject: string, data: HealthData, key: Buffer, now = new Date()): HealthSummary {
  const profile = data.profile ?? emptyProfile;
  const latest = Object.fromEntries((['bp', 'pulse', 'spo2', 'sugar', 'temp', 'weight'] as const).map((t) => [t, null])) as HealthSummary['latest'];
  for (const r of data.readings) latest[r.type as VitalType] ??= toReading(r, subject, profile.heightCm);
  const weight = latest.weight?.value;
  return {
    profile: profile as HealthSummary['profile'],
    age: age(profile.dateOfBirth, now),
    bmi: weight && profile.heightCm ? bmi(weight, profile.heightCm) : null,
    latest,
    conditions: data.conditions.map((c) => toCondition(c, key)),
    allergies: data.allergies.map(toAllergy),
    medications: data.medications.map((m) => toMedication(m, data.doses, now)),
  };
}
