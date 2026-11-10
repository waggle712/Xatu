import { AnalyticsService, type AnalyticsClient } from './analytics.service.js';

const userId = '0196f0a0-0000-7000-8000-000000000001';

function fakeClient(overrides: Partial<AnalyticsClient> = {}) {
  const captured: unknown[] = [];
  const client: AnalyticsClient = {
    capture: (input) => void captured.push(input),
    shutdown: async () => undefined,
    ...overrides,
  };
  return { client, captured };
}

describe('AnalyticsService', () => {
  it('sends a valid event with the user id as distinct id', () => {
    const { client, captured } = fakeClient();
    new AnalyticsService(client).capture(userId, 'buyer_signed_up', { language: 'ta' });
    expect(captured).toEqual([
      { distinctId: userId, event: 'buyer_signed_up', properties: { language: 'ta' } },
    ]);
  });

  it('does nothing when analytics is not configured', () => {
    expect(() =>
      new AnalyticsService(null).capture(userId, 'buyer_signed_up', { language: 'en' }),
    ).not.toThrow();
  });

  it('drops invalid events instead of sending them', () => {
    const { client, captured } = fakeClient();
    new AnalyticsService(client).capture(userId, 'buyer_signed_up', {
      language: 'ta',
      phone: '+91',
    } as never);
    expect(captured).toEqual([]);
  });

  it('never throws when the client fails', () => {
    const { client } = fakeClient({
      capture: () => {
        throw new Error('PostHog down');
      },
    });
    expect(() =>
      new AnalyticsService(client).capture(userId, 'buyer_signed_up', { language: 'ta' }),
    ).not.toThrow();
  });
});
