import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppRole, consoleRoles, type ErrorBody } from '@repo/contracts';
import type { AppEnv } from '../app';

export interface AccessClaims {
  userId: string;
  phone: string | null;
  aal: 'aal1' | 'aal2';
  roles: AppRole[];
  sessionId: string | null;
}

export type TokenVerifier = (token: string) => Promise<AccessClaims>;

/**
 * Verifies Supabase access tokens: asymmetric keys from the project's JWKS in
 * production; an HS256 secret only for a local CLI stack that still uses one.
 */
export function createTokenVerifier(opts: { supabaseUrl: string; hs256Secret?: string; keys?: JWTVerifyGetKey }): TokenVerifier {
  const issuer = `${opts.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const jwks = opts.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = opts.hs256Secret ? new TextEncoder().encode(opts.hs256Secret) : null;

  return async (token) => {
    const { payload } = secret
      ? await jwtVerify(token, secret, { issuer, audience: 'authenticated', algorithms: ['HS256'] })
      : await jwtVerify(token, jwks, { issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256'] });
    if (!payload.sub) throw new Error('token has no subject');
    const roles = Array.isArray(payload.app_roles) ? payload.app_roles.filter((r): r is AppRole => AppRole.safeParse(r).success) : [];
    return {
      userId: payload.sub,
      phone: typeof payload.phone === 'string' && payload.phone ? payload.phone : null,
      aal: payload.aal === 'aal2' ? 'aal2' : 'aal1',
      roles,
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
    };
  };
}

const unauthorized = (requestId: string, message = 'Sign in required'): ErrorBody => ({ error: { code: 'unauthorized', message, requestId } });

/** Requires a valid Supabase access token; sets c.var.auth. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json(unauthorized(c.get('requestId')), 401);
  try {
    c.set('auth', await c.get('deps').verifyToken(token));
  } catch {
    return c.json(unauthorized(c.get('requestId'), 'Invalid or expired session'), 401);
  }
  await next();
});

/** Console staff: a staff role and a TOTP-verified session (aal2). Use after requireAuth. */
export function requireStaff(allowed: readonly AppRole[] = consoleRoles) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth');
    const forbidden = (message: string) => c.json<ErrorBody>({ error: { code: 'forbidden', message, requestId: c.get('requestId') } }, 403);
    if (!auth?.roles.some((r) => allowed.includes(r))) return forbidden('Not allowed for this role');
    if (auth.aal !== 'aal2') return forbidden('Two-factor verification required');
    await next();
  });
}
