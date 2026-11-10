/**
 * Feed and search latency benchmark (prompt 12 target: feed API p95 < 200 ms).
 *
 * Seeds about 5,000 live products across 250 shops around Trichy into a THROWAWAY database, boots
 * the real API in-process, and measures over HTTP. Never point it at a real database.
 *
 *   createdb xatu_bench   (or: docker exec <db> psql -U xatu -d postgres -c "CREATE DATABASE xatu_bench")
 *   BENCH_DATABASE_URL=postgresql://xatu:...@localhost:5434/xatu_bench pnpm --filter api bench:feed
 */
import { randomUUID } from 'node:crypto';

const benchUrl = process.env.BENCH_DATABASE_URL;
if (!benchUrl || !/bench/.test(benchUrl)) {
  console.error('Set BENCH_DATABASE_URL to a throwaway database whose name contains "bench".');
  process.exit(1);
}
process.env.DATABASE_URL = benchUrl;
process.env.RUN_WORKERS = 'false';

const SHOPS = 250;
const PRODUCTS_PER_SHOP = 20;
const TRICHY = { lat: 10.81, lng: 78.69 };
const jitter = (km: number) => (Math.random() * 2 - 1) * (km / 111);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function main() {
  const { execFileSync } = await import('node:child_process');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });

  // The compiled app (`pnpm build`): Nest needs decorator metadata, which tsx does not emit.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/src/app.module.js');
  const { configureApp } = await import('../dist/src/app.setup.js');
  const { PrismaService } = await import('../dist/src/prisma/prisma.service.js');
  const { REDIS } = await import('../dist/src/redis/redis.module.js');
  const { RATE_LIMIT_KEY_PREFIX } = await import('../dist/src/common/rate-limit.js');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app);
  await app.listen(0);
  const base = await app.getUrl();
  const prisma = app.get(PrismaService);
  const redis = app.get(REDIS) as import('ioredis').Redis;
  // Every request comes from one IP here; reset the per-IP limits so they don't stop the run.
  const clearLimits = async () => {
    const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}discovery:*`);
    if (keys.length) await redis.del(...keys);
  };

  if ((await prisma.product.count()) < SHOPS * PRODUCTS_PER_SHOP) {
    console.log('Seeding…');
    const category = await prisma.category.upsert({
      where: { slug: 'terracotta' },
      update: {},
      create: { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
    });
    const words = ['Diya set', 'Clay pot', 'Murukku', 'Planter', 'Cake', 'Henna cone', 'Earrings'];
    const tamil = ['அகல் விளக்கு', 'மண் பானை', 'முறுக்கு', 'தொட்டி', 'கேக்', 'மருதாணி', 'கம்மல்'];
    for (let s = 0; s < SHOPS; s++) {
      const userId = randomUUID();
      const sellerId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          firebaseUid: `bench-${userId}`,
          phone: `+91bench${s}`,
          roles: ['seller'],
        },
      });
      await prisma.sellerProfile.create({
        data: {
          id: sellerId,
          userId,
          handle: `bench_${s}`,
          businessName: `Bench Maker ${s}`,
          city: 'Trichy',
          status: 'active',
          verificationStatus: Math.random() < 0.3 ? 'verified' : 'unverified',
          categoryId: category.id,
        },
      });
      const lat = TRICHY.lat + jitter(30);
      const lng = TRICHY.lng + jitter(30);
      await prisma.$executeRaw`
        UPDATE seller_profiles
        SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            approx_location = ST_SetSRID(ST_MakePoint(${Math.round(lng * 100) / 100}, ${Math.round(lat * 100) / 100}), 4326)::geography
        WHERE id = ${sellerId}::uuid`;
      for (let p = 0; p < PRODUCTS_PER_SHOP; p++) {
        const w = Math.floor(Math.random() * words.length);
        await prisma.product.create({
          data: {
            sellerId,
            categoryId: category.id,
            title: `${words[w]} ${s}-${p}`,
            titleTa: tamil[w],
            status: 'active',
            moderationStatus: 'live',
            publishedAt: new Date(Date.now() - Math.random() * 60 * 86_400_000),
            variants: { create: { pricePaise: BigInt(10000 + p * 500), stock: 10 } },
          },
        });
      }
    }
    await prisma.$executeRaw`ANALYZE`;
  }
  console.log(
    `Products: ${await prisma.product.count()}, shops: ${await prisma.sellerProfile.count()}`,
  );

  async function time(path: string): Promise<{ ms: number; body: { nextCursor?: string | null } }> {
    await clearLimits();
    const start = performance.now();
    const res = await fetch(`${base}${path}`);
    const body = (await res.json()) as { nextCursor?: string | null };
    if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(body)}`);
    return { ms: performance.now() - start, body };
  }
  const point = () =>
    `lat=${(TRICHY.lat + jitter(15)).toFixed(2)}&lng=${(TRICHY.lng + jitter(15)).toFixed(2)}`;

  for (let i = 0; i < 20; i++) await time(`/feed?${point()}`); // warm up

  const feedFirst: number[] = [];
  const feedNext: number[] = [];
  const search: number[] = [];
  for (let i = 0; i < 300; i++) {
    const p = point();
    const first = await time(`/feed?${p}`);
    feedFirst.push(first.ms);
    if (first.body.nextCursor) {
      feedNext.push((await time(`/feed?${p}&cursor=${first.body.nextCursor}`)).ms);
    }
    if (i % 4 === 0) {
      const q = ['murukku', 'diya', encodeURIComponent('முறுக்கு'), 'bench maker 12'][
        (i % 16) / 4
      ]!;
      search.push((await time(`/search?q=${q}&${p}`)).ms);
    }
  }
  const report = (name: string, v: number[]) =>
    console.log(
      `${name.padEnd(18)} n=${String(v.length).padStart(3)}  p50 ${percentile(v, 50).toFixed(1)} ms  p95 ${percentile(v, 95).toFixed(1)} ms  p99 ${percentile(v, 99).toFixed(1)} ms`,
    );
  report('feed (page 1)', feedFirst);
  report('feed (page 2)', feedNext);
  report('search', search);

  const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`
    EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
    SELECT p.id FROM products p JOIN seller_profiles s ON s.id = p.seller_id
    WHERE p.status = 'active' AND p.moderation_status = 'live' AND s.status = 'active'
      AND ST_DWithin(s.approx_location, ST_SetSRID(ST_MakePoint(78.69, 10.81), 4326)::geography, 25000)`);
  console.log('\nRadius filter plan:\n' + plan.map((r) => r['QUERY PLAN']).join('\n'));

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
