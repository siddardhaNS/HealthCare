// Hospital handover rules (docs/plans/phase-3-sos.md ⚑4, §10). Pure functions,
// unit-tested without a database.
import { createHash, randomBytes } from 'node:crypto';
import type { HandoverItem, HandoverRecord } from '@repo/contracts';
import { distanceM, estimateEtaS } from '@repo/contracts/sos';
import type { LatLng } from '../../lib/crew-locator';
import { age, decNotes } from '../health/service';
import type { PatientData } from './repo';

/** How long the handover link works. */
export const HANDOVER_TTL_MS = 6 * 60 * 60_000;

export interface HospitalOption {
  id: string;
  hasCapacity: boolean;
  active: boolean;
  lat: number;
  lng: number;
}

/**
 * Plan §11: the crew picks the hospital, so nothing is chosen here. Every
 * active hospital, ER full or not, nearest first; ETA null when we do not
 * know where the patient is (then by name).
 */
export function hospitalsByDistance<T extends HospitalOption & { name: string }>(from: LatLng | null, hospitals: T[]): (T & { etaS: number | null })[] {
  return hospitals
    .filter((h) => h.active)
    .map((h) => ({ ...h, etaS: from ? estimateEtaS(distanceM(from, h)) : null }))
    .sort((a, b) => (a.etaS ?? Infinity) - (b.etaS ?? Infinity) || a.name.localeCompare(b.name));
}

/** A random link token; only its hash is stored, so a database read never yields a working link. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * What the ER sees: only the consented items, read from the live record so
 * vitals are the latest. The name always travels so the ER knows who is
 * arriving; age and sex go with the clinical items, never with the blood
 * group alone. The crew's first-aid notes are always included.
 */
export function buildRecord(data: PatientData, items: readonly HandoverItem[], key: Buffer, firstAidNotesEnc: string | null, now = new Date()): HandoverRecord {
  const has = (i: HandoverItem) => items.includes(i);
  const clinical = has('conditions');
  return {
    items: [...items],
    patient: { name: data.name, age: clinical ? age(data.dateOfBirth, now) : null, sex: clinical ? data.sex : null },
    bloodGroup: has('blood_group') ? data.bloodGroup : null,
    ...(has('allergies') ? { allergies: data.allergies.map((a) => ({ substance: a.substance, severity: a.severity, reaction: a.reaction })) } : {}),
    ...(clinical ? { conditions: data.conditions.map((c) => ({ name: c.name, status: c.status })) } : {}),
    ...(has('medicines')
      ? { medicines: data.medications.filter((m) => m.active).map((m) => ({ name: m.name, strength: m.strength, dose: m.dose, frequency: m.frequency })) }
      : {}),
    ...(has('last_vitals')
      ? { lastVitals: data.readings.map((r) => ({ type: r.type, value: r.value, value2: r.value2, unit: r.unit, takenAt: r.takenAt.toISOString() })) }
      : {}),
    ...(has('emergency_contacts') ? { emergencyContacts: data.contacts.map((c) => ({ name: c.name, relation: c.relation, phone: c.phone })) } : {}),
    ...(has('insurance')
      ? {
          insurance: data.insurance.map((i) => ({
            insurer: i.insurer,
            policyNumber: decNotes(key, i.policyNumberEnc),
            memberId: decNotes(key, i.memberIdEnc),
            validUntil: i.validUntil,
          })),
        }
      : {}),
    firstAidNotes: decNotes(key, firstAidNotesEnc),
  };
}
