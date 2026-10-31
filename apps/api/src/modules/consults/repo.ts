// Consults (docs/plans/phase-4-consults-calling.md): specialties, doctors and
// their hours. Every change by operations or a doctor is audited.
import type { ConsultType, Doctor, SavedHoursException as HoursException, Specialty, WeeklyHours } from '@repo/contracts';
import { and, asc, auditEvents, authUsers, doctorExceptions, doctorHours, doctorSpecialties, doctors, eq, inArray, specialties, sql, userRoles, type Db } from '@repo/db';

export type SpecialtyInputRow = Omit<Specialty, 'id'>;

export interface DoctorFields {
  fullName: string;
  qualification: string;
  registrationNo: string;
  council: string;
  feeVideoPaise?: number | null;
  feeAudioPaise?: number | null;
  feeClinicPaise?: number | null;
  slotMinutes?: number;
  languages?: ('en' | 'te' | 'hi')[];
  clinicAddress?: string | null;
  specialtyIds?: string[];
}

export interface ConsultsRepo {
  specialties(opts: { activeOnly: boolean }): Promise<Specialty[]>;
  addSpecialty(s: SpecialtyInputRow, actor: string): Promise<Specialty | 'duplicate'>;
  updateSpecialty(id: string, s: Partial<Omit<SpecialtyInputRow, 'code'>>, actor: string): Promise<Specialty | null>;
  /** The sign-in with this email, and whether it holds the doctor role. */
  accountByEmail(email: string): Promise<{ userId: string; isDoctor: boolean } | null>;
  doctors(): Promise<Doctor[]>;
  doctor(id: string): Promise<Doctor | null>;
  doctorByUser(userId: string): Promise<Doctor | null>;
  createDoctor(userId: string, f: DoctorFields, actor: string): Promise<Doctor | 'duplicate'>;
  updateDoctor(id: string, f: Partial<DoctorFields>, actor: string): Promise<Doctor | 'duplicate' | null>;
  verifyDoctor(id: string, actor: string): Promise<Doctor | null>;
  setDoctorActive(id: string, active: boolean, actor: string): Promise<Doctor | null>;
  hours(doctorId: string): Promise<WeeklyHours[]>;
  replaceHours(doctorId: string, hours: WeeklyHours[], actor: string): Promise<void>;
  exceptions(doctorId: string): Promise<HoursException[]>;
  addException(doctorId: string, e: Omit<HoursException, 'id'>, actor: string): Promise<HoursException>;
  removeException(doctorId: string, id: string, actor: string): Promise<boolean>;
}

