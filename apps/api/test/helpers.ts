import { createHmac, randomBytes } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { Webhook } from 'standardwebhooks';
import { createApp } from '../src/app';
import type { Deps } from '../src/deps';
import { memoryKv } from '../src/lib/kv';
import { createTokenVerifier } from '../src/middleware/auth';
import { ProviderError, type SmsSend, type WhatsAppSend } from '../src/modules/messaging/providers';
import type { Lead } from '@repo/contracts';
import type { ConsentRepo } from '../src/modules/consent/repo';
import type { ResidentsRepo } from '../src/modules/residents/repo';
import { fakeHouseholds } from './fake-households';
import { fakeHealth } from './fake-health';
import { fakeEscalation, fakeSos, recordingAlerts } from './fake-sos';
import { fakeDispatch } from './fake-dispatch';
import { fakeDesk } from './fake-desk';
import { fakeCoverage, fakeSosSettings } from './fake-coverage';
import { fakeHandovers, recordingNotifier } from './fake-handover';
import { memoryCrewLocator } from '../src/lib/crew-locator';
import { recordingRealtime } from '../src/lib/realtime';
import { publishingSosRepo } from '../src/modules/sos/live';
import type { ConsentRow } from '../src/modules/consent/policy';
import { newLeadRef, type LeadsRepo } from '../src/modules/leads/repo';
import type { MessageLogInput, MessagingRepo, OptinInput } from '../src/modules/messaging/repo';

export const SUPABASE_URL = 'http://supabase.test';
export const HOOK_SECRET = `v1,whsec_${randomBytes(32).toString('base64')}`;
export const WA_APP_SECRET = 'wa-app-secret';
export const WA_VERIFY_TOKEN = 'wa-verify-token';

export function fakeRepo() {
  const messages: (MessageLogInput & { id: string })[] = [];
  const optins: OptinInput[] = [];
  const challenges: { phoneHash: string; channel: string; outcome: string }[] = [];
  const repo: MessagingRepo = {
    async logMessage(row) {
      const id = `log-${messages.length + 1}`;
      messages.push({ ...row, id });
      return { id };
    },
    async updateStatus(pid, status, errorCode) {
      const m = messages.find((x) => x.providerMessageId === pid);
      if (!m) return null;
      m.status = status;
      m.errorCode = errorCode ?? null;
      return { id: m.id };
    },
    async recordOptin(row) {
      optins.push(row);
    },
    async recordOtpChallenge(row) {
      challenges.push(row);
    },
  };
  return { repo, messages, optins, challenges };
}

export function fakeLeads() {
  const rows: Lead[] = [];
  const repo: LeadsRepo = {
    async create(input) {
      const lead: Lead = {
        id: crypto.randomUUID(),
        ref: newLeadRef(),
        createdAt: new Date().toISOString(),
        status: 'new',
        orgType: input.orgType,
        orgName: input.orgName ?? null,
        city: input.city,
        area: input.area ?? null,
        size: input.size,
        contactName: input.contactName,
        contactRole: input.contactRole,
        phone: input.phone,
        email: input.email,
        services: input.services,
        plan: input.plan,
        walkthrough: input.walkthrough,
        notes: input.notes ?? null,
      };
      rows.unshift(lead);
      return { id: lead.id, ref: lead.ref };
    },
    async list({ status, limit }) {
      return rows.filter((r) => !status || r.status === status).slice(0, limit);
    },
    async setStatus(id, status) {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      r.status = status;
      return r;
    },
  };
  return { repo, rows };
}

