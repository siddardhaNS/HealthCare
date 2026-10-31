import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CoverageAssign, CoverageBackups, CoverageMember, CoveragePlaces, CoverageTeam, CoverageTeamCreate, CoverageTeamUpdate, CoverageTeams, ErrorBody, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';
import type { AssignFailure, TeamRow } from './repo';

// Plan §9: managed by super admin and operations. The community desk sees
// its community's team in the residents directory, but cannot change it.
const security = [{ bearer: [] }];
const managers = { security, middleware: [requireAuth, requireStaff(['super_admin', 'operations'])] };
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found'), 409: json(ErrorBody, 'Not possible') };
const idParam = { params: z.object({ id: z.string().uuid() }) };
const err = (c: Context<AppEnv>, code: string, message: string) => ({ error: { code, message, requestId: c.get('requestId') } }) satisfies ErrorBodyT;
const me = (c: Context<AppEnv>) => c.get('auth')!.userId;

const assignMessage: Record<AssignFailure, [number, string]> = {
  no_team: [404, 'No such team.'],
  team_inactive: [409, 'This team is inactive. Reactivate it before giving it places to cover.'],
  not_standalone: [400, 'Homes inside a community follow the community’s team; assign the community instead.'],
  unknown_place: [404, 'One of these places no longer exists. Refresh and try again.'],
  no_primary: [409, 'Every place needs a primary team before it can have backups. Set the primary first.'],
  too_many_backups: [409, 'A place can have at most 9 backup teams.'],
  is_primary: [409, 'This team is already the primary team for this place.'],
};

/** A team as listed, without members (create / update answers). */
const bare = (t: TeamRow) => ({ ...t, crews: [], ambulances: [], sites: 0, homes: 0, households: 0 });

const r = {
  teams: createRoute({ method: 'get', path: '/coverage/teams', operationId: 'coverageTeams', tags: ['coverage'], summary: 'Teams with their crews, ambulances and what they cover; plus everyone who can join a team', ...managers, responses: { 200: json(CoverageTeams, 'Teams'), ...failures } }),
  create: createRoute({ method: 'post', path: '/coverage/teams', operationId: 'createCoverageTeam', tags: ['coverage'], summary: 'Create a team', ...managers, request: body(CoverageTeamCreate), responses: { 201: json(CoverageTeam, 'Created'), ...failures } }),
  update: createRoute({
    method: 'patch',
    path: '/coverage/teams/{id}',
    operationId: 'updateCoverageTeam',
    tags: ['coverage'],
    summary: 'Rename, relabel, deactivate or reactivate a team (an inactive team is not offered SOS first)',
    ...managers,
    request: { ...idParam, ...body(CoverageTeamUpdate) },
    responses: { 200: json(CoverageTeam, 'Updated'), ...failures },
  }),
  crew: createRoute({
    method: 'put',
    path: '/coverage/crews/{id}/team',
    operationId: 'setCrewTeam',
    tags: ['coverage'],
    summary: 'Put a crew member in a team (moving them from any other), or take them out',
    ...managers,
    request: { ...idParam, ...body(CoverageMember) },
    responses: { 204: { description: 'Done' }, ...failures },
  }),
  ambulance: createRoute({
    method: 'put',
    path: '/coverage/ambulances/{id}/team',
    operationId: 'setAmbulanceTeam',
    tags: ['coverage'],
    summary: 'Put an ambulance in a team (moving it from any other), or take it out',
    ...managers,
    request: { ...idParam, ...body(CoverageMember) },
    responses: { 204: { description: 'Done' }, ...failures },
  }),
  places: createRoute({
    method: 'get',
    path: '/coverage/places',
    operationId: 'coveragePlaces',
    tags: ['coverage'],
    summary: 'Communities, buildings and stand-alone homes with the team covering each',
    ...managers,
    request: { query: z.object({ uncovered: z.enum(['true', 'false']).optional(), q: z.string().trim().max(60).optional() }) },
    responses: { 200: json(CoveragePlaces, 'Places'), ...failures },
  }),
  assign: createRoute({
    method: 'put',
    path: '/coverage/assignments',
    operationId: 'assignCoverage',
    tags: ['coverage'],
    summary: 'Assign places to a primary team in bulk (a place covered by another team moves), unassign them (teamId null), or add a backup team to each',
    ...managers,
    request: body(CoverageAssign),
    responses: { 200: json(z.object({ changed: z.number().int() }), 'Done'), ...failures },
  }),
  backups: createRoute({
    method: 'put',
    path: '/coverage/backups',
    operationId: 'setCoverageBackups',
    tags: ['coverage'],
    summary: 'Replace one place’s backup teams with an ordered list (offered in this order, one per timeout; plan §11)',
    ...managers,
    request: body(CoverageBackups),
    responses: { 200: json(z.object({ changed: z.boolean() }), 'Done'), ...failures },
  }),
};

export const coverageRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.teams, async (c) => {
    const { coverage } = c.get('deps');
    const [teams, roster] = await Promise.all([coverage.teams(), coverage.roster()]);
    return c.json({ teams, roster }, 200);
  })
  .openapi(r.create, async (c) => {
    const { name, area } = c.req.valid('json');
    return c.json(bare(await c.get('deps').coverage.createTeam({ name, area: area || null }, me(c))), 201);
  })
  .openapi(r.update, async (c) => {
    const change = c.req.valid('json');
    const row = await c.get('deps').coverage.updateTeam(c.req.valid('param').id, { ...change, ...(change.area !== undefined ? { area: change.area || null } : {}) }, me(c));
    if (!row) return c.json(err(c, 'not_found', 'No such team.'), 404);
    return c.json(bare(row), 200);
  })
  .openapi(r.crew, async (c) => {
    const { coverage } = c.get('deps');
    const { teamId } = c.req.valid('json');
    if (teamId && !(await coverage.team(teamId))) return c.json(err(c, 'not_found', 'No such team.'), 404);
    if (!(await coverage.setCrewTeam(c.req.valid('param').id, teamId, me(c)))) return c.json(err(c, 'not_found', 'No such crew member.'), 404);
    return c.body(null, 204);
  })
  .openapi(r.ambulance, async (c) => {
    const { coverage } = c.get('deps');
    const { teamId } = c.req.valid('json');
    if (teamId && !(await coverage.team(teamId))) return c.json(err(c, 'not_found', 'No such team.'), 404);
    if (!(await coverage.setAmbulanceTeam(c.req.valid('param').id, teamId, me(c)))) return c.json(err(c, 'not_found', 'No such ambulance.'), 404);
    return c.body(null, 204);
  })
  .openapi(r.places, async (c) => {
    const { uncovered, q } = c.req.valid('query');
    return c.json({ places: await c.get('deps').coverage.places({ uncovered: uncovered === 'true', q }) }, 200);
  })
  .openapi(r.assign, async (c) => {
    const { teamId, as, sites, households } = c.req.valid('json');
    const result = await c.get('deps').coverage.assign(teamId, { sites, households }, me(c), as);
    if (!result.ok) {
      const [status, message] = assignMessage[result.error];
      return c.json(err(c, result.error, message), status as 400 | 404 | 409);
    }
    return c.json({ changed: result.changed }, 200);
  })
  .openapi(r.backups, async (c) => {
    const { kind, id, teamIds } = c.req.valid('json');
    const result = await c.get('deps').coverage.setBackups({ kind, id }, teamIds, me(c));
    if (!result.ok) {
      const [status, message] = assignMessage[result.error];
      return c.json(err(c, result.error, message), status as 400 | 404 | 409);
    }
    return c.json({ changed: result.changed }, 200);
  });
