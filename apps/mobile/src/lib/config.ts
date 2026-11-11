import Constants from 'expo-constants';

/** Base URL of the Xatu API. Set EXPO_PUBLIC_API_URL in apps/mobile/.env. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/** 'firebase' when the native Firebase config files were present at build time, else 'dev'. */
export const AUTH_MODE: 'firebase' | 'dev' =
  (Constants.expoConfig?.extra as { authMode?: 'firebase' | 'dev' } | undefined)?.authMode ?? 'dev';

/**
 * Base of share links (https://<domain>/p/<id>). Set EXPO_PUBLIC_WEB_URL to the link domain
 * before launch; until then links point at the API, which serves the same preview pages.
 */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || API_URL).replace(/\/$/, '');
