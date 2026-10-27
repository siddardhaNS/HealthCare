import { sql } from 'drizzle-orm';
import type { Db } from './index';

export interface UserClaims {
  sub: string;
  role?: 'authenticated';
  aal?: string;
  app_roles?: string[];
  [k: string]: unknown;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs queries as the signed-in user so Postgres row-level security applies,
 * exactly as it would for a Supabase client: the role is switched to
 * `authenticated` and the verified JWT claims are exposed to auth.uid() /
 * auth.jwt() for this transaction only.
 */
export async function asUser<T>(db: Db, claims: UserClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', ...claims })}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
