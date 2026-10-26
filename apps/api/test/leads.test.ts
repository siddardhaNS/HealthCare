import { describe, expect, it } from 'vitest';
import { testContext } from './helpers';

const valid = {
  orgType: 'apartment',
  orgName: 'Green Meadows',
  city: 'Hyderabad',
  area: 'Gachibowli',
  pin: '500032',
  size: 240,
  towers: 6,
  seniorShare: '10to25',
  onsite: ['guard'],
  contactName: 'Ravi Kumar',
  contactRole: 'association',
  phone: '+919876543210',
  email: 'ravi@example.in',
  services: ['consult', 'sos'],
  plan: 'complete',
  walkthrough: 'this_week',
  notes: 'Many seniors living alone',
  consent: true,
  consentVersion: 'lead-2026-10',
};

type Ctx = Awaited<ReturnType<typeof testContext>>;

const post = (t: Ctx, body: unknown, headers: Record<string, string> = {}) =>
  t.app.request('/v1/leads', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('POST /v1/leads', () => {
  it('saves the lead, returns a neutral reference and alerts sales without contact details', async () => {
    const t = await testContext();
    const res = await post(t, valid);
    expect(res.status).toBe(201);
    const { ref } = (await res.json()) as { ref: string };
    expect(ref).toMatch(/^L-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(t.leads).toHaveLength(1);
    expect(t.leads[0]).toMatchObject({ ref, status: 'new', orgName: 'Green Meadows', size: 240 });
    expect(t.mail).toHaveLength(1);
    expect(t.mail[0]!.to).toBe('sales@example.test');
    expect(t.mail[0]!.subject).toContain(ref);
    const mail = JSON.stringify(t.mail[0]);
    for (const pii of ['Ravi', '9876543210', 'ravi@example.in', 'seniors']) expect(mail).not.toContain(pii);
    expect(t.mail[0]!.text).toContain(`https://console.example.test/leads?focus=${t.leads[0]!.id}`);
  });

  it('accepts a family without an organisation name', async () => {
    const t = await testContext();
    const { orgName: _n, towers: _t, ...family } = valid;
    expect((await post(t, { ...family, orgType: 'family', contactRole: 'family', size: 2 })).status).toBe(201);
  });

  it('requires a name for communities and organisations', async () => {
    const t = await testContext();
    const { orgName: _n, ...noName } = valid;
    expect((await post(t, noName)).status).toBe(400);
  });

  it.each([
    ['no consent', { consent: false }],
    ['bad phone', { phone: '12345' }],
    ['bad PIN', { pin: '5000' }],
    ['no services', { services: [] }],
    ['bad email', { email: 'nope' }],
  ])('rejects %s', async (_name, patch) => {
    const t = await testContext();
    expect((await post(t, { ...valid, ...patch })).status).toBe(400);
    expect(t.leads).toHaveLength(0);
  });

  it('answers a filled honeypot like a success but stores and sends nothing', async () => {
    const t = await testContext();
    const res = await post(t, { ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(t.leads).toHaveLength(0);
    expect(t.mail).toHaveLength(0);
  });

  it('keeps the lead when the sales alert fails', async () => {
    const t = await testContext({ mailerFails: true });
    expect((await post(t, valid)).status).toBe(201);
    expect(t.leads).toHaveLength(1);
  });

  it('limits submissions per IP', async () => {
    const t = await testContext();
    for (let i = 0; i < 5; i++) expect((await post(t, valid, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(201);
    expect((await post(t, valid, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429);
    expect((await post(t, valid, { 'x-forwarded-for': '203.0.113.10' })).status).toBe(201);
  });

  it('allows the landing origin in CORS and no others', async () => {
    const t = await testContext();
    const ok = await t.app.request('/v1/leads', { method: 'OPTIONS', headers: { origin: 'https://web.example.test', 'access-control-request-method': 'POST' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://web.example.test');
    const bad = await t.app.request('/v1/leads', { method: 'OPTIONS', headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('console lead endpoints', () => {
  async function staff(t: Ctx, roles: string[], aal = 'aal2') {
    return { authorization: `Bearer ${await t.token({ sub: '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11', aal, app_roles: roles })}` };
  }

  it('lists and moves leads for operations staff at aal2', async () => {
    const t = await testContext();
    await post(t, valid);
    const headers = await staff(t, ['operations']);
    const list = (await (await t.app.request('/v1/leads', { headers })).json()) as { leads: { id: string; status: string }[] };
    expect(list.leads).toHaveLength(1);
    const id = list.leads[0]!.id;
    const res = await t.app.request(`/v1/leads/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'contacted' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('contacted');
    const filtered = (await (await t.app.request('/v1/leads?status=new', { headers })).json()) as { leads: unknown[] };
    expect(filtered.leads).toHaveLength(0);
  });

  it.each([
    ['a community desk user', ['community_desk'], 'aal2'],
    ['staff without TOTP', ['operations'], 'aal1'],
  ])('refuses %s', async (_name, roles, aal) => {
    const t = await testContext();
    expect((await t.app.request('/v1/leads', { headers: await staff(t, roles, aal) })).status).toBe(403);
  });

  it('404s an unknown lead', async () => {
    const t = await testContext();
    const res = await t.app.request('/v1/leads/00000000-0000-4000-8000-000000000000', {
      method: 'PATCH',
      headers: { ...(await staff(t, ['super_admin'])), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'live' }),
    });
    expect(res.status).toBe(404);
  });
});
