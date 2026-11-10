import {
  type AnalyticsEventName,
  type AnalyticsEventProps,
  FEATURE_FLAGS,
  type FeatureFlag,
  parseAnalyticsEvent,
} from '@xatu/shared';
import PostHog, { useFeatureFlag as usePostHogFlag } from 'posthog-react-native';

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/**
 * PostHog client, or null when no key is configured (local development).
 * Privacy: no autocapture, no session replay, no geo-IP, person profiles only for
 * signed-in users, and the distinct id is the Xatu user id, never a phone number.
 */
export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, {
      host,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableGeoip: true,
      personProfiles: 'identified_only',
      preloadFeatureFlags: true,
    })
  : null;

/** Sends a typed pilot event. Never throws; analytics can't break a screen. */
export function track<E extends AnalyticsEventName>(event: E, props: AnalyticsEventProps<E>): void {
  if (!posthog) return;
  try {
    posthog.capture(event, parseAnalyticsEvent(event, props));
  } catch (err) {
    if (__DEV__) console.warn(`Analytics event ${event} dropped`, err);
  }
}

export function identifyUser(userId: string, language: 'ta' | 'en'): void {
  try {
    posthog?.identify(userId, { language });
  } catch {
    // ignore: analytics is best effort
  }
}

export function resetAnalytics(): void {
  try {
    posthog?.reset();
  } catch {
    // ignore
  }
}

/** Typed feature flag. Off by default, and always off without PostHog. */
export const useFeatureFlag: (flag: FeatureFlag) => boolean = posthog
  ? (flag) => {
      const value = usePostHogFlag(FEATURE_FLAGS[flag].key, posthog ?? undefined);
      return value === undefined
        ? FEATURE_FLAGS[flag].default
        : value === true || typeof value === 'string';
    }
  : (flag) => FEATURE_FLAGS[flag].default;
