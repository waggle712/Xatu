import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` needs no database, so a fresh clone (or CI) can install without
    // DATABASE_URL. Migrate and seed commands fail clearly if it is missing.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:1/DATABASE_URL_is_not_set',
  },
});
