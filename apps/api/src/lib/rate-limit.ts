import type { Kv } from './kv';

export interface LimitRule {
  limit: number;
  windowSeconds: number;
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Fixed-window limits; every rule must pass. */
export async function checkLimits(kv: Kv, key: string, rules: LimitRule[], now: number = Date.now()): Promise<LimitResult> {
  let retryAfterSeconds = 0;
  for (const { limit, windowSeconds } of rules) {
    const window = Math.floor(now / 1000 / windowSeconds);
    const count = await kv.hit(`rl:${key}:${windowSeconds}:${window}`, windowSeconds);
    if (count > limit) {
      const windowEnds = (window + 1) * windowSeconds;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(windowEnds - now / 1000));
    }
  }
  return retryAfterSeconds > 0 ? { ok: false, retryAfterSeconds } : { ok: true };
}
