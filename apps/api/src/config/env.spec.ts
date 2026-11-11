import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FIREBASE_PROJECT_ID: 'p',
  JWT_SECRET: 'x'.repeat(40),
};

describe('payment settings', () => {
  it('refuses live Razorpay keys (test mode only until launch sign-off)', () => {
    expect(() =>
      loadEnv({ ...base, RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's' }),
    ).toThrow(/live Razorpay keys are refused/);
    expect(() =>
      loadEnv({ ...base, RAZORPAY_KEY_ID: 'something_else', RAZORPAY_KEY_SECRET: 's' }),
    ).toThrow(/test key/);
  });

  it('needs both key id and secret, or neither', () => {
    expect(() => loadEnv({ ...base, RAZORPAY_KEY_ID: 'rzp_test_abc' })).toThrow(/both/);
    expect(loadEnv({ ...base }).RAZORPAY_KEY_ID).toBe('');
    expect(
      loadEnv({ ...base, RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 's' })
        .RAZORPAY_KEY_ID,
    ).toBe('rzp_test_abc');
  });
});
