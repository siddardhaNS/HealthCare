import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirror of supabase/migrations/*_foundations.sql. Append-only (enforced by trigger). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    householdId: uuid('household_id'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_events_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc()),
    index('audit_events_household_idx').on(t.householdId, t.createdAt.desc()),
  ],
);
