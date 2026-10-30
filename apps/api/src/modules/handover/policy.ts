// Hospital handover rules (docs/plans/phase-3-sos.md ⚑4, §10). Pure functions,
// unit-tested without a database.
import { createHash, randomBytes } from 'node:crypto';
import type { HandoverItem, HandoverRecord } from '@repo/contracts';
import { distanceM, estimateEtaS } from '@repo/contracts/sos';
import type { LatLng } from '../../lib/crew-locator';
import { age, decNotes } from '../health/service';
import type { PatientData } from './repo';

/** ⚑4: the preferred hospital wins if its ETA is at most this much worse than the nearest. */
export const PREFERRED_SLACK_S = 600;
/** How long the handover link works. */
export const HANDOVER_TTL_MS = 6 * 60 * 60_000;

export interface HospitalOption {
  id: string;
  hasCapacity: boolean;
  active: boolean;
  lat: number;
  lng: number;
}

export type HospitalChoice = { hospitalId: string; etaS: number; preferred: boolean } | null;

/** Active hospitals with capacity, nearest first, with their ETA from `from`. */
export function rankHospitals<T extends HospitalOption>(from: LatLng, hospitals: T[]): (T & { etaS: number })[] {
  return hospitals
    .filter((h) => h.active && h.hasCapacity)
    .map((h) => ({ ...h, etaS: estimateEtaS(distanceM(from, h)) }))
    .sort((a, b) => a.etaS - b.etaS);
}

/**
 * ⚑4: the person's preferred hospital if it has capacity and is at most
 * 10 minutes further than the nearest one with capacity; otherwise the
 * nearest with capacity. Null when no hospital has capacity.
 */
export function chooseHospital(from: LatLng, hospitals: HospitalOption[], preferredId: string | null): HospitalChoice {
  const ranked = rankHospitals(from, hospitals);
  const nearest = ranked[0];
  if (!nearest) return null;
  const preferred = preferredId ? ranked.find((h) => h.id === preferredId) : undefined;
  if (preferred && preferred.etaS - nearest.etaS <= PREFERRED_SLACK_S) return { hospitalId: preferred.id, etaS: preferred.etaS, preferred: true };
  return { hospitalId: nearest.id, etaS: nearest.etaS, preferred: false };
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
