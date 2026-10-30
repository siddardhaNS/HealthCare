import type { HandoverItem } from '@repo/contracts';
import {
  allergies,
  and,
  auditEvents,
  conditions,
  desc,
  emergencyContacts,
  eq,
  gte,
  healthProfiles,
  hospitalHandovers,
  hospitals,
  insurancePolicies,
  isNull,
  medications,
  profiles,
  recordShares,
  sosIncidents,
  sql,
  userRoles,
  vitalReadings,
  type Db,
} from '@repo/db';
import type { AllergyRow, ConditionRow, InsuranceRow, MedicationRow, ReadingRow } from '../health/repo';

export interface HospitalRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  erPhone: string;
  hasCapacity: boolean;
  capacityUpdatedAt: Date | null;
  active: boolean;
}

export interface HospitalFields {
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  erPhone: string;
}

export interface HandoverRow {
  id: string;
  incidentId: string;
  hospitalId: string;
  hospitalName: string;
  erPhone: string;
  items: HandoverItem[];
  expiresAt: Date;
  firstAidNotesEnc: string | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  chosenBy: 'auto' | 'crew' | 'desk';
  choiceReason: string | null;
  preferred: boolean;
  createdAt: Date;
}

/** Everything a handover may carry; the policy keeps only the consented items. */
export interface PatientData {
  name: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  bloodGroup: string | null;
  allergies: Omit<AllergyRow, 'id'>[];
  conditions: Pick<ConditionRow, 'name' | 'status'>[];
  medications: Pick<MedicationRow, 'name' | 'strength' | 'dose' | 'frequency' | 'active'>[];
  readings: Pick<ReadingRow, 'type' | 'value' | 'value2' | 'unit' | 'takenAt'>[];
  contacts: { name: string; relation: string | null; phone: string }[];
  insurance: Pick<InsuranceRow, 'insurer' | 'policyNumberEnc' | 'memberIdEnc' | 'validUntil'>[];
}

export interface HandoverUpsert {
  incidentId: string;
  subjectId: string;
  hospitalId: string;
  items: readonly HandoverItem[];
  tokenHash: string;
  expiresAt: Date;
  chosenBy: 'auto' | 'crew' | 'desk';
  reason: string | null;
  preferred: boolean;
  actor: { id: string | null; role: string };
}

/** Service-role access: the routes check role, scope and consent first. */
export interface HandoverRepo {
  hospitals(): Promise<HospitalRow[]>;
  hospital(id: string): Promise<HospitalRow | null>;
  createHospital(actorId: string, h: HospitalFields): Promise<HospitalRow>;
  /** Audited with the fields changed. Null if there is no such hospital. */
  updateHospital(
    actor: { id: string; role: string },
    id: string,
    patch: Partial<HospitalFields> & { active?: boolean; hasCapacity?: boolean },
  ): Promise<HospitalRow | null>;
  preferredHospital(userId: string): Promise<string | null>;
  setPreferredHospital(actorId: string, userId: string, hospitalId: string | null): Promise<void>;
  forIncident(incidentId: string): Promise<HandoverRow | null>;
  byTokenHash(hash: string): Promise<HandoverRow | null>;
  /** The hospital's handovers since `since`, newest first. */
  forHospital(hospitalId: string, since: Date): Promise<HandoverRow[]>;
  /**
   * Creates the incident's handover or moves it to another hospital: new
   * link (the old one stops working), confirmation cleared, the incident's
   * hospital set. Audited in the same transaction.
   */
  upsert(h: HandoverUpsert): Promise<HandoverRow>;
  setFirstAidNotes(incidentId: string, enc: string): Promise<boolean>;
  /** Records receipt once. Null if there is no handover or it was already confirmed. */
  confirm(incidentId: string, by: string): Promise<HandoverRow | null>;
  /** Hospitals a partner user works for (user_roles: hospital, scoped to the partner). */
  partnerHospitals(userId: string): Promise<string[]>;
  patientData(subjectId: string): Promise<PatientData>;
  recordShare(s: {
    subjectId: string;
    viewerId: string | null;
    viewerRole: string;
    items: readonly string[];
    incidentId: string;
    expiresAt: Date;
  }): Promise<void>;
}

const live = <T extends { deletedAt: unknown; userId: unknown }>(t: T, subject: string) => and(eq(t.userId as never, subject), isNull(t.deletedAt as never));
const geo = (lat: number, lng: number) => sql`extensions.st_setsrid(extensions.st_makepoint(${lng}, ${lat}), 4326)::extensions.geography` as unknown as string;

