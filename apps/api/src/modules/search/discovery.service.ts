import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type FeedItem,
  type FeedPage,
  type FeedQuery,
  FEED_PAGE_SIZE,
  hasTamil,
  type NearbyMaker,
  normaliseQuery,
  roundPoint,
  type SearchPage,
  type SearchQuery,
  TRICHY_CENTRE,
} from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import { paiseToNumber } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';

/** Search stays local: products within this distance of the buyer (or Trichy centre). */
export const SEARCH_RADIUS_KM = 50;
const MAX_MAKERS = 50;
const MAX_TERMS = 6;

interface Row {
  id: string;
  title: string;
  title_ta: string | null;
  description: string | null;
  description_ta: string | null;
  made_to_order: boolean;
  handle: string;
  business_name: string;
  verified: boolean;
  area_name: string | null;
  city: string;
  meters: number;
  min_price: bigint;
  total_stock: number;
  variant_count: number;
  media_id: string | null;
  score: bigint;
}

interface Cursor {
  v: 1;
  kind: 'feed' | 'search';
  asOf: string;
  lat: number;
  lng: number;
  r: number;
  c: string | null;
  q: string | null;
  s: string;
  id: string;
}

/**
 * Discovery read model: the home feed, search and the maker map.
 *
 * DOCUMENTED EXCEPTION to "modules never read another module's tables": for speed (feed p95 under
 * 200 ms) these read-only queries join catalog (products, variants, photos) and profiles
 * (seller_profiles) in SQL. They read public columns only, and only `approx_location`, never the
 * exact point. What "visible to buyers" means lives in `VISIBLE` below; a test checks every feed
 * and search result also opens through the catalog's own product page.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async feed(query: FeedQuery): Promise<FeedPage> {
    const origin = this.origin(query);
    const category = query.category ?? null;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      this.checkCursor(cursor, {
        kind: 'feed',
        ...origin,
        r: query.radiusKm,
        c: category,
        q: null,
      });
    }
    const asOf = cursor ? new Date(cursor.asOf) : new Date();
    const radiusM = query.radiusKm * 1000;
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography`;
    const categoryFilter = category
      ? Prisma.sql`AND p.category_id = (SELECT id FROM categories WHERE slug = ${category})`
      : Prisma.empty;

    // 50% nearness (halves at 3 km), 30% freshness (two-week decay), 20% shop reliability
    // (verified for now; orders, reviews and disputes join this in prompts 17-19).
    const score = Prisma.sql`round(1000000 * (
        0.5 / (1 + meters / 3000.0)
      + 0.3 * exp(-extract(epoch FROM (${asOf}::timestamp - published_at)) / 86400.0 / 14)
      + 0.2 * (CASE WHEN verified THEN 1 ELSE 0.5 END)))::bigint`;

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT * FROM (
        SELECT c.*, ${score} AS score FROM (${this.candidates(point, radiusM, asOf, categoryFilter)}) c
      ) ranked
      ${cursor ? Prisma.sql`WHERE (score, id) < (${BigInt(cursor.s)}, ${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY score DESC, id DESC
      LIMIT ${FEED_PAGE_SIZE + 1}`;

    const page = rows.slice(0, FEED_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      items: await this.toItems(page),
      nextCursor:
        rows.length > FEED_PAGE_SIZE && last
          ? encodeCursor({
              v: 1,
              kind: 'feed',
              asOf: asOf.toISOString(),
              lat: origin.lat,
              lng: origin.lng,
              r: query.radiusKm,
              c: category,
              q: null,
              s: last.score.toString(),
              id: last.id,
            })
          : null,
      origin: { lat: origin.lat, lng: origin.lng, approximate: origin.approximate },
      ...(cursor ? {} : { makers: await this.makers(point, radiusM, categoryFilter) }),
    };
  }

  async search(query: SearchQuery): Promise<SearchPage> {
    const origin = this.origin(query);
    const q = normaliseQuery(query.q);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      this.checkCursor(cursor, {
        kind: 'search',
        ...origin,
        r: SEARCH_RADIUS_KM,
        c: null,
        q,
      });
    }
    const asOf = cursor ? new Date(cursor.asOf) : new Date();
    const terms = await this.expand(q);
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography`;

    // A term matches when it is word-similar (pg_trgm, threshold 0.6) to the English or Tamil
    // title or the shop name. Relevance counts 80%, nearness 20%.
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT * FROM (
        SELECT c.*, round(1000000 * (
            0.8 * (SELECT max(greatest(
                     word_similarity(t, c.title),
                     word_similarity(t, coalesce(c.title_ta, '')),
                     0.8 * word_similarity(t, c.business_name)))
                   FROM unnest(${terms}::text[]) t)
          + 0.2 / (1 + c.meters / 3000.0)))::bigint AS score
        FROM (${this.candidates(point, SEARCH_RADIUS_KM * 1000, asOf, Prisma.empty)}) c
        WHERE EXISTS (
          SELECT 1 FROM unnest(${terms}::text[]) t
          WHERE t <% c.title OR t <% coalesce(c.title_ta, '') OR t <% c.business_name)
      ) ranked
      ${cursor ? Prisma.sql`WHERE (score, id) < (${BigInt(cursor.s)}, ${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY score DESC, id DESC
      LIMIT ${FEED_PAGE_SIZE + 1}`;

    const page = rows.slice(0, FEED_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      items: await this.toItems(page),
      nextCursor:
        rows.length > FEED_PAGE_SIZE && last
          ? encodeCursor({
              v: 1,
              kind: 'search',
              asOf: asOf.toISOString(),
              lat: origin.lat,
              lng: origin.lng,
              r: SEARCH_RADIUS_KM,
              c: null,
              q,
              s: last.score.toString(),
              id: last.id,
            })
          : null,
      terms,
    };
  }

  /**
   * Buyer-visible products near a point. THE definition of visible for discovery: product active
   * and live, with a title and a publish time no later than the page's as-of time, at least one
   * option, from an ACTIVE shop (paused shops can't take orders, so they stay out of the feed).
   */
  private candidates(point: Prisma.Sql, radiusM: number, asOf: Date, extra: Prisma.Sql) {
    return Prisma.sql`
      SELECT p.id, p.title, p.title_ta, p.description, p.description_ta, p.made_to_order,
             p.published_at, s.handle, s.business_name,
             s.verification_status = 'verified' AS verified, s.area_name, s.city,
             ST_Distance(s.approx_location, ${point}) AS meters,
             v.min_price, v.total_stock, v.variant_count,
             (SELECT pm.media_id FROM product_media pm
              WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
      FROM products p
      JOIN seller_profiles s ON s.id = p.seller_id
      JOIN LATERAL (
        SELECT min(price_paise) AS min_price, coalesce(sum(stock), 0)::int AS total_stock,
               count(*)::int AS variant_count
        FROM product_variants WHERE product_id = p.id AND deleted_at IS NULL
      ) v ON v.variant_count > 0
      WHERE p.status = 'active' AND p.moderation_status = 'live'
        AND p.title IS NOT NULL AND p.published_at IS NOT NULL AND p.published_at <= ${asOf}
        AND s.status = 'active' AND s.approx_location IS NOT NULL
        AND ST_DWithin(s.approx_location, ${point}, ${radiusM})
        ${extra}`;
  }

  /** Shops with at least one visible product near the point, nearest first (rounded points). */
  private async makers(point: Prisma.Sql, radiusM: number, extra: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<
      {
        handle: string;
        business_name: string;
        verified: boolean;
        area_name: string | null;
        city: string;
        lat: number;
        lng: number;
        meters: number;
        live_products: number;
      }[]
    >`
      SELECT c.handle, c.business_name, c.verified, c.area_name, c.city,
             ST_Y(s.approx_location::geometry) AS lat, ST_X(s.approx_location::geometry) AS lng,
             min(c.meters) AS meters, count(*)::int AS live_products
      FROM (${this.candidates(point, radiusM, new Date(), extra)}) c
      JOIN seller_profiles s ON s.handle = c.handle
      GROUP BY c.handle, c.business_name, c.verified, c.area_name, c.city, s.approx_location
      ORDER BY meters, c.handle
      LIMIT ${MAX_MAKERS}`;
    return rows.map((r): NearbyMaker => ({
      handle: r.handle,
      businessName: r.business_name,
      verified: r.verified,
      areaName: r.area_name,
      city: r.city,
      location: roundPoint({ lat: r.lat, lng: r.lng }),
      distanceKm: Math.round(r.meters / 100) / 10,
      liveProducts: r.live_products,
    }));
  }

  /** The query plus Tamil spellings of Latin words (and Latin spellings of Tamil words). */
  private async expand(q: string): Promise<string[]> {
    // Whole words only (padded with spaces), so "sweet potato" never pulls in பானை via "pot".
    const padded = ` ${q} `;
    const rows = hasTamil(q)
      ? await this.prisma.$queryRaw<{ term: string }[]>`
          SELECT DISTINCT latin AS term FROM search_transliterations
          WHERE position(' ' || tamil || ' ' IN ${padded}) > 0
             OR strict_word_similarity(tamil, ${q}) >= 0.8
          LIMIT ${MAX_TERMS - 1}`
      : await this.prisma.$queryRaw<{ term: string }[]>`
          SELECT DISTINCT tamil AS term FROM search_transliterations
          WHERE position(' ' || latin || ' ' IN ${padded}) > 0
             OR strict_word_similarity(latin, ${q}) >= 0.7
          LIMIT ${MAX_TERMS - 1}`;
    return [...new Set([q, ...rows.map((r) => r.term)])].slice(0, MAX_TERMS);
  }

  private async toItems(rows: Row[]): Promise<FeedItem[]> {
    const images = await this.media.imagesFor(
      rows.flatMap((r) => (r.media_id ? [r.media_id] : [])),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      titleTa: r.title_ta,
      description: r.description,
      descriptionTa: r.description_ta,
      fromPricePaise: paiseToNumber(r.min_price),
      hasOptions: r.variant_count > 1,
      inStock: r.total_stock > 0,
      madeToOrder: r.made_to_order,
      photo: (r.media_id && images.get(r.media_id)) || null,
      maker: {
        handle: r.handle,
        businessName: r.business_name,
        verified: r.verified,
        areaName: r.area_name,
        city: r.city,
      },
      distanceKm: Math.round(r.meters / 100) / 10,
    }));
  }

  private origin(query: { lat?: number; lng?: number }) {
    if (query.lat === undefined || query.lng === undefined) {
      return { ...TRICHY_CENTRE, approximate: true };
    }
    return { ...roundPoint({ lat: query.lat, lng: query.lng }), approximate: false };
  }

  private checkCursor(
    cursor: Cursor,
    expected: Pick<Cursor, 'kind' | 'lat' | 'lng' | 'r' | 'c' | 'q'>,
  ): void {
    const same =
      cursor.kind === expected.kind &&
      cursor.lat === expected.lat &&
      cursor.lng === expected.lng &&
      cursor.r === expected.r &&
      cursor.c === expected.c &&
      cursor.q === expected.q;
    if (!same) throw invalidCursor();
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const c = value as Partial<Cursor> | null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !c ||
    c.v !== 1 ||
    (c.kind !== 'feed' && c.kind !== 'search') ||
    typeof c.asOf !== 'string' ||
    Number.isNaN(new Date(c.asOf).getTime()) ||
    typeof c.lat !== 'number' ||
    typeof c.lng !== 'number' ||
    typeof c.r !== 'number' ||
    typeof c.s !== 'string' ||
    !/^\d{1,12}$/.test(c.s) ||
    typeof c.id !== 'string' ||
    !uuid.test(c.id)
  ) {
    throw invalidCursor();
  }
  return { ...c, c: c.c ?? null, q: c.q ?? null } as Cursor;
}

function invalidCursor(): AppError {
  return new AppError('invalid_cursor', 'This page link is not valid.', HttpStatus.BAD_REQUEST);
}
