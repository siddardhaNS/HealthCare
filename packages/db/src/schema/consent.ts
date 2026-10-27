import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirror of supabase/migrations/*_consent.sql. Append-only (trigger). */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').notNull(),
    purpose: text('purpose').notNull(),
    scopeKey: text('scope_key').notNull().default(''),
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['granted', 'withdrawn'] }).notNull(),
    noticeVersion: text('notice_version').notNull(),
    language: text('language', { enum: ['en', 'te', 'hi'] }).notNull(),
    actedBy: uuid('acted_by').notNull(),
  },
  (t) => [index('consents_current_idx').on(t.userId, t.purpose, t.scopeKey, t.createdAt.desc())],
);

/** Every disclosure of health data to someone other than the person. Append-only. */
export const recordShares = pgTable(
  'record_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    subjectId: uuid('subject_id').notNull(),
    viewerId: uuid('viewer_id'),
    viewerRole: text('viewer_role').notNull(),
    purpose: text('purpose').notNull(),
    items: text('items').array().notNull(),
    contextType: text('context_type', { enum: ['consult', 'sos', 'care_team', 'manager', 'export'] }).notNull(),
    contextId: uuid('context_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('record_shares_subject_idx').on(t.subjectId, t.createdAt.desc())],
);
