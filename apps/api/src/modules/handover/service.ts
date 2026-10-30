// Hospital handover (docs/plans/phase-3-sos.md §3.7, §10): which hospital
// receives the patient, what it may see, and the ER's confirmation.
import { allowedHandoverItems, type HandoverLinkView, type PartnerHandover, type PartnerHandoverDetail } from '@repo/contracts';
import { crewActiveStates, distanceM, estimateEtaS, sosRef } from '@repo/contracts/sos';
import type { CrewLocator } from '../../lib/crew-locator';
import { encryptJson } from '../../lib/crypto';
import { silentRealtime, type Realtime } from '../../lib/realtime';
import type { ConsentRepo } from '../consent/repo';
import { isGranted } from '../consent/policy';
import type { DispatchRepo } from '../dispatch/repo';
import { publishDesk } from '../sos/live';
import type { IncidentRow, SosRepo } from '../sos/repo';
import { incidentPoint } from '../sos/service';
import { fail, type SosFailure } from '../sos/transition';
import { HANDOVER_TTL_MS, buildRecord, chooseHospital, hashLinkToken, newLinkToken, rankHospitals } from './policy';
import type { HandoverRepo, HandoverRow } from './repo';
import { toSummary } from './summary';

export { toSummary };

/** Delivers the link to the hospital. The raw token exists only here and in the message. */
export interface HandoverNotifier {
  linkReady(n: { incidentId: string; hospitalId: string; erPhone: string; url: string; isDrill: boolean }): Promise<void>;
}

/**
 * Until the notifications module sends it to the ER's WhatsApp (needs a
 * template), the link is not sent anywhere: the hospital sees the handover
 * in the partner portal. Local development prints the URL so it can be tried.
 */
export function logHandoverNotifier(opts: { printUrl: boolean }): HandoverNotifier {
  return {
    async linkReady(n) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'sos_handover_link_ready',
          incidentId: n.incidentId,
          hospitalId: n.hospitalId,
          ...(opts.printUrl ? { url: n.url } : {}),
        }),
      );
    },
  };
}

export interface HandoverDeps {
  handovers: HandoverRepo;
  consents: ConsentRepo;
  sos: SosRepo;
  dispatch: DispatchRepo;
  locator: CrewLocator;
  handoverNotifier: HandoverNotifier;
  realtime?: Realtime;
  config: { consoleUrl: string; fieldKey: Buffer };
}

export const handoverUrl = (consoleUrl: string, token: string) => `${consoleUrl}/handover/${token}`;

/** A link is dead once it expires or the SOS is cancelled. */
export const isLive = (h: Pick<HandoverRow, 'expiresAt'>, state: IncidentRow['state'], now = new Date()) =>
  state !== 'cancelled' && h.expiresAt.getTime() > now.getTime();

async function itemsFor(d: Pick<HandoverDeps, 'consents'>, subjectId: string) {
  return allowedHandoverItems(isGranted(await d.consents.historyForStaff(subjectId), 'emergency_share'));
}

async function issue(
  d: HandoverDeps,
  incident: IncidentRow,
  hospitalId: string,
  how: { chosenBy: 'auto' | 'crew' | 'desk'; reason: string | null; preferred: boolean; actor: { id: string | null; role: string } },
) {
  const { token, hash } = newLinkToken();
  const row = await d.handovers.upsert({
    incidentId: incident.id,
    subjectId: incident.userId,
    hospitalId,
    items: await itemsFor(d, incident.userId),
    tokenHash: hash,
    expiresAt: new Date(Date.now() + HANDOVER_TTL_MS),
    ...how,
  });
  await d.handoverNotifier.linkReady({
    incidentId: incident.id,
    hospitalId,
    erPhone: row.erPhone,
    url: handoverUrl(d.config.consoleUrl, token),
    isDrill: incident.isDrill,
  });
  return row;
}

/**
 * On accept: choose the receiving hospital (⚑4) and open the handover.
 * Drills never reach a hospital. A job taken again after a reassign keeps
 * its hospital. No hospital with capacity: the desk is alarmed and picks one.
 */
