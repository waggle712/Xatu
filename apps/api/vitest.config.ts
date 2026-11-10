import { defineConfig } from 'vitest/config';

// Unit tests need no database or Redis; these values only satisfy the env schema.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unit:unit@localhost:1/unit',
      REDIS_URL: 'redis://localhost:1',
      FIREBASE_PROJECT_ID: 'xatu-test',
      JWT_SECRET: 'unit-test-secret-that-is-long-enough-123456',
      AUTH_DEV_BYPASS: 'false',
    },
  },
});
