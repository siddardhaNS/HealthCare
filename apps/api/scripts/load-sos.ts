// SOS load test (plan §7): many simultaneous incidents in one city, answered by
// simulated crews, through the real API, database and escalation workflow.
// Local stack only.
//
//   SUPABASE_JWT_SECRET=<local JWT secret> pnpm --filter api dev      # API that accepts locally signed tokens
//   pnpm --filter api load:sos [--incidents 50] [--crews 60] [--near 17.44,78.35] [--timeout 120]
//
// Sign-ins are rate limited (30 per 5 min per IP), so test accounts are created
// with the admin API and their tokens signed here with the local stack's JWT
// secret (`pnpm supabase status` → JWT_SECRET). Auth is not what is measured.
//
// Measures: raise latency, raise → first offer, raise → accepted, accept races
// lost, HTTP errors. Checks: every incident is accepted by exactly one crew and
// no crew holds two jobs. Afterwards the desk cancels the incidents and crews go off duty.
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { crews, createDb, inArray, sosIncidents, sql, userRoles } from '@repo/db';

const { values } = parseArgs({
  options: {
    incidents: { type: 'string', default: '50' },
    crews: { type: 'string', default: '60' },
    near: { type: 'string', default: '17.44,78.35' },
    timeout: { type: 'string', default: '120' },
    api: { type: 'string', default: 'http://localhost:3001' },
  },
});
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const jwtSecret = process.env.SUPABASE_JWT_SECRET;
if (!url || !secret || !jwtSecret || !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error('Local stack only: SUPABASE_URL (127.0.0.1/localhost), SUPABASE_SECRET_KEY and SUPABASE_JWT_SECRET must be set.');
  process.exit(1);
}
const [lat0, lng0] = values.near!.split(',').map(Number) as [number, number];
const nIncidents = Number(values.incidents);
const nCrews = Number(values.crews);
const timeoutMs = Number(values.timeout) * 1000;
const api = values.api!.replace(/\/$/, '');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const db = createDb();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = new TextEncoder().encode(jwtSecret);

// ── Accounts and tokens ────────────────────────────────────────────────

async function existingUsers(): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data.users) if (u.email) byEmail.set(u.email, u.id);
    if (data.users.length < 1000) return byEmail;
  }
}

async function ensureUser(known: Map<string, string>, email: string): Promise<string> {
  const id = known.get(email);
  if (id) return id;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  return data.user.id;
}

