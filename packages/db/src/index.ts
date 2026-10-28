import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * from './schema';
// Query helpers, re-exported so every consumer uses this package's drizzle-orm.
export { aliasedTable, and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
export { schema };

/**
 * The Postgres error code of a failed query (e.g. '23505', unique violation).
 * Drizzle wraps the driver's error, so the code is on `cause`, not on the
 * error itself; checking only `err.code` silently never matches.
 */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === '23505';

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
