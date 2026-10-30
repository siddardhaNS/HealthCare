import { randomUUID } from 'node:crypto';
import type { HandoverRepo, HandoverRow, HospitalRow, PatientData } from '../src/modules/handover/repo';
import type { HandoverNotifier } from '../src/modules/handover/service';
import type { IncidentRow } from '../src/modules/sos/repo';

export const emptyPatient = (): PatientData => ({
  name: null,
  dateOfBirth: null,
  sex: null,
  bloodGroup: null,
  allergies: [],
  conditions: [],
  medications: [],
  readings: [],
  contacts: [],
  insurance: [],
});

/** In-memory HandoverRepo mirroring the database (one handover per incident, confirm once). */
export function fakeHandovers(incidents: () => IncidentRow[]) {
  const hospitals: HospitalRow[] = [];
  const rows: (HandoverRow & { tokenHash: string })[] = [];
  const preferred = new Map<string, string | null>();
  const partners = new Map<string, string[]>();
  const patients = new Map<string, PatientData>();
  const shares: { subjectId: string; viewerId: string | null; viewerRole: string; items: readonly string[]; incidentId: string }[] = [];
  const audit: { action: string; entityId: string; metadata: Record<string, unknown> }[] = [];
  let clock = Date.now();

  const strip = ({ tokenHash: _t, ...h }: HandoverRow & { tokenHash: string }): HandoverRow => ({ ...h, items: [...h.items] });
  const named = (h: HandoverRow & { tokenHash: string }) => {
    const hospital = hospitals.find((x) => x.id === h.hospitalId)!;
    return strip({ ...h, hospitalName: hospital.name, erPhone: hospital.erPhone });
  };

  const addHospital = (p: Partial<HospitalRow> & { lat: number; lng: number }) => {
    const h: HospitalRow = {
      id: randomUUID(),
      name: `Hospital ${hospitals.length + 1}`,
      address: null,
      city: 'Hyderabad',
      erPhone: '+914012345678',
      hasCapacity: true,
      capacityUpdatedAt: null,
      active: true,
      ...p,
    };
    hospitals.push(h);
    return h;
  };

  const repo: HandoverRepo = {
    async hospitals() {
      return hospitals.map((h) => ({ ...h }));
    },
    async hospital(id) {
      const h = hospitals.find((x) => x.id === id);
      return h ? { ...h } : null;
    },
    async createHospital(actorId, f) {
      const h = addHospital({ ...f, capacityUpdatedAt: new Date() });
      audit.push({ action: 'hospital_created', entityId: h.id, metadata: { by: actorId } });
      return { ...h };
    },
    async updateHospital(actor, id, patch) {
      const h = hospitals.find((x) => x.id === id);
      if (!h) return null;
      Object.assign(h, patch, patch.hasCapacity !== undefined ? { capacityUpdatedAt: new Date() } : {});
      audit.push({
        action: patch.hasCapacity !== undefined && Object.keys(patch).length === 1 ? 'hospital_capacity' : 'hospital_updated',
        entityId: id,
        metadata: { by: actor.id, role: actor.role, changed: Object.keys(patch) },
      });
      return { ...h };
    },
    async preferredHospital(userId) {
      return preferred.get(userId) ?? null;
    },
    async setPreferredHospital(actorId, userId, hospitalId) {
      preferred.set(userId, hospitalId);
      audit.push({ action: 'preferred_hospital_set', entityId: userId, metadata: { by: actorId, hospital_id: hospitalId } });
    },
    async forIncident(incidentId) {
      const h = rows.find((x) => x.incidentId === incidentId);
      return h ? named(h) : null;
    },
    async byTokenHash(hash) {
      const h = rows.find((x) => x.tokenHash === hash);
      return h ? named(h) : null;
    },
    async forHospital(hospitalId, since) {
      return rows
        .filter((h) => h.hospitalId === hospitalId && h.createdAt >= since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(named);
    },
    async upsert(u) {
      const prev = rows.find((x) => x.incidentId === u.incidentId);
      const fields = {
        hospitalId: u.hospitalId,
        items: [...u.items],
        tokenHash: u.tokenHash,
        expiresAt: u.expiresAt,
        chosenBy: u.chosenBy,
        choiceReason: u.reason,
        preferred: u.preferred,
        confirmedAt: null,
        confirmedBy: null,
        createdAt: new Date(Math.max(Date.now(), (clock += 1000))),
      };
      audit.push({
        action: prev ? 'sos_handover_redirected' : 'sos_handover_opened',
        entityId: u.incidentId,
        metadata: { hospital_id: u.hospitalId, ...(prev ? { from_hospital_id: prev.hospitalId } : {}), chosen_by: u.chosenBy, items: [...u.items] },
      });
      if (prev) Object.assign(prev, fields);
      else rows.push({ id: randomUUID(), incidentId: u.incidentId, hospitalName: '', erPhone: '', firstAidNotesEnc: null, ...fields });
      const incident = incidents().find((i) => i.id === u.incidentId);
      if (incident) (incident as IncidentRow & { hospitalId?: string }).hospitalId = u.hospitalId;
      return named(rows.find((x) => x.incidentId === u.incidentId)!);
    },
    async setFirstAidNotes(incidentId, enc) {
      const h = rows.find((x) => x.incidentId === incidentId);
      if (!h) return false;
      h.firstAidNotesEnc = enc;
      return true;
    },
    async confirm(incidentId, by) {
      const h = rows.find((x) => x.incidentId === incidentId);
      if (!h || h.confirmedAt) return null;
      Object.assign(h, { confirmedAt: new Date(), confirmedBy: by });
      audit.push({ action: 'sos_handover_confirmed', entityId: incidentId, metadata: { by } });
      return named(h);
    },
    async partnerHospitals(userId) {
      return partners.get(userId) ?? [];
    },
    async patientData(subjectId) {
      return patients.get(subjectId) ?? emptyPatient();
    },
    async recordShare(s) {
      shares.push({ subjectId: s.subjectId, viewerId: s.viewerId, viewerRole: s.viewerRole, items: [...s.items], incidentId: s.incidentId });
    },
  };
  return { repo, hospitals, rows, preferred, partners, patients, shares, audit, addHospital };
}

/** Keeps the links "sent" so tests can open them. */
export function recordingNotifier() {
  const sent: { incidentId: string; hospitalId: string; url: string }[] = [];
  const notifier: HandoverNotifier = {
    async linkReady(n) {
      sent.push({ incidentId: n.incidentId, hospitalId: n.hospitalId, url: n.url });
    },
  };
  return { notifier, sent };
}
