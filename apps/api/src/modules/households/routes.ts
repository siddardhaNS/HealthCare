import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  CreateHousehold,
  ContactAlerts,
  EmergencyContact,
  EmergencyContactInput,
  EmergencyContacts,
  ErrorBody,
  HouseholdInvite,
  HouseholdView,
  InviteCreate,
  MyInvites,
  Profile,
  type ErrorBody as ErrorBodyT,
} from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { normalizeIndianPhone } from '../../lib/phone';
import { requireAuth } from '../../middleware/auth';
import { acceptInvite, canActFor, createHousehold, fail, inviteMember, isFailure, listContacts, maskPhone, revokeInvite, viewHousehold, type Failure } from './service';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const err = (description: string) => json(ErrorBody, description);
const authed = { security, middleware: [requireAuth] };
/** Every route can answer with any household failure (see `status` below). */
const failures = {
  400: err('Invalid request (e.g. your own number)'),
  401: err('Not signed in'),
  403: err('Not allowed'),
  404: err('Not found (unknown code, home, invitation or contact)'),
  409: err('Conflict (already in a household, home needs an invitation, no household yet)'),
  410: err('Invitation expired'),
};

const status: Record<Failure['error'], 400 | 403 | 404 | 409 | 410> = {
  already_member: 409,
  household_exists: 409,
  not_member: 409,
  bad_code: 404,
  home_not_found: 404,
  not_found: 404,
  not_yours: 403,
  forbidden: 403,
  expired: 410,
  own_phone: 400,
};

function failure(c: Context<AppEnv>, f: Failure) {
  const body: ErrorBodyT = { error: { code: f.error, message: f.message, requestId: c.get('requestId') } };
  return c.json(body, status[f.error]);
}

const myPhone = (c: Context<AppEnv>) => {
  const p = c.get('auth')!.phone;
  return p ? normalizeIndianPhone(p) : null;
};

const routes = {
  view: createRoute({ method: 'get', path: '/households/me', operationId: 'getMyHousehold', tags: ['households'], summary: 'My household, members (with manager links) and open invitations', ...authed, responses: { 200: json(HouseholdView, 'Household'), ...failures } }),
  create: createRoute({
    method: 'post',
    path: '/households',
    operationId: 'createHousehold',
    tags: ['households'],
    summary: 'Set up my household: standalone (families) or by community code',
    ...authed,
    request: { body: { content: { 'application/json': { schema: CreateHousehold } }, required: true } },
    responses: { 201: json(HouseholdView, 'Created'), ...failures },
  }),
  invite: createRoute({
    method: 'post',
    path: '/households/invites',
    operationId: 'inviteToHousehold',
    tags: ['households'],
    summary: 'Invite a relative by phone; they accept after signing in with that number',
    ...authed,
    request: { body: { content: { 'application/json': { schema: InviteCreate } }, required: true } },
    responses: { 201: json(HouseholdInvite, 'Invitation'), ...failures },
  }),
  revoke: createRoute({
    method: 'delete',
    path: '/households/invites/{id}',
    operationId: 'revokeHouseholdInvite',
    tags: ['households'],
    summary: 'Cancel an open invitation',
    ...authed,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 204: { description: 'Cancelled' }, ...failures },
  }),
  myInvites: createRoute({ method: 'get', path: '/me/invites', operationId: 'listMyInvites', tags: ['households'], summary: 'Invitations sent to my verified phone number', ...authed, responses: { 200: json(MyInvites, 'Invitations'), ...failures } }),
  accept: createRoute({
    method: 'post',
    path: '/me/invites/{id}/accept',
    operationId: 'acceptHouseholdInvite',
    tags: ['households'],
    summary: 'Join the household that invited me',
    ...authed,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: json(HouseholdView, 'Joined'), ...failures },
  }),
  getProfile: createRoute({ method: 'get', path: '/me/profile', operationId: 'getMyProfile', tags: ['households'], summary: 'My name and language', ...authed, responses: { 200: json(Profile.nullable(), 'Profile, or null if not set'), ...failures } }),
  putProfile: createRoute({
    method: 'put',
    path: '/me/profile',
    operationId: 'saveMyProfile',
    tags: ['households'],
    summary: 'Set my name and language',
    ...authed,
    request: { body: { content: { 'application/json': { schema: Profile } }, required: true } },
    responses: { 200: json(Profile, 'Saved'), ...failures },
  }),
  contacts: createRoute({
    method: 'get',
    path: '/people/{userId}/emergency-contacts',
    operationId: 'listEmergencyContacts',
    tags: ['households'],
    summary: "A person's emergency contacts (mine, or someone who made me their manager)",
    ...authed,
    request: { params: z.object({ userId: z.string().uuid() }) },
    responses: { 200: json(EmergencyContacts, 'Contacts'), ...failures },
  }),
  addContact: createRoute({
    method: 'post',
    path: '/people/{userId}/emergency-contacts',
    operationId: 'addEmergencyContact',
    tags: ['households'],
    summary: 'Add an emergency contact',
    ...authed,
    request: { params: z.object({ userId: z.string().uuid() }), body: { content: { 'application/json': { schema: EmergencyContactInput } }, required: true } },
    responses: { 201: json(EmergencyContact, 'Added'), ...failures },
  }),
  contactAlerts: createRoute({
    method: 'put',
    path: '/people/{userId}/emergency-contacts/{id}/alerts',
    operationId: 'setEmergencyContactAlerts',
    tags: ['households'],
    summary: 'Confirm this contact agreed to SOS alerts on WhatsApp or SMS, or turn them off (plan §13; recorded as their opt-in)',
    ...authed,
    request: { params: z.object({ userId: z.string().uuid(), id: z.string().uuid() }), body: { content: { 'application/json': { schema: ContactAlerts } }, required: true } },
    responses: { 200: json(EmergencyContact, 'Updated'), ...failures },
  }),
  removeContact: createRoute({
    method: 'delete',
    path: '/people/{userId}/emergency-contacts/{id}',
    operationId: 'removeEmergencyContact',
    tags: ['households'],
    summary: 'Remove an emergency contact',
    ...authed,
    request: { params: z.object({ userId: z.string().uuid(), id: z.string().uuid() }) },
    responses: { 204: { description: 'Removed' }, ...failures },
  }),
};

