import type { Redis } from '@upstash/redis';

/** Short-lived shared state (rate limits, OTP intents, fallback payloads). */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Increments a counter that expires `ttlSeconds` after its first hit; returns the new count. */
  hit(key: string, ttlSeconds: number): Promise<number>;
}

export function upstashKv(redis: Redis): Kv {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, { ex: ttlSeconds });
    },
    del: async (key) => {
      await redis.del(key);
    },
    hit: async (key, ttlSeconds) => {
      const [count] = await redis.multi().incr(key).expire(key, ttlSeconds, 'NX').exec<[number, 0 | 1]>();
      return count;
    },
  };
}

/**
 * In-process store for tests and single-process local development only.
 * Production must use Upstash: functions are stateless.
 */
export function memoryKv(now: () => number = Date.now): Kv {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const live = (key: string) => {
    const e = store.get(key);
    if (e && e.expiresAt <= now()) store.delete(key);
    return store.get(key);
  };
  return {
    get: async <T>(key: string) => (live(key)?.value as T | undefined) ?? null,
    set: async (key, value, ttlSeconds) => {
      store.set(key, { value: structuredClone(value), expiresAt: now() + ttlSeconds * 1000 });
    },
    del: async (key) => {
      store.delete(key);
    },
    hit: async (key, ttlSeconds) => {
      const e = live(key);
      const count = ((e?.value as number | undefined) ?? 0) + 1;
      store.set(key, { value: count, expiresAt: e?.expiresAt ?? now() + ttlSeconds * 1000 });
      return count;
    },
  };
}
