// Shared by the signed-in suite's setup and tests: the local stack, test
// accounts and API helpers. Local Supabase only (refuses any other URL).
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = join(here, '.auth');
export const ACCOUNTS_FILE = join(AUTH_DIR, 'accounts.json');
export const adminState = join(AUTH_DIR, 'admin.json');
export const erState = join(AUTH_DIR, 'er.json');

// Server secrets come from the repo's .env (as for the API and scripts).
const rootEnv = join(here, '..', '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  secretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  api: process.env.E2E_API_URL ?? 'http://localhost:3001',
};
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.supabaseUrl) || !env.secretKey) {
  throw new Error('The signed-in suite runs against the local Supabase stack only: set SUPABASE_URL (127.0.0.1) and SUPABASE_SECRET_KEY in .env.');
}

/** An isolated test area far from the dev data (Vijayawada), so hospital choice is predictable. */
export const AREA = { lat: 16.506, lng: 80.648 };
export const north = (km: number) => ({ lat: AREA.lat + km / 111.2, lng: AREA.lng });

export interface Account {
  userId: string;
  email: string;
  password: string;
  totpSecret?: string;
  token: string;
}
export interface Accounts {
  admin: Account;
  er: Account;
  crew: Account & { crewId: string };
  resident: Account;
  siteId: string;
  hospitals: { near: string; far: string };
}

export const accounts = (): Accounts => JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) as Accounts;

/** RFC 6238 code (SHA-1, 6 digits, 30 s) for a base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[19]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Calls the API as a test account. */
export async function api<T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${env.api}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (res.status === 204 ? null : await res.json().catch(() => null)) as T };
}

/** The crew takes the job: its own offer if it has one, else the desk offers it first (as the command center would). */
export async function crewAccepts(a: Accounts, incidentId: string) {
  const offerFor = async () => (await api<{ id: string; incidentId: string }[]>(a.crew.token, 'GET', '/v1/crew/offers')).body.find((o) => o.incidentId === incidentId);
  let offer = await offerFor();
  if (!offer) {
    await api(a.admin.token, 'POST', `/v1/desk/sos/${incidentId}/offers`, { crewId: a.crew.crewId });
    offer = await offerFor();
  }
  if (!offer) throw new Error('the test crew got no offer');
  const r = await api(a.crew.token, 'POST', `/v1/dispatch/offers/${offer.id}/accept`);
  if (r.status !== 200) throw new Error(`accept failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Ends whatever the test left open, through the desk (so it is in the timeline). */
export async function endIncident(a: Accounts, incidentId: string) {
  const r = await api(a.admin.token, 'POST', `/v1/desk/sos/${incidentId}/cancel`, { reason: 'End of e2e test' });
  if (r.status !== 200) await api(a.admin.token, 'POST', `/v1/desk/sos/${incidentId}/close`, { reason: 'End of e2e test' });
}
