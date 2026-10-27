import { randomUUID } from 'node:crypto';
import type { ConsentRow } from '../src/modules/consent/policy';
import type { AllergyRow, ConditionRow, DeviceRow, DoseRow, HealthRepo, InsuranceRow, MedicationRow, ProfileRow, ReadingRow, VaccinationRow } from '../src/modules/health/repo';
import type { HouseholdsRepo } from '../src/modules/households/repo';
import { canActFor } from '../src/modules/households/service';

type Owned<T> = T & { userId: string; enteredBy: string; deleted: boolean; at: number };

/**
 * In-memory HealthRepo. Person/manager calls enforce the same rule as the
 * database's RLS (can_act_for) and throw like Postgres would if it fails.
 */
export function fakeHealth(households: HouseholdsRepo, _consents: ConsentRow[]) {
  const profiles = new Map<string, ProfileRow>();
  const readings: Owned<ReadingRow>[] = [];
  const conditions: Owned<ConditionRow>[] = [];
  const allergies: Owned<AllergyRow>[] = [];
  const medications: Owned<MedicationRow>[] = [];
  const doses: Owned<DoseRow>[] = [];
  const vaccinations: Owned<VaccinationRow>[] = [];
  const insurance: Owned<InsuranceRow>[] = [];
  const devices: Owned<DeviceRow>[] = [];
  const shares: { subjectId: string; viewerId: string; viewerRole: string; purpose: string; items: string[] }[] = [];
  let at = 0;

  async function rls(actor: string, subject: string) {
    if (!(await canActFor(households, actor, subject))) throw new Error('RLS: new row violates row-level security policy');
  }
  const mine = <T extends { userId: string; deleted: boolean }>(rows: T[], subject: string) => rows.filter((r) => r.userId === subject && !r.deleted);
  const strip = <T extends object>(r: Owned<T>): T => {
    const { userId: _u, deleted: _d, at: _a, ...rest } = r;
    return rest as unknown as T;
  };

  const repo: HealthRepo = {
    async profile(actor, subject) {
      await rls(actor, subject);
      return profiles.get(subject) ?? null;
    },
    async saveProfile(actor, subject, p) {
      await rls(actor, subject);
      profiles.set(subject, p);
    },
    async addReading(actor, subject, r) {
      await rls(actor, subject);
      const row = { ...r, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      readings.push(row);
      return { ...strip(row), enteredBy: actor };
    },
    async readings(actor, subject, type, limit) {
      await rls(actor, subject);
      return mine(readings, subject)
        .filter((r) => r.type === type)
        .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...strip(r), enteredBy: r.enteredBy }));
    },
    async latestReadings(actor, subject) {
      await rls(actor, subject);
      const best = new Map<string, Owned<ReadingRow>>();
      for (const r of mine(readings, subject)) if (!best.has(r.type) || r.takenAt > best.get(r.type)!.takenAt) best.set(r.type, r);
      return [...best.values()].map((r) => ({ ...strip(r), enteredBy: r.enteredBy }));
    },
    async softDelete(actor, subject, table, id) {
      await rls(actor, subject);
      const list = { vital_readings: readings, conditions, allergies, medications, vaccinations, insurance_policies: insurance, devices }[table] as Owned<{ id: string }>[];
      const row = mine(list, subject).find((r) => r.id === id);
      if (!row) return false;
      row.deleted = true;
      return true;
    },
    async conditions(actor, subject) {
      await rls(actor, subject);
      return mine(conditions, subject).map(strip);
    },
    async addCondition(actor, subject, c) {
      await rls(actor, subject);
      const row = { ...c, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      conditions.push(row);
      return strip(row);
    },
    async allergies(actor, subject) {
      await rls(actor, subject);
      return mine(allergies, subject).map(strip);
    },
    async addAllergy(actor, subject, a) {
      await rls(actor, subject);
      const row = { ...a, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      allergies.push(row);
      return strip(row);
    },
    async medications(actor, subject) {
      await rls(actor, subject);
      return mine(medications, subject).map(strip);
    },
    async addMedication(actor, subject, m) {
      await rls(actor, subject);
      const row = { ...m, active: true, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      medications.push(row);
      return strip(row);
    },
    async doses(actor, subject, since) {
      await rls(actor, subject);
      return mine(doses, subject).filter((d) => d.scheduledAt >= since).map(strip);
    },
    async markDose(actor, subject, d) {
      await rls(actor, subject);
      const existing = doses.find((x) => x.medicationId === d.medicationId && x.scheduledAt.getTime() === d.scheduledAt.getTime());
      if (existing) existing.status = d.status;
      else doses.push({ ...d, userId: subject, enteredBy: actor, deleted: false, at: ++at });
    },
    async vaccinations(actor, subject) {
      await rls(actor, subject);
      return mine(vaccinations, subject).map(strip);
    },
    async addVaccination(actor, subject, v) {
      await rls(actor, subject);
      const row = { ...v, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      vaccinations.push(row);
      return strip(row);
    },
    async insurance(actor, subject) {
      await rls(actor, subject);
      return mine(insurance, subject).map(strip);
    },
    async addInsurance(actor, subject, i) {
      await rls(actor, subject);
      const row = { ...i, cardPath: null, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      insurance.push(row);
      return strip(row);
    },
    async devices(actor, subject) {
      await rls(actor, subject);
      return mine(devices, subject).map(strip);
    },
    async addDevice(actor, subject, d) {
      await rls(actor, subject);
      const row = { ...d, lastSyncAt: null, id: randomUUID(), userId: subject, enteredBy: actor, deleted: false, at: ++at };
      devices.push(row);
      return strip(row);
    },
    async dataForStaff(subject, since) {
      const best = new Map<string, Owned<ReadingRow>>();
      for (const r of mine(readings, subject)) if (!best.has(r.type) || r.takenAt > best.get(r.type)!.takenAt) best.set(r.type, r);
      return {
        profile: profiles.get(subject) ?? null,
        readings: [...best.values()].map((r) => ({ ...strip(r), enteredBy: r.enteredBy })),
        conditions: mine(conditions, subject).map(strip),
        allergies: mine(allergies, subject).map(strip),
        medications: mine(medications, subject).map(strip),
        doses: mine(doses, subject).filter((d) => d.scheduledAt >= since).map(strip),
      };
    },
    async recordShare(s) {
      shares.push(s);
    },
  };
  return { repo, conditions, shares, doses, insurance };
}
