import { randomUUID } from 'node:crypto';
import type { Doctor, SavedHoursException, Specialty, WeeklyHours } from '@repo/contracts';
import type { ConsultsRepo } from '../src/modules/consults/repo';

/** In-memory ConsultsRepo. `accounts` stands in for auth.users + user_roles (email → sign-in). */
export function fakeConsults() {
  const specialties: Specialty[] = [];
  const doctors: Doctor[] = [];
  const hours = new Map<string, WeeklyHours[]>();
  const exceptions = new Map<string, SavedHoursException[]>();
  const accounts = new Map<string, { userId: string; isDoctor: boolean }>();
  const audit: { action: string; entityId: string }[] = [];
  const log = (action: string, entityId: string) => audit.push({ action, entityId });

  const repo: ConsultsRepo = {
    async specialties({ activeOnly }) {
      return specialties.filter((s) => !activeOnly || s.active).map((s) => ({ ...s }));
    },
    async addSpecialty(s) {
      if (specialties.some((x) => x.code === s.code)) return 'duplicate';
      const row = { ...s, id: randomUUID() };
      specialties.push(row);
      log('specialty_added', row.id);
      return { ...row };
    },
    async updateSpecialty(id, s) {
      const row = specialties.find((x) => x.id === id);
      if (!row) return null;
      Object.assign(row, s);
      log('specialty_updated', id);
      return { ...row };
    },
    async accountByEmail(email) {
      return accounts.get(email.toLowerCase()) ?? null;
    },
    async doctors() {
      return doctors.map((d) => ({ ...d }));
    },
    async doctor(id) {
      const d = doctors.find((x) => x.id === id);
      return d ? { ...d } : null;
    },
    async doctorByUser(userId) {
      const d = doctors.find((x) => x.userId === userId);
      return d ? { ...d } : null;
    },
    async createDoctor(userId, f) {
      if (doctors.some((d) => d.userId === userId || (d.council === f.council && d.registrationNo === f.registrationNo))) return 'duplicate';
      const email = [...accounts].find(([, a]) => a.userId === userId)?.[0] ?? null;
      const row: Doctor = {
        id: randomUUID(),
        userId,
        email,
        fullName: f.fullName,
        qualification: f.qualification,
        registrationNo: f.registrationNo,
        council: f.council,
        verifiedAt: null,
        feeVideoPaise: f.feeVideoPaise ?? null,
        feeAudioPaise: f.feeAudioPaise ?? null,
        feeClinicPaise: f.feeClinicPaise ?? null,
        slotMinutes: f.slotMinutes ?? 15,
        languages: f.languages ?? ['en'],
        clinicAddress: f.clinicAddress ?? null,
        specialtyIds: f.specialtyIds ?? [],
        active: false,
      };
      doctors.push(row);
      log('doctor_added', row.id);
      return { ...row };
    },
    async updateDoctor(id, f) {
      const d = doctors.find((x) => x.id === id);
      if (!d) return null;
      if (f.registrationNo && doctors.some((x) => x.id !== id && x.council === (f.council ?? d.council) && x.registrationNo === f.registrationNo)) return 'duplicate';
      const reverify = (f.registrationNo !== undefined && f.registrationNo !== d.registrationNo) || (f.council !== undefined && f.council !== d.council);
      Object.assign(d, f, reverify ? { verifiedAt: null, active: false } : {});
      log('doctor_updated', id);
      return { ...d };
    },
    async verifyDoctor(id) {
      const d = doctors.find((x) => x.id === id);
      if (!d) return null;
      d.verifiedAt = new Date().toISOString();
      log('doctor_verified', id);
      return { ...d };
    },
    async setDoctorActive(id, active) {
      const d = doctors.find((x) => x.id === id);
      if (!d) return null;
      d.active = active;
      log(active ? 'doctor_activated' : 'doctor_deactivated', id);
      return { ...d };
    },
    async hours(doctorId) {
      return (hours.get(doctorId) ?? []).map((h) => ({ ...h }));
    },
    async replaceHours(doctorId, h) {
      hours.set(doctorId, h.map((x) => ({ ...x })));
      log('doctor_hours_set', doctorId);
    },
    async exceptions(doctorId) {
      return [...(exceptions.get(doctorId) ?? [])];
    },
    async addException(doctorId, e) {
      const row = { ...e, id: randomUUID() };
      exceptions.set(doctorId, [...(exceptions.get(doctorId) ?? []), row]);
      log('doctor_exception_added', doctorId);
      return row;
    },
    async removeException(doctorId, id) {
      const list = exceptions.get(doctorId) ?? [];
      exceptions.set(doctorId, list.filter((x) => x.id !== id));
      return list.some((x) => x.id === id);
    },
  };
  return { repo, specialties, doctors, accounts, audit };
}
