import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry';

describe('scrubSentryEvent', () => {
  it('drops user, extra, query strings, headers and bodies', () => {
    const event = {
      message: 'boom',
      user: { id: 'u1', phone: '+919876543210' },
      extra: { vitals: { bp: '180/120' } },
      request: { method: 'POST', url: 'https://api.example/v1/x?phone=919876543210', data: '{"bp":"180/120"}', headers: { authorization: 'Bearer t' } },
      contexts: { state: { form: 'x' }, os: { name: 'Android' } },
    };
    expect(scrubSentryEvent(event)).toEqual({
      message: 'boom',
      request: { method: 'POST', url: 'https://api.example/v1/x' },
      contexts: { os: { name: 'Android' } },
    });
  });
});
