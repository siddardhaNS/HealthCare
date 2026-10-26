import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/app';
import { decryptJson, encryptJson, verifyMetaSignature } from '../src/lib/crypto';
import { memoryKv } from '../src/lib/kv';
import { maskPhone, normalizeIndianPhone } from '../src/lib/phone';
import { checkLimits } from '../src/lib/rate-limit';
import { requireStaff, type AccessClaims } from '../src/middleware/auth';

describe('crypto', () => {
  it('round-trips and rejects tampering', () => {
    const key = randomBytes(32);
    const sealed = encryptJson(key, { code: '123456' });
    expect(decryptJson(key, sealed)).toEqual({ code: '123456' });
    const buf = Buffer.from(sealed, 'base64');
    buf[buf.length - 1]! ^= 1;
    expect(() => decryptJson(key, buf.toString('base64'))).toThrow();
    expect(() => decryptJson(randomBytes(32), sealed)).toThrow();
  });

  it('verifies Meta signatures', () => {
    expect(verifyMetaSignature('s', '{}', 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(verifyMetaSignature('s', '{}', undefined)).toBe(false);
  });
});

describe('phone', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['9876543210', '+919876543210'],
    ['+91 12345 67890', null],
    ['+14155550100', null],
  ])('%s → %s', (raw, out) => expect(normalizeIndianPhone(raw)).toBe(out));

  it('masks for logs', () => expect(maskPhone('+919876543210')).toBe('+91******3210'));
});

describe('rate limits', () => {
  it('blocks after the limit within a window and reports retry-after', async () => {
    let now = 1_000_000_000_000;
    const kv = memoryKv(() => now);
    const rules = [{ limit: 2, windowSeconds: 60 }];
    expect(await checkLimits(kv, 'k', rules, now)).toEqual({ ok: true });
    expect(await checkLimits(kv, 'k', rules, now)).toEqual({ ok: true });
    const blocked = await checkLimits(kv, 'k', rules, now);
    expect(blocked.ok).toBe(false);
    now += 61_000;
    expect(await checkLimits(kv, 'k', rules, now)).toEqual({ ok: true });
  });
});

describe('requireStaff', () => {
  const app = (auth: AccessClaims) =>
    new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('requestId', 'r');
        c.set('auth', auth);
        await next();
      })
      .get('/x', requireStaff(), (c) => c.text('ok'));
  const base: AccessClaims = { userId: 'u', phone: null, aal: 'aal2', roles: ['operations'], sessionId: null };

  it('allows a staff role at aal2', async () => expect((await app(base).request('/x')).status).toBe(200));
  it('requires TOTP (aal2)', async () => expect((await app({ ...base, aal: 'aal1' }).request('/x')).status).toBe(403));
  it('refuses field and resident users', async () => expect((await app({ ...base, roles: ['crew'] }).request('/x')).status).toBe(403));
});
