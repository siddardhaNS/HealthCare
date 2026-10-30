// Coverage teams (docs/plans/phase-3-sos.md §9): which crew-and-ambulance
// team covers which communities, buildings and stand-alone homes. Every
// change is audited. Dispatch reads assignments through its own repo.
import { ambulances, and, asc, auditEvents, coverageAssignments, coverageTeams, crewShifts, crews, eq, homes, households, householdMembers, ilike, inArray, isNull, or, profiles, sites, sql, type Db } from '@repo/db';

export interface TeamRow {
  id: string;
  name: string;
  area: string | null;
  active: boolean;
}

export interface TeamSummary extends TeamRow {
  crews: { crewId: string; name: string | null; onDuty: boolean }[];
  ambulances: { id: string; registration: string }[];
  sites: number;
  homes: number;
  households: number;
}

export interface PlaceRow {
  kind: 'site' | 'household';
  id: string;
  name: string;
  city: string | null;
  households: number;
  teamId: string | null;
  teamName: string | null;
}

export interface Roster {
  crews: { crewId: string; name: string | null; teamId: string | null }[];
  ambulances: { id: string; registration: string; teamId: string | null }[];
}

export type AssignFailure = 'no_team' | 'team_inactive' | 'not_standalone' | 'unknown_place';

export interface CoverageRepo {
  teams(): Promise<TeamSummary[]>;
  team(id: string): Promise<TeamRow | null>;
  roster(): Promise<Roster>;
  createTeam(t: { name: string; area: string | null }, actor: string): Promise<TeamRow>;
  updateTeam(id: string, change: Partial<Pick<TeamRow, 'name' | 'area' | 'active'>>, actor: string): Promise<TeamRow | null>;
  /** False if there is no such active crew / ambulance. */
  setCrewTeam(crewId: string, teamId: string | null, actor: string): Promise<boolean>;
  setAmbulanceTeam(ambulanceId: string, teamId: string | null, actor: string): Promise<boolean>;
  places(filter: { uncovered: boolean; q?: string }): Promise<PlaceRow[]>;
  /** Assigns (or with teamId null, unassigns) places in one transaction. A place covered by another team moves. */
  assign(teamId: string | null, places: { sites: string[]; households: string[] }, actor: string): Promise<{ ok: true; changed: number } | { ok: false; error: AssignFailure }>;
}

const audit = (actor: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) => ({
  actorUserId: actor,
  actorRole: 'staff',
  action,
  entityType,
  entityId,
  metadata,
});

// Correlated subqueries name the outer table in plain SQL: Drizzle leaves select-list
// columns unqualified in single-table queries, where they would bind to the inner table.
const TEAM_COLS = { id: coverageTeams.id, name: coverageTeams.name, area: coverageTeams.area, active: coverageTeams.active };

