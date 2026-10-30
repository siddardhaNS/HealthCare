import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ErrorBody, SiteSosSettings, SiteSosSettingsList, SiteSosSettingsUpdate, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import { sosThresholds } from '@repo/contracts/sos';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { deskReadRoles, staffOf } from './desk';
import type { SiteSettingsRow } from './settings-repo';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found') };
const err = (c: Context<AppEnv>, code: string, message: string) => ({ error: { code, message, requestId: c.get('requestId') } }) satisfies ErrorBodyT;
/** Plan ⚑2: only a super admin changes thresholds; everyone who runs the command center can see them. */
const canEdit = (c: Context<AppEnv>) => c.get('auth')!.roles.includes('super_admin');
const view = (r: SiteSettingsRow) => ({ ...r, updatedAt: r.custom && r.updatedAt ? r.updatedAt.toISOString() : null });

const r = {
  list: createRoute({
    method: 'get',
    path: '/sos-settings',
    operationId: 'sosSettings',
    tags: ['desk'],
    summary: 'Escalation thresholds per community (the community desk: its own)',
    security,
    middleware: [requireAuth, requireStaff(deskReadRoles)],
    responses: { 200: json(SiteSosSettingsList, 'Thresholds'), ...failures },
  }),
  set: createRoute({
    method: 'put',
    path: '/sos-settings/{siteId}',
    operationId: 'setSosSettings',
    tags: ['desk'],
    summary: 'Set a community’s thresholds (super admin; applies to the next SOS; audited)',
    security,
    middleware: [requireAuth, requireStaff(['super_admin'])],
    request: { params: z.object({ siteId: z.string().uuid() }), body: { content: { 'application/json': { schema: SiteSosSettingsUpdate } }, required: true } },
    responses: { 200: json(SiteSosSettings, 'Saved'), ...failures },
  }),
};

export const sosSettingsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.list, async (c) => {
    const auth = c.get('auth')!;
    const staff = await staffOf(auth, () => c.get('deps').residents.deskSites(auth.userId));
    const rows = await c.get('deps').sosSettings.list(staff.sites);
    return c.json({ sites: rows.map(view), canEdit: canEdit(c), defaults: { widenAfterS: sosThresholds.widenDefault, escalateAfterS: sosThresholds.escalateDefault } }, 200);
  })
  .openapi(r.set, async (c) => {
    const row = await c.get('deps').sosSettings.set(c.req.valid('param').siteId, c.req.valid('json'), c.get('auth')!.userId);
    if (!row) return c.json(err(c, 'not_found', 'No such community.'), 404);
    return c.json(view(row), 200);
  });
