// Starts throwaway Postgres (PostGIS) and Redis containers for the integration tests,
// applies the migrations, and points the API at them. Needs Docker.
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

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
    APPLE_TEAM_ID: 'TEAMID1234',
    ANDROID_CERT_SHA256:
      'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  });

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}

export async function teardown(): Promise<void> {
  await Promise.all([pg?.stop(), redis?.stop()]);
}
