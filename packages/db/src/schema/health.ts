import { boolean, date, index, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** Mirror of supabase/migrations/*_health_record.sql (tables used so far). */
const base = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  userId: uuid('user_id').notNull(),
  enteredBy: uuid('entered_by').notNull(),
};

// numeric columns come back from postgres-js as strings; mode 'number' converts.
export const healthProfiles = pgTable('health_profiles', {
  ...base,
  bloodGroup: text('blood_group'),
  heightCm: numeric('height_cm', { precision: 5, scale: 1, mode: 'number' }),
  dateOfBirth: date('date_of_birth'),
  sex: text('sex'),
});

export const vitalReadings = pgTable(
  'vital_readings',
  {
    ...base,
    type: text('type').notNull(),
    value: numeric('value', { precision: 6, scale: 1, mode: 'number' }).notNull(),
    value2: numeric('value2', { precision: 6, scale: 1, mode: 'number' }),
    unit: text('unit').notNull(),
    context: text('context'),
    source: text('source').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('vital_readings_user_type_idx').on(t.userId, t.type, t.takenAt.desc())],
);

export const conditions = pgTable('conditions', {
  ...base,
  name: text('name').notNull(),
  code: text('code'),
  status: text('status').notNull(),
  diagnosedOn: date('diagnosed_on'),
  notesEnc: text('notes_enc'),
});

export const allergies = pgTable('allergies', {
  ...base,
  substance: text('substance').notNull(),
  code: text('code'),
  severity: text('severity').notNull(),
  reaction: text('reaction'),
});

export const medications = pgTable('medications', {
  ...base,
  name: text('name').notNull(),
  code: text('code'),
  strength: text('strength'),
  dose: text('dose'),
  frequency: text('frequency'),
  schedule: jsonb('schedule').$type<string[]>().notNull().default([]),
  startDate: date('start_date'),
  endDate: date('end_date'),
  active: boolean('active').notNull().default(true),
});

export const medicationDoses = pgTable(
  'medication_doses',
  {
    ...base,
    medicationId: uuid('medication_id').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }),
  },
  (t) => [unique('medication_doses_medication_id_scheduled_at_key').on(t.medicationId, t.scheduledAt), index('medication_doses_user_idx').on(t.userId, t.scheduledAt.desc())],
);

export const vaccinations = pgTable('vaccinations', {
  ...base,
  name: text('name').notNull(),
  doseLabel: text('dose_label'),
  givenOn: date('given_on'),
  nextDue: date('next_due'),
});

export const insurancePolicies = pgTable('insurance_policies', {
  ...base,
  insurer: text('insurer').notNull(),
  policyNumberEnc: text('policy_number_enc'),
  memberIdEnc: text('member_id_enc'),
  validUntil: date('valid_until'),
  cardPath: text('card_path'),
});

export const devices = pgTable('devices', {
  ...base,
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  connection: text('connection').notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
});
