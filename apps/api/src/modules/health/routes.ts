import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  Allergy,
  AllergyInput,
  Condition,
  ConditionInput,
  DoseMark,
  ErrorBody,
  HealthProfile,
  HealthSummary,
  Medication,
  MedicationInput,
  VitalReading,
  VitalReadingInput,
  VitalSeries,
  VitalTypeSchema,
  vitalTargets,
  vitalUnits,
  type AppRole,
  type ErrorBody as ErrorBodyT,
} from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { isGranted } from '../consent/policy';
import { canActFor } from '../households/service';
import { encNotes, istDate, istSlot, prepareReading, toAllergy, toCondition, toMedication, toReading, toSummary } from './service';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found') };
const person = z.object({ userId: z.string().uuid() });
const item = person.extend({ id: z.string().uuid() });
const authed = { security, middleware: [requireAuth] };
const DAY = 86_400_000;

const error = (c: Context<AppEnv>, status: 400 | 403 | 404, code: string, message: string) => c.json({ error: { code, message, requestId: c.get('requestId') } } satisfies ErrorBodyT, status);

/** The person themselves, or a family manager they appointed. */
async function guard(c: Context<AppEnv>, subject: string) {
  return canActFor(c.get('deps').households, c.get('auth')!.userId, subject);
}
const forbidden = (c: Context<AppEnv>) => error(c, 403, 'forbidden', 'You do not manage this person’s care.');

const r = {
  summary: createRoute({ method: 'get', path: '/people/{userId}/health/summary', operationId: 'getHealthSummary', tags: ['health'], summary: 'Home snapshot and Health tab data: profile, latest of each vital, conditions, allergies, medicines', ...authed, request: { params: person }, responses: { 200: json(HealthSummary, 'Summary'), ...failures } }),
  putProfile: createRoute({ method: 'put', path: '/people/{userId}/health/profile', operationId: 'saveHealthProfile', tags: ['health'], summary: 'Blood group, height, date of birth, sex', ...authed, request: { params: person, ...body(HealthProfile) }, responses: { 200: json(HealthProfile, 'Saved'), ...failures } }),
  series: createRoute({
    method: 'get',
    path: '/people/{userId}/health/vitals/{type}',
    operationId: 'getVitalSeries',
    tags: ['health'],
    summary: 'Latest readings of one vital with its target band (default 7)',
    ...authed,
    request: { params: person.extend({ type: VitalTypeSchema }), query: z.object({ limit: z.coerce.number().int().min(1).max(90).default(7) }) },
    responses: { 200: json(VitalSeries, 'Readings, newest first'), ...failures },
  }),
  addReading: createRoute({ method: 'post', path: '/people/{userId}/health/vitals', operationId: 'logVitalReading', tags: ['health'], summary: 'Log a reading (validated against physiological limits)', ...authed, request: { params: person, ...body(VitalReadingInput) }, responses: { 201: json(VitalReading, 'Logged'), ...failures } }),
  delReading: createRoute({ method: 'delete', path: '/people/{userId}/health/vitals/{id}', operationId: 'deleteVitalReading', tags: ['health'], summary: 'Remove a reading (kept in history, hidden)', ...authed, request: { params: item }, responses: { 204: { description: 'Removed' }, ...failures } }),
  addCondition: createRoute({ method: 'post', path: '/people/{userId}/health/conditions', operationId: 'addCondition', tags: ['health'], summary: 'Add a condition (notes are encrypted)', ...authed, request: { params: person, ...body(ConditionInput) }, responses: { 201: json(Condition, 'Added'), ...failures } }),
  delCondition: createRoute({ method: 'delete', path: '/people/{userId}/health/conditions/{id}', operationId: 'deleteCondition', tags: ['health'], summary: 'Remove a condition', ...authed, request: { params: item }, responses: { 204: { description: 'Removed' }, ...failures } }),
  addAllergy: createRoute({ method: 'post', path: '/people/{userId}/health/allergies', operationId: 'addAllergy', tags: ['health'], summary: 'Add an allergy', ...authed, request: { params: person, ...body(AllergyInput) }, responses: { 201: json(Allergy, 'Added'), ...failures } }),
  delAllergy: createRoute({ method: 'delete', path: '/people/{userId}/health/allergies/{id}', operationId: 'deleteAllergy', tags: ['health'], summary: 'Remove an allergy', ...authed, request: { params: item }, responses: { 204: { description: 'Removed' }, ...failures } }),
  addMedication: createRoute({ method: 'post', path: '/people/{userId}/health/medications', operationId: 'addMedication', tags: ['health'], summary: 'Add a medicine with its dose times', ...authed, request: { params: person, ...body(MedicationInput) }, responses: { 201: json(Medication, 'Added'), ...failures } }),
  delMedication: createRoute({ method: 'delete', path: '/people/{userId}/health/medications/{id}', operationId: 'deleteMedication', tags: ['health'], summary: 'Remove a medicine', ...authed, request: { params: item }, responses: { 204: { description: 'Removed' }, ...failures } }),
  markDose: createRoute({ method: 'post', path: '/people/{userId}/health/medications/{id}/doses', operationId: 'markDose', tags: ['health'], summary: 'Tick a dose as taken (or skipped)', ...authed, request: { params: item, ...body(DoseMark) }, responses: { 200: json(Medication, 'Updated medicine'), ...failures } }),
  staffView: createRoute({
    method: 'get',
    path: '/residents/{userId}/health',
    operationId: 'getResidentHealth',
    tags: ['residents'],
    summary: 'Care team view of a resident’s health record; only with their proactive_care consent; recorded in record_shares',
    security,
    middleware: [requireAuth, requireStaff(['super_admin', 'operations', 'support'])],
    request: { params: person },
    responses: { 200: json(HealthSummary, 'Summary'), ...failures },
  }),
};

