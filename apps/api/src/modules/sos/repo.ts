import type { SosActor, SosState } from '@repo/contracts/sos';
import { and, asc, auditEvents, eq, notInArray, siteSosSettings, sosEvents, sosIncidents, sql, type Db } from '@repo/db';

export interface IncidentRow {
  id: string;
  userId: string;
  householdId: string | null;
  siteId: string | null;
  raisedBy: string;
  state: SosState;
  isDrill: boolean;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  widenAfterS: number;
  escalateAfterS: number;
  crewId: string | null;
  createdAt: Date;
}

export interface EventRow {
  createdAt: Date;
  fromState: SosState | null;
  toState: SosState;
  actorRole: SosActor;
  reason: string | null;
}

export interface NewIncident {
  userId: string;
  householdId: string | null;
  siteId: string | null;
  raisedBy: string;
  raisedByRole: SosActor;
  idempotencyKey: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isDrill: boolean;
  widenAfterS: number;
  escalateAfterS: number;
}

export interface SosRepo {
  siteSettings(siteId: string): Promise<{ widenAfterS: number; escalateAfterS: number } | null>;
  byIdempotency(raisedBy: string, key: string): Promise<IncidentRow | null>;
  openForUser(userId: string): Promise<IncidentRow | null>;
  /** Creates the incident and its first timeline event in one transaction. Throws { code: '23505' } on a duplicate. */
  create(i: NewIncident): Promise<IncidentRow>;
  get(id: string): Promise<IncidentRow | null>;
  events(id: string): Promise<EventRow[]>;
  /**
   * Moves the incident from `from` to `to` only if it is still in `from`
   * (compare-and-set), writing the timeline event and an audit event in the
   * same transaction. Returns null if another change got there first.
   * `assign` sets the crew that took the job (on accept).
   */
  transition(id: string, from: SosState, to: SosState, actor: { id: string | null; role: SosActor }, reason: string | null, assign?: { crewId: string }): Promise<IncidentRow | null>;
  /** Records the escalation workflow run that owns this incident. */
  setWorkflowRun(id: string, runId: string): Promise<void>;
  /** An SOS action that is not a state change (desk alarm, offer ring, 108 prompt). Ids only in metadata. */
  recordAction(id: string, action: string, metadata: Record<string, unknown>): Promise<void>;
}

const OPEN_EXCLUDED = ['closed', 'cancelled'];

export function drizzleSosRepo(db: Db): SosRepo {
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
    escalateAfterS: sosIncidents.escalateAfterS,
    crewId: sosIncidents.crewId,
    createdAt: sosIncidents.createdAt,
  };
  const audit = (incidentId: string, actorId: string | null, role: string, action: string, metadata: Record<string, unknown>) => ({
    actorUserId: actorId,
    actorRole: role,
    action,
    entityType: 'sos_incident',
    entityId: incidentId,
    metadata,
  });

  return {
    async siteSettings(siteId) {
      const [r] = await db.select({ widenAfterS: siteSosSettings.widenAfterS, escalateAfterS: siteSosSettings.escalateAfterS }).from(siteSosSettings).where(eq(siteSosSettings.siteId, siteId));
      return r ?? null;
    },
    async byIdempotency(raisedBy, key) {
      const [r] = await db.select(cols).from(sosIncidents).where(and(eq(sosIncidents.raisedBy, raisedBy), eq(sosIncidents.idempotencyKey, key)));
      return r ?? null;
    },
    async openForUser(userId) {
      const [r] = await db.select(cols).from(sosIncidents).where(and(eq(sosIncidents.userId, userId), notInArray(sosIncidents.state, OPEN_EXCLUDED)));
      return r ?? null;
    },
    async create(i) {
      return db.transaction(async (tx) => {
        const location = i.lat !== null && i.lng !== null ? sql`extensions.st_setsrid(extensions.st_makepoint(${i.lng}, ${i.lat}), 4326)::extensions.geography` : null;
        const [row] = await tx
          .insert(sosIncidents)
          .values({
            userId: i.userId,
            householdId: i.householdId,
            siteId: i.siteId,
            raisedBy: i.raisedBy,
            idempotencyKey: i.idempotencyKey,
            location: location as unknown as string,
            accuracyM: i.accuracyM,
            isDrill: i.isDrill,
            widenAfterS: i.widenAfterS,
            escalateAfterS: i.escalateAfterS,
          })
          .returning(cols);
        await tx.insert(sosEvents).values({ incidentId: row!.id, fromState: null, toState: 'raised', actorId: i.raisedBy, actorRole: i.raisedByRole, metadata: { drill: i.isDrill } });
        await tx.insert(auditEvents).values(audit(row!.id, i.raisedBy, i.raisedByRole, 'sos_raised', { subject_id: i.userId, drill: i.isDrill }));
        return row!;
      });
    },
    async get(id) {
      const [r] = await db.select(cols).from(sosIncidents).where(eq(sosIncidents.id, id));
      return r ?? null;
    },
    async events(id) {
      return (await db
        .select({ createdAt: sosEvents.createdAt, fromState: sosEvents.fromState, toState: sosEvents.toState, actorRole: sosEvents.actorRole, reason: sosEvents.reason })
        .from(sosEvents)
        .where(eq(sosEvents.incidentId, id))
        .orderBy(asc(sosEvents.createdAt))) as EventRow[];
    },
    async transition(id, from, to, actor, reason, assign) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(sosIncidents)
          .set({ state: to, closedAt: to === 'closed' || to === 'cancelled' ? new Date() : null, ...(assign ? { crewId: assign.crewId } : {}) })
          .where(and(eq(sosIncidents.id, id), eq(sosIncidents.state, from)))
          .returning(cols);
        if (!row) return null;
        await tx.insert(sosEvents).values({ incidentId: id, fromState: from, toState: to, actorId: actor.id, actorRole: actor.role, reason });
        await tx.insert(auditEvents).values(audit(id, actor.id, actor.role, `sos_${to}`, { subject_id: row.userId, from, ...(assign ? { crew_id: assign.crewId } : {}) }));
        return row;
      });
    },
    async setWorkflowRun(id, runId) {
      await db.update(sosIncidents).set({ workflowRunId: runId }).where(eq(sosIncidents.id, id));
    },
    async recordAction(id, action, metadata) {
      await db.insert(auditEvents).values(audit(id, null, 'system', action, metadata));
    },
  };
}
