import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Crash and error reporting. Disabled when no DSN is set (local development). */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    release: `xatu@${Constants.expoConfig?.version ?? '0.0.0'}`,
    // DPDP: no IP, no user details beyond the id we set, no screenshots or view trees.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    reportAccessibilityIdentifier: false,
    tracesSampleRate: 0,
    beforeBreadcrumb(breadcrumb) {
      // HTTP breadcrumbs carry URLs; keep the method and status, drop query strings.
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        const url =
          typeof breadcrumb.data?.url === 'string' ? breadcrumb.data.url.split('?')[0] : undefined;
        return { ...breadcrumb, data: { ...breadcrumb.data, url } };
      }
      return breadcrumb;
    },
  });
}

export function setSentryUser(userId: string | null): void {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

export { Sentry };
