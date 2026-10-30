import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ErrorBody, ResidentDetail, ResidentList, type AppRole, type ErrorBody as ErrorBodyT, type ResidentRow } from '@repo/contracts';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { currentState, isGranted } from '../consent/policy';
import { maskPhone } from '../households/service';
import type { ResidentRecord } from './repo';

/** Who may open the directory at all. */
const directoryRoles = ['super_admin', 'operations', 'support', 'community_desk'] as const;
/** The care team; everyone else in directoryRoles is the community desk. */
const careTeam: readonly AppRole[] = ['super_admin', 'operations', 'support'];

const security = [{ bearer: [] }];
const err = (description: string) => ({ description, content: { 'application/json': { schema: ErrorBody } } });
const middleware = [requireAuth, requireStaff(directoryRoles)];

const toRow = (r: ResidentRecord): ResidentRow => ({
  userId: r.userId,
  fullName: r.fullName,
  community: r.community,
  tower: r.tower,
  number: r.number,
  city: r.city,
  phone: r.phone ? maskPhone(r.phone.startsWith('+') ? r.phone : `+${r.phone}`) : null,
  role: r.role,
  coverageTeam: r.coverageTeam,
});

const list = createRoute({
  method: 'get',
  path: '/residents',
  operationId: 'listResidents',
  tags: ['residents'],
  summary: 'Residents directory (community desk: their own community only; no medical data)',
  security,
  middleware,
  request: { query: z.object({ q: z.string().trim().max(60).optional() }) },
  responses: { 200: { description: 'Residents', content: { 'application/json': { schema: ResidentList } } }, 401: err('Not signed in'), 403: err('Not allowed') },
});

const detail = createRoute({
  method: 'get',
  path: '/residents/{userId}',
  operationId: 'getResident',
  tags: ['residents'],
  summary: 'Resident profile: consent state for the care team, medical access per consent; every view is logged',
  security,
  middleware,
  request: { params: z.object({ userId: z.string().uuid() }) },
  responses: { 200: { description: 'Resident', content: { 'application/json': { schema: ResidentDetail } } }, 401: err('Not signed in'), 403: err('Not allowed'), 404: err('Not found') },
});

export const residentRoutes = new OpenAPIHono<AppEnv>()
  .openapi(list, async (c) => {
    const auth = c.get('auth')!;
    const repo = c.get('deps').residents;
    const isCare = auth.roles.some((r) => careTeam.includes(r));
    const rows = await repo.list({ siteIds: isCare ? 'all' : await repo.deskSites(auth.userId), q: c.req.valid('query').q, limit: 200 });
    return c.json({ residents: rows.map(toRow) }, 200);
  })
  .openapi(detail, async (c) => {
    const auth = c.get('auth')!;
    const { residents, consents } = c.get('deps');
    const isCare = auth.roles.some((r) => careTeam.includes(r));
    const r = await residents.get(c.req.valid('param').userId);
    // Outside a desk user's community looks the same as not existing.
    if (!r || (!isCare && (!r.siteId || !(await residents.deskSites(auth.userId)).includes(r.siteId)))) {
      return c.json({ error: { code: 'not_found', message: 'No such resident', requestId: c.get('requestId') } } satisfies ErrorBodyT, 404);
    }
    const history = isCare ? await consents.historyForStaff(r.userId) : null;
    await residents.logView(auth.userId, isCare ? 'care_team' : 'community_desk', r.userId, c.get('requestId'));
    return c.json(
      {
        ...toRow(r),
        householdSize: await residents.householdSize(r.householdId),
        consents: history ? currentState(history) : null,
        medicalAccess: !isCare ? 'not_permitted' : isGranted(history!, 'proactive_care') ? 'granted' : 'not_granted',
      } as const,
      200,
    );
  });
