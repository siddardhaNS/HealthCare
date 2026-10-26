import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { consoleRoles, type AppRole } from '@repo/contracts/roles';
import { supabaseEnv } from './env';

/** Server Components, Server Actions and Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

export interface StaffClaims {
  userId: string;
  email: string | null;
  aal: string;
  roles: AppRole[];
}

/** Verified claims for the current request (getClaims checks the JWT signature). */
export async function getStaffClaims(): Promise<StaffClaims | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  const roles = (Array.isArray(c.app_roles) ? c.app_roles : []).filter((r: unknown): r is AppRole => (consoleRoles as readonly unknown[]).includes(r));
  return { userId: c.sub, email: typeof c.email === 'string' ? c.email : null, aal: String(c.aal ?? 'aal1'), roles };
}
