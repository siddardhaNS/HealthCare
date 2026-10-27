import { and, asUser, consents, desc, emergencyContacts, eq, gt, householdInvites, householdMembers, households, homes, inArray, isNull, profiles, sites, sql, type Db } from '@repo/db';

export interface Membership {
  householdId: string;
  role: 'owner' | 'member';
}

export interface HouseholdRecord {
  id: string;
  name: string | null;
  city: string | null;
  homeId: string | null;
}

export interface SiteRecord {
  id: string;
  name: string;
  kind: string;
  city: string;
  deskPhone: string | null;
}

export interface HomeRecord {
  id: string;
  siteId: string;
  tower: string | null;
  number: string;
}

export interface MemberRecord {
  userId: string;
  role: 'owner' | 'member';
  relation: string | null;
  fullName: string | null;
}

export interface InviteRecord {
  id: string;
  householdId: string;
  phone: string;
  relation: string | null;
  invitedBy: string;
  expiresAt: Date;
}

export interface ContactRecord {
  id: string;
  name: string;
  relation: string | null;
  phone: string;
  priority: number;
}

/** Storage primitives; the rules live in service.ts. */
export interface HouseholdsRepo {
  membership(userId: string): Promise<Membership | null>;
  household(id: string): Promise<HouseholdRecord | null>;
  siteByJoinCode(code: string): Promise<SiteRecord | null>;
  site(id: string): Promise<SiteRecord | null>;
  home(id: string): Promise<HomeRecord | null>;
  findHome(siteId: string, tower: string | null, number: string): Promise<HomeRecord | null>;
  householdForHome(homeId: string): Promise<string | null>;
  createHousehold(h: { homeId: string | null; name?: string | null; city?: string | null; address?: string | null; pin?: string | null }, owner: string): Promise<string>;
  addMember(householdId: string, userId: string, role: 'owner' | 'member', relation: string | null): Promise<void>;
  members(householdId: string): Promise<MemberRecord[]>;
  /** Current manager links among these people: [subject, manager] where the subject granted it. */
  managerLinks(userIds: string[]): Promise<Array<{ subject: string; manager: string }>>;
  createInvite(i: Omit<InviteRecord, 'id'>): Promise<InviteRecord>;
  openInvites(householdId: string, now: Date): Promise<InviteRecord[]>;
  openInvitesForPhone(phone: string, now: Date): Promise<Array<InviteRecord & { householdName: string | null; invitedByName: string | null }>>;
  invite(id: string): Promise<(InviteRecord & { acceptedAt: Date | null; revokedAt: Date | null }) | null>;
  revokeInvite(id: string, now: Date): Promise<void>;
  acceptInvite(id: string, userId: string, now: Date): Promise<void>;
  profile(userId: string): Promise<{ fullName: string; language: 'en' | 'te' | 'hi' } | null>;
  saveProfile(userId: string, p: { fullName: string; language: 'en' | 'te' | 'hi' }): Promise<void>;
  contacts(actorId: string, subjectId: string): Promise<ContactRecord[]>;
  addContact(actorId: string, subjectId: string, c: Omit<ContactRecord, 'id'>): Promise<ContactRecord>;
  removeContact(actorId: string, subjectId: string, id: string): Promise<boolean>;
}

