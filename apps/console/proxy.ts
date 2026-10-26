import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { consoleRoles } from '@repo/contracts/roles';
import { supabaseEnv } from './lib/supabase/env';

const PUBLIC_PATHS = ['/sign-in'];
const MFA_PATH = '/mfa';

/**
 * Refreshes the Supabase session on every navigation and routes staff:
 * no session → /sign-in; signed in without TOTP (aal1) → /mfa; no console
 * role → /sign-in?error=role. Pages check again on the server.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;

  const redirect = (to: string) => {
    const target = NextResponse.redirect(new URL(to, request.url));
    // Keep any refreshed auth cookies and cache headers.
    for (const c of response.cookies.getAll()) target.cookies.set(c);
    response.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'cache-control') target.headers.set(k, v);
    });
    return target;
  };

  if (!claims) return PUBLIC_PATHS.includes(path) ? response : redirect('/sign-in');

  const roles = Array.isArray(claims.app_roles) ? (claims.app_roles as string[]) : [];
  if (!roles.some((r) => (consoleRoles as readonly string[]).includes(r))) {
    return PUBLIC_PATHS.includes(path) ? response : redirect('/sign-in?error=role');
  }
  if (claims.aal !== 'aal2') return path === MFA_PATH ? response : redirect(MFA_PATH);
  if (PUBLIC_PATHS.includes(path) || path === MFA_PATH) return redirect('/');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|generated/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
