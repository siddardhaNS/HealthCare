import { crewActiveStates } from '@repo/contracts/sos';
import { aliasedTable, ambulances, and, auditEvents, coverageAssignments, coverageTeams, crewShifts, crews, dispatchOffers, eq, homes, households, inArray, isNull, sosIncidents, sql, type Db } from '@repo/db';
import type { LatLng } from '../../lib/crew-locator';

export interface CrewRow {
  id: string;
  userId: string;
  teamId: string | null;
  teamName: string | null;
  drillParticipant: boolean;
  active: boolean;
}

export interface OfferRow {
  id: string;
  incidentId: string;
  crewId: string;
  ring: number;
  etaS: number | null;
  response: 'accepted' | 'declined' | 'expired' | 'released' | null;
  createdAt: Date;
}

export interface PendingOffer extends OfferRow {
  isDrill: boolean;
  location: LatLng | null;
}

export interface DispatchRepo {
  crewByUser(userId: string): Promise<CrewRow | null>;
  isOnDuty(crewId: string): Promise<boolean>;
  /** Opens a shift (no-op if one is open) or closes the open one. Audited. */
  setDuty(crew: CrewRow, onDuty: boolean): Promise<void>;
  /**
   * Crews that can take a new job: active, on duty, not on another active
   * job, not already offered this incident, and drill participants for a
   * drill. Limited to `teamId` or to `crewIds`. `reoffer` (the desk's own
   * pick) also allows crews offered this incident before.
   */
  available(filter: { incidentId: string; isDrill: boolean; teamId?: string; crewIds?: string[]; reoffer?: boolean }): Promise<{ id: string; teamId: string | null }[]>;
  /** The active teams covering a household, primary first then backups in order: through its site, or the household itself (plan §11). */
  teamsForHousehold(householdId: string): Promise<string[]>;
  /** Where a household is (its home, else its own location), for an SOS sent without GPS. */
  householdLocation(householdId: string): Promise<LatLng | null>;
  createOffers(incidentId: string, offers: { crewId: string; ring: number; etaS: number | null }[]): Promise<OfferRow[]>;
  /** The desk offers the job to one crew (ring 0). Opens it again if this crew was offered before. */
  deskOffer(incidentId: string, crewId: string, etaS: number | null): Promise<OfferRow>;
  offer(id: string): Promise<OfferRow | null>;
  pendingForCrew(crewId: string): Promise<PendingOffer[]>;
  /** Records a response only if the offer is still open. False if it was not. */
  respond(id: string, response: 'accepted' | 'declined' | 'released'): Promise<boolean>;
  /** Releases every other open offer on the incident (the job was taken). */
  releaseOthers(incidentId: string, keepOfferId: string): Promise<void>;
  /** The crew's ambulance (their own, else their team's) as the resident sees it. */
  vehicle(crewId: string): Promise<Vehicle | null>;
}

export interface Vehicle {
  registration: string;
  equipment: 'bls' | 'als';
  workPhone: string;
}

const OFFER_COLS = {
  id: dispatchOffers.id,
  incidentId: dispatchOffers.incidentId,
  crewId: dispatchOffers.crewId,
  ring: dispatchOffers.ring,
  etaS: dispatchOffers.etaS,
  response: dispatchOffers.response,
  createdAt: dispatchOffers.createdAt,
};

const point = (col: unknown) => ({
  lat: sql<number | null>`extensions.st_y(${col}::extensions.geometry)`,
  lng: sql<number | null>`extensions.st_x(${col}::extensions.geometry)`,
});

