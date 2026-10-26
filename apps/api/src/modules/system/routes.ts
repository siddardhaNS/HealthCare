import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { HealthStatus } from '@repo/contracts';
import type { AppEnv } from '../../app';

const health = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: ['system'],
  summary: 'Liveness check',
  responses: {
    200: { description: 'API is up', content: { 'application/json': { schema: HealthStatus } } },
  },
});

export const systemRoutes = new OpenAPIHono<AppEnv>().openapi(health, (c) =>
  c.json(
    {
      status: 'ok' as const,
      region: process.env.VERCEL_REGION ?? 'local',
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '0.0.0',
      time: new Date().toISOString(),
    },
    200,
  ),
);
