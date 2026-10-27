import { consentPurposes, purposeMeta, type ConsentPurpose, type ConsentState, type ConsentUpdate } from '@repo/contracts';

export interface ConsentRow {
  purpose: ConsentPurpose;
  scopeKey: string;
  status: 'granted' | 'withdrawn';
  noticeVersion: string;
  language: 'en' | 'te' | 'hi';
  actedBy: string;
  userId: string;
  createdAt: Date;
}

const key = (purpose: string, scopeKey: string) => `${purpose}\u0000${scopeKey}`;

/** Latest row per (purpose, scope). Rows may arrive in any order. */
export function latest(rows: ConsentRow[]): Map<string, ConsentRow> {
  const out = new Map<string, ConsentRow>();
  for (const r of rows) {
    const k = key(r.purpose, r.scopeKey);
    const cur = out.get(k);
    if (!cur || r.createdAt > cur.createdAt) out.set(k, r);
  }
  return out;
}

/** A consent counts only if granted, and only against the notice version currently in force. */
export function isGranted(rows: ConsentRow[], purpose: ConsentPurpose, scopeKey = ''): boolean {
  const r = latest(rows).get(key(purpose, scopeKey));
  return r?.status === 'granted' && r.noticeVersion === purposeMeta[purpose].noticeVersion;
}

/** Every standing purpose (asked or not) plus every scoped consent on record. */
export function currentState(rows: ConsentRow[]): ConsentState[] {
  const map = latest(rows);
  const states: ConsentState[] = [];
  for (const purpose of consentPurposes) {
    if (!purposeMeta[purpose].standing) continue;
    const r = map.get(key(purpose, ''));
    states.push(toState(purpose, '', r));
  }
  for (const r of map.values()) if (!purposeMeta[r.purpose].standing) states.push(toState(r.purpose, r.scopeKey, r));
  return states;
}

function toState(purpose: ConsentPurpose, scopeKey: string, r: ConsentRow | undefined): ConsentState {
  return {
    purpose,
    scopeKey,
    status: r ? r.status : 'not_asked',
    noticeVersion: r?.noticeVersion ?? null,
    outdated: !!r && r.noticeVersion !== purposeMeta[purpose].noticeVersion,
    updatedAt: r ? r.createdAt.toISOString() : null,
  };
}

export type UpdateCheck = { ok: true } | { ok: false; code: 'stale_notice' | 'bad_scope' | 'use_erasure' | 'not_allowed'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rules for a person changing their own consent through the app. */
export function checkUpdate(actorId: string, u: ConsentUpdate): UpdateCheck {
  const meta = purposeMeta[u.purpose];
  if (u.noticeVersion !== meta.noticeVersion) {
    return { ok: false, code: 'stale_notice', message: 'The consent text has changed. Show the current notice and ask again.' };
  }
  if (u.purpose === 'care_record' && u.status === 'withdrawn') {
    // Withdrawing the core purpose means closing the record, which follows
    // the retention rules: it goes through a privacy (erasure) request.
    return { ok: false, code: 'use_erasure', message: 'To stop keeping your health record, request account deletion from Privacy.' };
  }
  if (u.purpose === 'manager') {
    if (!UUID.test(u.scopeKey)) return { ok: false, code: 'bad_scope', message: 'Choose the family member who may manage your care.' };
    if (u.scopeKey.toLowerCase() === actorId.toLowerCase()) return { ok: false, code: 'bad_scope', message: 'You cannot make yourself your own manager.' };
  } else if (u.purpose === 'doctor_share') {
    if (!UUID.test(u.scopeKey)) return { ok: false, code: 'bad_scope', message: 'Doctor sharing is chosen per booking.' };
  } else if (u.scopeKey !== '') {
    return { ok: false, code: 'bad_scope', message: 'This consent has no scope.' };
  }
  return { ok: true };
}