const careTeam: readonly AppRole[] = ['super_admin', 'operations', 'support'];

export const healthRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.summary, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const me = c.get('auth')!.userId;
    const repo = c.get('deps').health;
    const now = new Date();
    const [profile, readings, conditions, allergies, medications, doses] = await Promise.all([
      repo.profile(me, userId),
      repo.latestReadings(me, userId),
      repo.conditions(me, userId),
      repo.allergies(me, userId),
      repo.medications(me, userId),
      repo.doses(me, userId, new Date(now.getTime() - 31 * DAY)),
    ]);
    return c.json(toSummary(userId, { profile, readings, conditions, allergies, medications, doses }, c.get('deps').config.fieldKey, now), 200);
  })
  .openapi(r.putProfile, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const p = c.req.valid('json');
    await c.get('deps').health.saveProfile(c.get('auth')!.userId, userId, p);
    return c.json(p, 200);
  })
  .openapi(r.series, async (c) => {
    const { userId, type } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const me = c.get('auth')!.userId;
    const repo = c.get('deps').health;
    const [rows, profile] = await Promise.all([repo.readings(me, userId, type, c.req.valid('query').limit), repo.profile(me, userId)]);
    return c.json({ type, unit: vitalUnits[type], target: vitalTargets[type], readings: rows.map((x) => toReading(x, userId, profile?.heightCm ?? null)) }, 200);
  })
  .openapi(r.addReading, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const check = prepareReading(c.req.valid('json'));
    if (!check.ok) return error(c, 400, check.code, check.message);
    const me = c.get('auth')!.userId;
    const repo = c.get('deps').health;
    const row = await repo.addReading(me, userId, check.row);
    const profile = await repo.profile(me, userId);
    return c.json(toReading(row, userId, profile?.heightCm ?? null), 201);
  })
  .openapi(r.delReading, async (c) => {
    const { userId, id } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    if (!(await c.get('deps').health.softDelete(c.get('auth')!.userId, userId, 'vital_readings', id))) return error(c, 404, 'not_found', 'No such reading.');
    return c.body(null, 204);
  })
  .openapi(r.addCondition, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const b = c.req.valid('json');
    const key = c.get('deps').config.fieldKey;
    const row = await c.get('deps').health.addCondition(c.get('auth')!.userId, userId, { name: b.name, status: b.status, diagnosedOn: b.diagnosedOn ?? null, notesEnc: encNotes(key, b.notes) });
    return c.json(toCondition(row, key), 201);
  })
  .openapi(r.delCondition, async (c) => {
    const { userId, id } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    if (!(await c.get('deps').health.softDelete(c.get('auth')!.userId, userId, 'conditions', id))) return error(c, 404, 'not_found', 'No such condition.');
    return c.body(null, 204);
  })
  .openapi(r.addAllergy, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const b = c.req.valid('json');
    return c.json(toAllergy(await c.get('deps').health.addAllergy(c.get('auth')!.userId, userId, { substance: b.substance, severity: b.severity, reaction: b.reaction ?? null })), 201);
  })
  .openapi(r.delAllergy, async (c) => {
    const { userId, id } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    if (!(await c.get('deps').health.softDelete(c.get('auth')!.userId, userId, 'allergies', id))) return error(c, 404, 'not_found', 'No such allergy.');
    return c.body(null, 204);
  })
  .openapi(r.addMedication, async (c) => {
    const { userId } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const b = c.req.valid('json');
    if (b.startDate && b.endDate && b.endDate < b.startDate) return error(c, 400, 'bad_dates', 'The end date is before the start date.');
    const row = await c.get('deps').health.addMedication(c.get('auth')!.userId, userId, {
      name: b.name,
      strength: b.strength ?? null,
      dose: b.dose ?? null,
      frequency: b.frequency ?? null,
      schedule: [...new Set(b.schedule)].sort(),
      startDate: b.startDate ?? null,
      endDate: b.endDate ?? null,
    });
    return c.json(toMedication(row, []), 201);
  })
  .openapi(r.delMedication, async (c) => {
    const { userId, id } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    if (!(await c.get('deps').health.softDelete(c.get('auth')!.userId, userId, 'medications', id))) return error(c, 404, 'not_found', 'No such medicine.');
    return c.body(null, 204);
  })
  .openapi(r.markDose, async (c) => {
    const { userId, id } = c.req.valid('param');
    if (!(await guard(c, userId))) return forbidden(c);
    const me = c.get('auth')!.userId;
    const repo = c.get('deps').health;
    const med = (await repo.medications(me, userId)).find((m) => m.id === id);
    if (!med) return error(c, 404, 'not_found', 'No such medicine.');
    const { date, time, status } = c.req.valid('json');
    if (!med.schedule.includes(time)) return error(c, 400, 'not_scheduled', 'That medicine has no dose at this time.');
    const now = new Date();
    if (date > istDate(now) || date < istDate(new Date(now.getTime() - 7 * DAY))) return error(c, 400, 'bad_date', 'Doses can be marked for today and the past week only.');
    await repo.markDose(me, userId, { medicationId: id, scheduledAt: istSlot(date, time), status });
    return c.json(toMedication(med, await repo.doses(me, userId, new Date(now.getTime() - 31 * DAY)), now), 200);
  })
  .openapi(r.staffView, async (c) => {
    const { userId } = c.req.valid('param');
    const auth = c.get('auth')!;
    const { consents, health, residents, config } = c.get('deps');
    if (!(await residents.get(userId))) return error(c, 404, 'not_found', 'No such resident.');
    // The care team sees medical details only with the person's proactive_care consent.
    if (!isGranted(await consents.historyForStaff(userId), 'proactive_care')) return error(c, 403, 'no_consent', 'This resident has not asked the care team to watch their readings.');
    const now = new Date();
    const data = await health.dataForStaff(userId, new Date(now.getTime() - 31 * DAY));
    const role = auth.roles.find((x) => careTeam.includes(x)) ?? 'care_team';
    await health.recordShare({ subjectId: userId, viewerId: auth.userId, viewerRole: role, purpose: 'proactive_care', items: ['vitals', 'conditions_allergies', 'medicines'], contextType: 'care_team' });
    await residents.logView(auth.userId, role, userId, c.get('requestId'));
    return c.json(toSummary(userId, data, config.fieldKey, now), 200);
  });
