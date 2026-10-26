import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { createDb } from '@repo/db';
import { memoryKv, upstashKv, type Kv } from './lib/kv';
import { createTokenVerifier, type TokenVerifier } from './middleware/auth';
import { cloudApiWhatsApp, logSms, logWhatsApp, msg91Sms } from './modules/messaging/providers';
import { drizzleMessagingRepo } from './modules/messaging/repo';
import type { MessagingDeps } from './modules/messaging/service';

const Env = z
  .object({
    NODE_ENV: z.string().default('development'),
    SUPABASE_URL: z.string().url(),
    /** Local Supabase CLI only, when the stack signs tokens with HS256. Never set in production. */
    SUPABASE_JWT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    SEND_SMS_HOOK_SECRET: z.string().startsWith('v1,whsec_'),
    OTP_FALLBACK_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
    PHONE_HASH_KEY: z.string().min(32),
    MESSAGING_MODE: z.enum(['live', 'log']).default('log'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_GRAPH_VERSION: z.string().default('v26.0'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().default('local-otp'),
  })
  .superRefine((e, ctx) => {
    const need = (keys: (keyof typeof e)[], why: string) =>
      keys.filter((k) => !e[k]).forEach((k) => ctx.addIssue({ code: 'custom', path: [k], message: `required ${why}` }));
    if (e.NODE_ENV === 'production') {
      need(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], 'in production (functions are stateless)');
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
  messaging: MessagingDeps;
  verifyToken: TokenVerifier;
  config: {
    sendSmsHookSecret: string;
    phoneHashKey: string;
    whatsappAppSecret: string | null;
    whatsappVerifyToken: string | null;
  };
}

export function depsFromEnv(source: NodeJS.ProcessEnv = process.env): Deps {
  // Blank lines in .env files (FOO=) mean "not set", not "empty string".
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join(', ')}`);
  }
  const env = parsed.data;
  const kv =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? upstashKv(new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }))
      : memoryKv();
  const live = env.MESSAGING_MODE === 'live';
  return {
    kv,
    messaging: {
      kv,
      repo: drizzleMessagingRepo(createDb(env.DATABASE_URL)),
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
    },
  };
}
