# mobile

The Xatu app for Android and iOS: Expo SDK 58, Expo Router, TypeScript. It uses a **development build** (not Expo Go) because phone login uses native Firebase.

```
app/                  routes (file = screen)
  (auth)/             welcome + language, phone number, OTP code
  (tabs)/             home, discover, create, orders, profile
src/
  features/auth/      phone auth (Firebase or dev mode), auth API calls
  components/         Screen, TabBar (marigold hive Create), TextField...
  lib/                API client (auto refresh), i18n, secure storage, phone helpers
  store/              Zustand session store
  locales/            ta.json, en.json (every string in both)
```

Brand tokens, fonts and shared components come from `@xatu/ui`; never paste hex values into screens.

## Run it

You need Node 24, pnpm, and the API running (`pnpm db:up`, then `pnpm --filter api dev` with `AUTH_DEV_BYPASS=true` in `apps/api/.env`).

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

### On your Android phone (USB)

1. On the phone: **Settings → About phone → tap Build number 7 times**, then **Settings → System → Developer options → USB debugging: on**. Plug it in and accept the prompt.
2. Install Android Studio once (it brings the Android SDK and Java). In your shell profile:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   ```
3. Let the phone reach the API and Metro on your Mac through the cable:
   ```bash
   adb reverse tcp:3000 tcp:3000 && adb reverse tcp:8081 tcp:8081
   ```
4. Build and install the development build (first time takes several minutes; afterwards only when native dependencies change):
   ```bash
   pnpm --filter mobile android
   ```
5. Next time just start Metro and open the installed Xatu app: `pnpm --filter mobile start`.

Over Wi-Fi instead of USB: set `EXPO_PUBLIC_API_URL=http://<your-Mac-LAN-IP>:3000` in `apps/mobile/.env` and keep the phone on the same network.

Without a Mac build: `npx eas-cli build --profile development --platform android` builds an installable APK in the cloud (needs an Expo account).

### iOS simulator

Needs Xcode with the iOS platform (`xcodebuild -downloadPlatform iOS`), then `pnpm --filter mobile ios`.

## Feature flags in development

Features ship behind PostHog flags. Without PostHog, turn them on locally in `apps/mobile/.env`:

```
EXPO_PUBLIC_FLAG_OVERRIDES=seller_onboarding
```

Restart Metro after changing `.env`. Overrides are ignored in release builds.

## Maps

The shop pickup picker uses Apple Maps on iOS. On Android it needs `GOOGLE_MAPS_ANDROID_API_KEY` (Maps SDK for Android, restricted to `in.xatu.app`) at build time; without it the screen offers "Use my current location" instead of a map.

## Login modes

- **Development** (default): with no Firebase files, no SMS is sent. Any Indian mobile number and code **123456** sign in, through the API's `AUTH_DEV_BYPASS`. The code screen says so.
- **Firebase**: put `google-services.json` and `GoogleService-Info.plist` in `apps/mobile/` (see `docs/firebase-setup.md`) and rebuild. The app then sends real SMS codes (or uses Firebase test numbers).

## Checks

`pnpm --filter mobile typecheck`, `pnpm --filter mobile lint`, `pnpm --filter mobile test`, `npx expo-doctor`.

Tamil strings in `src/locales/ta.json` are a first draft and must be checked by a native speaker on the team before release.
