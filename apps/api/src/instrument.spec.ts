import type { ErrorEvent } from '@sentry/nestjs';
import { scrubSentryEvent } from './instrument.js';

describe('scrubSentryEvent', () => {
  it('removes bodies, cookies, auth headers and user details', () => {
    const event = scrubSentryEvent({
      type: undefined,
      request: {
        data: '{"firebaseIdToken":"secret"}',
        cookies: { a: 'b' },
        query_string: 'phone=9876543210',
        headers: { Authorization: 'Bearer x', 'Idempotency-Key': 'k', 'User-Agent': 'app' },
      },
      user: { id: 'u1', ip_address: '1.2.3.4', username: '+919876543210' },
    } as ErrorEvent);
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toEqual({
      Authorization: '[redacted]',
      'Idempotency-Key': '[redacted]',
      'User-Agent': 'app',
    });
    expect(event.user).toEqual({ id: 'u1' });
  });
});
