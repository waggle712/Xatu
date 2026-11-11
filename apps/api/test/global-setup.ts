// Starts throwaway Postgres (PostGIS) and Redis containers for the integration tests,
// applies the migrations, and points the API at them. Needs Docker.
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg_ from 'pg';

const { Client } = pg_;

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(): Promise<void> {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer('imresamu/postgis:16-3.5')
      .withDatabase('xatu_test')
      .withUsername('xatu')
      .withPassword('xatu_test')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  // Set before any test file loads src/config/env.ts; dotenv never overrides these.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    FIREBASE_PROJECT_ID: 'xatu-test',
    JWT_SECRET: 'test-only-secret-that-is-long-enough-1234567890',
    AUTH_DEV_BYPASS: 'true',
    MEDIA_STORAGE: 'local',
    MEDIA_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'xatu-media-')),
    PUBLIC_API_URL: 'http://media.test',
    RUN_WORKERS: 'true',
    PUBLIC_WEB_URL: 'https://links.test',
    // Fake test-mode values: the tests replace the Razorpay client with a fake; nothing leaves.
    RAZORPAY_KEY_ID: 'rzp_test_FakeKeyForTests',
    RAZORPAY_KEY_SECRET: 'fake-test-secret',
    RAZORPAY_WEBHOOK_SECRET: 'fake-webhook-secret-for-tests',
    APPLE_TEAM_ID: 'TEAMID1234',
    ANDROID_CERT_SHA256:
      'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  });

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

  // Run the app under the production grants: a login user in the xatu_app role, which may only
  // SELECT and INSERT on ledger tables. Migrations above ran as the owner.
  const appUser = 'xatu_app_test';
  const appPassword = 'app_test_only_password';
  const owner = new Client({ connectionString: pg.getConnectionUri() });
  await owner.connect();
  await owner.query(`CREATE ROLE ${appUser} LOGIN PASSWORD '${appPassword}' IN ROLE xatu_app`);
  await owner.end();

  const url = new URL(pg.getConnectionUri());
  url.username = appUser;
  url.password = appPassword;
  process.env.DATABASE_URL = url.toString();
  process.env.DATABASE_OWNER_URL = pg.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await Promise.all([pg?.stop(), redis?.stop()]);
}
