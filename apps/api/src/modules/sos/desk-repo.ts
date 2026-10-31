// Read side of the console command center: incidents with who and where,
// the offers made, and the fleet. Never medical details.
import { crewActiveStates, type SosState } from '@repo/contracts/sos';
import { aliasedTable, ambulances, and, coverageTeams, crewShifts, crews, desc, dispatchOffers, eq, gte, homes, households, inArray, notInArray, profiles, sites, sosIncidents, sql, type Db } from '@repo/db';
import type { LatLng } from '../../lib/crew-locator';
import type { IncidentRow } from './repo';

export interface DeskIncidentRow extends IncidentRow {
  closedAt: Date | null;
  residentName: string | null;
  community: string | null;
  tower: string | null;
  number: string | null;
  city: string | null;
}

export interface DeskOfferRow {
  crewId: string;
  crewName: string | null;
  registration: string | null;
  ring: number;
  createdAt: Date;
  response: 'accepted' | 'declined' | 'expired' | 'released' | null;
}

export interface FleetRow {
  crewId: string;
  name: string | null;
  team: string | null;
  registration: string | null;
  equipment: 'bls' | 'als' | null;
  onDuty: boolean;
  drillParticipant: boolean;
  incidentId: string | null;
}

export interface DeskRepo {
  /** Open incidents, or those closed / cancelled in the last day. Newest first. */
  incidents(filter: { siteIds: string[] | 'all'; open: boolean; limit: number }): Promise<DeskIncidentRow[]>;
  incident(id: string): Promise<DeskIncidentRow | null>;
  offers(incidentId: string): Promise<DeskOfferRow[]>;
  crewInfo(crewId: string): Promise<{ name: string | null; team: string | null } | null>;
  /** Active crews with their vehicle, duty and current job. */
  fleet(): Promise<FleetRow[]>;
  sites(siteIds: string[] | 'all'): Promise<{ id: string; name: string; city: string }[]>;
  /** Where a test SOS for the site starts: the middle of its boundary, else of its homes. */
  siteCentre(siteId: string): Promise<LatLng | null>;
}

const CLOSED = ['closed', 'cancelled'];
const RECENT_MS = 24 * 60 * 60 * 1000;

