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

  const r2 = {
    MEDIA_STORAGE: 'r2',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
    MEDIA_PUBLIC_BASE_URL: 'https://img.example.in',
  };

  it('can never be enabled in production', () => {
    expect(() =>
      loadEnv({ ...base, ...r2, NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true' }),
    ).toThrow(/never be enabled in production/);
  });

  it('production cannot use local media storage, and R2 needs its settings', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /MEDIA_STORAGE=local is for development only/,
    );
    expect(() => loadEnv({ ...base, MEDIA_STORAGE: 'r2' })).toThrow(
      /MEDIA_STORAGE=r2 needs R2_ACCOUNT_ID/,
    );
    expect(loadEnv({ ...base, ...r2, NODE_ENV: 'production' }).MEDIA_STORAGE).toBe('r2');
  });

  it('defaults to off', () => {
    expect(loadEnv(base).AUTH_DEV_BYPASS).toBe(false);
  });
});
