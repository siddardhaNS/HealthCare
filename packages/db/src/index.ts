import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * from './schema';
// Query helpers, re-exported so every consumer uses this package's drizzle-orm.
export { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
export { schema };

/**
 * Server-only database client (API and scripts). Uses the Supabase pooler
 * URL in production; `prepare: false` is required for transaction pooling.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { prepare: false, max: 1 });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { asUser, type UserClaims } from './as-user';
