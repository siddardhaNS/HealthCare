import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirror of supabase/migrations/*_leads.sql. */
export const leadStatus = pgEnum('lead_status', ['new', 'contacted', 'walkthrough_booked', 'live']);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ref: text('ref').notNull().unique(),
    status: leadStatus('status').notNull().default('new'),
    orgType: text('org_type').notNull(),
    orgName: text('org_name'),
    city: text('city').notNull(),
    area: text('area'),
    pin: text('pin'),
    size: integer('size').notNull(),
    towers: integer('towers'),
    seniorShare: text('senior_share').notNull().default('unknown'),
    onsite: text('onsite').array().notNull().default([]),
    contactName: text('contact_name').notNull(),
    contactRole: text('contact_role').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    services: text('services').array().notNull(),
    plan: text('plan').notNull(),
    walkthrough: text('walkthrough').notNull(),
    notes: text('notes'),
    consentVersion: text('consent_version').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid('status_changed_by'),
  },
  (t) => [index('leads_status_idx').on(t.status, t.createdAt.desc())],
);
