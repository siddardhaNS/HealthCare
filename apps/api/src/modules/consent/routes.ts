import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { ConsentHistory, ConsentList, ConsentState, ConsentUpdate, ErrorBody, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import type { AppEnv } from '../../app';
import { requireAuth } from '../../middleware/auth';
import { checkUpdate, currentState } from './policy';

const security = [{ bearer: [] }];
const errors = {
  401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorBody } } },
} as const;

const list = createRoute({
  method: 'get',
  path: '/consents',
  operationId: 'listConsents',
  tags: ['consent'],
  summary: 'My consents: every standing purpose (granted, withdrawn or not asked) plus scoped ones',
  security,
  middleware: [requireAuth] as const,
  responses: { 200: { description: 'Current consents', content: { 'application/json': { schema: ConsentList } } }, ...errors },
});

const update = createRoute({
  method: 'post',
  path: '/consents',
  operationId: 'updateConsent',
  tags: ['consent'],
  summary: 'Grant or withdraw one of my consents (takes effect immediately)',
  security,
  middleware: [requireAuth] as const,
  request: { body: { content: { 'application/json': { schema: ConsentUpdate } }, required: true } },
  responses: {
    200: { description: 'Recorded', content: { 'application/json': { schema: ConsentState } } },
    409: { description: 'Not allowed as asked (stale notice, wrong scope, or needs an erasure request)', content: { 'application/json': { schema: ErrorBody } } },
    ...errors,
  },
});

const history = createRoute({
  method: 'get',
  path: '/consents/history',
  operationId: 'consentHistory',
  tags: ['consent'],
  summary: 'Every consent change I (or a manager) made, newest first',
  security,
  middleware: [requireAuth] as const,
  responses: { 200: { description: 'History', content: { 'application/json': { schema: ConsentHistory } } }, ...errors },
});

export const consentRoutes = new OpenAPIHono<AppEnv>()
  .openapi(list, async (c) => {
    const me = c.get('auth')!.userId;
    return c.json({ consents: currentState(await c.get('deps').consents.history(me)) }, 200);
  })
  .openapi(update, async (c) => {
    const me = c.get('auth')!.userId;
    const body = c.req.valid('json');
    const check = checkUpdate(me, body);
    if (!check.ok) return c.json({ error: { code: check.code, message: check.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, 409);
    const repo = c.get('deps').consents;
    await repo.record(me, { userId: me, purpose: body.purpose, scopeKey: body.scopeKey, status: body.status, noticeVersion: body.noticeVersion, language: body.language });
    const state = currentState(await repo.history(me)).find((s) => s.purpose === body.purpose && s.scopeKey === body.scopeKey)!;
    return c.json(state, 200);
  })
  .openapi(history, async (c) => {
    const me = c.get('auth')!.userId;
    const rows = await c.get('deps').consents.history(me);
    return c.json(
      {
        events: rows.map((r) => ({
          purpose: r.purpose,
          scopeKey: r.scopeKey,
          status: r.status,
          noticeVersion: r.noticeVersion,
          language: r.language,
          createdAt: r.createdAt.toISOString(),
          byManager: r.actedBy !== r.userId,
        })),
      },
      200,
    );
  });
