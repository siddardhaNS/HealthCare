import type { CreateHousehold, HouseholdView } from '@repo/contracts';
import type { ContactRecord, HouseholdsRepo } from './repo';

export const INVITE_TTL_DAYS = 7;

export type Failure = { error: 'already_member' | 'bad_code' | 'home_not_found' | 'household_exists' | 'not_member' | 'not_found' | 'not_yours' | 'expired' | 'own_phone' | 'forbidden'; message: string };
export const fail = (error: Failure['error'], message: string): Failure => ({ error, message });
export const isFailure = (x: unknown): x is Failure => typeof x === 'object' && x !== null && 'error' in x;

/** Shown to others (the household owner's invite list): keep the last four digits only. */
export const maskPhone = (p: string) => `${p.slice(0, 3)} ••••• ${p.slice(-4)}`;

export async function viewHousehold(repo: HouseholdsRepo, me: string, now = new Date()): Promise<HouseholdView> {
  const m = await repo.membership(me);
  if (!m) return { household: null, members: [], invites: [] };
  const h = (await repo.household(m.householdId))!;
  const home = h.homeId ? await repo.home(h.homeId) : null;
  const site = home ? await repo.site(home.siteId) : null;
  const members = await repo.members(h.id);
  const links = await repo.managerLinks(members.map((x) => x.userId));
  const invites = await repo.openInvites(h.id, now);
  return {
    household: {
      id: h.id,
      name: h.name,
      city: h.city ?? site?.city ?? null,
      community: site ? { name: site.name, kind: site.kind, deskPhone: site.deskPhone } : null,
      home: home ? { tower: home.tower, number: home.number } : null,
    },
    members: members.map((x) => ({
      userId: x.userId,
      fullName: x.fullName,
      relation: x.relation,
      role: x.role,
      isMe: x.userId === me,
      managesMe: links.some((l) => l.subject === me && l.manager === x.userId),
      iManage: links.some((l) => l.subject === x.userId && l.manager === me),
    })),
    invites: invites.map((i) => ({ id: i.id, phone: maskPhone(i.phone), relation: i.relation, expiresAt: i.expiresAt.toISOString() })),
  };
}

export async function createHousehold(repo: HouseholdsRepo, me: string, input: CreateHousehold): Promise<{ householdId: string } | Failure> {
  if (await repo.membership(me)) return fail('already_member', 'You already belong to a household.');
  if (input.mode === 'standalone') {
    return { householdId: await repo.createHousehold({ homeId: null, name: input.name, city: input.city, address: input.address, pin: input.pin }, me) };
  }
  const site = await repo.siteByJoinCode(input.joinCode);
  if (!site) return fail('bad_code', 'That code is not recognised. Check it with your association.');
  const home = await repo.findHome(site.id, input.tower ?? null, input.number);
  if (!home) return fail('home_not_found', 'We could not find that villa or flat. Check the number, or ask the community desk to add it.');
  // A home that already has a household is joined only by invitation from a
  // member, so knowing the code and a flat number is not enough.
  if (await repo.householdForHome(home.id)) return fail('household_exists', 'Your home is already set up. Ask a family member to invite you from their app.');
  return { householdId: await repo.createHousehold({ homeId: home.id, city: site.city }, me) };
}

export async function inviteMember(repo: HouseholdsRepo, me: string, myPhone: string | null, input: { phone: string; relation?: string }, now = new Date()) {
  const m = await repo.membership(me);
  if (!m) return fail('not_member', 'Set up your household first.');
  if (myPhone && input.phone === myPhone) return fail('own_phone', 'That is your own number.');
  const existing = (await repo.openInvites(m.householdId, now)).find((i) => i.phone === input.phone);
  if (existing) return existing;
  return repo.createInvite({
    householdId: m.householdId,
    phone: input.phone,
    relation: input.relation ?? null,
    invitedBy: me,
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
  });
}

export async function revokeInvite(repo: HouseholdsRepo, me: string, id: string, now = new Date()): Promise<true | Failure> {
  const [m, inv] = await Promise.all([repo.membership(me), repo.invite(id)]);
  if (!inv || !m || inv.householdId !== m.householdId) return fail('not_found', 'No such invitation.');
  await repo.revokeInvite(id, now);
  return true;
}

export async function acceptInvite(repo: HouseholdsRepo, me: string, myPhone: string | null, id: string, now = new Date()): Promise<{ householdId: string } | Failure> {
  const inv = await repo.invite(id);
  if (!inv || inv.revokedAt || inv.acceptedAt) return fail('not_found', 'This invitation is no longer open.');
  if (!myPhone || inv.phone !== myPhone) return fail('not_yours', 'This invitation was sent to a different number.');
  if (inv.expiresAt <= now) return fail('expired', 'This invitation has expired. Ask for a new one.');
  if (await repo.membership(me)) return fail('already_member', 'You already belong to a household.');
  await repo.acceptInvite(id, me, now);
  return { householdId: inv.householdId };
}

/** A manager must share my household (checked before recording a manager consent). */
export async function areCoMembers(repo: HouseholdsRepo, a: string, b: string): Promise<boolean> {
  const [ma, mb] = await Promise.all([repo.membership(a), repo.membership(b)]);
  return !!ma && !!mb && ma.householdId === mb.householdId;
}

/** I may act for `subject` (their contacts, later their record) if it's me or they made me a manager. */
export async function canActFor(repo: HouseholdsRepo, me: string, subject: string): Promise<boolean> {
  if (me === subject) return true;
  return (await repo.managerLinks([subject, me])).some((l) => l.subject === subject && l.manager === me);
}

export async function listContacts(repo: HouseholdsRepo, me: string, subject: string): Promise<ContactRecord[] | Failure> {
  if (!(await canActFor(repo, me, subject))) return fail('forbidden', 'You do not manage this person’s care.');
  return repo.contacts(me, subject);
}
