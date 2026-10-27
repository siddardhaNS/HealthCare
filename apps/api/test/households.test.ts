import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const SON = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const STRANGER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PHONES: Record<string, string> = { [MOM]: '919876543210', [SON]: '919812345678', [STRANGER]: '919900011122' };

type Ctx = Awaited<ReturnType<typeof testContext>>;

async function as(t: Ctx, user: string) {
  const token = await t.token({ sub: user, phone: PHONES[user] });
  return {
    get: (path: string) => t.app.request(path, { headers: { authorization: `Bearer ${token}` } }),
    post: (path: string, body?: unknown) =>
      t.app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    put: (path: string, body: unknown) => t.app.request(path, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    del: (path: string) => t.app.request(path, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }),
  };
}

const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('households', () => {
  it('a family sets up a standalone household (no community needed)', async () => {
    const t = await testContext();
    const mom = await as(t, MOM);
    expect(await (await mom.get('/v1/households/me')).json()).toEqual({ household: null, members: [], invites: [] });
    const res = await mom.post('/v1/households', { mode: 'standalone', city: 'Vijayawada', name: 'Rao family' });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { household: { community: unknown; city: string }; members: { isMe: boolean; role: string }[] };
    expect(view.household).toMatchObject({ city: 'Vijayawada', community: null });
    expect(view.members).toEqual([expect.objectContaining({ isMe: true, role: 'owner' })]);
    expect(await code(await mom.post('/v1/households', { mode: 'standalone', city: 'Pune' }))).toBe('already_member');
  });

  it('joins a community home by code, case-insensitive', async () => {
    const t = await testContext();
    t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
    const res = await (await as(t, MOM)).post('/v1/households', { mode: 'join', joinCode: 'green24', tower: 'b', number: '1204' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { household: unknown }).household).toMatchObject({ community: { name: 'Green Meadows' }, home: { tower: 'B', number: '1204' }, city: 'Hyderabad' });
  });

  it('a code and a flat number are not enough to join someone else’s household', async () => {
    const t = await testContext();
    t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
    await (await as(t, MOM)).post('/v1/households', { mode: 'join', joinCode: 'GREEN24', tower: 'B', number: '1204' });
    const res = await (await as(t, STRANGER)).post('/v1/households', { mode: 'join', joinCode: 'GREEN24', tower: 'B', number: '1204' });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('household_exists');
  });

  it.each([
    ['unknown code', { mode: 'join', joinCode: 'NOPE999', number: '1' }, 404, 'bad_code'],
    ['unknown home', { mode: 'join', joinCode: 'GREEN24', tower: 'Z', number: '9' }, 404, 'home_not_found'],
  ])('%s', async (_n, body, status, c) => {
    const t = await testContext();
    t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
    const res = await (await as(t, MOM)).post('/v1/households', body);
    expect(res.status).toBe(status);
    expect(await code(res)).toBe(c);
  });
});

