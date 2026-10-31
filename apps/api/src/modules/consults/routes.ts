import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  Doctor,
  DoctorActive,
  DoctorCreate,
  DoctorSchedule,
  Doctors,
  DoctorUpdate,
  ErrorBody,
  HoursException,
  HoursExceptionInput,
  Specialties,
  Specialty,
  SpecialtyInput,
  SpecialtyUpdate,
  WeeklyHoursInput,
  generateSlots,
  istDay,
  type Doctor as DoctorT,
  type ErrorBody as ErrorBodyT,
} from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';

// Phase 4 step 2: specialties and doctors (operations), and the doctor's own schedule (partner portal).
const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found'), 409: json(ErrorBody, 'Not possible') };
const idParam = { params: z.object({ id: z.string().uuid() }) };
const err = (c: Context<AppEnv>, status: 400 | 403 | 404 | 409, code: string, message: string) => c.json({ error: { code, message, requestId: c.get('requestId') } } satisfies ErrorBodyT, status);
const me = (c: Context<AppEnv>) => c.get('auth')!.userId;

const ops = { security, middleware: [requireAuth, requireStaff(['super_admin', 'operations'])] };
const doctorOnly = { security, middleware: [requireAuth, requireStaff(['doctor'])] };
const authed = { security, middleware: [requireAuth] };

/** Weekly hours may not overlap on the same day (the slots would repeat). */
function overlapping(hours: { weekday: number; start: string; end: string }[]): boolean {
  const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  return sorted.some((h, i) => i > 0 && sorted[i - 1]!.weekday === h.weekday && sorted[i - 1]!.end > h.start);
}

/** Why a doctor can't be made bookable yet, or null. */
function notReady(d: DoctorT): string | null {
  if (!d.verifiedAt) return 'Check the registration number against the council register and mark it verified first.';
  if (d.feeVideoPaise == null && d.feeAudioPaise == null && d.feeClinicPaise == null) return 'Set a fee for at least one consult type first.';
  if (d.specialtyIds.length === 0) return 'Choose at least one specialty first.';
  return null;
}