export const householdRoutes = new OpenAPIHono<AppEnv>()
  .openapi(routes.view, async (c) => c.json(await viewHousehold(c.get('deps').households, c.get('auth')!.userId), 200))
  .openapi(routes.create, async (c) => {
    const repo = c.get('deps').households;
    const me = c.get('auth')!.userId;
    const r = await createHousehold(repo, me, c.req.valid('json'));
    if (isFailure(r)) return failure(c, r);
    return c.json(await viewHousehold(repo, me), 201);
  })
  .openapi(routes.invite, async (c) => {
    const r = await inviteMember(c.get('deps').households, c.get('auth')!.userId, myPhone(c), c.req.valid('json'));
    if (isFailure(r)) return failure(c, r);
    return c.json({ id: r.id, phone: maskPhone(r.phone), relation: r.relation, expiresAt: r.expiresAt.toISOString() }, 201);
  })
  .openapi(routes.revoke, async (c) => {
    const r = await revokeInvite(c.get('deps').households, c.get('auth')!.userId, c.req.valid('param').id);
    if (isFailure(r)) return failure(c, r);
    return c.body(null, 204);
  })
  .openapi(routes.myInvites, async (c) => {
    const phone = myPhone(c);
    const rows = phone ? await c.get('deps').households.openInvitesForPhone(phone, new Date()) : [];
    return c.json({ invites: rows.map((i) => ({ id: i.id, householdName: i.householdName, invitedBy: i.invitedByName, relation: i.relation, expiresAt: i.expiresAt.toISOString() })) }, 200);
  })
  .openapi(routes.accept, async (c) => {
    const repo = c.get('deps').households;
    const me = c.get('auth')!.userId;
    const r = await acceptInvite(repo, me, myPhone(c), c.req.valid('param').id);
    if (isFailure(r)) return failure(c, r);
    return c.json(await viewHousehold(repo, me), 200);
  })
  .openapi(routes.getProfile, async (c) => c.json(await c.get('deps').households.profile(c.get('auth')!.userId), 200))
  .openapi(routes.putProfile, async (c) => {
    const p = c.req.valid('json');
    await c.get('deps').households.saveProfile(c.get('auth')!.userId, p);
    return c.json(p, 200);
  })
  .openapi(routes.contacts, async (c) => {
    const r = await listContacts(c.get('deps').households, c.get('auth')!.userId, c.req.valid('param').userId);
    if (isFailure(r)) return failure(c, r);
    return c.json({ contacts: r }, 200);
  })
  .openapi(routes.addContact, async (c) => {
    const repo = c.get('deps').households;
    const me = c.get('auth')!.userId;
    const { userId } = c.req.valid('param');
    if (!(await canActFor(repo, me, userId))) return failure(c, fail('forbidden', 'You do not manage this person’s care.'));
    const b = c.req.valid('json');
    return c.json(await repo.addContact(me, userId, { name: b.name, relation: b.relation ?? null, phone: b.phone, priority: b.priority, alertsAgreed: b.alertsAgreed }), 201);
  })
  .openapi(routes.contactAlerts, async (c) => {
    const repo = c.get('deps').households;
    const me = c.get('auth')!.userId;
    const { userId, id } = c.req.valid('param');
    if (!(await canActFor(repo, me, userId))) return failure(c, fail('forbidden', 'You do not manage this person’s care.'));
    const r = await repo.setContactAlerts(me, userId, id, c.req.valid('json').agreed);
    return r ? c.json(r, 200) : failure(c, fail('not_found', 'No such contact.'));
  })
  .openapi(routes.removeContact, async (c) => {
    const repo = c.get('deps').households;
    const me = c.get('auth')!.userId;
    const { userId, id } = c.req.valid('param');
    if (!(await canActFor(repo, me, userId))) return failure(c, fail('forbidden', 'You do not manage this person’s care.'));
    if (!(await repo.removeContact(me, userId, id))) return failure(c, fail('not_found', 'No such contact.'));
    return c.body(null, 204);
  });
