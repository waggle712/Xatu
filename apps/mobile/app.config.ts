/// <reference types="node" />
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { APP_NAME } from '@xatu/config/brand';

// Firebase native config files are git-ignored; each developer downloads their own
// (docs/firebase-setup.md). Without them the app builds in development login mode.
const androidFirebase = resolve(__dirname, 'google-services.json');
const iosFirebase = resolve(__dirname, 'GoogleService-Info.plist');
const hasFirebase = existsSync(androidFirebase) && existsSync(iosFirebase);

const BUNDLE_ID = 'in.xatu.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: 'xatu',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'xatu',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
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
  },
});