const r = {
  specialties: createRoute({ method: 'get', path: '/specialties', operationId: 'specialties', tags: ['consults'], summary: 'Active specialties, with names in en/te/hi', ...authed, responses: { 200: json(Specialties, 'Specialties'), ...failures } }),
  allSpecialties: createRoute({ method: 'get', path: '/console/specialties', operationId: 'consoleSpecialties', tags: ['consults'], summary: 'Every specialty with its symptom keywords (operations)', ...ops, responses: { 200: json(Specialties, 'Specialties'), ...failures } }),
  addSpecialty: createRoute({ method: 'post', path: '/console/specialties', operationId: 'addSpecialty', tags: ['consults'], summary: 'Add a specialty', ...ops, request: body(SpecialtyInput), responses: { 201: json(Specialty, 'Added'), ...failures } }),
  editSpecialty: createRoute({ method: 'patch', path: '/console/specialties/{id}', operationId: 'editSpecialty', tags: ['consults'], summary: 'Rename, edit keywords, or switch off a specialty', ...ops, request: { ...idParam, ...body(SpecialtyUpdate) }, responses: { 200: json(Specialty, 'Updated'), ...failures } }),
  doctors: createRoute({ method: 'get', path: '/console/doctors', operationId: 'consoleDoctors', tags: ['consults'], summary: 'Doctors (operations)', ...ops, responses: { 200: json(Doctors, 'Doctors'), ...failures } }),
  addDoctor: createRoute({
    method: 'post',
    path: '/console/doctors',
    operationId: 'addDoctor',
    tags: ['consults'],
    summary: 'Add a doctor to an existing doctor sign-in (created with staff:create --role doctor); starts unverified and off',
    ...ops,
    request: body(DoctorCreate),
    responses: { 201: json(Doctor, 'Added'), ...failures },
  }),
  editDoctor: createRoute({
    method: 'patch',
    path: '/console/doctors/{id}',
    operationId: 'editDoctor',
    tags: ['consults'],
    summary: 'Edit a doctor; changing the registration number clears the verification and switches them off',
    ...ops,
    request: { ...idParam, ...body(DoctorUpdate) },
    responses: { 200: json(Doctor, 'Updated'), ...failures },
  }),
  verifyDoctor: createRoute({ method: 'post', path: '/console/doctors/{id}/verify', operationId: 'verifyDoctor', tags: ['consults'], summary: 'Record that the registration was checked on the council register (⚑1)', ...ops, request: idParam, responses: { 200: json(Doctor, 'Verified'), ...failures } }),
  doctorActive: createRoute({
    method: 'put',
    path: '/console/doctors/{id}/active',
    operationId: 'setDoctorActive',
    tags: ['consults'],
    summary: 'Make a doctor bookable, or not (bookable needs verification, a fee and a specialty)',
    ...ops,
    request: { ...idParam, ...body(DoctorActive) },
    responses: { 200: json(Doctor, 'Updated'), ...failures },
  }),
  schedule: createRoute({ method: 'get', path: '/partner/schedule', operationId: 'mySchedule', tags: ['consults'], summary: 'Doctor: my weekly hours, exceptions and the slots they make for the next 7 days', ...doctorOnly, responses: { 200: json(DoctorSchedule, 'Schedule'), ...failures } }),
  setHours: createRoute({ method: 'put', path: '/partner/schedule/hours', operationId: 'setMyHours', tags: ['consults'], summary: 'Doctor: replace my weekly hours', ...doctorOnly, request: body(WeeklyHoursInput), responses: { 200: json(DoctorSchedule, 'Schedule'), ...failures } }),
  addException: createRoute({ method: 'post', path: '/partner/schedule/exceptions', operationId: 'addMyException', tags: ['consults'], summary: 'Doctor: add leave or extra hours', ...doctorOnly, request: body(HoursExceptionInput), responses: { 201: json(HoursException, 'Added'), ...failures } }),
  removeException: createRoute({ method: 'delete', path: '/partner/schedule/exceptions/{id}', operationId: 'removeMyException', tags: ['consults'], summary: 'Doctor: remove leave or extra hours', ...doctorOnly, request: idParam, responses: { 204: { description: 'Removed' }, ...failures } }),
};

/** The signed-in doctor's record, or a 403 for a doctor sign-in operations haven't set up yet. */
async function myDoctor(c: Context<AppEnv>) {
  return c.get('deps').consults.doctorByUser(me(c));
}

async function scheduleOf(c: Context<AppEnv>, d: DoctorT, now = new Date()) {
  const { consults } = c.get('deps');
  const [hours, exceptions] = await Promise.all([consults.hours(d.id), consults.exceptions(d.id)]);
  const from = istDay(now);
  const to = istDay(new Date(now.getTime() + 6 * 86_400_000));
  const preview = generateSlots({
    hours,
    exceptions: exceptions.map((e) => ({ ...e, start: e.start ?? undefined, end: e.end ?? undefined, types: e.types ?? undefined })),
    slotMinutes: d.slotMinutes,
    from,
    to,
    now,
  }).map((s) => ({ startsAt: s.startsAt.toISOString(), types: s.types }));
  return { doctor: d, hours: hours.map((h) => ({ ...h, types: [...h.types] })), exceptions, preview };
}

const notSetUp = (c: Context<AppEnv>) => err(c, 403, 'forbidden', 'Your doctor profile is not set up yet. Ask operations to add you.');