export async function openHandover(d: HandoverDeps, incident: IncidentRow): Promise<HandoverRow | null> {
  if (incident.isDrill) return null;
  const existing = await d.handovers.forIncident(incident.id);
  if (existing) return existing;
  const [from, hospitals, preferredId] = await Promise.all([
    incidentPoint(d.dispatch, incident),
    d.handovers.hospitals(),
    d.handovers.preferredHospital(incident.userId),
  ]);
  const choice = from ? chooseHospital(from, hospitals, preferredId) : null;
  if (!choice) {
    console.warn(JSON.stringify({ level: 'warn', event: 'sos_no_hospital', incidentId: incident.id, located: !!from }));
    await publishDesk(d.realtime ?? silentRealtime(), incident, 'alarm', { why: 'no_hospital', at: new Date().toISOString() });
    return null;
  }
  return issue(d, incident, choice.hospitalId, { chosenBy: 'auto', reason: null, preferred: choice.preferred, actor: { id: null, role: 'system' } });
}

/** Never fails the accept: the crew has the job either way, and the desk can choose a hospital. */
export async function openHandoverSafely(d: HandoverDeps, incident: IncidentRow, requestId?: string) {
  try {
    await openHandover(d, incident);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'sos_handover_open_failed', incidentId: incident.id, requestId, name: (err as Error).name }));
  }
}

/** States in which the patient can still be sent somewhere else. */
const redirectable = (i: IncidentRow) => crewActiveStates.includes(i.state);

/** The crew or the desk sends the patient to another hospital, with a reason. The old link stops working. */
export async function redirectHandover(
  d: HandoverDeps,
  incident: IncidentRow,
  hospitalId: string,
  reason: string,
  actor: { id: string; role: 'crew' | 'desk' },
): Promise<HandoverRow | SosFailure> {
  if (incident.isDrill) return fail('conflict', 'Drills are never handed over to a hospital.');
  if (!redirectable(incident)) return fail('conflict', 'The hospital can be changed only while a crew has the job.');
  const hospital = await d.handovers.hospital(hospitalId);
  if (!hospital?.active) return fail('not_found', 'No such hospital.');
  const current = await d.handovers.forIncident(incident.id);
  if (current?.hospitalId === hospitalId) return current;
  return issue(d, incident, hospitalId, {
    chosenBy: actor.role,
    reason,
    preferred: (await d.handovers.preferredHospital(incident.userId)) === hospitalId,
    actor,
  });
}

/** Hospitals for the crew or desk to pick from: nearest with capacity first, then the rest. */
export async function hospitalsNear(d: Pick<HandoverDeps, 'handovers' | 'dispatch'>, incident: IncidentRow) {
  const [from, all] = await Promise.all([incidentPoint(d.dispatch, incident), d.handovers.hospitals()]);
  const active = all.filter((h) => h.active);
  const ranked = from ? rankHospitals(from, active) : [];
  const rest = active.filter((h) => !ranked.some((r) => r.id === h.id)).map((h) => ({ ...h, etaS: from ? estimateEtaS(distanceM(from, h)) : null }));
  return [...ranked, ...rest].map((h) => ({ id: h.id, name: h.name, hasCapacity: h.hasCapacity, etaS: h.etaS }));
}

/** The crew's first-aid notes, added to the handover (encrypted at rest). */
export async function saveFirstAidNotes(d: HandoverDeps, incident: IncidentRow, notes: string): Promise<true | SosFailure> {
  if (!redirectable(incident) && incident.state !== 'handed_over') return fail('conflict', 'Notes can be added only during the job.');
  if (!(await d.handovers.setFirstAidNotes(incident.id, encryptJson(d.config.fieldKey, notes))))
    return fail('conflict', 'There is no hospital handover for this SOS yet.');
  return true;
}

/** When the ambulance reaches the hospital: via the patient until it is transporting. */
async function arrivalEtaS(d: Pick<HandoverDeps, 'dispatch' | 'locator' | 'handovers'>, incident: IncidentRow, hospitalId: string): Promise<number | null> {
  if (!incident.crewId || !crewActiveStates.includes(incident.state)) return null;
  const [at, hospital, patient] = await Promise.all([
    d.locator.position(incident.crewId),
    d.handovers.hospital(hospitalId),
    incidentPoint(d.dispatch, incident),
  ]);
  if (!at || !hospital) return null;
  if (incident.state === 'transporting' || !patient) return estimateEtaS(distanceM(at, hospital));
  return estimateEtaS(distanceM(at, patient) + distanceM(patient, hospital));
}

