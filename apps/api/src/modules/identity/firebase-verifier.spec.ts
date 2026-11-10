import {
  DevFirebaseVerifier,
  FirebaseAdminVerifier,
  InvalidFirebaseTokenError,
} from './firebase-verifier.js';
import { loadEnv } from '../../config/env.js';

describe('FirebaseAdminVerifier', () => {
  it('rejects a token that is not a Firebase ID token', async () => {
    await expect(new FirebaseAdminVerifier().verify('not-a-token')).rejects.toBeInstanceOf(
      InvalidFirebaseTokenError,
    );
  });
});

describe('DevFirebaseVerifier', () => {
  const dev = new DevFirebaseVerifier();

  it('accepts an Indian mobile number with the fixed dev code', async () => {
    await expect(dev.verify('dev|+919876543210|123456')).resolves.toEqual({
      firebaseUid: 'dev-+919876543210',
      phone: '+919876543210',
    });
  });

  it.each([
    'dev|+919876543210|000000',
    'dev|+15551234567|123456',
    'dev|9876543210|123456',
    'ok|x|y',
  ])('rejects %s', async (token) => {
    await expect(dev.verify(token)).rejects.toBeInstanceOf(InvalidFirebaseTokenError);
  });
});

describe('AUTH_DEV_BYPASS', () => {
  const base = {
    DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    FIREBASE_PROJECT_ID: 'p',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('can never be enabled in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true' })).toThrow(
      /never be enabled in production/,
    );
  });

  it('defaults to off', () => {
    expect(loadEnv(base).AUTH_DEV_BYPASS).toBe(false);
  });
});