export async function testContext(opts: { whatsappFails?: boolean; mailerFails?: boolean; escalationFails?: boolean } = {}) {
  const kv = memoryKv();
  const store = fakeRepo();
  const leads = fakeLeads();
  const consentRows: ConsentRow[] = [];
  const hh = fakeHouseholds(consentRows);
  const health = fakeHealth(hh.repo, consentRows);
  const sos = fakeSos();
  const escalation = fakeEscalation({ startFails: opts.escalationFails });
  const alerts = recordingAlerts();
  const dispatch = fakeDispatch(() => sos.incidents);
  const desk = fakeDesk(sos, dispatch, hh);
  const coverage = fakeCoverage(dispatch, hh);
  const sosSettings = fakeSosSettings(hh, sos);
  const ops = { deskPhone: null as string | null, audit: [] as { from: string | null; to: string | null }[] };
  const handovers = fakeHandovers(() => sos.incidents);
  const links = recordingNotifier();
  const locator = memoryCrewLocator();
  const live = recordingRealtime();
  const residentViews: { staffId: string; role: string; residentId: string }[] = [];
  const deskScopes = new Map<string, string[]>();
  const residents: ResidentsRepo = {
    async deskSites(staffId) {
      return deskScopes.get(staffId) ?? [];
    },
    async list({ siteIds, q }) {
      const all = await hh.residents();
      return all.filter((r) => (siteIds === 'all' || (r.siteId && siteIds.includes(r.siteId))) && (!q || `${r.fullName} ${r.number} ${r.community}`.toLowerCase().includes(q.toLowerCase())));
    },
    async get(userId) {
      return (await hh.residents()).find((r) => r.userId === userId) ?? null;
    },
    async householdSize(householdId) {
      return hh.members.filter((m) => m.householdId === householdId).length;
    },
    async logView(staffId, role, residentId) {
      residentViews.push({ staffId, role, residentId });
    },
  };
  let tick = Date.parse('2026-10-27T00:00:00Z');
  const consents: ConsentRepo = {
    async history(userId) {
      return consentRows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async historyForStaff(userId) {
      return consentRows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async record(actorId, row) {
      // Mirrors the RLS insert policy: people write only their own consents.
      if (row.userId !== actorId) throw new Error('RLS: new row violates row-level security policy');
      const r: ConsentRow = { ...row, actedBy: actorId, createdAt: new Date((tick += 1000)) };
      consentRows.push(r);
      return r;
    },
  };
  const mail: { to: string; subject: string; text: string }[] = [];
  const whatsappSent: WhatsAppSend[] = [];
  const smsSent: SmsSend[] = [];
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' };

  const deps: Deps = {
    kv,
    leads: leads.repo,
    consents,
    households: hh.repo,
    residents,
    health: health.repo,
    sos: publishingSosRepo(sos.repo, live.realtime),
    desk: desk.repo,
    sosSettings: sosSettings.repo,
    coverage: coverage.repo,
    opsSettings: {
      deskPhone: async () => ops.deskPhone,
      setDeskPhone: async (phone) => {
        ops.audit.push({ from: ops.deskPhone, to: phone });
        ops.deskPhone = phone;
      },
    },
    handovers: handovers.repo,
    handoverNotifier: links.notifier,
    sosAlerts: alerts.alerts,
    escalation: escalation.runner,
    dispatch: dispatch.repo,
    locator,
    realtime: live.realtime,
    mailer: {
      async send(msg) {
        if (opts.mailerFails) throw new Error('smtp down');
        mail.push(msg);
      },
    },
    messaging: {
      kv,
      repo: store.repo,
      whatsapp: {
        async sendTemplate(msg) {
          if (opts.whatsappFails) throw new ProviderError('whatsapp', '131026');
          whatsappSent.push(msg);
          return { messageId: `wamid.${whatsappSent.length}` };
        },
      },
      sms: {
        async sendTemplate(msg) {
          smsSent.push(msg);
          return { requestId: `sms-${smsSent.length}` };
        },
      },
      fallbackKey: randomBytes(32),
      smsTemplateIds: { otp_code: 'dlt-otp' },
    },
    verifyToken: createTokenVerifier({ supabaseUrl: SUPABASE_URL, keys: createLocalJWKSet({ keys: [jwk] }) }),
    config: {
      sendSmsHookSecret: HOOK_SECRET,
      phoneHashKey: 'x'.repeat(32),
      whatsappAppSecret: WA_APP_SECRET,
      whatsappVerifyToken: WA_VERIFY_TOKEN,
      salesInbox: 'sales@example.test',
      consoleUrl: 'https://console.example.test',
      fieldKey: randomBytes(32),
    },
  };

  const app = createApp({ deps: () => deps, webOrigins: ['https://web.example.test'] });

  async function token(claims: JWTPayload & { aal?: string; app_roles?: string[] }, opt: { issuer?: string; expiresIn?: string } = {}) {
    return new SignJWT({ role: 'authenticated', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(opt.issuer ?? `${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(opt.expiresIn ?? '1h')
      .sign(privateKey);
  }

  function sendSmsHook(body: unknown, secret = HOOK_SECRET) {
    const payload = JSON.stringify(body);
    const id = `msg_${randomBytes(6).toString('hex')}`;
    const ts = new Date();
    const signature = new Webhook(secret.replace(/^v1,/, '')).sign(id, ts, payload);
    return app.request('/v1/auth/hooks/send-sms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': signature },
      body: payload,
    });
  }

  function whatsappWebhook(body: unknown, secret = WA_APP_SECRET) {
    const raw = JSON.stringify(body);
    const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    return app.request('/webhooks/whatsapp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  }

  return {
    app,
    deps,
    kv,
    ...store,
    leads: leads.rows,
    consentRows,
    hh,
    health,
    sos,
    desk,
    coverage,
    sosSettings,
    ops,
    handovers,
    links: links.sent,
    escalation,
    alerts,
    dispatch,
    locator,
    published: live.sent,
    residentViews,
    deskScopes,
    mail,
    whatsappSent,
    smsSent,
    token,
    sendSmsHook,
    whatsappWebhook,
  };
}

export const statusEvent = (id: string, status: string, code?: number) => ({
  entry: [{ changes: [{ value: { statuses: [{ id, status, ...(code ? { errors: [{ code }] } : {}) }] } }] }],
});

export const inboundText = (from: string, body: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, type: 'text', text: { body } }] } }] }],
});
