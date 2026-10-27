import { describe, expect, it } from 'vitest';
import { depsFromEnv } from '../src/deps';

const base = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SEND_SMS_HOOK_SECRET: `v1,whsec_${Buffer.alloc(32, 7).toString('base64')}`,
  OTP_FALLBACK_KEY: Buffer.alloc(32, 9).toString('base64'),
  PHONE_HASH_KEY: 'k'.repeat(32),
  FIELD_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
};

describe('depsFromEnv', () => {
  it('treats blank .env values as unset', () => {
    expect(() => depsFromEnv({ ...base, UPSTASH_REDIS_REST_URL: '', SUPABASE_JWT_SECRET: '', MSG91_OTP_TEMPLATE_ID: '' })).not.toThrow();
  });

  it('requires Upstash in production (no in-memory state)', () => {
    expect(() => depsFromEnv({ ...base, NODE_ENV: 'production' })).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('refuses the HS256 secret in production', () => {
    expect(() => depsFromEnv({ ...base, NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', SUPABASE_JWT_SECRET: 's' })).toThrow(
      /SUPABASE_JWT_SECRET/,
    );
  });

  it('requires provider credentials for live messaging', () => {
    expect(() => depsFromEnv({ ...base, MESSAGING_MODE: 'live' })).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('rejects a fallback key that is not 32 bytes', () => {
    expect(() => depsFromEnv({ ...base, OTP_FALLBACK_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
});
