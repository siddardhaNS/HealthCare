import { describe, expect, it } from 'vitest';
import type { Doctor, DoctorSchedule } from '@repo/contracts';
import { testContext } from './helpers';

const OPS = '44444444-4444-4444-8444-444444444444';
const DESK = '22222222-2222-4222-8222-222222222222';
const DOC = 'd0c00000-0000-4000-8000-000000000001';

async function setup() {
  const t = await testContext();
  const as = async (sub: string, roles: string[], aal = 'aal2') => {
    const h = { authorization: `Bearer ${await t.token({ sub, aal, app_roles: roles })}`, 'content-type': 'application/json' };
    const call = (method: string, p: string, b?: unknown) => t.app.request(p, { method, headers: h, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { get: (p: string) => call('GET', p), post: (p: string, b: unknown) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), patch: (p: string, b: unknown) => call('PATCH', p, b), del: (p: string) => call('DELETE', p) };
  };
  const ops = await as(OPS, ['operations']);
  const gp = (await (await ops.post('/v1/console/specialties', { code: 'general_physician', names: { en: 'General Physician', te: 'జనరల్ ఫిజీషియన్', hi: 'सामान्य चिकित्सक' }, keywords: { en: ['fever'] } })).json()) as { id: string };
  t.consults.accounts.set('dr.rao@example.test', { userId: DOC, isDoctor: true });
  t.consults.accounts.set('ops2@example.test', { userId: OPS, isDoctor: false });
  const doctorBody = { email: 'Dr.Rao@example.test', fullName: 'Dr. Anil Rao', qualification: 'MBBS, MD', registrationNo: 'TSMC-12345', council: 'Telangana State Medical Council', feeVideoPaise: 50000, specialtyIds: [gp.id] };
  return { t, as, ops, gp, doctorBody, doctor: await as(DOC, ['doctor']) };
}

describe('specialties', () => {
  it('operations manage them; everyone signed in sees the active ones', async () => {
    const s = await setup();
    expect((await s.ops.post('/v1/console/specialties', { code: 'general_physician', names: { en: 'X', te: 'X', hi: 'X' } })).status).toBe(409);
    expect((await (await s.as(DESK, ['community_desk'])).post('/v1/console/specialties', { code: 'derm', names: { en: 'X', te: 'X', hi: 'X' } })).status).toBe(403);
    await s.ops.patch(`/v1/console/specialties/${s.gp.id}`, { active: false });
    const resident = await s.as('6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11', []);
    expect(((await (await resident.get('/v1/specialties')).json()) as { specialties: unknown[] }).specialties).toEqual([]);
  });
});

describe('doctor onboarding (⚑1)', () => {
  it('links an existing doctor sign-in by email; starts unverified and off', async () => {
    const s = await setup();
    const res = await s.ops.post('/v1/console/doctors', s.doctorBody);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: DOC, email: 'dr.rao@example.test', verifiedAt: null, active: false, slotMinutes: 15, specialtyIds: [s.gp.id] });
    expect((await s.ops.post('/v1/console/doctors', s.doctorBody)).status).toBe(409);
  });

  it('refuses an unknown email and a sign-in without the doctor role', async () => {
    const s = await setup();
    expect((await s.ops.post('/v1/console/doctors', { ...s.doctorBody, email: 'nobody@example.test' })).status).toBe(404);
    expect((await s.ops.post('/v1/console/doctors', { ...s.doctorBody, email: 'ops2@example.test' })).status).toBe(409);
  });

  it('bookable only once verified, with a fee and a specialty; a new registration number needs verifying again', async () => {
    const s = await setup();
    const d = (await (await s.ops.post('/v1/console/doctors', s.doctorBody)).json()) as Doctor;
    const activate = () => s.ops.put(`/v1/console/doctors/${d.id}/active`, { active: true });
    expect((await activate()).status).toBe(409);
    await s.ops.post(`/v1/console/doctors/${d.id}/verify`, {});
    expect(await (await activate()).json()).toMatchObject({ active: true });
    // Saving the form unchanged (it always sends the registration) keeps the doctor verified and bookable.
    expect(await (await s.ops.patch(`/v1/console/doctors/${d.id}`, { registrationNo: 'TSMC-12345', council: 'Telangana State Medical Council', feeAudioPaise: 30000 })).json()).toMatchObject({ active: true, feeAudioPaise: 30000 });
    const edited = (await (await s.ops.patch(`/v1/console/doctors/${d.id}`, { registrationNo: 'TSMC-99999' })).json()) as Doctor;
    expect(edited).toMatchObject({ verifiedAt: null, active: false });
    expect(edited.verifiedAt).toBeNull();
    expect(s.t.consults.audit.map((a) => a.action)).toEqual(['specialty_added', 'doctor_added', 'doctor_verified', 'doctor_activated', 'doctor_updated', 'doctor_updated']);
  });
});

describe("the doctor's schedule (⚑3)", () => {
  it('only a set-up doctor; hours make slots for the next 7 days; leave removes them', async () => {
    const s = await setup();
    expect((await s.doctor.get('/v1/partner/schedule')).status).toBe(403);
    await s.ops.post('/v1/console/doctors', s.doctorBody);
    const allWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '10:00', types: ['video'] }));
    const set = (await (await s.doctor.put('/v1/partner/schedule/hours', { hours: allWeek })).json()) as DoctorSchedule;
    expect(set.hours).toHaveLength(7);
    // Four 15-minute slots a day; today's may already be past.
    expect(set.preview.length).toBeGreaterThanOrEqual(24);

    const day = new Date(Date.now() + 2 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    expect((await s.doctor.post('/v1/partner/schedule/exceptions', { from: day, to: day, kind: 'off' })).status).toBe(201);
    const after = (await (await s.doctor.get('/v1/partner/schedule')).json()) as DoctorSchedule;
    expect(after.preview.length).toBe(set.preview.length - 4);
  });

  it('refuses overlapping rows, and consult types the doctor has no fee for', async () => {
    const s = await setup();
    await s.ops.post('/v1/console/doctors', s.doctorBody);
    const overlap = [
      { weekday: 1, start: '09:00', end: '11:00', types: ['video'] },
      { weekday: 1, start: '10:30', end: '12:00', types: ['video'] },
    ];
    expect((await s.doctor.put('/v1/partner/schedule/hours', { hours: overlap })).status).toBe(400);
    expect((await s.doctor.put('/v1/partner/schedule/hours', { hours: [{ weekday: 1, start: '09:00', end: '10:00', types: ['clinic'] }] })).status).toBe(400);
    expect((await s.doctor.put('/v1/partner/schedule/hours', { hours: [{ weekday: 1, start: '10:00', end: '09:00', types: ['video'] }] })).status).toBe(400);
  });
});
