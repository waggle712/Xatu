# Firebase phone login: settings to configure by hand

The app signs in with Firebase phone OTP. The API never sees the OTP: it verifies the Firebase ID token (`POST /auth/session`) and issues its own access token (15 minutes) and refresh token (30 days, rotated on every use).

Do this once for a **dev** project (`xatu-dev`) and again later for **prod** (`xatu-prod`).

## 1. Project and phone sign-in

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**. Google Analytics is not needed (we use PostHog).
2. **Build → Authentication → Get started → Sign-in method → Phone → Enable.**
3. Same page, **Phone numbers for testing**: add a few fake numbers with fixed codes, for example `+91 90000 00099` / `123456`. They never send an SMS and work on any plan. Use these for development and store review.
4. **Authentication → Settings → SMS region policy → Allow** only **India (+91)**. This blocks SMS-pumping fraud from other countries.
5. Real SMS needs the **Blaze (pay-as-you-go)** plan. Set a budget alert in Google Cloud Billing before switching.

## 2. Android app

1. **Project settings → Your apps → Add app → Android.** Package name: `in.xatu.app` (must match `android.package` in `apps/mobile/app.config.ts`).
2. Add the **SHA-1 and SHA-256** fingerprints:
   - local debug builds: `cd apps/mobile/android && ./gradlew signingReport` (after `npx expo prebuild`), or `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`
   - EAS builds: `eas credentials` → Android → copy both fingerprints
   - Play Store: Play Console → App integrity → App signing key certificate
3. In Google Cloud console for the same project, enable the **Play Integrity API** (Firebase uses it to confirm the request comes from your real app; without it users see a reCAPTCHA page).
4. Download **google-services.json** and put it at `apps/mobile/google-services.json`. It is git-ignored; each developer downloads their own.

## 3. iOS app

1. **Add app → iOS.** Bundle ID: `in.xatu.app` (matches `ios.bundleIdentifier`).
2. Download **GoogleService-Info.plist** to `apps/mobile/GoogleService-Info.plist` (git-ignored).
3. **Project settings → Cloud Messaging → Apple app configuration → upload an APNs Authentication Key** (from developer.apple.com → Keys, with Apple Push Notifications enabled). Firebase uses a silent push to verify the device; without it iOS falls back to a reCAPTCHA page. Needs a paid Apple Developer account.

## 4. API settings (`apps/api/.env`)

| Variable              | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID` | Project settings → General → Project ID                                                           |
| `JWT_SECRET`          | `openssl rand -base64 48`; different per environment, kept in AWS Secrets Manager in staging/prod |

Verifying the token signature needs only the project ID. In **production** the API also checks whether the Firebase token was revoked, which needs a service account: give the App Runner/ECS task a Google service-account key through Secrets Manager and set `GOOGLE_APPLICATION_CREDENTIALS`. Never commit the key.

## 5. What the API enforces

- Only `phone` sign-ins are accepted; tokens without a verified phone number are rejected.
- A Firebase user with the same phone as an existing account (for example a maker the team onboarded) is linked to that account.
- Refresh tokens are stored as SHA-256 hashes. Reusing an already-rotated refresh token revokes every session of that user.
- Suspended or deleted accounts cannot sign in or call protected endpoints.
- Rate limits (per IP, Redis): `POST /auth/session` 10/min, `/auth/refresh` 30/min, `/auth/logout` 30/min.
