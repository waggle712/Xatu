import { renderHook } from '@testing-library/react-native';
import { posthog, track, useFeatureFlag } from './analytics';

// No EXPO_PUBLIC_POSTHOG_KEY in tests: analytics must be fully switched off.
describe('analytics without a PostHog key', () => {
  it('has no client', () => {
    expect(posthog).toBeNull();
  });

  it('track() is a safe no-op', () => {
    expect(() => track('buyer_signed_up', { language: 'ta' })).not.toThrow();
  });

  it('feature flags stay off', async () => {
    const { result } = await renderHook(() => [
      useFeatureFlag('checkout'),
      useFeatureFlag('seller_onboarding'),
    ]);
    expect(result.current).toEqual([false, false]);
  });
});
