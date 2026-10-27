import { allergies, and, asUser, conditions, desc, eq, gte, healthProfiles, isNull, medicationDoses, medications, recordShares, vitalReadings, type Db } from '@repo/db';

type Table = 'conditions' | 'allergies' | 'medications';

export interface ProfileRow {
  bloodGroup: string | null;
  heightCm: number | null;
  dateOfBirth: string | null;
  sex: string | null;
}
export interface ReadingRow {
  id: string;
  type: string;
  value: number;
  value2: number | null;
  unit: string;
  context: string | null;
  source: string;
  takenAt: Date;
  enteredBy: string;
}
export interface ConditionRow {
  id: string;
  name: string;
  status: string;
  diagnosedOn: string | null;
  notesEnc: string | null;
}
export interface AllergyRow {
  id: string;
  substance: string;
  severity: string;
  reaction: string | null;
}
export interface MedicationRow {
  id: string;
  name: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  schedule: string[];
  startDate: string | null;
  endDate: string | null;
  active: boolean;
}
export interface DoseRow {
  medicationId: string;
  scheduledAt: Date;
  status: string;
}

export interface HealthData {
  profile: ProfileRow | null;
  readings: ReadingRow[];
  conditions: ConditionRow[];
  allergies: AllergyRow[];
  medications: MedicationRow[];
  doses: DoseRow[];
}

/**
 * `actor` is who is asking (the person, or a manager). Implementations run
 * as that user so Postgres RLS (can_act_for) applies; the service checks the
 * same rule first so a refusal is a clean 403, not a database error.
 */
export interface HealthRepo {
  profile(actor: string, subject: string): Promise<ProfileRow | null>;
  saveProfile(actor: string, subject: string, p: ProfileRow): Promise<void>;
  addReading(actor: string, subject: string, r: Omit<ReadingRow, 'id' | 'enteredBy'>): Promise<ReadingRow>;
  readings(actor: string, subject: string, type: string, limit: number): Promise<ReadingRow[]>;
  latestReadings(actor: string, subject: string): Promise<ReadingRow[]>;
  softDelete(actor: string, subject: string, table: Table | 'vital_readings', id: string): Promise<boolean>;
  conditions(actor: string, subject: string): Promise<ConditionRow[]>;
  addCondition(actor: string, subject: string, c: Omit<ConditionRow, 'id'>): Promise<ConditionRow>;
  allergies(actor: string, subject: string): Promise<AllergyRow[]>;
  addAllergy(actor: string, subject: string, a: Omit<AllergyRow, 'id'>): Promise<AllergyRow>;
  medications(actor: string, subject: string): Promise<MedicationRow[]>;
  addMedication(actor: string, subject: string, m: Omit<MedicationRow, 'id' | 'active'>): Promise<MedicationRow>;
  doses(actor: string, subject: string, since: Date): Promise<DoseRow[]>;
  markDose(actor: string, subject: string, d: DoseRow): Promise<void>;
  /** Care team read (service role); the route has already checked role + consent. */
  dataForStaff(subject: string, since: Date): Promise<HealthData>;
  /** Records a disclosure in record_shares (append-only). */
  recordShare(s: { subjectId: string; viewerId: string; viewerRole: string; purpose: string; items: string[]; contextType: 'care_team' }): Promise<void>;
}

const live = <T extends { deletedAt: unknown; userId: unknown }>(t: T, subject: string) => and(eq(t.userId as never, subject), isNull(t.deletedAt as never));