export function drizzleHandoverRepo(db: Db): HandoverRepo {
  const hospitalCols = {
    id: hospitals.id,
    name: hospitals.name,
    address: hospitals.address,
    city: hospitals.city,
    lat: sql<number>`extensions.st_y(${hospitals.location}::extensions.geometry)`,
    lng: sql<number>`extensions.st_x(${hospitals.location}::extensions.geometry)`,
    erPhone: hospitals.erPhone,
    hasCapacity: hospitals.hasCapacity,
    capacityUpdatedAt: hospitals.capacityUpdatedAt,
    active: hospitals.active,
  };
  const handoverCols = {
    id: hospitalHandovers.id,
    incidentId: hospitalHandovers.incidentId,
    hospitalId: hospitalHandovers.hospitalId,
    hospitalName: hospitals.name,
    erPhone: hospitals.erPhone,
    items: hospitalHandovers.items,
    expiresAt: hospitalHandovers.expiresAt,
    firstAidNotesEnc: hospitalHandovers.firstAidNotesEnc,
    confirmedAt: hospitalHandovers.confirmedAt,
    confirmedBy: hospitalHandovers.confirmedBy,
    chosenBy: hospitalHandovers.chosenBy,
    choiceReason: hospitalHandovers.choiceReason,
    preferred: hospitalHandovers.preferred,
    createdAt: hospitalHandovers.createdAt,
  };
  const selectHandovers = () => db.select(handoverCols).from(hospitalHandovers).innerJoin(hospitals, eq(hospitals.id, hospitalHandovers.hospitalId));
  const one = async (where: ReturnType<typeof eq>) => ((await selectHandovers().where(where))[0] as HandoverRow | undefined) ?? null;
  const audit = (actor: { id: string | null; role: string }, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) => ({
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    metadata,
  });

  return {
    async hospitals() {
      return db.select(hospitalCols).from(hospitals).orderBy(hospitals.name);
    },
    async hospital(id) {
      return (await db.select(hospitalCols).from(hospitals).where(eq(hospitals.id, id)))[0] ?? null;
    },
    async createHospital(actorId, h) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(hospitals)
          .values({ name: h.name, address: h.address, city: h.city, erPhone: h.erPhone, location: geo(h.lat, h.lng), capacityUpdatedAt: new Date() })
          .returning(hospitalCols);
        await tx.insert(auditEvents).values(audit({ id: actorId, role: 'staff' }, 'hospital_created', 'hospital', row!.id, { name: h.name }));
        return row!;
      });
    },
    async updateHospital(actor, id, patch) {
      return db.transaction(async (tx) => {
        const { lat, lng, ...rest } = patch;
        const set = {
          ...rest,
          ...(lat !== undefined && lng !== undefined ? { location: geo(lat, lng) } : {}),
          ...(patch.hasCapacity !== undefined ? { capacityUpdatedAt: new Date() } : {}),
        };
        const [row] = await tx.update(hospitals).set(set).where(eq(hospitals.id, id)).returning(hospitalCols);
        if (!row) return null;
        const changed = Object.keys(patch)
          .filter((k) => k !== 'lng')
          .map((k) => (k === 'lat' ? 'location' : k));
        await tx
          .insert(auditEvents)
          .values(
            audit(actor, patch.hasCapacity !== undefined && changed.length === 1 ? 'hospital_capacity' : 'hospital_updated', 'hospital', id, {
              changed,
              ...(patch.hasCapacity !== undefined ? { has_capacity: patch.hasCapacity } : {}),
            }),
          );
        return row;
      });
    },
    async preferredHospital(userId) {
      const [r] = await db.select({ id: profiles.preferredHospitalId }).from(profiles).where(eq(profiles.userId, userId));
      return r?.id ?? null;
    },
    async setPreferredHospital(actorId, userId, hospitalId) {
      await db.transaction(async (tx) => {
        await tx.update(profiles).set({ preferredHospitalId: hospitalId }).where(eq(profiles.userId, userId));
        await tx.insert(auditEvents).values(audit({ id: actorId, role: 'resident' }, 'preferred_hospital_set', 'profile', userId, { hospital_id: hospitalId }));
      });
    },
    forIncident: (incidentId) => one(eq(hospitalHandovers.incidentId, incidentId)),
    byTokenHash: (hash) => one(eq(hospitalHandovers.tokenHash, hash)),
    async forHospital(hospitalId, since) {
      return (await selectHandovers()
        .where(and(eq(hospitalHandovers.hospitalId, hospitalId), gte(hospitalHandovers.createdAt, since)))
        .orderBy(desc(hospitalHandovers.createdAt))) as HandoverRow[];
    },
    async upsert(h) {
      return db.transaction(async (tx) => {
        const [prev] = await tx
          .select({ hospitalId: hospitalHandovers.hospitalId })
          .from(hospitalHandovers)
          .where(eq(hospitalHandovers.incidentId, h.incidentId));
        const values = {
          hospitalId: h.hospitalId,
          items: [...h.items],
          tokenHash: h.tokenHash,
          expiresAt: h.expiresAt,
          chosenBy: h.chosenBy,
          choiceReason: h.reason,
          preferred: h.preferred,
          confirmedAt: null,
          confirmedBy: null,
        };
        await tx
          .insert(hospitalHandovers)
          .values({ incidentId: h.incidentId, ...values })
          .onConflictDoUpdate({ target: hospitalHandovers.incidentId, set: { ...values, createdAt: sql`now()` } });
        await tx.update(sosIncidents).set({ hospitalId: h.hospitalId }).where(eq(sosIncidents.id, h.incidentId));
        await tx.insert(auditEvents).values(
          audit(h.actor, prev ? 'sos_handover_redirected' : 'sos_handover_opened', 'sos_incident', h.incidentId, {
            subject_id: h.subjectId,
            hospital_id: h.hospitalId,
            ...(prev ? { from_hospital_id: prev.hospitalId } : {}),
            chosen_by: h.chosenBy,
            preferred: h.preferred,
            items: [...h.items],
          }),
        );
        return (
          await tx
            .select(handoverCols)
            .from(hospitalHandovers)
            .innerJoin(hospitals, eq(hospitals.id, hospitalHandovers.hospitalId))
            .where(eq(hospitalHandovers.incidentId, h.incidentId))
        )[0] as HandoverRow;
      });
    },
    async setFirstAidNotes(incidentId, enc) {
      const r = await db
        .update(hospitalHandovers)
        .set({ firstAidNotesEnc: enc })
        .where(eq(hospitalHandovers.incidentId, incidentId))
        .returning({ id: hospitalHandovers.id });
      return r.length > 0;
    },
    async confirm(incidentId, by) {
      return db.transaction(async (tx) => {
        const r = await tx
          .update(hospitalHandovers)
          .set({ confirmedAt: new Date(), confirmedBy: by })
          .where(and(eq(hospitalHandovers.incidentId, incidentId), isNull(hospitalHandovers.confirmedAt)))
          .returning({ hospitalId: hospitalHandovers.hospitalId });
        if (r.length === 0) return null;
        await tx
          .insert(auditEvents)
          .values(audit({ id: by, role: 'hospital' }, 'sos_handover_confirmed', 'sos_incident', incidentId, { hospital_id: r[0]!.hospitalId }));
        return (
          await tx
            .select(handoverCols)
            .from(hospitalHandovers)
            .innerJoin(hospitals, eq(hospitals.id, hospitalHandovers.hospitalId))
            .where(eq(hospitalHandovers.incidentId, incidentId))
        )[0] as HandoverRow;
      });
    },
    async partnerHospitals(userId) {
      const rows = await db
        .select({ id: userRoles.scopeId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'hospital'), eq(userRoles.scopeType, 'partner')));
      return rows.map((r) => r.id!).filter(Boolean);
    },
    async patientData(subject) {
      const [person] = await db.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.userId, subject));
      const [hp] = await db
        .select({ bloodGroup: healthProfiles.bloodGroup, dateOfBirth: healthProfiles.dateOfBirth, sex: healthProfiles.sex })
        .from(healthProfiles)
        .where(live(healthProfiles, subject));
      return {
        name: person?.name ?? null,
        dateOfBirth: hp?.dateOfBirth ?? null,
        sex: hp?.sex ?? null,
        bloodGroup: hp?.bloodGroup ?? null,
        allergies: await db
          .select({ substance: allergies.substance, severity: allergies.severity, reaction: allergies.reaction })
          .from(allergies)
          .where(live(allergies, subject)),
        conditions: await db.select({ name: conditions.name, status: conditions.status }).from(conditions).where(live(conditions, subject)),
        medications: await db
          .select({
            name: medications.name,
            strength: medications.strength,
            dose: medications.dose,
            frequency: medications.frequency,
            active: medications.active,
          })
          .from(medications)
          .where(live(medications, subject)),
        readings: await db
          .selectDistinctOn([vitalReadings.type], {
            type: vitalReadings.type,
            value: vitalReadings.value,
            value2: vitalReadings.value2,
            unit: vitalReadings.unit,
            takenAt: vitalReadings.takenAt,
          })
          .from(vitalReadings)
          .where(live(vitalReadings, subject))
          .orderBy(vitalReadings.type, desc(vitalReadings.takenAt)),
        contacts: await db
          .select({ name: emergencyContacts.name, relation: emergencyContacts.relation, phone: emergencyContacts.phone })
          .from(emergencyContacts)
          .where(eq(emergencyContacts.userId, subject))
          .orderBy(emergencyContacts.priority, emergencyContacts.createdAt),
        insurance: await db
          .select({
            insurer: insurancePolicies.insurer,
            policyNumberEnc: insurancePolicies.policyNumberEnc,
            memberIdEnc: insurancePolicies.memberIdEnc,
            validUntil: insurancePolicies.validUntil,
          })
          .from(insurancePolicies)
          .where(live(insurancePolicies, subject)),
      };
    },
    async recordShare(s) {
      await db.insert(recordShares).values({
        subjectId: s.subjectId,
        viewerId: s.viewerId,
        viewerRole: s.viewerRole,
        purpose: 'emergency_share',
        items: [...s.items],
        contextType: 'sos',
        contextId: s.incidentId,
        expiresAt: s.expiresAt,
      });
    },
  };
}
