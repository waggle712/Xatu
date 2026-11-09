import { Injectable } from '@nestjs/common';
import { type App, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../../config/env.js';

export interface VerifiedPhoneIdentity {
  firebaseUid: string;
  /** E.164, e.g. +919876543210. */
  phone: string;
}

/** Verifies a Firebase ID token from the app. Swapped for a fake in tests. */
export abstract class FirebaseVerifier {
  /** Throws if the token is invalid, expired, revoked, or has no verified phone number. */
  abstract verify(idToken: string): Promise<VerifiedPhoneIdentity>;
}

export class InvalidFirebaseTokenError extends Error {}

/**
 * Real verifier. Checking the signature needs only the project id (Google's public keys);
 * checking revocation needs Application Default Credentials (a service account) on the server.
 */
@Injectable()
export class FirebaseAdminVerifier extends FirebaseVerifier {
  private app: App | undefined;

  private getApp(): App {
    this.app ??=
      getApps().find((a) => a.name === 'xatu') ??
      initializeApp({ projectId: env.FIREBASE_PROJECT_ID }, 'xatu');
    return this.app;
  }

  async verify(idToken: string): Promise<VerifiedPhoneIdentity> {
    let decoded;
    try {
      // checkRevoked needs a service account; enable it once deployed with credentials.
      decoded = await getAuth(this.getApp()).verifyIdToken(idToken, env.NODE_ENV === 'production');
    } catch {
      throw new InvalidFirebaseTokenError('Firebase ID token is invalid or expired');
    }
    if (decoded.firebase.sign_in_provider !== 'phone' || !decoded.phone_number) {
      throw new InvalidFirebaseTokenError('Firebase token is not a phone sign-in');
    }
    return { firebaseUid: decoded.uid, phone: decoded.phone_number };
  }
}
