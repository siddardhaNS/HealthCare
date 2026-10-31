// Coverage teams (docs/plans/phase-3-sos.md §9): which crew-and-ambulance
// team covers which communities, buildings and stand-alone homes. Every
// change is audited. Dispatch reads assignments through its own repo.
import { MAX_BACKUP_TEAMS } from '@repo/contracts';
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
  /** Backup teams in order (plan §11). */
  backups: { teamId: string; teamName: string; active: boolean }[];
}

export interface Roster {
  crews: { crewId: string; name: string | null; teamId: string | null }[];
  ambulances: { id: string; registration: string; teamId: string | null }[];
}

export type AssignFailure = 'no_team' | 'team_inactive' | 'not_standalone' | 'unknown_place' | 'no_primary' | 'too_many_backups' | 'is_primary';

export interface PlaceRef {
  kind: 'site' | 'household';
  id: string;
}

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
  /**
   * As primary: assigns (or with teamId null, unassigns along with the backups) places in one
   * transaction; a place covered by another team moves. As backup: appends the team to each
   * place's backup list (skipped where it is already the primary or a backup).
   */
  assign(teamId: string | null, places: { sites: string[]; households: string[] }, actor: string, as?: 'primary' | 'backup'): Promise<{ ok: true; changed: number } | { ok: false; error: AssignFailure }>;
  /** Replaces one place's ordered backup list. */
  setBackups(place: PlaceRef, teamIds: string[], actor: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: AssignFailure }>;
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

  type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
  type PlaceKey = { siteId: string | null; householdId: string | null };
  const placeWhere = (p: PlaceKey) => (p.siteId ? eq(coverageAssignments.siteId, p.siteId) : eq(coverageAssignments.householdId, p.householdId!));

  /** Rewrites a place's backups as ranks 1..n, so the order has no gaps. */
  async function writeBackups(tx: Tx, p: PlaceKey, teamIds: string[], actor: string) {
    await tx.delete(coverageAssignments).where(and(placeWhere(p), sql`${coverageAssignments.rank} > 0`));
    if (teamIds.length) await tx.insert(coverageAssignments).values(teamIds.map((teamId, i) => ({ ...p, teamId, rank: i + 1, assignedBy: actor })));
  }

  /** A place's primary team (or null) and its backups in order. */
  async function cover(tx: Tx, p: PlaceKey) {
    const rows = await tx.select({ teamId: coverageAssignments.teamId, rank: coverageAssignments.rank }).from(coverageAssignments).where(placeWhere(p)).orderBy(asc(coverageAssignments.rank));
    return { primary: rows.find((r) => r.rank === 0)?.teamId ?? null, backups: rows.filter((r) => r.rank > 0).map((r) => r.teamId) };
  }

  async function addBackup(teamId: string, siteIds: string[], householdIds: string[], actor: string) {
    const places: PlaceKey[] = [...siteIds.map((id) => ({ siteId: id, householdId: null })), ...householdIds.map((id) => ({ siteId: null, householdId: id }))];
    return db.transaction(async (tx) => {
      const covers = await Promise.all(places.map((p) => cover(tx, p)));
      if (covers.some((c) => !c.primary)) return { ok: false as const, error: 'no_primary' as const };
      // Skipped where the team already covers the place, as primary or backup.
      const todo = places.map((p, i) => ({ p, c: covers[i]! })).filter(({ c }) => c.primary !== teamId && !c.backups.includes(teamId));
      if (todo.some(({ c }) => c.backups.length >= MAX_BACKUP_TEAMS)) return { ok: false as const, error: 'too_many_backups' as const };
      for (const { p, c } of todo) {
        await writeBackups(tx, p, [...c.backups, teamId], actor);
        await tx.insert(auditEvents).values(audit(actor, 'coverage_backups_set', p.siteId ? 'site' : 'household', (p.siteId ?? p.householdId)!, { from: c.backups, to: [...c.backups, teamId] }));
      }
      return { ok: true as const, changed: todo.length };
    });
  }

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
      const backupRows = await db
        .select({ siteId: coverageAssignments.siteId, householdId: coverageAssignments.householdId, teamId: coverageAssignments.teamId, teamName: coverageTeams.name, active: coverageTeams.active })
        .from(coverageAssignments)
        .innerJoin(coverageTeams, eq(coverageTeams.id, coverageAssignments.teamId))
        .where(sql`${coverageAssignments.rank} > 0`)
        .orderBy(asc(coverageAssignments.rank));
      const backups = (kind: 'site' | 'household', id: string) =>
        backupRows.filter((b) => (kind === 'site' ? b.siteId : b.householdId) === id).map(({ teamId, teamName, active }) => ({ teamId, teamName, active }));
      return [
        ...siteRows.map((s) => ({ kind: 'site' as const, ...s, backups: backups('site', s.id) })),
        ...homeRows.map((h) => ({ kind: 'household' as const, id: h.id, name: h.name ?? '', city: h.city, households: 1, teamId: h.teamId, teamName: h.teamName, backups: backups('household', h.id) })),
      ];
    },
    async assign(teamId, { sites: siteIds, households: householdIds }, actor, as = 'primary') {
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
      if (as === 'backup') return addBackup(teamId!, siteIds, householdIds, actor);
      return db.transaction(async (tx) => {
        const where = or(siteIds.length ? inArray(coverageAssignments.siteId, siteIds) : undefined, householdIds.length ? inArray(coverageAssignments.householdId, householdIds) : undefined)!;
        // The primary team changes; the new team is taken off the place's backup list (a team appears once per place).
        // Without a primary there is no first ring, so removing the cover removes the backups too.
        const backupsBefore = await tx
          .select({ siteId: coverageAssignments.siteId, householdId: coverageAssignments.householdId, teamId: coverageAssignments.teamId })
          .from(coverageAssignments)
          .where(and(where, sql`${coverageAssignments.rank} > 0`))
          .orderBy(asc(coverageAssignments.rank));
        const before = await tx.delete(coverageAssignments).where(and(where, eq(coverageAssignments.rank, 0))).returning({ siteId: coverageAssignments.siteId, householdId: coverageAssignments.householdId, teamId: coverageAssignments.teamId });
        const was = (siteId: string | null, householdId: string | null) => before.find((b) => (siteId && b.siteId === siteId) || (householdId && b.householdId === householdId))?.teamId ?? null;
        const places = [...siteIds.map((id) => ({ siteId: id, householdId: null })), ...householdIds.map((id) => ({ siteId: null, householdId: id }))];
        // Backups first: the new primary must leave the list before it is inserted (a team once per place).
        for (const p of places) {
          const list = backupsBefore.filter((b) => (p.siteId ? b.siteId === p.siteId : b.householdId === p.householdId)).map((b) => b.teamId);
          if (!list.length || (teamId && !list.includes(teamId))) continue;
          await writeBackups(tx, p, teamId ? list.filter((t) => t !== teamId) : [], actor);
        }
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
    async setBackups({ kind, id }, teamIds, actor) {
      const p: PlaceKey = kind === 'site' ? { siteId: id, householdId: null } : { siteId: null, householdId: id };
      if (kind === 'site') {
        if (!(await db.select({ id: sites.id }).from(sites).where(eq(sites.id, id))).length) return { ok: false, error: 'unknown_place' };
      } else {
        const [h] = await db.select({ homeId: households.homeId }).from(households).where(eq(households.id, id));
        if (!h) return { ok: false, error: 'unknown_place' };
        if (h.homeId !== null) return { ok: false, error: 'not_standalone' };
      }
      const found = teamIds.length ? await db.select(TEAM_COLS).from(coverageTeams).where(inArray(coverageTeams.id, teamIds)) : [];
      if (found.length !== teamIds.length) return { ok: false, error: 'no_team' };
      return db.transaction(async (tx) => {
        const c = await cover(tx, p);
        if (teamIds.length && !c.primary) return { ok: false as const, error: 'no_primary' as const };
        if (c.primary && teamIds.includes(c.primary)) return { ok: false as const, error: 'is_primary' as const };
        // A team already on the list may stay while inactive (dispatch skips it); a new one must be active.
        if (found.some((t) => !t.active && !c.backups.includes(t.id))) return { ok: false as const, error: 'team_inactive' as const };
        if (c.backups.join() === teamIds.join()) return { ok: true as const, changed: false };
        await writeBackups(tx, p, teamIds, actor);
        await tx.insert(auditEvents).values(audit(actor, 'coverage_backups_set', kind, id, { from: c.backups, to: teamIds }));
        return { ok: true as const, changed: true };
      });
    },
  };
}