export function drizzleHealthRepo(db: Db): HealthRepo {
  const run = <T>(actor: string, fn: Parameters<typeof asUser<T>>[2]) => asUser<T>(db, { sub: actor }, fn);
  const readingCols = { id: vitalReadings.id, type: vitalReadings.type, value: vitalReadings.value, value2: vitalReadings.value2, unit: vitalReadings.unit, context: vitalReadings.context, source: vitalReadings.source, takenAt: vitalReadings.takenAt, enteredBy: vitalReadings.enteredBy };
  const condCols = { id: conditions.id, name: conditions.name, status: conditions.status, diagnosedOn: conditions.diagnosedOn, notesEnc: conditions.notesEnc };
  const allergyCols = { id: allergies.id, substance: allergies.substance, severity: allergies.severity, reaction: allergies.reaction };
  const medCols = { id: medications.id, name: medications.name, strength: medications.strength, dose: medications.dose, frequency: medications.frequency, schedule: medications.schedule, startDate: medications.startDate, endDate: medications.endDate, active: medications.active };
  const profileCols = { bloodGroup: healthProfiles.bloodGroup, heightCm: healthProfiles.heightCm, dateOfBirth: healthProfiles.dateOfBirth, sex: healthProfiles.sex };
  const tables = { conditions, allergies, medications, vital_readings: vitalReadings };

  // Latest reading per type, newest first.
  const latestQuery = (tx: Pick<Db, 'selectDistinctOn'>, subject: string) =>
    tx.selectDistinctOn([vitalReadings.type], readingCols).from(vitalReadings).where(live(vitalReadings, subject)).orderBy(vitalReadings.type, desc(vitalReadings.takenAt));

  return {
    profile: (actor, subject) => run(actor, async (tx) => (await tx.select(profileCols).from(healthProfiles).where(live(healthProfiles, subject)))[0] ?? null),
    saveProfile: (actor, subject, p) =>
      run(actor, async (tx) => {
        await tx.insert(healthProfiles).values({ userId: subject, enteredBy: actor, ...p }).onConflictDoUpdate({ target: healthProfiles.userId, set: { ...p, enteredBy: actor } });
      }),
    addReading: (actor, subject, r) => run(actor, async (tx) => (await tx.insert(vitalReadings).values({ ...r, userId: subject, enteredBy: actor }).returning(readingCols))[0]!),
    readings: (actor, subject, type, limit) =>
      run(actor, (tx) => tx.select(readingCols).from(vitalReadings).where(and(live(vitalReadings, subject), eq(vitalReadings.type, type))).orderBy(desc(vitalReadings.takenAt)).limit(limit)),
    latestReadings: (actor, subject) => run(actor, (tx) => latestQuery(tx, subject)),
    softDelete: (actor, subject, table, id) =>
      run(actor, async (tx) => {
        const t = tables[table];
        const rows = await tx
          .update(t)
          .set({ deletedAt: new Date() })
          .where(and(eq(t.id, id), live(t, subject)))
          .returning({ id: t.id });
        return rows.length > 0;
      }),
    conditions: (actor, subject) => run(actor, (tx) => tx.select(condCols).from(conditions).where(live(conditions, subject)).orderBy(conditions.createdAt)),
    addCondition: (actor, subject, c) => run(actor, async (tx) => (await tx.insert(conditions).values({ ...c, userId: subject, enteredBy: actor }).returning(condCols))[0]!),
    allergies: (actor, subject) => run(actor, (tx) => tx.select(allergyCols).from(allergies).where(live(allergies, subject)).orderBy(allergies.createdAt)),
    addAllergy: (actor, subject, a) => run(actor, async (tx) => (await tx.insert(allergies).values({ ...a, userId: subject, enteredBy: actor }).returning(allergyCols))[0]!),
    medications: (actor, subject) => run(actor, (tx) => tx.select(medCols).from(medications).where(live(medications, subject)).orderBy(medications.createdAt)),
    addMedication: (actor, subject, m) => run(actor, async (tx) => (await tx.insert(medications).values({ ...m, userId: subject, enteredBy: actor }).returning(medCols))[0]!),
    doses: (actor, subject, since) =>
      run(actor, (tx) =>
        tx
          .select({ medicationId: medicationDoses.medicationId, scheduledAt: medicationDoses.scheduledAt, status: medicationDoses.status })
          .from(medicationDoses)
          .where(and(live(medicationDoses, subject), gte(medicationDoses.scheduledAt, since))),
      ),
    markDose: (actor, subject, d) =>
      run(actor, async (tx) => {
        await tx
          .insert(medicationDoses)
          .values({ userId: subject, enteredBy: actor, medicationId: d.medicationId, scheduledAt: d.scheduledAt, status: d.status, takenAt: d.status === 'taken' ? new Date() : null })
          .onConflictDoUpdate({ target: [medicationDoses.medicationId, medicationDoses.scheduledAt], set: { status: d.status, takenAt: d.status === 'taken' ? new Date() : null, enteredBy: actor } });
      }),
    async dataForStaff(subject, since) {
      const [profile] = await db.select(profileCols).from(healthProfiles).where(live(healthProfiles, subject));
      return {
        profile: profile ?? null,
        readings: await latestQuery(db, subject),
        conditions: await db.select(condCols).from(conditions).where(live(conditions, subject)),
        allergies: await db.select(allergyCols).from(allergies).where(live(allergies, subject)),
        medications: await db.select(medCols).from(medications).where(live(medications, subject)),
        doses: await db
          .select({ medicationId: medicationDoses.medicationId, scheduledAt: medicationDoses.scheduledAt, status: medicationDoses.status })
          .from(medicationDoses)
          .where(and(live(medicationDoses, subject), gte(medicationDoses.scheduledAt, since))),
      };
    },
    async recordShare(s) {
      await db.insert(recordShares).values(s);
    },
  };
}
