import { describe, expect, it } from 'vitest';
import { testContext } from './helpers';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OPS = '44444444-4444-4444-8444-444444444444';

describe('community desk number (plan §11)', () => {
  const put = async (t: Awaited<ReturnType<typeof testContext>>, sub: string, roles: string[], body: unknown) =>
    t.app.request('/v1/settings/desk-phone', { method: 'PUT', headers: { authorization: `Bearer ${await t.token({ sub, aal: 'aal2', app_roles: roles })}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('is null until set, and anyone can read it without signing in (phones fetch it before sign-in)', async () => {
    const t = await testContext();
    const res = await t.app.request('/v1/config');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    expect(await res.json()).toEqual({ deskPhone: null });
  });

  it('only a super admin sets or clears it; every change is audited', async () => {
    const t = await testContext();
    expect((await put(t, OPS, ['operations'], { deskPhone: '+914023456789' })).status).toBe(403);
    expect((await t.app.request('/v1/settings/desk-phone', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"deskPhone":null}' })).status).toBe(401);
    const res = await put(t, ADMIN, ['super_admin'], { deskPhone: ' +914023456789 ' });
    expect(await res.json()).toEqual({ deskPhone: '+914023456789' });
    expect(await (await t.app.request('/v1/config')).json()).toEqual({ deskPhone: '+914023456789' });
    await put(t, ADMIN, ['super_admin'], { deskPhone: null });
    expect(t.ops.audit).toEqual([
      { from: null, to: '+914023456789' },
      { from: '+914023456789', to: null },
    ]);
  });

  it.each(['04023456789', '+91402345678', '+1 4023456789', ''])('refuses %j', async (deskPhone) => {
    const t = await testContext();
    expect((await put(t, ADMIN, ['super_admin'], { deskPhone })).status).toBe(400);
    expect(t.ops.audit).toEqual([]);
  });
});
