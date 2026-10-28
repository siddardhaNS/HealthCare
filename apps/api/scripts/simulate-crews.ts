// Simulated ambulance crews for local end-to-end runs (plan §7). Local stack only.
//
//   pnpm --filter api simulate:crews [--count 5] [--near 17.44,78.35] [--team 2] [--sos] [--decline 0.2] [--drive [--speed 11]]
//
// Creates (or reuses) test crew accounts crew-sim-N@example.test with the crew
// role, puts them on duty at random points 0.5–8 km around --near, then polls
// for offers and accepts after 2–6 s (or declines, at the --decline rate).
// --team N puts the first N crews in a "Simulated team" covering the test
// resident's household. --sos also raises an SOS as a test resident at --near.
// --drive: the crew that wins a job goes en route, drives to the patient
// (a fix every 4 s at --speed m/s, default 11 ≈ 40 km/h; use e.g. 100 for a
// quick test), then on scene → transporting → handed over.
// Ctrl+C takes everyone off duty.
import { randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { coverageAssignments, coverageTeams, crews, createDb, eq, householdMembers, households, userRoles } from '@repo/db';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '5' },
    near: { type: 'string', default: '17.44,78.35' },
    team: { type: 'string', default: '0' },
    sos: { type: 'boolean', default: false },
    decline: { type: 'string', default: '0' },
    drive: { type: 'boolean', default: false },
    speed: { type: 'string', default: '11' },
    api: { type: 'string', default: 'http://localhost:3001' },
  },
});
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret || !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error('Local stack only: SUPABASE_URL must point at 127.0.0.1/localhost and SUPABASE_SECRET_KEY be set (.env).');
  process.exit(1);
}
const [lat0, lng0] = values.near!.split(',').map(Number) as [number, number];
const count = Number(values.count);
const teamSize = Math.min(Number(values.team), count);
const declineRate = Number(values.decline);
const api = values.api!.replace(/\/$/, '');

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const db = createDb();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (who: string, msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${who.padEnd(10)} ${msg}`);

/** A test account with a fresh password for this run; returns its access token. */
async function account(email: string): Promise<{ userId: string; token: string }> {
  const password = randomBytes(12).toString('base64url');
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list.users.find((u) => u.email === email);
  const userId = existing ? existing.id : (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
  if (existing) await admin.auth.admin.updateUserById(userId, { password });
  const signIn = createClient(url!, secret!, { auth: { persistSession: false } });
  const { data, error } = await signIn.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return { userId, token: data.session.access_token };
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

const FIX_MS = 4_000;
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180)) * 111_200;

/** The winning crew drives to the patient, streaming its position, then works through the job steps. */
async function drive(s: { name: string; token: string }, from: { lat: number; lng: number }, incidentId: string, to: { lat: number; lng: number }) {
  const step = async (state: string) => {
    const r = await call(s.token, 'POST', `/v1/sos/${incidentId}/status`, { to: state });
    log(s.name, `${state} → ${r.status}`);
    return r.status === 200;
  };
  if (!(await step('en_route'))) return;
  let at = from;
  while (metres(at, to) > 30) {
    const d = metres(at, to);
    const f = Math.min(1, (Number(values.speed) * FIX_MS) / 1000 / d);
    at = { lat: at.lat + (to.lat - at.lat) * f, lng: at.lng + (to.lng - at.lng) * f };
    await call(s.token, 'POST', '/v1/crew/location', { points: [{ ...at, at: new Date().toISOString() }] });
    log(s.name, `${Math.round(metres(at, to))} m to go`);
    await sleep(FIX_MS);
  }
  for (const state of ['on_scene', 'transporting', 'handed_over']) {
    if (!(await step(state))) return;
    await sleep(10_000);
  }
}

/** A random point 0.5–8 km from the centre. */
function around(): { lat: number; lng: number } {
  const km = 0.5 + Math.random() * 7.5;
  const bearing = Math.random() * 2 * Math.PI;
  return { lat: lat0 + (km / 111.2) * Math.cos(bearing), lng: lng0 + (km / (111.2 * Math.cos((lat0 * Math.PI) / 180))) * Math.sin(bearing) };
}

async function main() {
  // Crews (roles first so the access token carries them).
  const sims: { name: string; token: string; crewId: string }[] = [];
  let teamId: string | null = null;
  if (teamSize > 0) {
    const [team] = await db.insert(coverageTeams).values({ name: 'Simulated team', area: 'Simulation' }).returning({ id: coverageTeams.id });
    teamId = team!.id;
  }
  for (let i = 1; i <= count; i++) {
    const email = `crew-sim-${i}@example.test`;
    const pre = await account(email);
    await db.insert(userRoles).values({ userId: pre.userId, role: 'crew' }).onConflictDoNothing();
    const [row] = await db
      .insert(crews)
      .values({ userId: pre.userId, drillParticipant: true, teamId: i <= teamSize ? teamId : null })
      .onConflictDoUpdate({ target: crews.userId, set: { active: true, teamId: i <= teamSize ? teamId : null } })
      .returning({ id: crews.id });
    const { token } = await account(email); // re-sign-in: the token now has the crew role
    sims.push({ name: `crew-${i}${i <= teamSize ? '*' : ''}`, token, crewId: row!.id });
  }

  const positions = new Map<string, { lat: number; lng: number }>();
  for (const s of sims) {
    const at = around();
    positions.set(s.name, at);
    const res = await call(s.token, 'PUT', '/v1/crew/duty', { onDuty: true, location: at });
    if (res.status !== 200) throw new Error(`${s.name} could not go on duty: ${res.status} ${JSON.stringify(res.body)}`);
    log(s.name, `on duty ${(Math.hypot(at.lat - lat0, (at.lng - lng0) * Math.cos((lat0 * Math.PI) / 180)) * 111.2).toFixed(1)} km away`);
  }
  if (teamSize > 0) log('setup', `* = in "Simulated team" (${teamSize} crews)`);

  const offDuty = async () => {
    await Promise.all(sims.map((s) => call(s.token, 'PUT', '/v1/crew/duty', { onDuty: false })));
    log('setup', 'all crews off duty');
    process.exit(0);
  };
  process.on('SIGINT', () => void offDuty());

  if (values.sos) {
    const resident = await account('resident-sim@example.test');
    if (teamId) {
      // A stand-alone household for the test resident, covered by the simulated team.
      let [m] = await db.select({ householdId: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, resident.userId));
      if (!m) {
        const [hh] = await db.insert(households).values({ name: 'Simulation household', city: 'Hyderabad' }).returning({ id: households.id });
        await db.insert(householdMembers).values({ householdId: hh!.id, userId: resident.userId, role: 'owner' });
        m = { householdId: hh!.id };
      }
      await db.delete(coverageAssignments).where(eq(coverageAssignments.householdId, m.householdId));
      await db.insert(coverageAssignments).values({ teamId, householdId: m.householdId });
    }
    const res = await call(resident.token, 'POST', '/v1/sos', { idempotencyKey: randomUUID(), location: { lat: lat0, lng: lng0, accuracyM: 15 } });
    log('resident', `raised SOS ${(res.body as { id?: string })?.id ?? ''} → ${res.status} ${(res.body as { state?: string })?.state ?? JSON.stringify(res.body)}`);
  }

  // Each crew polls for offers and answers once per offer.
  const answered = new Set<string>();
  await Promise.all(
    sims.map(async (s) => {
      for (;;) {
        const { body } = await call(s.token, 'GET', '/v1/crew/offers');
        for (const o of (body as { id: string; incidentId: string; ring: number; distanceM: number | null; etaS: number | null; location: { lat: number; lng: number } | null }[]) ?? []) {
          if (answered.has(o.id)) continue;
          answered.add(o.id);
          log(s.name, `offer ring ${o.ring} · ${o.distanceM ?? '?'} m · ETA ${o.etaS ?? '?'} s`);
          void (async () => {
            await sleep(2000 + Math.random() * 4000);
            if (Math.random() < declineRate) {
              const r = await call(s.token, 'POST', `/v1/dispatch/offers/${o.id}/decline`);
              log(s.name, `declined → ${r.status}`);
            } else {
              const r = await call(s.token, 'POST', `/v1/dispatch/offers/${o.id}/accept`);
              log(s.name, r.status === 200 ? 'ACCEPTED: the job is ours' : `accept → ${r.status} ${(r.body as { error?: { message?: string } })?.error?.message ?? ''}`);
              if (r.status === 200 && values.drive) await drive(s, positions.get(s.name)!, o.incidentId, o.location ?? { lat: lat0, lng: lng0 });
            }
          })();
        }
        await sleep(1000);
      }
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