const token = (sub: string, roles: string[], aal: 'aal1' | 'aal2' = 'aal1') =>
  new SignJWT({ role: 'authenticated', app_roles: roles, aal, session_id: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(`${url!.replace(/\/$/, '')}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key);

// ── HTTP with timing ───────────────────────────────────────────────────

const timings = new Map<string, number[]>();
const errors: { route: string; status: number }[] = [];

async function call(tok: string, method: string, path: string, route: string, body?: unknown) {
  const started = performance.now();
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    status = res.status;
    json = res.status === 204 ? null : await res.json().catch(() => null);
  } catch {
    status = 0;
  }
  const ms = performance.now() - started;
  timings.set(route, [...(timings.get(route) ?? []), ms]);
  if (status === 0 || status >= 500) errors.push({ route, status });
  return { status, body: json };
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
const fmt = (ms: number) => (Number.isNaN(ms) ? '–' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** A random point up to `km` from the centre. */
function around(km: number) {
  const d = Math.sqrt(Math.random()) * km;
  const b = Math.random() * 2 * Math.PI;
  return { lat: lat0 + (d / 111.2) * Math.cos(b), lng: lng0 + (d / (111.2 * Math.cos((lat0 * Math.PI) / 180))) * Math.sin(b) };
}

async function main() {
  const health = await fetch(`${api}/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`API not reachable at ${api}`);

  console.log(`Setting up ${nCrews} crews and ${nIncidents} residents…`);
  const known = await existingUsers();
  const crewUsers = await Promise.all(Array.from({ length: nCrews }, (_, i) => ensureUser(known, `crew-load-${i + 1}@example.test`)));
  const residentUsers = await Promise.all(Array.from({ length: nIncidents }, (_, i) => ensureUser(known, `resident-load-${i + 1}@example.test`)));
  await db.insert(userRoles).values(crewUsers.map((userId) => ({ userId, role: 'crew' as const }))).onConflictDoNothing();
  await db.insert(crews).values(crewUsers.map((userId) => ({ userId }))).onConflictDoUpdate({ target: crews.userId, set: { active: true, teamId: null } });
  const adminUser = await ensureUser(known, 'load-admin@example.test');
  await db.insert(userRoles).values({ userId: adminUser, role: 'super_admin' }).onConflictDoNothing();
  const desk = await token(adminUser, ['super_admin'], 'aal2');
  /** Cancels this run's open incidents through the desk, so every change is in the timeline. */
  const cancelOpen = async () => {
    const open = await db.select({ id: sosIncidents.id }).from(sosIncidents).where(sql`${inArray(sosIncidents.userId, residentUsers)} and ${sosIncidents.state} not in ('closed', 'cancelled')`);
    await Promise.all(
      open.map(async (o) => {
        // After the 108 prompt the desk closes rather than cancels.
        const r = await call(desk, 'POST', `/v1/desk/sos/${o.id}/cancel`, 'cleanup', { reason: 'Load test clean-up' });
        if (r.status !== 200) await call(desk, 'POST', `/v1/desk/sos/${o.id}/close`, 'cleanup', { reason: 'Load test clean-up' });
      }),
    );
  };
  // Leftovers from an interrupted run would block "one open SOS per person".
  await cancelOpen();

  const crewSims = await Promise.all(crewUsers.map(async (userId, i) => ({ name: `crew-${i + 1}`, userId, tok: await token(userId, ['crew']), jobs: [] as string[] })));
  const residents = await Promise.all(residentUsers.map(async (userId) => ({ userId, tok: await token(userId, []) })));

  for (const c of crewSims) {
    const r = await call(c.tok, 'PUT', '/v1/crew/duty', 'PUT /crew/duty', { onDuty: true, location: around(8) });
    if (r.status !== 200) throw new Error(`${c.name} could not go on duty: ${r.status} ${JSON.stringify(r.body)}`);
  }

  // ── The burst ──
  const raisedAt = new Map<string, number>();
  const firstOffer = new Map<string, number>();
  const acceptedAt = new Map<string, number>();
  let lostRaces = 0;
  let stop = false;

  // Crews poll for offers every second (as the field app does) and accept after 0.5–2 s.
  const crewLoops = crewSims.map(async (c) => {
    const answered = new Set<string>();
    while (!stop) {
      const { body } = await call(c.tok, 'GET', '/v1/crew/offers', 'GET /crew/offers');
      for (const o of (body as { id: string; incidentId: string }[] | null) ?? []) {
        if (!firstOffer.has(o.incidentId)) firstOffer.set(o.incidentId, performance.now());
        if (answered.has(o.id) || c.jobs.length > 0) continue;
        answered.add(o.id);
        await sleep(500 + Math.random() * 1500);
        const r = await call(c.tok, 'POST', `/v1/dispatch/offers/${o.id}/accept`, 'POST /dispatch/offers/{id}/accept');
        if (r.status === 200) {
          c.jobs.push(o.incidentId);
          if (!acceptedAt.has(o.incidentId)) acceptedAt.set(o.incidentId, performance.now());
          await call(c.tok, 'POST', `/v1/sos/${o.incidentId}/status`, 'POST /sos/{id}/status', { to: 'en_route' });
        } else if (r.status === 409) lostRaces++;
      }
      await sleep(1000);
    }
  });

  console.log(`Raising ${nIncidents} SOS at once…`);
  const t0 = performance.now();
  const raised = await Promise.all(
    residents.map(async (p) => {
      const start = performance.now();
      const r = await call(p.tok, 'POST', '/v1/sos', 'POST /sos', { idempotencyKey: randomUUID(), location: { ...around(6), accuracyM: 20 } });
      const id = (r.body as { id?: string } | null)?.id;
      if (id) raisedAt.set(id, start);
      return { ...p, id, status: r.status };
    }),
  );
  const burstMs = performance.now() - t0;

  while (acceptedAt.size < raisedAt.size && performance.now() - t0 < timeoutMs) await sleep(500);
  stop = true;
  await Promise.all(crewLoops);

  // ── Checks against the database ──
  const ids = [...raisedAt.keys()];
  const rows = ids.length ? await db.select({ id: sosIncidents.id, state: sosIncidents.state, crewId: sosIncidents.crewId }).from(sosIncidents).where(inArray(sosIncidents.id, ids)) : [];
  const byCrew = new Map<string, number>();
  for (const r of rows) if (r.crewId) byCrew.set(r.crewId, (byCrew.get(r.crewId) ?? 0) + 1);
  const doubleBooked = [...byCrew.values()].filter((n) => n > 1).length;
  const unassigned = rows.filter((r) => !r.crewId).length;
  const states = rows.reduce<Record<string, number>>((a, r) => ((a[r.state] = (a[r.state] ?? 0) + 1), a), {});
  const jobsHeld = crewSims.filter((c) => c.jobs.length > 1).length;

  const since = (m: Map<string, number>) => ids.filter((id) => m.has(id)).map((id) => m.get(id)! - raisedAt.get(id)!);

  console.log('\n── Results ──────────────────────────────────────────');
  console.log(`incidents raised      ${raisedAt.size}/${nIncidents} (burst took ${fmt(burstMs)}; failed raises: ${raised.filter((r) => !r.id).map((r) => r.status).join(', ') || 'none'})`);
  console.log(`accepted              ${acceptedAt.size}/${raisedAt.size}`);
  console.log(`raise → first offer   p50 ${fmt(pct(since(firstOffer), 50))}  p95 ${fmt(pct(since(firstOffer), 95))}  max ${fmt(pct(since(firstOffer), 100))}`);
  console.log(`raise → accepted      p50 ${fmt(pct(since(acceptedAt), 50))}  p95 ${fmt(pct(since(acceptedAt), 95))}  max ${fmt(pct(since(acceptedAt), 100))}`);
  console.log(`accept races lost     ${lostRaces} (409: another crew was first)`);
  console.log(`states                ${JSON.stringify(states)}`);
  console.log('request latency:');
  for (const [route, xs] of [...timings].sort()) console.log(`  ${route.padEnd(36)} n=${String(xs.length).padStart(5)}  p50 ${fmt(pct(xs, 50)).padStart(7)}  p95 ${fmt(pct(xs, 95)).padStart(7)}  max ${fmt(pct(xs, 100)).padStart(7)}`);
  console.log(`HTTP errors (5xx / network): ${errors.length}${errors.length ? ` ${JSON.stringify(errors.slice(0, 5))}` : ''}`);

  const failures = [
    raisedAt.size < nIncidents && 'not every SOS was raised',
    unassigned > 0 && `${unassigned} incidents without a crew`,
    doubleBooked > 0 && `${doubleBooked} crews hold more than one incident in the database`,
    jobsHeld > 0 && `${jobsHeld} crews were told they won more than one job`,
    errors.length > 0 && 'server errors',
  ].filter(Boolean);
  console.log(failures.length ? `\nFAIL: ${failures.join('; ')}` : '\nPASS: every SOS raised and accepted by exactly one crew; no crew double-booked; no server errors');

  // ── Clean up: incidents cancelled by the desk, crews off duty ──
  await cancelOpen();
  await Promise.all(crewSims.map((c) => call(c.tok, 'PUT', '/v1/crew/duty', 'cleanup', { onDuty: false })));
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
