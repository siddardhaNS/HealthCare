import { and, auditEvents, authUsers, eq, householdMembers, households, homes, ilike, inArray, or, profiles, sites, sql, userRoles, type Db } from '@repo/db';

export interface ResidentRecord {
  userId: string;
  fullName: string | null;
  community: string | null;
  siteId: string | null;
  tower: string | null;
  number: string | null;
  city: string | null;
  phone: string | null;
  role: 'owner' | 'member';
  householdId: string;
}

export interface ResidentsRepo {
  /** Sites a community-desk user is limited to (user_roles scope). */
  deskSites(staffId: string): Promise<string[]>;
  list(filter: { siteIds: string[] | 'all'; q?: string; limit: number }): Promise<ResidentRecord[]>;
  get(userId: string): Promise<ResidentRecord | null>;
  householdSize(householdId: string): Promise<number>;
  /** Staff access to a resident profile is logged (ids only). */
  logView(staffId: string, staffRole: string, residentId: string, requestId: string): Promise<void>;
}

export function drizzleResidentsRepo(db: Db): ResidentsRepo {
  const base = () =>
    db
      .select({
        userId: householdMembers.userId,
        fullName: profiles.fullName,
        community: sites.name,
        siteId: sites.id,
        tower: homes.tower,
        number: homes.number,
        city: sql<string | null>`coalesce(${households.city}, ${sites.city})`,
        phone: authUsers.phone,
        role: householdMembers.role,
        householdId: householdMembers.householdId,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .leftJoin(homes, eq(homes.id, households.homeId))
      .leftJoin(sites, eq(sites.id, homes.siteId))
      .leftJoin(profiles, eq(profiles.userId, householdMembers.userId))
      .leftJoin(authUsers, eq(authUsers.id, householdMembers.userId));

  return {
    async deskSites(staffId) {
      const rows = await db
        .select({ scopeId: userRoles.scopeId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, staffId), eq(userRoles.role, 'community_desk'), eq(userRoles.scopeType, 'site')));
      return rows.map((r) => r.scopeId).filter((x): x is string => !!x);
    },
    async list({ siteIds, q, limit }) {
      if (siteIds !== 'all' && siteIds.length === 0) return [];
      const conds = [];
      if (siteIds !== 'all') conds.push(inArray(sites.id, siteIds));
      if (q) {
        const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        conds.push(or(ilike(profiles.fullName, like), ilike(homes.number, like), ilike(homes.tower, like), ilike(sites.name, like))!);
      }
      return base()
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(sites.name, homes.tower, homes.number, profiles.fullName)
        .limit(limit);
    },
    async get(userId) {
      return (await base().where(eq(householdMembers.userId, userId)).limit(1))[0] ?? null;
    },
    async householdSize(householdId) {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
      return r?.n ?? 0;
    },
    async logView(staffId, staffRole, residentId, requestId) {
      await db.insert(auditEvents).values({ actorUserId: staffId, actorRole: staffRole, action: 'view', entityType: 'resident_profile', entityId: residentId, requestId, metadata: { subject_id: residentId } });
    },
  };
}