export const consultsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.specialties, async (c) => c.json({ specialties: await c.get('deps').consults.specialties({ activeOnly: true }) }, 200))
  .openapi(r.allSpecialties, async (c) => c.json({ specialties: await c.get('deps').consults.specialties({ activeOnly: false }) }, 200))
  .openapi(r.addSpecialty, async (c) => {
    const row = await c.get('deps').consults.addSpecialty(c.req.valid('json'), me(c));
    return row === 'duplicate' ? err(c, 409, 'duplicate', 'A specialty with this code already exists.') : c.json(row, 201);
  })
  .openapi(r.editSpecialty, async (c) => {
    const row = await c.get('deps').consults.updateSpecialty(c.req.valid('param').id, c.req.valid('json'), me(c));
    return row ? c.json(row, 200) : err(c, 404, 'not_found', 'No such specialty.');
  })
  .openapi(r.doctors, async (c) => c.json({ doctors: await c.get('deps').consults.doctors() }, 200))
  .openapi(r.addDoctor, async (c) => {
    const { consults } = c.get('deps');
    const { email, ...fields } = c.req.valid('json');
    const account = await consults.accountByEmail(email);
    if (!account) return err(c, 404, 'no_account', 'There is no sign-in with this email. Create it first: pnpm --filter api staff:create --email … --role doctor');
    if (!account.isDoctor) return err(c, 409, 'not_doctor', 'This sign-in does not have the doctor role.');
    const row = await consults.createDoctor(account.userId, fields, me(c));
    return row === 'duplicate' ? err(c, 409, 'duplicate', 'This sign-in or registration number is already a doctor here.') : c.json(row, 201);
  })
  .openapi(r.editDoctor, async (c) => {
    const row = await c.get('deps').consults.updateDoctor(c.req.valid('param').id, c.req.valid('json'), me(c));
    if (row === 'duplicate') return err(c, 409, 'duplicate', 'Another doctor has this registration number.');
    return row ? c.json(row, 200) : err(c, 404, 'not_found', 'No such doctor.');
  })
  .openapi(r.verifyDoctor, async (c) => {
    const row = await c.get('deps').consults.verifyDoctor(c.req.valid('param').id, me(c));
    return row ? c.json(row, 200) : err(c, 404, 'not_found', 'No such doctor.');
  })
  .openapi(r.doctorActive, async (c) => {
    const { consults } = c.get('deps');
    const { id } = c.req.valid('param');
    const { active } = c.req.valid('json');
    const d = await consults.doctor(id);
    if (!d) return err(c, 404, 'not_found', 'No such doctor.');
    const why = active ? notReady(d) : null;
    if (why) return err(c, 409, 'not_ready', why);
    return c.json((await consults.setDoctorActive(id, active, me(c)))!, 200);
  })
  .openapi(r.schedule, async (c) => {
    const d = await myDoctor(c);
    return d ? c.json(await scheduleOf(c, d), 200) : notSetUp(c);
  })
  .openapi(r.setHours, async (c) => {
    const d = await myDoctor(c);
    if (!d) return notSetUp(c);
    const { hours } = c.req.valid('json');
    if (overlapping(hours)) return err(c, 400, 'overlap', 'Two rows overlap on the same day. Join them or change the times.');
    const offered = new Set([d.feeVideoPaise != null && 'video', d.feeAudioPaise != null && 'audio', d.feeClinicPaise != null && 'clinic'].filter(Boolean));
    if (hours.some((h) => h.types.some((t) => !offered.has(t)))) return err(c, 400, 'type_not_offered', 'One of the rows offers a consult type you have no fee for. Ask operations to set the fee, or untick it.');
    await c.get('deps').consults.replaceHours(d.id, hours, me(c));
    return c.json(await scheduleOf(c, d), 200);
  })
  .openapi(r.addException, async (c) => {
    const d = await myDoctor(c);
    if (!d) return notSetUp(c);
    const e = c.req.valid('json');
    const row = await c.get('deps').consults.addException(d.id, { from: e.from, to: e.to, kind: e.kind, start: e.start ?? null, end: e.end ?? null, types: e.types ?? null }, me(c));
    return c.json(row, 201);
  })
  .openapi(r.removeException, async (c) => {
    const d = await myDoctor(c);
    if (!d) return notSetUp(c);
    return (await c.get('deps').consults.removeException(d.id, c.req.valid('param').id, me(c))) ? c.body(null, 204) : err(c, 404, 'not_found', 'No such entry.');
  });
