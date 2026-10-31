// Phase 4: consults, calls, payments (supabase/migrations/*_consults.sql).
import { boolean, customType, date, integer, jsonb, pgTable, primaryKey, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

/** PostGIS geography; written with ST_MakePoint via sql, read with ST_X/ST_Y. */
const geography = customType<{ data: string; driverData: string }>({ dataType: () => 'extensions.geography' });

const ts = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const specialties = pgTable('specialties', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  code: text('code').notNull().unique(),
  names: jsonb('names').$type<{ en: string; te: string; hi: string }>().notNull(),
  /** Symptom words per language that suggest this specialty (⚑4). */
  keywords: jsonb('keywords').$type<Partial<Record<'en' | 'te' | 'hi', string[]>>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
});

export const doctors = pgTable('doctors', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull().unique(),
  fullName: text('full_name').notNull(),
  qualification: text('qualification').notNull(),
  registrationNo: text('registration_no').notNull(),
  council: text('council').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by'),
  feeVideoPaise: integer('fee_video_paise'),
  feeAudioPaise: integer('fee_audio_paise'),
  feeClinicPaise: integer('fee_clinic_paise'),
  slotMinutes: smallint('slot_minutes').notNull().default(15),
  languages: text('languages').array().notNull().default(['en']),
  clinicAddress: text('clinic_address'),
  clinicLocation: geography('clinic_location'),
  signaturePath: text('signature_path'),
  active: boolean('active').notNull().default(false),
});

export const doctorSpecialties = pgTable(
  'doctor_specialties',
  { doctorId: uuid('doctor_id').notNull(), specialtyId: uuid('specialty_id').notNull() },
  (t) => [primaryKey({ columns: [t.doctorId, t.specialtyId] })],
);

export const doctorHours = pgTable('doctor_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  doctorId: uuid('doctor_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  types: text('types').array().notNull(),
});

export const doctorExceptions = pgTable('doctor_exceptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  doctorId: uuid('doctor_id').notNull(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  kind: text('kind', { enum: ['off', 'extra'] }).notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  types: text('types').array(),
});

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull(),
  bookedBy: uuid('booked_by').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  specialtyId: uuid('specialty_id'),
  type: text('type', { enum: ['video', 'audio', 'clinic'] }).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  state: text('state').notNull(),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  feePaise: integer('fee_paise').notNull(),
  /** Encrypted with the field key. */
  symptomsEnc: text('symptoms_enc'),
  sharedItems: text('shared_items').array().notNull().default([]),
  roomName: text('room_name').unique(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const appointmentEvents = pgTable('appointment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appointmentId: uuid('appointment_id').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  actorId: uuid('actor_id'),
  actorRole: text('actor_role').notNull(),
  reason: text('reason'),
});

export const consultNotes = pgTable('consult_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  appointmentId: uuid('appointment_id').notNull().unique(),
  doctorId: uuid('doctor_id').notNull(),
  notesEnc: text('notes_enc').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const prescriptions = pgTable('prescriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  appointmentId: uuid('appointment_id').notNull(),
  userId: uuid('user_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  chiefComplaints: text('chief_complaints'),
  diagnosis: text('diagnosis'),
  investigations: text('investigations'),
  advice: text('advice'),
  followUp: text('follow_up'),
  pdfPath: text('pdf_path'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  replacesId: uuid('replaces_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const prescriptionItems = pgTable('prescription_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  prescriptionId: uuid('prescription_id').notNull(),
  position: smallint('position').notNull(),
  name: text('name').notNull(),
  strength: text('strength'),
  dose: text('dose'),
  frequency: text('frequency'),
  duration: text('duration'),
  instructions: text('instructions'),
  tpgList: text('tpg_list', { enum: ['O', 'A', 'B'] }),
});

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  type: text('type', { enum: ['video_consult', 'audio_consult', 'crew', 'desk', 'service'] }).notNull(),
  contextType: text('context_type', { enum: ['appointment', 'sos', 'booking'] }).notNull(),
  contextId: uuid('context_id').notNull(),
  callerId: uuid('caller_id').notNull(),
  callerRole: text('caller_role').notNull(),
  calleeId: uuid('callee_id').notNull(),
  calleeRole: text('callee_role').notNull(),
  roomName: text('room_name').notNull().unique(),
  state: text('state', { enum: ['ringing', 'connected', 'ended', 'missed', 'failed'] }).notNull().default('ringing'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endReason: text('end_reason'),
  /** Metadata only, never media. */
  quality: jsonb('quality'),
});

export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull(),
  app: text('app', { enum: ['resident', 'field'] }).notNull(),
  platform: text('platform', { enum: ['android', 'ios'] }).notNull(),
  deviceId: text('device_id').notNull(),
  fcmToken: text('fcm_token'),
  voipToken: text('voip_token'),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull(),
  purpose: text('purpose', { enum: ['consult'] }).notNull(),
  contextId: uuid('context_id').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  currency: text('currency').notNull().default('INR'),
  provider: text('provider').notNull().default('razorpay'),
  providerOrderId: text('provider_order_id').unique(),
  providerPaymentId: text('provider_payment_id').unique(),
  status: text('status', { enum: ['created', 'captured', 'failed', 'refund_pending', 'refunded'] }).notNull(),
  refundId: text('refund_id'),
  refundedPaise: integer('refunded_paise').notNull().default(0),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
});
