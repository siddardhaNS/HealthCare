import { boolean, customType, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** PostGIS geography; written with ST_MakePoint via sql, read with ST_X/ST_Y. */
const geography = customType<{ data: string; driverData: string }>({ dataType: () => 'extensions.geography' });

const ts = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Mirror of supabase/migrations/*_sos.sql. */
export const standbyPoints = pgTable('standby_points', { id: uuid('id').primaryKey().defaultRandom(), ...ts, siteId: uuid('site_id'), name: text('name').notNull(), location: geography('location').notNull() });

export const ambulances = pgTable('ambulances', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  registration: text('registration').notNull().unique(),
  operator: text('operator').notNull(),
  operatorKind: text('operator_kind', { enum: ['own', 'partner'] }).notNull(),
  equipment: text('equipment', { enum: ['bls', 'als'] }).notNull(),
  workPhone: text('work_phone').notNull(),
  active: boolean('active').notNull().default(true),
  teamId: uuid('team_id'),
});

export const crews = pgTable('crews', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull().unique(),
  ambulanceId: uuid('ambulance_id'),
  drillParticipant: boolean('drill_participant').notNull().default(false),
  active: boolean('active').notNull().default(true),
  teamId: uuid('team_id'),
});

export const crewShifts = pgTable('crew_shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  crewId: uuid('crew_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  standbyPointId: uuid('standby_point_id'),
});

export const hospitals = pgTable('hospitals', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  name: text('name').notNull(),
  location: geography('location').notNull(),
  erPhone: text('er_phone').notNull(),
  address: text('address'),
  city: text('city'),
  hasCapacity: boolean('has_capacity').notNull().default(true),
  capacityUpdatedAt: timestamp('capacity_updated_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
});

export const siteSosSettings = pgTable('site_sos_settings', {
  siteId: uuid('site_id').primaryKey(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  widenAfterS: integer('widen_after_s').notNull().default(30),
  escalateAfterS: integer('escalate_after_s').notNull().default(90),
  gatePhone: text('gate_phone'),
  updatedBy: uuid('updated_by'),
});

export const sosIncidents = pgTable(
  'sos_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...ts,
    userId: uuid('user_id').notNull(),
    householdId: uuid('household_id'),
    siteId: uuid('site_id'),
    raisedBy: uuid('raised_by').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    location: geography('location'),
    accuracyM: numeric('accuracy_m', { precision: 7, scale: 1, mode: 'number' }),
    state: text('state').notNull().default('raised'),
    isDrill: boolean('is_drill').notNull().default(false),
    crewId: uuid('crew_id'),
    ambulanceId: uuid('ambulance_id'),
    hospitalId: uuid('hospital_id'),
    widenAfterS: integer('widen_after_s').notNull(),
    escalateAfterS: integer('escalate_after_s').notNull(),
    workflowRunId: text('workflow_run_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [unique('sos_incidents_raised_by_idempotency_key_key').on(t.raisedBy, t.idempotencyKey), index('sos_incidents_site_idx').on(t.siteId, t.createdAt.desc())],
);

export const sosEvents = pgTable(
  'sos_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    incidentId: uuid('incident_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role', { enum: ['resident', 'crew', 'desk', 'system'] }).notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('sos_events_incident_idx').on(t.incidentId, t.createdAt)],
);

export const dispatchOffers = pgTable(
  'dispatch_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    incidentId: uuid('incident_id').notNull(),
    crewId: uuid('crew_id').notNull(),
    ring: smallint('ring').notNull(),
    etaS: integer('eta_s'),
    response: text('response', { enum: ['accepted', 'declined', 'expired', 'released'] }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [unique('dispatch_offers_incident_id_crew_id_key').on(t.incidentId, t.crewId)],
);

export const hospitalHandovers = pgTable('hospital_handovers', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  incidentId: uuid('incident_id').notNull().unique(),
  hospitalId: uuid('hospital_id').notNull(),
  items: text('items').array().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  firstAidNotesEnc: text('first_aid_notes_enc'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedBy: uuid('confirmed_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  chosenBy: text('chosen_by', { enum: ['auto', 'crew', 'desk'] })
    .notNull()
    .default('auto'),
  choiceReason: text('choice_reason'),
  preferred: boolean('preferred').notNull().default(false),
});

/** Mirror of supabase/migrations/*_coverage.sql (plan §9). */
export const coverageTeams = pgTable('coverage_teams', { id: uuid('id').primaryKey().defaultRandom(), ...ts, name: text('name').notNull(), area: text('area'), active: boolean('active').notNull().default(true) });

export const coverageAssignments = pgTable('coverage_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  teamId: uuid('team_id').notNull(),
  siteId: uuid('site_id'),
  householdId: uuid('household_id'),
  /** 0 = primary team, 1.. = backups in order (plan §11). */
  rank: smallint('rank').notNull().default(0),
  assignedBy: uuid('assigned_by'),
});