async function partnerView(d: HandoverDeps, h: HandoverRow, incident: IncidentRow, now: Date): Promise<PartnerHandover> {
  const vehicle = incident.crewId ? await d.dispatch.vehicle(incident.crewId) : null;
  return {
    id: h.incidentId,
    ref: sosRef(incident.id),
    isDrill: incident.isDrill,
    state: incident.state,
    createdAt: h.createdAt.toISOString(),
    expiresAt: h.expiresAt.toISOString(),
    expired: !isLive(h, incident.state, now),
    confirmedAt: h.confirmedAt?.toISOString() ?? null,
    ambulance: vehicle,
    arrivalEtaS: await arrivalEtaS(d, incident, h.hospitalId),
    items: h.items,
  };
}

/** The partner portal's list: the last day's handovers to this hospital. */
export async function partnerList(d: HandoverDeps, hospitalId: string, now = new Date()): Promise<PartnerHandover[]> {
  const rows = await d.handovers.forHospital(hospitalId, new Date(now.getTime() - 24 * 60 * 60_000));
  const views = await Promise.all(
    rows.map(async (h) => {
      const incident = await d.sos.get(h.incidentId);
      return incident ? partnerView(d, h, incident, now) : null;
    }),
  );
  return views.filter((v) => v !== null);
}

/** One handover for a partner user of `hospitalIds`. Other hospitals' handovers look like they do not exist. */
async function loadForPartner(d: HandoverDeps, hospitalIds: string[], incidentId: string) {
  const h = await d.handovers.forIncident(incidentId);
  const incident = h && hospitalIds.includes(h.hospitalId) ? await d.sos.get(incidentId) : null;
  return h && incident ? { h, incident } : null;
}

/** The record, while the link is live; every opening is a record_shares row. */
export async function partnerDetail(
  d: HandoverDeps,
  viewer: { id: string; hospitalIds: string[] },
  incidentId: string,
  now = new Date(),
): Promise<PartnerHandoverDetail | SosFailure> {
  const found = await loadForPartner(d, viewer.hospitalIds, incidentId);
  if (!found) return fail('not_found', 'No such handover.');
  const view = await partnerView(d, found.h, found.incident, now);
  if (view.expired) return { ...view, record: null };
  const record = buildRecord(await d.handovers.patientData(found.incident.userId), found.h.items, d.config.fieldKey, found.h.firstAidNotesEnc, now);
  await d.handovers.recordShare({
    subjectId: found.incident.userId,
    viewerId: viewer.id,
    viewerRole: 'hospital',
    items: found.h.items,
    incidentId,
    expiresAt: found.h.expiresAt,
  });
  return { ...view, record };
}

/** The ER confirms the patient was received. Once; a second press returns the first confirmation. */
export async function partnerConfirm(
  d: HandoverDeps,
  viewer: { id: string; hospitalIds: string[] },
  incidentId: string,
  now = new Date(),
): Promise<PartnerHandover | SosFailure> {
  const found = await loadForPartner(d, viewer.hospitalIds, incidentId);
  if (!found) return fail('not_found', 'No such handover.');
  if (found.incident.state === 'cancelled') return fail('conflict', 'This SOS was cancelled.');
  // A race with a second press lands on the confirmation that won.
  const confirmed = found.h.confirmedAt ? found.h : ((await d.handovers.confirm(incidentId, viewer.id)) ?? (await d.handovers.forIncident(incidentId))!);
  return partnerView(d, confirmed, found.incident, now);
}

/** The ER opens the signed link (no sign-in). Expired, cancelled and unknown links look the same. */
export async function linkView(d: HandoverDeps, token: string, now = new Date()): Promise<HandoverLinkView | SosFailure> {
  const h = await d.handovers.byTokenHash(hashLinkToken(token));
  const incident = h ? await d.sos.get(h.incidentId) : null;
  if (!h || !incident || !isLive(h, incident.state, now))
    return fail('not_found', 'This link has expired or is not valid. Ask the ambulance crew or the control room.');
  const record = buildRecord(await d.handovers.patientData(incident.userId), h.items, d.config.fieldKey, h.firstAidNotesEnc, now);
  await d.handovers.recordShare({
    subjectId: incident.userId,
    viewerId: null,
    viewerRole: 'hospital_link',
    items: h.items,
    incidentId: incident.id,
    expiresAt: h.expiresAt,
  });
  return {
    ref: sosRef(incident.id),
    hospital: h.hospitalName,
    isDrill: incident.isDrill,
    expiresAt: h.expiresAt.toISOString(),
    confirmedAt: h.confirmedAt?.toISOString() ?? null,
    record,
  };
}