export function drizzleCoverageRepo(db: Db): CoverageRepo {
  const team = async (id: string) => (await db.select(TEAM_COLS).from(coverageTeams).where(eq(coverageTeams.id, id)))[0] ?? null;

  return {
    async teams() {
      const [teams, members, vehicles, counts] = await Promise.all([
        db.select(TEAM_COLS).from(coverageTeams).orderBy(asc(coverageTeams.name)),
        db
          .select({
            teamId: crews.teamId,
            crewId: crews.id,
            name: profiles.fullName,
            onDuty: sql<boolean>`exists (select 1 from ${crewShifts} s where s.crew_id = ${crews.id} and s.ended_at is null)`,
          })
          .from(crews)
          .leftJoin(profiles, eq(profiles.userId, crews.userId))
          .where(and(eq(crews.active, true), sql`${crews.teamId} is not null`))
          .orderBy(asc(profiles.fullName)),
        db
          .select({ teamId: ambulances.teamId, id: ambulances.id, registration: ambulances.registration })
          .from(ambulances)
          .where(and(eq(ambulances.active, true), sql`${ambulances.teamId} is not null`)),
        db
          .select({
            teamId: coverageAssignments.teamId,
            sites: sql<number>`count(${coverageAssignments.siteId})::int`,
            homes: sql<number>`count(${coverageAssignments.householdId})::int`,
            households: sql<number>`(count(${coverageAssignments.householdId}) + coalesce(sum((select count(*) from ${households} h join ${homes} hm on hm.id = h.home_id where hm.site_id = coverage_assignments.site_id)), 0))::int`,
          })
          .from(coverageAssignments)
          // Places this team covers as the primary team; backups are listed per place (plan §11).
          .where(eq(coverageAssignments.rank, 0))
          .groupBy(coverageAssignments.teamId),
      ]);
      return teams.map((t) => {
        const c = counts.find((x) => x.teamId === t.id);
        return {
          ...t,
          crews: members.filter((m) => m.teamId === t.id).map(({ teamId: _t, ...m }) => m),
          ambulances: vehicles.filter((v) => v.teamId === t.id).map(({ teamId: _t, ...v }) => v),
          sites: c?.sites ?? 0,
          homes: c?.homes ?? 0,
          households: c?.households ?? 0,
        };
      });
    },
    team,
    async roster() {
      const [c, a] = await Promise.all([
        db.select({ crewId: crews.id, name: profiles.fullName, teamId: crews.teamId }).from(crews).leftJoin(profiles, eq(profiles.userId, crews.userId)).where(eq(crews.active, true)).orderBy(asc(profiles.fullName)),
        db.select({ id: ambulances.id, registration: ambulances.registration, teamId: ambulances.teamId }).from(ambulances).where(eq(ambulances.active, true)).orderBy(asc(ambulances.registration)),
      ]);
      return { crews: c, ambulances: a };
    },
    async createTeam(t, actor) {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(coverageTeams).values({ name: t.name, area: t.area }).returning(TEAM_COLS);
        await tx.insert(auditEvents).values(audit(actor, 'coverage_team_created', 'coverage_team', row!.id, { name: t.name }));
        return row!;
      });
    },
    async updateTeam(id, change, actor) {
      return db.transaction(async (tx) => {
        const [row] = await tx.update(coverageTeams).set(change).where(eq(coverageTeams.id, id)).returning(TEAM_COLS);
        if (row) await tx.insert(auditEvents).values(audit(actor, 'coverage_team_updated', 'coverage_team', id, change));
        return row ?? null;
      });
    },
    async setCrewTeam(crewId, teamId, actor) {
      return db.transaction(async (tx) => {
        const [before] = await tx.select({ teamId: crews.teamId }).from(crews).where(and(eq(crews.id, crewId), eq(crews.active, true)));
        if (!before) return false;
        await tx.update(crews).set({ teamId }).where(eq(crews.id, crewId));
        await tx.insert(auditEvents).values(audit(actor, 'coverage_crew_moved', 'crew', crewId, { from: before.teamId, to: teamId }));
        return true;
      });
    },
    async setAmbulanceTeam(ambulanceId, teamId, actor) {
      return db.transaction(async (tx) => {
        const [before] = await tx.select({ teamId: ambulances.teamId }).from(ambulances).where(and(eq(ambulances.id, ambulanceId), eq(ambulances.active, true)));
        if (!before) return false;
        await tx.update(ambulances).set({ teamId }).where(eq(ambulances.id, ambulanceId));
        await tx.insert(auditEvents).values(audit(actor, 'coverage_ambulance_moved', 'ambulance', ambulanceId, { from: before.teamId, to: teamId }));
        return true;
      });
    },
    async places({ uncovered, q }) {
      const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const siteRows = await db
        .select({
          id: sites.id,
          name: sites.name,
          city: sites.city,
          households: sql<number>`(select count(*) from ${households} h join ${homes} hm on hm.id = h.home_id where hm.site_id = sites.id)::int`,
          teamId: coverageAssignments.teamId,
          teamName: coverageTeams.name,
        })
        .from(sites)
        .leftJoin(coverageAssignments, and(eq(coverageAssignments.siteId, sites.id), eq(coverageAssignments.rank, 0)))
        .leftJoin(coverageTeams, eq(coverageTeams.id, coverageAssignments.teamId))
        .where(and(uncovered ? isNull(coverageAssignments.teamId) : undefined, like ? or(ilike(sites.name, like), ilike(sites.city, like)) : undefined))
        .orderBy(asc(sites.name));
      // A stand-alone home is named after its household, else its owner.
      const owner = sql<string | null>`(select p.full_name from ${householdMembers} m join ${profiles} p on p.user_id = m.user_id where m.household_id = households.id and m.role = 'owner' limit 1)`;
      const homeName = sql<string | null>`coalesce(${households.name}, ${owner})`;
      const homeRows = await db
        .select({ id: households.id, name: homeName, city: households.city, teamId: coverageAssignments.teamId, teamName: coverageTeams.name })
        .from(households)
        .leftJoin(coverageAssignments, and(eq(coverageAssignments.householdId, households.id), eq(coverageAssignments.rank, 0)))
        .leftJoin(coverageTeams, eq(coverageTeams.id, coverageAssignments.teamId))
        .where(and(isNull(households.homeId), uncovered ? isNull(coverageAssignments.teamId) : undefined, like ? or(sql`${homeName} ilike ${like}`, ilike(households.city, like)) : undefined))
        .orderBy(asc(households.city));
      return [
        ...siteRows.map((s) => ({ kind: 'site' as const, ...s })),
        ...homeRows.map((h) => ({ kind: 'household' as const, id: h.id, name: h.name ?? '', city: h.city, households: 1, teamId: h.teamId, teamName: h.teamName })),
      ];
    },
    async assign(teamId, { sites: siteIds, households: householdIds }, actor) {
      if (teamId) {
        const t = await team(teamId);
        if (!t) return { ok: false, error: 'no_team' };
        if (!t.active) return { ok: false, error: 'team_inactive' };
      }
      if (siteIds.length) {
        const found = await db.select({ id: sites.id }).from(sites).where(inArray(sites.id, siteIds));
        if (found.length !== new Set(siteIds).size) return { ok: false, error: 'unknown_place' };
      }
      if (householdIds.length) {
        const found = await db.select({ id: households.id, homeId: households.homeId }).from(households).where(inArray(households.id, householdIds));
        if (found.length !== new Set(householdIds).size) return { ok: false, error: 'unknown_place' };
        // Households in a community follow the community's team.
        if (found.some((h) => h.homeId !== null)) return { ok: false, error: 'not_standalone' };
      }
      return db.transaction(async (tx) => {
        const where = or(siteIds.length ? inArray(coverageAssignments.siteId, siteIds) : undefined, householdIds.length ? inArray(coverageAssignments.householdId, householdIds) : undefined)!;
        // The primary team changes; the new team is taken off the place's backup list (a team appears once per place).
        if (teamId) await tx.delete(coverageAssignments).where(and(where, eq(coverageAssignments.teamId, teamId), sql`${coverageAssignments.rank} > 0`));
        const before = await tx.delete(coverageAssignments).where(and(where, eq(coverageAssignments.rank, 0))).returning({ siteId: coverageAssignments.siteId, householdId: coverageAssignments.householdId, teamId: coverageAssignments.teamId });
        const was = (siteId: string | null, householdId: string | null) => before.find((b) => (siteId && b.siteId === siteId) || (householdId && b.householdId === householdId))?.teamId ?? null;
        const places = [...siteIds.map((id) => ({ siteId: id, householdId: null })), ...householdIds.map((id) => ({ siteId: null, householdId: id }))];
        if (teamId) await tx.insert(coverageAssignments).values(places.map((p) => ({ ...p, teamId, assignedBy: actor })));
        const changed = places.filter((p) => was(p.siteId, p.householdId) !== teamId);
        if (changed.length) {
          await tx.insert(auditEvents).values(
            changed.map((p) => audit(actor, teamId ? 'coverage_assigned' : 'coverage_removed', p.siteId ? 'site' : 'household', (p.siteId ?? p.householdId)!, { from: was(p.siteId, p.householdId), to: teamId })),
          );
        }
        return { ok: true as const, changed: changed.length };
      });
    },
  };
}
