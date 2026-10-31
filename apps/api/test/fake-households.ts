import type { ConsentRow } from '../src/modules/consent/policy';
import type { ContactRecord, HomeRecord, HouseholdsRepo, InviteRecord, SiteRecord } from '../src/modules/households/repo';

/** In-memory HouseholdsRepo for tests. Manager links come from the shared consent rows. */
export function fakeHouseholds(consentRows: ConsentRow[]) {
  const sites: (SiteRecord & { joinCode: string })[] = [];
  const homes: HomeRecord[] = [];
  const households: { id: string; name: string | null; city: string | null; homeId: string | null }[] = [];
  const members: { householdId: string; userId: string; role: 'owner' | 'member'; relation: string | null; at: number }[] = [];
  const invites: (InviteRecord & { acceptedAt: Date | null; revokedAt: Date | null })[] = [];
  const profiles = new Map<string, { fullName: string; language: 'en' | 'te' | 'hi' }>();
  const contacts = new Map<string, ContactRecord[]>();
  /** Opt-ins recorded from the resident's confirmation (plan §13). */
  const optins: { phone: string; agreed: boolean }[] = [];
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  const repo: HouseholdsRepo = {
    async membership(userId) {
      const m = members.find((x) => x.userId === userId);
      return m ? { householdId: m.householdId, role: m.role } : null;
    },
    async household(hid) {
      return households.find((h) => h.id === hid) ?? null;
    },
    async siteByJoinCode(code) {
      return sites.find((s) => s.joinCode === code) ?? null;
    },
    async site(sid) {
      return sites.find((s) => s.id === sid) ?? null;
    },
    async home(hid) {
      return homes.find((h) => h.id === hid) ?? null;
    },
    async findHome(siteId, tower, number) {
      return homes.find((h) => h.siteId === siteId && (h.tower ?? null)?.toLowerCase() === tower?.toLowerCase() && h.number.toLowerCase() === number.toLowerCase()) ?? null;
    },
    async householdForHome(homeId) {
      return households.find((h) => h.homeId === homeId)?.id ?? null;
    },
    async createHousehold(h, owner) {
      const hid = id();
      households.push({ id: hid, name: h.name ?? null, city: h.city ?? null, homeId: h.homeId });
      members.push({ householdId: hid, userId: owner, role: 'owner', relation: null, at: seq });
      return hid;
    },
    async addMember(householdId, userId, role, relation) {
      members.push({ householdId, userId, role, relation, at: ++seq });
    },
    async members(householdId) {
      return members.filter((m) => m.householdId === householdId).map((m) => ({ userId: m.userId, role: m.role, relation: m.relation, fullName: profiles.get(m.userId)?.fullName ?? null }));
    },
    async managerLinks(userIds) {
      const latest = new Map<string, ConsentRow>();
      for (const r of consentRows.filter((x) => x.purpose === 'manager')) {
        const k = `${r.userId}|${r.scopeKey}`;
        if (!latest.has(k) || r.createdAt > latest.get(k)!.createdAt) latest.set(k, r);
      }
      return [...latest.values()].filter((r) => r.status === 'granted' && userIds.includes(r.userId) && userIds.includes(r.scopeKey)).map((r) => ({ subject: r.userId, manager: r.scopeKey }));
    },
    async createInvite(i) {
      const inv = { ...i, id: id(), acceptedAt: null, revokedAt: null };
      invites.push(inv);
      return inv;
    },
    async openInvites(householdId, now) {
      return invites.filter((i) => i.householdId === householdId && !i.acceptedAt && !i.revokedAt && i.expiresAt > now);
    },
    async openInvitesForPhone(phone, now) {
      return invites
        .filter((i) => i.phone === phone && !i.acceptedAt && !i.revokedAt && i.expiresAt > now)
        .map((i) => ({ ...i, householdName: households.find((h) => h.id === i.householdId)?.name ?? null, invitedByName: profiles.get(i.invitedBy)?.fullName ?? null }));
    },
    async invite(iid) {
      return invites.find((i) => i.id === iid) ?? null;
    },
    async revokeInvite(iid, now) {
      invites.find((i) => i.id === iid)!.revokedAt = now;
    },
    async acceptInvite(iid, userId, now) {
      const inv = invites.find((i) => i.id === iid)!;
      inv.acceptedAt = now;
      members.push({ householdId: inv.householdId, userId, role: 'member', relation: inv.relation, at: ++seq });
    },
    async profile(userId) {
      return profiles.get(userId) ?? null;
    },
    async saveProfile(userId, p) {
      profiles.set(userId, p);
    },
    async contacts(_actor, subject) {
      return contacts.get(subject) ?? [];
    },
    async addContact(_actor, subject, c) {
      const rec = { ...c, id: id() };
      if (c.alertsAgreed) optins.push({ phone: c.phone, agreed: true });
      contacts.set(subject, [...(contacts.get(subject) ?? []), rec]);
      return rec;
    },
    async setContactAlerts(_actor, subject, cid, agreed) {
      const c = (contacts.get(subject) ?? []).find((x) => x.id === cid);
      if (!c) return null;
      c.alertsAgreed = agreed;
      optins.push({ phone: c.phone, agreed });
      return { ...c };
    },
    async removeContact(_actor, subject, cid) {
      const list = contacts.get(subject) ?? [];
      contacts.set(subject, list.filter((c) => c.id !== cid));
      return list.some((c) => c.id === cid);
    },
  };

  function addSite(s: { name: string; kind: string; city: string; joinCode: string; homes: Array<{ tower: string | null; number: string }> }) {
    const site = { id: id(), name: s.name, kind: s.kind, city: s.city, deskPhone: '+914000000000', joinCode: s.joinCode };
    sites.push(site);
    for (const h of s.homes) homes.push({ id: id(), siteId: site.id, tower: h.tower, number: h.number });
    return site;
  }

  /** Directory rows (what the residents repo joins together), with fake phones. */
  async function residents() {
    return members.map((m) => {
      const h = households.find((x) => x.id === m.householdId)!;
      const home = homes.find((x) => x.id === h.homeId);
      const site = home ? sites.find((s) => s.id === home.siteId) : undefined;
      return {
        userId: m.userId,
        fullName: profiles.get(m.userId)?.fullName ?? null,
        community: site?.name ?? null,
        siteId: site?.id ?? null,
        tower: home?.tower ?? null,
        number: home?.number ?? null,
        city: h.city ?? site?.city ?? null,
        phone: '919876543210',
        role: m.role,
        householdId: m.householdId,
        coverageTeam: coverageTeamOf ? coverageTeamOf(site?.id ?? null, h.id) : null,
      };
    });
  }

  /** Set by the coverage fake: the active team covering a site or stand-alone household. */
  let coverageTeamOf: ((siteId: string | null, householdId: string) => string | null) | null = null;
  const linkCoverage = (fn: typeof coverageTeamOf) => {
    coverageTeamOf = fn;
  };

  return { optins, repo, addSite, invites, members, residents, sites, homes, households, profiles, linkCoverage };
}