export function drizzleDispatchRepo(db: Db): DispatchRepo {
  const openShift = (crewId: string) => and(eq(crewShifts.crewId, crewId), isNull(crewShifts.endedAt));

  return {
    async crewByUser(userId) {
      const [r] = await db
        .select({ id: crews.id, userId: crews.userId, teamId: crews.teamId, teamName: coverageTeams.name, drillParticipant: crews.drillParticipant, active: crews.active })
        .from(crews)
        .leftJoin(coverageTeams, eq(coverageTeams.id, crews.teamId))
        .where(eq(crews.userId, userId));
      return r ?? null;
    },
    async isOnDuty(crewId) {
      const [r] = await db.select({ id: crewShifts.id }).from(crewShifts).where(openShift(crewId));
      return !!r;
    },
    async setDuty(crew, onDuty) {
      await db.transaction(async (tx) => {
        if (onDuty) {
          const opened = await tx.insert(crewShifts).values({ crewId: crew.id }).onConflictDoNothing().returning({ id: crewShifts.id });
          if (opened.length === 0) return;
        } else {
          const closed = await tx.update(crewShifts).set({ endedAt: new Date() }).where(openShift(crew.id)).returning({ id: crewShifts.id });
          if (closed.length === 0) return;
        }
        await tx.insert(auditEvents).values({ actorUserId: crew.userId, actorRole: 'crew', action: onDuty ? 'crew_on_duty' : 'crew_off_duty', entityType: 'crew', entityId: crew.id, metadata: {} });
      });
    },
    async available({ incidentId, isDrill, teamId, crewIds, reoffer }) {
      if (crewIds && crewIds.length === 0) return [];
      const busy = sql`exists (select 1 from ${sosIncidents} i where i.crew_id = ${crews.id} and i.state in (${sql.join(
        crewActiveStates.map((s) => sql`${s}`),
        sql`, `,
      )}))`;
      const offered = sql`exists (select 1 from ${dispatchOffers} o where o.crew_id = ${crews.id} and o.incident_id = ${incidentId})`;
      const onDuty = sql`exists (select 1 from ${crewShifts} s where s.crew_id = ${crews.id} and s.ended_at is null)`;
      return db
        .select({ id: crews.id, teamId: crews.teamId })
        .from(crews)
        .where(
          and(
            eq(crews.active, true),
            onDuty,
            sql`not ${busy}`,
            reoffer ? undefined : sql`not ${offered}`,
            isDrill ? eq(crews.drillParticipant, true) : undefined,
            teamId ? eq(crews.teamId, teamId) : undefined,
            crewIds ? inArray(crews.id, crewIds) : undefined,
          ),
        );
    },
    async teamsForHousehold(householdId) {
      const rows = await db
        .select({ teamId: coverageAssignments.teamId })
        .from(households)
        .leftJoin(homes, eq(homes.id, households.homeId))
        // A household in a community follows the community's team (plan §9), even if it once had its own.
        .innerJoin(coverageAssignments, sql`case when ${homes.siteId} is not null then ${coverageAssignments.siteId} = ${homes.siteId} else ${coverageAssignments.householdId} = ${households.id} end`)
        .innerJoin(coverageTeams, and(eq(coverageTeams.id, coverageAssignments.teamId), eq(coverageTeams.active, true)))
        .where(eq(households.id, householdId))
        .orderBy(coverageAssignments.rank);
      return rows.map((r) => r.teamId);
    },
    async householdLocation(householdId) {
      const home = point(homes.location);
      const own = point(households.location);
      const [r] = await db
        .select({ homeLat: home.lat, homeLng: home.lng, ownLat: own.lat, ownLng: own.lng })
        .from(households)
        .leftJoin(homes, eq(homes.id, households.homeId))
        .where(eq(households.id, householdId));
      if (r?.homeLat != null && r.homeLng != null) return { lat: r.homeLat, lng: r.homeLng };
      if (r?.ownLat != null && r.ownLng != null) return { lat: r.ownLat, lng: r.ownLng };
      return null;
    },
    async createOffers(incidentId, offers) {
      if (offers.length === 0) return [];
      return (await db
        .insert(dispatchOffers)
        .values(offers.map((o) => ({ incidentId, crewId: o.crewId, ring: o.ring, etaS: o.etaS })))
        .onConflictDoNothing()
        .returning(OFFER_COLS)) as OfferRow[];
    },
    async deskOffer(incidentId, crewId, etaS) {
      const [r] = await db
        .insert(dispatchOffers)
        .values({ incidentId, crewId, ring: 0, etaS })
        .onConflictDoUpdate({
          target: [dispatchOffers.incidentId, dispatchOffers.crewId],
          // A new id: it is a new ring, so clients (and pushes) that remember answered offers ring again.
          set: { id: sql`gen_random_uuid()`, ring: 0, etaS, response: null, respondedAt: null, createdAt: sql`now()` },
        })
        .returning(OFFER_COLS);
      return r as OfferRow;
    },
    async offer(id) {
      const [r] = await db.select(OFFER_COLS).from(dispatchOffers).where(eq(dispatchOffers.id, id));
      return (r as OfferRow | undefined) ?? null;
    },
    async pendingForCrew(crewId) {
      const at = point(sosIncidents.location);
      const rows = await db
        .select({ ...OFFER_COLS, isDrill: sosIncidents.isDrill, lat: at.lat, lng: at.lng })
        .from(dispatchOffers)
        .innerJoin(sosIncidents, eq(sosIncidents.id, dispatchOffers.incidentId))
        .where(and(eq(dispatchOffers.crewId, crewId), isNull(dispatchOffers.response), inArray(sosIncidents.state, ['dispatching', 'escalated_to_108'])));
      return rows.map(({ lat, lng, ...o }) => ({ ...(o as OfferRow), isDrill: o.isDrill, location: lat != null && lng != null ? { lat, lng } : null }));
    },
    async respond(id, response) {
      const r = await db
        .update(dispatchOffers)
        .set({ response, respondedAt: new Date() })
        .where(and(eq(dispatchOffers.id, id), isNull(dispatchOffers.response)))
        .returning({ id: dispatchOffers.id });
      return r.length > 0;
    },
    async releaseOthers(incidentId, keepOfferId) {
      await db
        .update(dispatchOffers)
        .set({ response: 'released', respondedAt: new Date() })
        .where(and(eq(dispatchOffers.incidentId, incidentId), isNull(dispatchOffers.response), sql`${dispatchOffers.id} <> ${keepOfferId}`));
    },
    async vehicle(crewId) {
      // A crew's own ambulance first; otherwise the active ambulance of their team.
      const teamAmb = aliasedTable(ambulances, 'team_ambulance');
      const [r] = await db
        .select({
          own: { registration: ambulances.registration, equipment: ambulances.equipment, workPhone: ambulances.workPhone },
          team: { registration: teamAmb.registration, equipment: teamAmb.equipment, workPhone: teamAmb.workPhone },
        })
        .from(crews)
        .leftJoin(ambulances, and(eq(ambulances.id, crews.ambulanceId), eq(ambulances.active, true)))
        .leftJoin(teamAmb, and(eq(teamAmb.teamId, crews.teamId), eq(teamAmb.active, true)))
        .where(eq(crews.id, crewId))
        .limit(1);
      return r?.own ?? r?.team ?? null;
    },
  };
}
