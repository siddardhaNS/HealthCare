// Creates a console staff account (email + password) and grants roles.
// Staff self sign-up is disabled; this is the only way in until the console
// has user management.
//
//   pnpm --filter api staff:create --email ops@example.in --role operations [--role support]
//   pnpm --filter api staff:create --email er@hospital.in --role hospital --scope partner:<hospital id>
//   pnpm --filter api staff:create --email desk@site.in --role community_desk --scope site:<site id>
//
// Prints a one-time password; the user must set up TOTP on first sign-in.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { AppRole, consoleRoles } from '@repo/contracts';
import { createDb, userRoles } from '@repo/db';

const { values } = parseArgs({ options: { email: { type: 'string' }, role: { type: 'string', multiple: true }, scope: { type: 'string' } } });
const roles = (values.role ?? []).map((r) => AppRole.parse(r));
if (!values.email || roles.length === 0 || roles.some((r) => !(consoleRoles as readonly string[]).includes(r))) {
  console.error(`Usage: staff:create --email <email> --role <${consoleRoles.join('|')}> [--role ...] [--scope partner:<id>|site:<id>]`);
  process.exit(1);
}

// Scopes every role granted: a hospital to its partner (hospitals.id), a community desk to its site.
const scope = values.scope?.match(/^(partner|site):([0-9a-f-]{36})$/i);
if (values.scope && !scope) {
  console.error('--scope must be partner:<uuid> or site:<uuid>');
  process.exit(1);
}
const scoped = scope ? { scopeType: scope[1]!.toLowerCase() as 'partner' | 'site', scopeId: scope[2]! } : {};

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).');
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const password = randomBytes(12).toString('base64url');
const { data, error } = await admin.auth.admin.createUser({ email: values.email, password, email_confirm: true });
if (error || !data.user) {
  console.error(`Could not create user: ${error?.message ?? 'unknown error'}`);
  process.exit(1);
}

const db = createDb();
await db.insert(userRoles).values(roles.map((role) => ({ userId: data.user.id, role, ...scoped })));

console.log(`Created ${values.email} with roles: ${roles.join(', ')}${values.scope ? ` (${values.scope})` : ''}`);
console.log(`One-time password: ${password}`);
console.log('Share it over a secure channel. TOTP set-up is required on first sign-in.');
process.exit(0);