describe('family invitations', () => {
  async function momWithHousehold(t: Ctx) {
    const mom = await as(t, MOM);
    await mom.put('/v1/me/profile', { fullName: 'Lakshmi Rao', language: 'te' });
    await mom.post('/v1/households', { mode: 'standalone', city: 'Vijayawada', name: 'Rao family' });
    return mom;
  }

  it('invite → the invited number sees it → accepts → is a member', async () => {
    const t = await testContext();
    const mom = await momWithHousehold(t);
    const inv = await mom.post('/v1/households/invites', { phone: '+919812345678', relation: 'son' });
    expect(inv.status).toBe(201);
    const invite = (await inv.json()) as { id: string; phone: string };
    expect(invite.phone).toBe('+91 ••••• 5678');

    const son = await as(t, SON);
    const mine = (await (await son.get('/v1/me/invites')).json()) as { invites: { id: string; householdName: string; invitedBy: string; relation: string }[] };
    expect(mine.invites).toEqual([expect.objectContaining({ id: invite.id, householdName: 'Rao family', invitedBy: 'Lakshmi Rao', relation: 'son' })]);

    const joined = await son.post(`/v1/me/invites/${invite.id}/accept`);
    expect(joined.status).toBe(200);
    const view = (await joined.json()) as { members: { userId: string; relation: string | null; fullName: string | null }[] };
    expect(view.members.map((m) => m.userId)).toEqual([MOM, SON]);
    expect(view.members[0]!.fullName).toBe('Lakshmi Rao');
    // Accepted invitations disappear from the open list.
    expect(((await (await mom.get('/v1/households/me')).json()) as { invites: unknown[] }).invites).toHaveLength(0);
  });

  it('only the invited phone number can accept', async () => {
    const t = await testContext();
    const mom = await momWithHousehold(t);
    const { id } = (await (await mom.post('/v1/households/invites', { phone: '+919812345678' })).json()) as { id: string };
    const res = await (await as(t, STRANGER)).post(`/v1/me/invites/${id}/accept`);
    expect(res.status).toBe(403);
    expect(t.hh.members.some((m) => m.userId === STRANGER)).toBe(false);
  });

  it('cancelled and expired invitations cannot be accepted', async () => {
    const t = await testContext();
    const mom = await momWithHousehold(t);
    const { id } = (await (await mom.post('/v1/households/invites', { phone: '+919812345678' })).json()) as { id: string };
    expect((await mom.del(`/v1/households/invites/${id}`)).status).toBe(204);
    expect((await (await as(t, SON)).post(`/v1/me/invites/${id}/accept`)).status).toBe(404);

    const again = (await (await mom.post('/v1/households/invites', { phone: '+919812345678' })).json()) as { id: string };
    t.hh.invites.find((i) => i.id === again.id)!.expiresAt = new Date(Date.now() - 1000);
    expect((await (await as(t, SON)).post(`/v1/me/invites/${again.id}/accept`)).status).toBe(410);
  });

  it('inviting the same number twice returns the open invitation; inviting yourself is refused', async () => {
    const t = await testContext();
    const mom = await momWithHousehold(t);
    const a = (await (await mom.post('/v1/households/invites', { phone: '+919812345678' })).json()) as { id: string };
    const b = (await (await mom.post('/v1/households/invites', { phone: '+919812345678' })).json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(await code(await mom.post('/v1/households/invites', { phone: '+919876543210' }))).toBe('own_phone');
  });

  it('you need a household before inviting', async () => {
    const t = await testContext();
    expect(await code(await (await as(t, MOM)).post('/v1/households/invites', { phone: '+919812345678' }))).toBe('not_member');
  });
});

describe('managers and emergency contacts', () => {
  async function family(t: Ctx) {
    const mom = await as(t, MOM);
    const son = await as(t, SON);
    await mom.post('/v1/households', { mode: 'standalone', city: 'Vijayawada' });
    const { id } = (await (await mom.post('/v1/households/invites', { phone: '+919812345678', relation: 'son' })).json()) as { id: string };
    await son.post(`/v1/me/invites/${id}/accept`);
    return { mom, son };
  }
  const grant = (status: 'granted' | 'withdrawn') => ({ purpose: 'manager', scopeKey: SON, status, noticeVersion: purposeMeta.manager.noticeVersion, language: 'te' });

  it('a son manages his mother’s contacts only after she makes him manager, and loses it when she withdraws', async () => {
    const t = await testContext();
    const { mom, son } = await family(t);
    const contact = { name: 'Dr. Reddy clinic', relation: 'doctor', phone: '+919000011111' };

    expect((await son.post(`/v1/people/${MOM}/emergency-contacts`, contact)).status).toBe(403);

    expect((await mom.post('/v1/consents', grant('granted'))).status).toBe(200);
    const view = (await (await son.get('/v1/households/me')).json()) as { members: { userId: string; iManage: boolean }[] };
    expect(view.members.find((m) => m.userId === MOM)!.iManage).toBe(true);
    expect((await son.post(`/v1/people/${MOM}/emergency-contacts`, contact)).status).toBe(201);
    expect(((await (await son.get(`/v1/people/${MOM}/emergency-contacts`)).json()) as { contacts: unknown[] }).contacts).toHaveLength(1);

    await mom.post('/v1/consents', grant('withdrawn'));
    expect((await son.get(`/v1/people/${MOM}/emergency-contacts`)).status).toBe(403);
  });

  it('people manage their own contacts; others cannot', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    const added = (await (await mom.post(`/v1/people/${MOM}/emergency-contacts`, { name: 'Arjun', relation: 'son', phone: '+919812345678' })).json()) as { id: string };
    expect((await (await as(t, STRANGER)).get(`/v1/people/${MOM}/emergency-contacts`)).status).toBe(403);
    expect((await mom.del(`/v1/people/${MOM}/emergency-contacts/${added.id}`)).status).toBe(204);
    expect((await mom.del(`/v1/people/${MOM}/emergency-contacts/${added.id}`)).status).toBe(404);
  });

  it('validates contact phone numbers', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    expect((await mom.post(`/v1/people/${MOM}/emergency-contacts`, { name: 'X', phone: '12345' })).status).toBe(400);
  });
});
