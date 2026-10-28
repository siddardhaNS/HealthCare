import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raiseWithRetry, RAISE_TIMEOUT_MS, type RaiseLoop } from '../lib/raise';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
const retryable = (e: unknown) => !(e instanceof HttpError) || e.status >= 500;
const offline = () => Promise.reject(new TypeError('Network request failed'));
/** Never answers until aborted (the request hangs on a dead network). */
const hang = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

function harness(attempt: RaiseLoop<string>['attempt']) {
  const log: string[] = [];
  let stop = false;
  const run = raiseWithRetry({
    attempt,
    retryable,
    onAttempt: (n) => log.push(`attempt ${n}`),
    onSlow: () => log.push('fallbacks shown'),
    stopped: () => stop,
  });
  return { run, log, stop: () => (stop = true) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('raising an SOS when the network or API is down', () => {
  it('API unreachable: shows the phone fallbacks at once, keeps retrying, and lands when the API is back', async () => {
    let up = false;
    const { run, log } = harness(async () => (up ? 'incident-1' : offline()));
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['attempt 1', 'fallbacks shown']);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    expect(log.filter((l) => l.startsWith('attempt'))).toHaveLength(4);
    up = true;
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(run).resolves.toEqual({ status: 'sent', value: 'incident-1' });
    expect(log.filter((l) => l === 'fallbacks shown')).toHaveLength(1);
  });

  it('a request that hangs is abandoned after 4 s, with the fallbacks shown at that moment', async () => {
    let calls = 0;
    const { run, log } = harness((signal) => (++calls === 1 ? hang(signal) : Promise.resolve('incident-1')));
    await vi.advanceTimersByTimeAsync(RAISE_TIMEOUT_MS - 1);
    expect(log).toEqual(['attempt 1']);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(['attempt 1', 'fallbacks shown']);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(run).resolves.toEqual({ status: 'sent', value: 'incident-1' });
  });

  it('a fast answer never shows the fallbacks', async () => {
    const { run, log } = harness(async () => 'incident-1');
    await expect(run).resolves.toEqual({ status: 'sent', value: 'incident-1' });
    expect(log).toEqual(['attempt 1']);
  });

  it('server errors are retried; a refusal (e.g. 429) stops at once and leaves only the phone fallbacks', async () => {
    let calls = 0;
    const { run } = harness(async () => {
      calls++;
      throw new HttpError(calls === 1 ? 503 : 429);
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(run).resolves.toMatchObject({ status: 'refused' });
    expect(calls).toBe(2);
  });

  it('keeps retrying every 15 s for as long as the screen is open, and stops when it closes', async () => {
    const { run, log, stop } = harness(offline);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 15_000 * 4);
    expect(log.filter((l) => l.startsWith('attempt')).length).toBe(9);
    stop();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(run).resolves.toEqual({ status: 'stopped' });
  });
});
