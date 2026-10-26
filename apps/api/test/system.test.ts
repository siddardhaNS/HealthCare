import { describe, expect, it } from 'vitest';
import { HealthStatus } from '@repo/contracts';
import { createApp } from '../src/app';

describe('system routes', () => {
  const app = createApp();

  it('GET /v1/health returns a valid HealthStatus', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(HealthStatus.safeParse(await res.json()).success).toBe(true);
  });

  it('unknown routes return a JSON 404 with a request id', async () => {
    const res = await app.request('/v1/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('serves an OpenAPI 3.1 document', async () => {
    const res = await app.request('/openapi.json');
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/health']).toBeDefined();
  });
});
