import { index, integer, pgEnum, pgSchema, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Mirror of supabase/migrations/*_auth.sql. */
export const appRole = pgEnum('app_role', [
  'super_admin',
  'operations',
  'community_desk',
  'support',
  'doctor',
  'pharmacy',
  'lab',
  'hospital',
  'crew',
  'phlebotomist',
  'companion',
  'rider',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...timestamps,
    userId: uuid('user_id').notNull(),
    role: appRole('role').notNull(),
    scopeType: text('scope_type', { enum: ['site', 'organisation', 'partner'] }),
    scopeId: uuid('scope_id'),
  },
  (t) => [index('user_roles_user_idx').on(t.userId)],
);

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...timestamps,
  phoneHash: text('phone_hash').notNull(),
  channel: text('channel', { enum: ['whatsapp', 'sms'] }).notNull(),
  outcome: text('outcome', { enum: ['sent', 'fallback_sms', 'rate_limited', 'failed'] }).notNull(),
});

export const messageStatuses = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const messageLog = pgTable('message_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...timestamps,
  channel: text('channel', { enum: ['whatsapp', 'sms'] }).notNull(),
  category: text('category', { enum: ['authentication', 'utility', 'marketing'] }).notNull(),
  template: text('template').notNull(),
  templateVersion: integer('template_version').notNull(),
  language: text('language').notNull(),
  toPhone: text('to_phone').notNull(),
  userId: uuid('user_id'),
  purpose: text('purpose').notNull(),
  providerMessageId: text('provider_message_id').unique(),
  status: text('status', { enum: messageStatuses }).notNull().default('queued'),
  errorCode: text('error_code'),
  fallbackOf: uuid('fallback_of').references((): AnyPgColumn => messageLog.id),
});

export const messagingOptins = pgTable('messaging_optins', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  phone: text('phone').notNull(),
  channel: text('channel', { enum: ['whatsapp', 'sms'] }).notNull(),
  status: text('status', { enum: ['opted_in', 'opted_out'] }).notNull(),
  source: text('source', { enum: ['signin', 'profile', 'stop_reply', 'console', 'confirmed_by_resident'] }).notNull(),
  consentVersion: text('consent_version'),
});

/** Read-only view of Supabase's auth.users (phone and email only). */
const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  phone: text('phone'),
  email: text('email'),
});