const audit = (actor: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) => ({
  actorUserId: actor,
  actorRole: 'staff',
  action,
  entityType,
  entityId,
  metadata,
});
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);
const isUnique = (e: unknown) => (e as { code?: string }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505';

const SPEC = { id: specialties.id, code: specialties.code, names: specialties.names, keywords: specialties.keywords, active: specialties.active };

export function drizzleConsultsRepo(db: Db): ConsultsRepo {
  const loadDoctors = async (where?: ReturnType<typeof eq>) => {
    const rows = await db
      .select({ d: doctors, email: authUsers.email })
      .from(doctors)
      .leftJoin(authUsers, eq(authUsers.id, doctors.userId))
      .where(where)
      .orderBy(asc(doctors.fullName));
    const links = rows.length ? await db.select().from(doctorSpecialties).where(inArray(doctorSpecialties.doctorId, rows.map((r) => r.d.id))) : [];
    return rows.map(({ d, email }): Doctor => ({
      id: d.id,
      userId: d.userId,
      email,
      fullName: d.fullName,
      qualification: d.qualification,
      registrationNo: d.registrationNo,
      council: d.council,
      verifiedAt: d.verifiedAt?.toISOString() ?? null,
      feeVideoPaise: d.feeVideoPaise,
      feeAudioPaise: d.feeAudioPaise,
      feeClinicPaise: d.feeClinicPaise,
      slotMinutes: d.slotMinutes,
      languages: d.languages as Doctor['languages'],
      clinicAddress: d.clinicAddress,
      specialtyIds: links.filter((l) => l.doctorId === d.id).map((l) => l.specialtyId),
      active: d.active,
    }));
  };
  const one = async (id: string) => (await loadDoctors(eq(doctors.id, id)))[0] ?? null;

  return {
    async specialties({ activeOnly }) {
      const rows = await db.select(SPEC).from(specialties).where(activeOnly ? eq(specialties.active, true) : undefined).orderBy(sql`${specialties.names}->>'en'`);
      return rows as Specialty[];
    },
    async addSpecialty(s, actor) {
      try {
        return await db.transaction(async (tx) => {
          const [row] = await tx.insert(specialties).values(s).returning(SPEC);
          await tx.insert(auditEvents).values(audit(actor, 'specialty_added', 'specialty', row!.id, { code: s.code }));
          return row as Specialty;
        });
      } catch (e) {
        if (isUnique(e)) return 'duplicate';
        throw e;
      }
    },
    async updateSpecialty(id, s, actor) {
      return db.transaction(async (tx) => {
        const [row] = await tx.update(specialties).set(s).where(eq(specialties.id, id)).returning(SPEC);
        if (row) await tx.insert(auditEvents).values(audit(actor, 'specialty_updated', 'specialty', id, { fields: Object.keys(s) }));
        return (row as Specialty) ?? null;
      });
    },
    async accountByEmail(email) {
      const [u] = await db.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = ${email.toLowerCase()}`);
      if (!u) return null;
      const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, u.id));
      return { userId: u.id, isDoctor: roles.some((r) => r.role === 'doctor') };
    },
    doctors: () => loadDoctors(),
    doctor: one,
    async doctorByUser(userId) {
      return (await loadDoctors(eq(doctors.userId, userId)))[0] ?? null;
    },
    async createDoctor(userId, { specialtyIds = [], ...f }, actor) {
      try {
        const id = await db.transaction(async (tx) => {
          const [row] = await tx.insert(doctors).values({ userId, ...f }).returning({ id: doctors.id });
          if (specialtyIds.length) await tx.insert(doctorSpecialties).values(specialtyIds.map((specialtyId) => ({ doctorId: row!.id, specialtyId })));
          await tx.insert(auditEvents).values(audit(actor, 'doctor_added', 'doctor', row!.id, { registration_no: f.registrationNo, council: f.council }));
          return row!.id;
        });
        return (await one(id))!;
      } catch (e) {
        if (isUnique(e)) return 'duplicate';
        throw e;
      }
    },
    async updateDoctor(id, { specialtyIds, ...f }, actor) {
      try {
        const found = await db.transaction(async (tx) => {
          const [cur] = await tx.select({ registrationNo: doctors.registrationNo, council: doctors.council }).from(doctors).where(eq(doctors.id, id));
          if (!cur) return false;
          // Only a different number or council needs checking again (the edit form always sends both).
          const changesRegistration = (f.registrationNo !== undefined && f.registrationNo !== cur.registrationNo) || (f.council !== undefined && f.council !== cur.council);
          // A new registration number must be checked again before the doctor is bookable.
          const set = { ...f, ...(changesRegistration ? { verifiedAt: null, verifiedBy: null, active: false } : {}) };
          const [row] = Object.keys(set).length ? await tx.update(doctors).set(set).where(eq(doctors.id, id)).returning({ id: doctors.id }) : await tx.select({ id: doctors.id }).from(doctors).where(eq(doctors.id, id));
          if (!row) return false;
          if (specialtyIds) {
            await tx.delete(doctorSpecialties).where(eq(doctorSpecialties.doctorId, id));
            if (specialtyIds.length) await tx.insert(doctorSpecialties).values(specialtyIds.map((specialtyId) => ({ doctorId: id, specialtyId })));
          }
          await tx.insert(auditEvents).values(audit(actor, 'doctor_updated', 'doctor', id, { fields: [...Object.keys(f), ...(specialtyIds ? ['specialtyIds'] : [])], reverified: changesRegistration }));
          return true;
        });
        return found ? await one(id) : null;
      } catch (e) {
        if (isUnique(e)) return 'duplicate';
        throw e;
      }
    },
    async verifyDoctor(id, actor) {
      const ok = await db.transaction(async (tx) => {
        const [row] = await tx.update(doctors).set({ verifiedAt: new Date(), verifiedBy: actor }).where(eq(doctors.id, id)).returning({ id: doctors.id });
        if (row) await tx.insert(auditEvents).values(audit(actor, 'doctor_verified', 'doctor', id, {}));
        return !!row;
      });
      return ok ? one(id) : null;
    },
    async setDoctorActive(id, active, actor) {
      const ok = await db.transaction(async (tx) => {
        const [row] = await tx.update(doctors).set({ active }).where(eq(doctors.id, id)).returning({ id: doctors.id });
        if (row) await tx.insert(auditEvents).values(audit(actor, active ? 'doctor_activated' : 'doctor_deactivated', 'doctor', id, {}));
        return !!row;
      });
      return ok ? one(id) : null;
    },
    async hours(doctorId) {
      const rows = await db.select().from(doctorHours).where(eq(doctorHours.doctorId, doctorId)).orderBy(asc(doctorHours.weekday), asc(doctorHours.startTime));
      return rows.map((r) => ({ weekday: r.weekday, start: hm(r.startTime)!, end: hm(r.endTime)!, types: r.types as ConsultType[] }));
    },
    async replaceHours(doctorId, hours, actor) {
      await db.transaction(async (tx) => {
        await tx.delete(doctorHours).where(eq(doctorHours.doctorId, doctorId));
        if (hours.length) await tx.insert(doctorHours).values(hours.map((h) => ({ doctorId, weekday: h.weekday, startTime: h.start, endTime: h.end, types: [...h.types] })));
        await tx.insert(auditEvents).values(audit(actor, 'doctor_hours_set', 'doctor', doctorId, { rows: hours.length }));
      });
    },
    async exceptions(doctorId) {
      const rows = await db.select().from(doctorExceptions).where(eq(doctorExceptions.doctorId, doctorId)).orderBy(asc(doctorExceptions.fromDate));
      return rows.map((r) => ({ id: r.id, from: r.fromDate, to: r.toDate, kind: r.kind, start: hm(r.startTime), end: hm(r.endTime), types: (r.types as ConsultType[] | null) ?? null }));
    },
    async addException(doctorId, e, actor) {
      return db.transaction(async (tx) => {
        const [r] = await tx
          .insert(doctorExceptions)
          .values({ doctorId, fromDate: e.from, toDate: e.to, kind: e.kind, startTime: e.start, endTime: e.end, types: e.types ? [...e.types] : null })
          .returning();
        await tx.insert(auditEvents).values(audit(actor, 'doctor_exception_added', 'doctor', doctorId, { kind: e.kind, from: e.from, to: e.to }));
        return { id: r!.id, from: r!.fromDate, to: r!.toDate, kind: r!.kind, start: hm(r!.startTime), end: hm(r!.endTime), types: (r!.types as ConsultType[] | null) ?? null };
      });
    },
    async removeException(doctorId, id, actor) {
      return db.transaction(async (tx) => {
        const [r] = await tx.delete(doctorExceptions).where(and(eq(doctorExceptions.id, id), eq(doctorExceptions.doctorId, doctorId))).returning({ id: doctorExceptions.id });
        if (r) await tx.insert(auditEvents).values(audit(actor, 'doctor_exception_removed', 'doctor', doctorId, { id }));
        return !!r;
      });
    },
  };
}
