// Prepares the local stack for the signed-in suite:
// - an isolated test area: one community with a home, and two hospitals
// - test accounts (admin, ER, crew, resident) with fresh passwords; staff get a
//   freshly enrolled TOTP factor whose secret is kept for the tests
// - the crew on duty at the community; nothing of a previous run left open
// Everything goes to e2e-signed-in/.auth (git-ignored).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDb, sql } from '@repo/db';
import { ACCOUNTS_FILE, AREA, AUTH_DIR, api, env, north, totp, type Account, type Accounts } from './fixtures';

const admin = createClient(env.supabaseUrl, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = {
  org: '0e2e0000-0000-4000-8000-000000000001',
  site: '0e2e0000-0000-4000-8000-000000000002',
  home: '0e2e0000-0000-4000-8000-000000000003',
  near: '0e2e0000-0000-4000-8000-000000000004',
  far: '0e2e0000-0000-4000-8000-000000000005',
};
const point = (p: { lat: number; lng: number }) => sql`extensions.st_setsrid(extensions.st_makepoint(${p.lng}, ${p.lat}), 4326)::extensions.geography`;

async function userId(email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const u = data.users.find((x) => x.email === email);
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  return data.user.id;
}

/** A fresh password and session. Staff: the old TOTP factors removed and a new one enrolled and verified (aal2). */
async function prepare(email: string, staff: boolean): Promise<Account> {
  const id = await userId(email);
  const password = randomBytes(12).toString('base64url');
  await admin.auth.admin.updateUserById(id, { password });
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: id });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });

  const client: SupabaseClient = createClient(env.supabaseUrl, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign-in failed for ${email}: ${signIn.error.message}`);
  if (!staff) return { userId: id, email, password, token: signIn.data.session!.access_token };

  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp' });
  if (enrolled.error) throw new Error(`TOTP enrolment failed for ${email}: ${enrolled.error.message}`);
  const secret = enrolled.data.totp.secret;
  // The local stack's clock (Docker / WSL) can drift a few seconds under load: try the
  // neighbouring 30 s windows too, as an authenticator app's code would be accepted.
  let verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret) });
  for (const skew of [-30_000, 30_000]) {
    if (!verified.error) break;
    verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret, Date.now() + skew) });
  }
  if (verified.error) throw new Error(`TOTP verification failed for ${email}: ${verified.error.message}`);
  // The verify response carries the aal2 session.
  return { userId: id, email, password, totpSecret: secret, token: verified.data.access_token };
}

export default async function globalSetup() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const db = createDb(env.databaseUrl);

  await db.execute(sql`
    insert into organisations (id, type, name, city) values (${ids.org}, 'community', 'E2E Community', 'Vijayawada') on conflict (id) do nothing`);
  await db.execute(sql`
    insert into sites (id, organisation_id, name, kind, city, join_code) values (${ids.site}, ${ids.org}, 'E2E Gardens', 'gated', 'Vijayawada', 'E2EGARDEN') on conflict (id) do nothing`);
  await db.execute(sql`
    insert into homes (id, site_id, kind, number, location) values (${ids.home}, ${ids.site}, 'villa', '7', ${point(AREA)}) on conflict (id) do nothing`);
  for (const [id, name, at, phone] of [
    [ids.near, 'E2E Near Hospital', north(2), '+918662000001'],
    [ids.far, 'E2E Far Hospital', north(6), '+918662000002'],
  ] as const) {
    await db.execute(sql`
      insert into hospitals (id, name, city, location, er_phone, capacity_updated_at) values (${id}, ${name}, 'Vijayawada', ${point(at)}, ${phone}, now())
      on conflict (id) do update set active = true, has_capacity = true`);
  }

  const crewEmail = 'e2e-crew@example.test';
  const pre = await userId(crewEmail);
  const adminId = await userId('e2e-admin@example.test');
  const erId = await userId('e2e-er@example.test');
  // Roles before signing in, so the tokens carry them.
  await db.execute(sql`delete from user_roles where user_id in (${adminId}, ${erId}, ${pre})`);
  await db.execute(sql`
    insert into user_roles (user_id, role, scope_type, scope_id) values
      (${adminId}, 'super_admin', null, null),
      (${erId}, 'hospital', 'partner', ${ids.far}),
      (${pre}, 'crew', null, null)`);
  const [crewRow] = (await db.execute(sql`
    insert into crews (user_id, drill_participant, active, team_id) values (${pre}, true, true, null)
    on conflict (user_id) do update set drill_participant = true, active = true, team_id = null
    returning id`)) as unknown as { id: string }[];

  const accounts: Accounts = {
    admin: await prepare('e2e-admin@example.test', true),
    er: await prepare('e2e-er@example.test', true),
    crew: { ...(await prepare(crewEmail, false)), crewId: crewRow!.id },
    resident: await prepare('e2e-resident@example.test', false),
    siteId: ids.site,
    hospitals: { near: ids.near, far: ids.far },
  };

  await db.execute(sql`
    insert into profiles (user_id, full_name) values (${accounts.resident.userId}, 'E2E Resident') on conflict (user_id) do update set full_name = excluded.full_name`);

  // Close anything a previous run left open for these accounts, then put the crew on duty at the community.
  const open = (await db.execute(sql`
    select id from sos_incidents where (user_id in (${accounts.resident.userId}, ${accounts.admin.userId}) or crew_id = ${accounts.crew.crewId})
      and state not in ('closed', 'cancelled')`)) as unknown as { id: string }[];
  for (const o of open) {
    const r = await api(accounts.admin.token, 'POST', `/v1/desk/sos/${o.id}/cancel`, { reason: 'E2E clean-up' });
    if (r.status !== 200) await api(accounts.admin.token, 'POST', `/v1/desk/sos/${o.id}/close`, { reason: 'E2E clean-up' });
  }
  const duty = await api(accounts.crew.token, 'PUT', '/v1/crew/duty', { onDuty: true, location: north(0.5) });
  if (duty.status !== 200) throw new Error(`crew could not go on duty: ${duty.status} ${JSON.stringify(duty.body)} (is the API running at ${env.api}?)`);

  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}
