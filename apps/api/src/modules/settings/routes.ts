import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { AppConfig, DeskPhoneUpdate, ErrorBody } from '@repo/contracts';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed') };

const r = {
  config: createRoute({
    method: 'get',
    path: '/config',
    operationId: 'appConfig',
    tags: ['system'],
    summary: 'Public settings every app reads and keeps on the phone: the community desk number for the no-network SOS fallback',
    responses: { 200: json(AppConfig, 'Config') },
  }),
  deskPhone: createRoute({
    method: 'put',
    path: '/settings/desk-phone',
    operationId: 'setDeskPhone',
    tags: ['system'],
    summary: 'Set or clear the community desk number (super admin; audited). Phones pick it up the next time they are online.',
    security: [{ bearer: [] }],
    middleware: [requireAuth, requireStaff(['super_admin'])],
    request: { body: { content: { 'application/json': { schema: DeskPhoneUpdate } }, required: true } },
    responses: { 200: json(AppConfig, 'Saved'), ...failures },
  }),
};

export const settingsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.config, async (c) => {
    // Not personal: shared caches may keep it briefly, so a busy SOS hour does not hit the database.
    c.header('cache-control', 'public, max-age=60, s-maxage=60');
    return c.json({ deskPhone: await c.get('deps').opsSettings.deskPhone() }, 200);
  })
  .openapi(r.deskPhone, async (c) => {
    const { deskPhone } = c.req.valid('json');
    const { opsSettings } = c.get('deps');
    await opsSettings.setDeskPhone(deskPhone, c.get('auth')!.userId);
    return c.json({ deskPhone: await opsSettings.deskPhone() }, 200);
  });
