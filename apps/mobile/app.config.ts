/// <reference types="node" />
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { APP_ID, APP_NAME, APP_SCHEME } from '@xatu/config/brand';

// Firebase native config files are git-ignored; each developer downloads their own
// (docs/firebase-setup.md). Without them the app builds in development login mode.
const androidFirebase = resolve(__dirname, 'google-services.json');
const iosFirebase = resolve(__dirname, 'GoogleService-Info.plist');
const hasFirebase = existsSync(androidFirebase) && existsSync(iosFirebase);

const BUNDLE_ID = APP_ID;

// Google Maps on Android needs an API key (Maps SDK for Android, restricted to this app).
// Without it the pickup picker falls back to "use my current location". iOS uses Apple Maps.
const googleMapsAndroidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '';

// Share links (prompt 13): https://<domain>/p/<id> and /s/<handle> open the app once the domain
// serves /.well-known/apple-app-site-association and assetlinks.json (the API does, from
// APPLE_TEAM_ID and ANDROID_CERT_SHA256). Unset until the domain is chosen: links then open the
// web preview page, which has an "Open in app" button (xatu://).
const linkHost = (() => {
  const url = process.env.EXPO_PUBLIC_WEB_URL ?? '';
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
})();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: 'xatu',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: APP_SCHEME,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    ...(linkHost ? { associatedDomains: [`applinks:${linkHost}`] } : {}),
    ...(hasFirebase ? { googleServicesFile: './GoogleService-Info.plist' } : {}),
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#3A2230',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(linkHost
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                { scheme: 'https', host: linkHost, pathPrefix: '/p/' },
                { scheme: 'https', host: linkHost, pathPrefix: '/s/' },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
    ...(googleMapsAndroidKey ? { config: { googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
    ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
  },
  web: {
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Your location is used to set your shop pickup point. Buyers only see your area.',
      },
    ],
    ['expo-maps', { requestLocationPermission: true }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Your photos are used for your shop and product pictures.',
        cameraPermission: 'The camera is used to photograph your products and shop.',
        microphonePermission: false,
      },
    ],
    // Native crash reporting. Source maps upload only when SENTRY_AUTH_TOKEN is set (EAS secrets).
    [
      '@sentry/react-native/expo',
      { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FCF8F1',
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
        dark: { backgroundColor: '#1E1218', image: './assets/images/splash-icon.png' },
      },
    ],
    [
      'expo-build-properties',
      {
        // React Native Firebase resolves the Firebase Apple SDK with SPM, which needs dynamic frameworks.
        ios: { useFrameworks: 'dynamic' },
        // Firebase Android SDK (BoM 35) ships Kotlin 2.4 metadata; the default 2.2 cannot read it.
        android: { kotlinVersion: '2.4.0' },
      },
    ],
    ...(hasFirebase ? ['@react-native-firebase/app', '@react-native-firebase/auth'] : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    /** 'firebase' when the native Firebase files are present, otherwise 'dev' (API AUTH_DEV_BYPASS). */
    authMode: hasFirebase ? 'firebase' : 'dev',
    googleMapsConfigured: googleMapsAndroidKey !== '',
  },
});
