import { customType, index, integer, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** PostGIS geography, read and written as WKT/EWKT text. */
const geography = customType<{ data: string; driverData: string }>({ dataType: () => 'extensions.geography' });

const ts = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Mirrors of supabase/migrations/*_households.sql and *_profiles_invites.sql. */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  type: text('type', { enum: ['community', 'senior_home', 'employer'] }).notNull(),
  name: text('name').notNull(),
  city: text('city').notNull(),
});

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  organisationId: uuid('organisation_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['gated', 'apartment', 'township', 'senior_home', 'office'] }).notNull(),
  address: text('address'),
  city: text('city').notNull(),
  pin: text('pin'),
  boundary: geography('boundary'),
  joinCode: text('join_code').notNull().unique(),
  deskPhone: text('desk_phone'),
});

export const homes = pgTable(
  'homes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...ts,
    siteId: uuid('site_id').notNull(),
    kind: text('kind', { enum: ['villa', 'flat'] }).notNull(),
    tower: text('tower'),
    floor: integer('floor'),
    number: text('number').notNull(),
    location: geography('location'),
  },
  (t) => [unique('homes_site_id_tower_number_key').on(t.siteId, t.tower, t.number).nullsNotDistinct()],
);

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  homeId: uuid('home_id'),
  name: text('name'),
  address: text('address'),
  city: text('city'),
  pin: text('pin'),
  location: geography('location'),
});

export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...ts,
    householdId: uuid('household_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    relation: text('relation'),
  },
  (t) => [unique('household_members_household_id_user_id_key').on(t.householdId, t.userId), index('household_members_user_idx').on(t.userId)],
);

export const emergencyContacts = pgTable('emergency_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...ts,
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  relation: text('relation'),
  phone: text('phone').notNull(),
  priority: smallint('priority').notNull().default(1),
});

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  ...ts,
  fullName: text('full_name').notNull(),
  language: text('language', { enum: ['en', 'te', 'hi'] }).notNull().default('en'),
});

export const householdInvites = pgTable('household_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  householdId: uuid('household_id').notNull(),
  phone: text('phone').notNull(),
  relation: text('relation'),
  invitedBy: uuid('invited_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
