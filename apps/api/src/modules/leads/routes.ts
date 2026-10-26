import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ErrorBody, Lead, LeadCreated, LeadList, LeadRequest, LeadStatusUpdate, leadStatuses, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import type { AppEnv } from '../../app';
import { checkLimits } from '../../lib/rate-limit';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { newLeadRef } from './repo';

/** Who can see and work leads in the console. */
const leadRoles = ['super_admin', 'operations'] as const;

const orgTypeLabel: Record<LeadRequest['orgType'], string> = {
  gated: 'Gated villas',
  apartment: 'Apartment complex',
  township: 'Township',
  senior_home: 'Senior-living home',
  employer: 'Employer',
  family: 'Family',
};

const createLead = createRoute({
  method: 'post',
  path: '/leads',
  operationId: 'createLead',
  tags: ['leads'],
  summary: 'Landing-site sign-up (community, organisation or family)',
  request: { body: { content: { 'application/json': { schema: LeadRequest } }, required: true } },
  responses: {
    201: { description: 'Saved', content: { 'application/json': { schema: LeadCreated } } },
    400: { description: 'Invalid', content: { 'application/json': { schema: ErrorBody } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const listLeads = createRoute({
  method: 'get',
  path: '/leads',
  operationId: 'listLeads',
  tags: ['leads'],
  summary: 'Leads for the console, newest first',
  security: [{ bearer: [] }],
  middleware: [requireAuth, requireStaff(leadRoles)] as const,
  request: { query: z.object({ status: z.enum(leadStatuses).optional() }) },
  responses: {
    200: { description: 'Leads', content: { 'application/json': { schema: LeadList } } },
    401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const updateLead = createRoute({
  method: 'patch',
  path: '/leads/{id}',
  operationId: 'updateLeadStatus',
  tags: ['leads'],
  summary: 'Move a lead through new → contacted → walkthrough booked → live',
  security: [{ bearer: [] }],
  middleware: [requireAuth, requireStaff(leadRoles)] as const,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: LeadStatusUpdate } }, required: true },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: Lead } } },
    401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorBody } } },
    403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorBody } } },
    404: { description: 'No such lead', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export const leadsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(createLead, async (c) => {
    const body = c.req.valid('json');
    const deps = c.get('deps');
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limited = await checkLimits(deps.kv, `leads:ip:${ip}`, [{ limit: 5, windowSeconds: 3600 }]);
    if (!limited.ok) {
      c.header('retry-after', String(limited.retryAfterSeconds));
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests. Please try again later.', requestId: c.get('requestId') } } satisfies ErrorBodyT, 429);
    }
    // Honeypot filled in: answer like a success so bots learn nothing; store nothing.
    if (body.website) return c.json({ ref: newLeadRef() }, 201);

    const { consent: _consent, website: _website, ...lead } = body;
    const { id, ref } = await deps.leads.create(lead);

    // A failed alert must not lose the lead; the console lists it either way.
    const place = [orgTypeLabel[lead.orgType], lead.city].join(', ');
    await deps.mailer
      .send({
        to: deps.config.salesInbox,
        subject: `New walkthrough request ${ref} · ${place}`,
        text: `${place}, size ${lead.size}.\nOpen in the console: ${deps.config.consoleUrl}/leads?focus=${id}`,
      })
      .catch((err: unknown) => console.error(JSON.stringify({ level: 'error', msg: 'lead alert failed', ref, name: (err as Error).name })));

    return c.json({ ref }, 201);
  })
  .openapi(listLeads, async (c) => {
    const { status } = c.req.valid('query');
    return c.json({ leads: await c.get('deps').leads.list({ status, limit: 200 }) }, 200);
  })
  .openapi(updateLead, async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('json');
    const lead = await c.get('deps').leads.setStatus(id, status, c.get('auth')!.userId);
    if (!lead) return c.json({ error: { code: 'not_found', message: 'No such lead', requestId: c.get('requestId') } } satisfies ErrorBodyT, 404);
    return c.json(lead, 200);
  });
