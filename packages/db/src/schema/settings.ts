import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Platform-wide settings (plan §11): one row, changed by the super admin, audited. */
export const opsSettings = pgTable('ops_settings', {
  id: boolean('id').primaryKey().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** The community desk number residents call when the app is offline. Null until set. */
  deskPhone: text('desk_phone'),
  updatedBy: uuid('updated_by'),
});
