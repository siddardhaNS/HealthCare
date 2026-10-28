// The SOS raise loop, kept free of React and React Native so it is unit
// tested (test/raise.test.ts). Plan §3.2: never block the person on the
// network. Every attempt reuses the caller's idempotency key, gives up after
// 4 s, and the loop keeps retrying until it lands, is refused for good, or
// the screen goes away.

/** Brief: offer the phone fallbacks if raising takes longer than this. */
export const RAISE_TIMEOUT_MS = 4_000;
/** Delays after a failed attempt; the last one repeats. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export type RaiseOutcome<T> = { status: 'sent'; value: T } | { status: 'refused'; error: unknown } | { status: 'stopped' };

export interface RaiseLoop<T> {
  /** One request. Must honour the signal (aborted at the timeout) and throw on failure. */
  attempt(signal: AbortSignal): Promise<T>;
  /** False for answers that will not change on retry (e.g. 429, 400). */
  retryable(error: unknown): boolean;
  /** Each attempt starting, 1-based. */
  onAttempt?(n: number): void;
  /** The first attempt was slow or failed: show the phone fallbacks. Called once. */
  onSlow(): void;
  /** True once nobody is waiting any more (screen closed). */
  stopped(): boolean;
  timeoutMs?: number;
  delaysMs?: readonly number[];
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function raiseWithRetry<T>(loop: RaiseLoop<T>): Promise<RaiseOutcome<T>> {
  const timeoutMs = loop.timeoutMs ?? RAISE_TIMEOUT_MS;
  const delays = loop.delaysMs ?? RETRY_DELAYS_MS;
  let slow = false;
  const markSlow = () => {
    if (slow) return;
    slow = true;
    loop.onSlow();
  };

  for (let n = 1; !loop.stopped(); n++) {
    loop.onAttempt?.(n);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      markSlow();
      abort.abort();
    }, timeoutMs);
    try {
      const value = await loop.attempt(abort.signal);
      return { status: 'sent', value };
    } catch (error) {
      if (!loop.retryable(error)) return { status: 'refused', error };
      markSlow();
    } finally {
      clearTimeout(timer);
    }
    await wait(delays[Math.min(n - 1, delays.length - 1)]!);
  }
  return { status: 'stopped' };
}