export function drizzleHouseholdsRepo(db: Db): HouseholdsRepo {
  const one = <T>(rows: T[]) => rows[0] ?? null;
  return {
    async membership(userId) {
      return one(await db.select({ householdId: householdMembers.householdId, role: householdMembers.role }).from(householdMembers).where(eq(householdMembers.userId, userId)).limit(1));
    },
    async household(id) {
      return one(await db.select({ id: households.id, name: households.name, city: households.city, homeId: households.homeId }).from(households).where(eq(households.id, id)));
    },
    async siteByJoinCode(code) {
      return one(await db.select({ id: sites.id, name: sites.name, kind: sites.kind, city: sites.city, deskPhone: sites.deskPhone }).from(sites).where(eq(sites.joinCode, code)));
    },
    async site(id) {
      return one(await db.select({ id: sites.id, name: sites.name, kind: sites.kind, city: sites.city, deskPhone: sites.deskPhone }).from(sites).where(eq(sites.id, id)));
    },
    async home(id) {
      return one(await db.select({ id: homes.id, siteId: homes.siteId, tower: homes.tower, number: homes.number }).from(homes).where(eq(homes.id, id)));
    },
    async findHome(siteId, tower, number) {
      const towerMatch = tower === null ? isNull(homes.tower) : sql`lower(${homes.tower}) = lower(${tower})`;
      return one(
        await db
          .select({ id: homes.id, siteId: homes.siteId, tower: homes.tower, number: homes.number })
          .from(homes)
          .where(and(eq(homes.siteId, siteId), towerMatch, sql`lower(${homes.number}) = lower(${number})`)),
      );
    },
    async householdForHome(homeId) {
      return one(await db.select({ id: households.id }).from(households).where(eq(households.homeId, homeId)))?.id ?? null;
    },
    async createHousehold(h, owner) {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(households).values({ homeId: h.homeId, name: h.name ?? null, city: h.city ?? null, address: h.address ?? null, pin: h.pin ?? null }).returning({ id: households.id });
        await tx.insert(householdMembers).values({ householdId: row!.id, userId: owner, role: 'owner' });
        return row!.id;
      });
    },
    async addMember(householdId, userId, role, relation) {
      await db.insert(householdMembers).values({ householdId, userId, role, relation });
    },
    async members(householdId) {
      return db
        .select({ userId: householdMembers.userId, role: householdMembers.role, relation: householdMembers.relation, fullName: profiles.fullName })
        .from(householdMembers)
        .leftJoin(profiles, eq(profiles.userId, householdMembers.userId))
        .where(eq(householdMembers.householdId, householdId))
        .orderBy(householdMembers.createdAt);
    },
    async managerLinks(userIds) {
      if (userIds.length === 0) return [];
      const rows = await db
        .selectDistinctOn([consents.userId, consents.scopeKey], { subject: consents.userId, manager: consents.scopeKey, status: consents.status })
        .from(consents)
        .where(and(eq(consents.purpose, 'manager'), inArray(consents.userId, userIds)))
        .orderBy(consents.userId, consents.scopeKey, desc(consents.createdAt));
      return rows.filter((r) => r.status === 'granted' && userIds.includes(r.manager)).map(({ subject, manager }) => ({ subject, manager }));
    },
    async createInvite(i) {
      const [r] = await db.insert(householdInvites).values(i).returning();
      return { id: r!.id, householdId: r!.householdId, phone: r!.phone, relation: r!.relation, invitedBy: r!.invitedBy, expiresAt: r!.expiresAt };
    },
    async openInvites(householdId, now) {
      return db
        .select({ id: householdInvites.id, householdId: householdInvites.householdId, phone: householdInvites.phone, relation: householdInvites.relation, invitedBy: householdInvites.invitedBy, expiresAt: householdInvites.expiresAt })
        .from(householdInvites)
        .where(and(eq(householdInvites.householdId, householdId), isNull(householdInvites.acceptedAt), isNull(householdInvites.revokedAt), gt(householdInvites.expiresAt, now)));
    },
    async openInvitesForPhone(phone, now) {
      return db
        .select({
          id: householdInvites.id,
          householdId: householdInvites.householdId,
          phone: householdInvites.phone,
          relation: householdInvites.relation,
          invitedBy: householdInvites.invitedBy,
          expiresAt: householdInvites.expiresAt,
          householdName: households.name,
          invitedByName: profiles.fullName,
        })
        .from(householdInvites)
        .innerJoin(households, eq(households.id, householdInvites.householdId))
        .leftJoin(profiles, eq(profiles.userId, householdInvites.invitedBy))
        .where(and(eq(householdInvites.phone, phone), isNull(householdInvites.acceptedAt), isNull(householdInvites.revokedAt), gt(householdInvites.expiresAt, now)));
    },
    async invite(id) {
      const r = one(await db.select().from(householdInvites).where(eq(householdInvites.id, id)));
      return r && { id: r.id, householdId: r.householdId, phone: r.phone, relation: r.relation, invitedBy: r.invitedBy, expiresAt: r.expiresAt, acceptedAt: r.acceptedAt, revokedAt: r.revokedAt };
    },
    async revokeInvite(id, now) {
      await db.update(householdInvites).set({ revokedAt: now }).where(eq(householdInvites.id, id));
    },
    async acceptInvite(id, userId, now) {
      await db.transaction(async (tx) => {
        const [inv] = await tx
          .update(householdInvites)
          .set({ acceptedAt: now, acceptedBy: userId })
          .where(and(eq(householdInvites.id, id), isNull(householdInvites.acceptedAt), isNull(householdInvites.revokedAt)))
          .returning();
        if (!inv) throw new Error('invite no longer open');
        await tx.insert(householdMembers).values({ householdId: inv.householdId, userId, role: 'member', relation: inv.relation });
      });
    },
    async profile(userId) {
      return one(await db.select({ fullName: profiles.fullName, language: profiles.language }).from(profiles).where(eq(profiles.userId, userId)));
    },
    async saveProfile(userId, p) {
      await db.insert(profiles).values({ userId, ...p }).onConflictDoUpdate({ target: profiles.userId, set: p });
    },
    // Emergency contacts are personal data the person (or a manager) edits:
    // run as that user so RLS (can_act_for) decides.
    contacts: (actorId, subjectId) =>
      asUser(db, { sub: actorId }, (tx) =>
        tx
          .select({ id: emergencyContacts.id, name: emergencyContacts.name, relation: emergencyContacts.relation, phone: emergencyContacts.phone, priority: emergencyContacts.priority })
          .from(emergencyContacts)
          .where(eq(emergencyContacts.userId, subjectId))
          .orderBy(emergencyContacts.priority, emergencyContacts.createdAt),
      ),
    addContact: (actorId, subjectId, c) =>
      asUser(db, { sub: actorId }, async (tx) => {
        const [r] = await tx.insert(emergencyContacts).values({ ...c, userId: subjectId }).returning();
        return { id: r!.id, name: r!.name, relation: r!.relation, phone: r!.phone, priority: r!.priority };
      }),
    removeContact: (actorId, subjectId, id) =>
      asUser(db, { sub: actorId }, async (tx) => (await tx.delete(emergencyContacts).where(and(eq(emergencyContacts.id, id), eq(emergencyContacts.userId, subjectId))).returning({ id: emergencyContacts.id })).length > 0),
  };
}