export function drizzleDeskRepo(db: Db): DeskRepo {
  const cols = {
    id: sosIncidents.id,
    userId: sosIncidents.userId,
    householdId: sosIncidents.householdId,
    siteId: sosIncidents.siteId,
    raisedBy: sosIncidents.raisedBy,
    state: sql<SosState>`${sosIncidents.state}`,
    isDrill: sosIncidents.isDrill,
    lat: sql<number | null>`extensions.st_y(${sosIncidents.location}::extensions.geometry)`,
    lng: sql<number | null>`extensions.st_x(${sosIncidents.location}::extensions.geometry)`,
    accuracyM: sosIncidents.accuracyM,
    widenAfterS: sosIncidents.widenAfterS,
    crewId: sosIncidents.crewId,
    createdAt: sosIncidents.createdAt,
    closedAt: sosIncidents.closedAt,
    residentName: profiles.fullName,
    community: sites.name,
    tower: homes.tower,
    number: homes.number,
    city: sql<string | null>`coalesce(${households.city}, ${sites.city})`,
  };
  const base = () =>
    db
      .select(cols)
      .from(sosIncidents)
      .leftJoin(profiles, eq(profiles.userId, sosIncidents.userId))
      .leftJoin(households, eq(households.id, sosIncidents.householdId))
      .leftJoin(homes, eq(homes.id, households.homeId))
      .leftJoin(sites, eq(sites.id, sosIncidents.siteId));
  // A crew's own ambulance first; otherwise the active ambulance of their team (as dispatch does).
  const teamAmb = aliasedTable(ambulances, 'team_ambulance');
  const ownAmb = and(eq(ambulances.id, crews.ambulanceId), eq(ambulances.active, true));
  const teamAmbOn = and(eq(teamAmb.teamId, crews.teamId), eq(teamAmb.active, true));

  return {
    async incidents({ siteIds, open, limit }) {
      if (siteIds !== 'all' && siteIds.length === 0) return [];
      return base()
        .where(
          and(
            siteIds === 'all' ? undefined : inArray(sosIncidents.siteId, siteIds),
            open ? notInArray(sosIncidents.state, CLOSED) : and(inArray(sosIncidents.state, CLOSED), gte(sosIncidents.closedAt, new Date(Date.now() - RECENT_MS))),
          ),
        )
        .orderBy(desc(open ? sosIncidents.createdAt : sosIncidents.closedAt))
        .limit(limit);
    },
    async incident(id) {
      return (await base().where(eq(sosIncidents.id, id)))[0] ?? null;
    },
    async offers(incidentId) {
      return (await db
        .select({
          crewId: dispatchOffers.crewId,
          crewName: profiles.fullName,
          registration: sql<string | null>`coalesce(${ambulances.registration}, ${teamAmb.registration})`,
          ring: dispatchOffers.ring,
          createdAt: dispatchOffers.createdAt,
          response: dispatchOffers.response,
        })
        .from(dispatchOffers)
        .innerJoin(crews, eq(crews.id, dispatchOffers.crewId))
        .leftJoin(profiles, eq(profiles.userId, crews.userId))
        .leftJoin(ambulances, ownAmb)
        .leftJoin(teamAmb, teamAmbOn)
        .where(eq(dispatchOffers.incidentId, incidentId))
        .orderBy(dispatchOffers.createdAt)) as DeskOfferRow[];
    },
    async crewInfo(crewId) {
      const [r] = await db
        .select({ name: profiles.fullName, team: coverageTeams.name })
        .from(crews)
        .leftJoin(profiles, eq(profiles.userId, crews.userId))
        .leftJoin(coverageTeams, eq(coverageTeams.id, crews.teamId))
        .where(eq(crews.id, crewId));
      return r ?? null;
    },
    async fleet() {
      const job = sql<string | null>`(select i.id from ${sosIncidents} i where i.crew_id = ${crews.id} and i.state in (${sql.join(
        crewActiveStates.map((s) => sql`${s}`),
        sql`, `,
      )}) limit 1)`;
      const onDuty = sql<boolean>`exists (select 1 from ${crewShifts} s where s.crew_id = ${crews.id} and s.ended_at is null)`;
      return (await db
        .selectDistinctOn([crews.id], {
          crewId: crews.id,
          name: profiles.fullName,
          team: coverageTeams.name,
          registration: sql<string | null>`coalesce(${ambulances.registration}, ${teamAmb.registration})`,
          equipment: sql<'bls' | 'als' | null>`coalesce(${ambulances.equipment}, ${teamAmb.equipment})`,
          onDuty,
          drillParticipant: crews.drillParticipant,
          incidentId: job,
        })
        .from(crews)
        .leftJoin(profiles, eq(profiles.userId, crews.userId))
        .leftJoin(coverageTeams, eq(coverageTeams.id, crews.teamId))
        .leftJoin(ambulances, ownAmb)
        .leftJoin(teamAmb, teamAmbOn)
        .where(eq(crews.active, true))
        .orderBy(crews.id)) as FleetRow[];
    },
    async sites(siteIds) {
      if (siteIds !== 'all' && siteIds.length === 0) return [];
      return db
        .select({ id: sites.id, name: sites.name, city: sites.city })
        .from(sites)
        .where(siteIds === 'all' ? undefined : inArray(sites.id, siteIds))
        .orderBy(sites.name);
    },
    async siteCentre(siteId) {
      const [r] = await db
        .select({
          lat: sql<number | null>`coalesce(
            extensions.st_y(extensions.st_centroid(${sites.boundary}::extensions.geometry)),
            (select avg(extensions.st_y(h.location::extensions.geometry)) from ${homes} h where h.site_id = sites.id))`,
          lng: sql<number | null>`coalesce(
            extensions.st_x(extensions.st_centroid(${sites.boundary}::extensions.geometry)),
            (select avg(extensions.st_x(h.location::extensions.geometry)) from ${homes} h where h.site_id = sites.id))`,
        })
        .from(sites)
        .where(eq(sites.id, siteId));
      return r?.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null;
    },
  };
}
