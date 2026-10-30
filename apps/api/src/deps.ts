import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { createDb } from '@repo/db';
import { processMemoryKv, upstashKv, type Kv } from './lib/kv';
import { silentRealtime, supabaseRealtime, type Realtime } from './lib/realtime';
import { processMemoryCrewLocator, upstashCrewLocator, type CrewLocator } from './lib/crew-locator';
import { drizzleDispatchRepo, type DispatchRepo } from './modules/dispatch/repo';
import { dispatchAlerts } from './modules/dispatch/service';
import { createTokenVerifier, type TokenVerifier } from './middleware/auth';
import { cloudApiWhatsApp, logSms, logWhatsApp, msg91Sms } from './modules/messaging/providers';
import { drizzleConsentRepo, type ConsentRepo } from './modules/consent/repo';
import { drizzleHealthRepo, type HealthRepo } from './modules/health/repo';
import { drizzleHouseholdsRepo, type HouseholdsRepo } from './modules/households/repo';
import { drizzleLeadsRepo, type LeadsRepo } from './modules/leads/repo';
import { drizzleResidentsRepo, type ResidentsRepo } from './modules/residents/repo';
import { drizzleSosRepo, type SosRepo } from './modules/sos/repo';
import { drizzleDeskRepo, type DeskRepo } from './modules/sos/desk-repo';
import { publishingSosRepo } from './modules/sos/live';
import type { EscalationRunner, SosAlerts } from './modules/sos/escalation-service';
import { workflowEscalation } from './modules/sos/escalation-runner';
import { drizzleMessagingRepo } from './modules/messaging/repo';
import { logMailer, type Mailer } from './modules/notifications/mailer';
import type { MessagingDeps } from './modules/messaging/service';

const Env = z
  .object({
    NODE_ENV: z.string().default('development'),
    SUPABASE_URL: z.string().url(),
    /** Secret key (sb_secret_…): publishes live SOS updates over Realtime. Without it the apps poll. */
    SUPABASE_SECRET_KEY: z.string().optional(),
    /** Local Supabase CLI only, when the stack signs tokens with HS256. Never set in production. */
    SUPABASE_JWT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    SEND_SMS_HOOK_SECRET: z.string().startsWith('v1,whsec_'),
    OTP_FALLBACK_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
    PHONE_HASH_KEY: z.string().min(32),
    /** 32 bytes, base64: encrypts clinical free text (condition notes) before storage. */
    FIELD_ENC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
    MESSAGING_MODE: z.enum(['live', 'log']).default('log'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_GRAPH_VERSION: z.string().default('v26.0'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().default('local-otp'),
    SALES_INBOX_EMAIL: z.string().email().default('sales@localhost.test'),
    CONSOLE_URL: z.string().url().default('http://localhost:3002'),
    /** Comma-separated origins allowed to call public endpoints from the browser (landing site). */
    WEB_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3003'),
  })
  .superRefine((e, ctx) => {
    const need = (keys: (keyof typeof e)[], why: string) =>
      keys.filter((k) => !e[k]).forEach((k) => ctx.addIssue({ code: 'custom', path: [k], message: `required ${why}` }));
    if (e.NODE_ENV === 'production') {
      need(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], 'in production (functions are stateless)');
      need(['SUPABASE_SECRET_KEY'], 'in production (live SOS updates)');
      if (e.SUPABASE_JWT_SECRET) ctx.addIssue({ code: 'custom', path: ['SUPABASE_JWT_SECRET'], message: 'must not be set in production' });
    }
    if (e.MESSAGING_MODE === 'live') {
      need(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'MSG91_AUTH_KEY'], 'when MESSAGING_MODE=live');
    }
  });

/** Invalid or missing configuration. The message names variables, never their values. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface Deps {
  kv: Kv;
  leads: LeadsRepo;
  consents: ConsentRepo;
  households: HouseholdsRepo;
  residents: ResidentsRepo;
  health: HealthRepo;
  sos: SosRepo;
  desk: DeskRepo;
  sosAlerts: SosAlerts;
  escalation: EscalationRunner;
  dispatch: DispatchRepo;
  locator: CrewLocator;
  realtime: Realtime;
  mailer: Mailer;
  messaging: MessagingDeps;
  verifyToken: TokenVerifier;
  config: {
    sendSmsHookSecret: string;
    phoneHashKey: string;
    whatsappAppSecret: string | null;
    whatsappVerifyToken: string | null;
    salesInbox: string;
    consoleUrl: string;
    fieldKey: Buffer;
  };
}

export function depsFromEnv(source: Record<string, string | undefined> = process.env): Deps {
  // Blank lines in .env files (FOO=) mean "not set", not "empty string".
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join(', ')}`);
  }
  const env = parsed.data;
  const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;
  // Without Upstash (local dev only; required in production) state is in-process and shared by handlers and workflow steps.
  const kv = redis ? upstashKv(redis) : processMemoryKv();
  const locator = redis ? upstashCrewLocator(redis) : processMemoryCrewLocator();
  const live = env.MESSAGING_MODE === 'live';
  const db = createDb(env.DATABASE_URL);
  const realtime = env.SUPABASE_SECRET_KEY ? supabaseRealtime({ supabaseUrl: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }) : silentRealtime();
  const sos = publishingSosRepo(drizzleSosRepo(db), realtime);
  const dispatch = drizzleDispatchRepo(db);
  return {
    kv,
    leads: drizzleLeadsRepo(db),
    consents: drizzleConsentRepo(db),
    households: drizzleHouseholdsRepo(db),
    residents: drizzleResidentsRepo(db),
    health: drizzleHealthRepo(db),
    sos,
    desk: drizzleDeskRepo(db),
    sosAlerts: dispatchAlerts({ dispatch, locator, sos, realtime }),
    escalation: workflowEscalation(),
    dispatch,
    locator,
    realtime,
    mailer: logMailer(),
    messaging: {
      kv,
      repo: drizzleMessagingRepo(db),
      whatsapp: live
        ? cloudApiWhatsApp({ phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!, accessToken: env.WHATSAPP_ACCESS_TOKEN!, graphVersion: env.WHATSAPP_GRAPH_VERSION })
        : logWhatsApp(),
      sms: live ? msg91Sms({ authKey: env.MSG91_AUTH_KEY! }) : logSms(),
      fallbackKey: Buffer.from(env.OTP_FALLBACK_KEY, 'base64'),
      smsTemplateIds: { otp_code: env.MSG91_OTP_TEMPLATE_ID },
    },
    verifyToken: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, hs256Secret: env.SUPABASE_JWT_SECRET }),
    config: {
      sendSmsHookSecret: env.SEND_SMS_HOOK_SECRET,
      phoneHashKey: env.PHONE_HASH_KEY,
      whatsappAppSecret: env.WHATSAPP_APP_SECRET ?? null,
      whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN ?? null,
      salesInbox: env.SALES_INBOX_EMAIL,
      consoleUrl: env.CONSOLE_URL.replace(/\/$/, ''),
      fieldKey: Buffer.from(env.FIELD_ENC_KEY, 'base64'),
    },
  };
}
