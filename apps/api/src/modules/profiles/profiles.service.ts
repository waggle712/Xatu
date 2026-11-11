import { HttpStatus, Injectable } from '@nestjs/common';
import {
  approximateLocation,
  canTransitionSeller,
  type Category,
  type CreateShopRequest,
  type FollowedShop,
  type FulfilmentMode,
  MAX_FOLLOWED_SHOPS,
  missingForSubmit,
  type MyShop,
  type OpeningHours,
  openingHoursSchema,
  PUBLIC_SELLER_STATUSES,
  type PublicShop,
  type SellerStatus,
  type UpdateShopRequest,
} from '@xatu/shared';
import { AnalyticsService } from '../../analytics/analytics.service.js';
import { AppError } from '../../common/errors.js';
import { paiseToBigInt, paiseToNumber } from '../../common/money.js';
import { MediaService } from '../media/media.service.js';
import { Prisma, type SellerProfile } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Shops (seller profiles). Every write checks that the acting user owns the shop;
 * the exact pickup point and address never leave this module in public responses.
 */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly media: MediaService,
  ) {}

  async listCategories(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { position: 'asc' },
      select: { id: true, slug: true, nameEn: true, nameTa: true },
    });
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    return (await this.prisma.sellerProfile.count({ where: { handle } })) === 0;
  }

  async createShop(userId: string, input: CreateShopRequest): Promise<MyShop> {
    const category = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category)
      throw new AppError(
        'category_not_found',
        'Choose a category from the list.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let shop: SellerProfile;
    try {
      shop = await this.prisma.$transaction(async (tx) => {
        const created = await tx.sellerProfile.create({
          data: {
            userId,
            handle: input.handle,
            businessName: input.businessName,
            categoryId: input.categoryId,
            city: user.city ?? 'Trichy',
            region: user.region,
          },
        });
        if (!user.roles.includes('seller')) {
          await tx.user.update({ where: { id: userId }, data: { roles: { push: 'seller' } } });
        }
        await this.outbox(tx, 'profiles.shop_created', created.id, {
          sellerId: created.id,
          userId,
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = JSON.stringify(err.meta ?? {});
        if (target.includes('user_id')) {
          throw new AppError('shop_exists', 'You already have a shop.', HttpStatus.CONFLICT);
        }
        throw new AppError(
          'handle_taken',
          'This shop link is taken. Try another.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    this.analytics.capture(userId, 'seller_signed_up', {
      seller_id: shop.id,
      category_slug: category.slug,
      city: shop.city,
    });
    return this.getOwnShop(userId, shop.id);
  }

  async getMyShop(userId: string): Promise<MyShop | null> {
    const shop = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    return shop ? this.toMyShop(shop) : null;
  }

  async getOwnShop(userId: string, sellerId: string): Promise<MyShop> {
    return this.toMyShop(await this.loadOwned(userId, sellerId));
  }

  async updateShop(userId: string, sellerId: string, patch: UpdateShopRequest): Promise<MyShop> {
    const shop = await this.loadOwned(userId, sellerId);
    if (shop.status === 'suspended') {
      throw new AppError(
        'shop_suspended',
        'This shop is suspended. Contact Xatu support.',
        HttpStatus.CONFLICT,
      );
    }
    if (patch.categoryId) {
      const exists = await this.prisma.category.count({ where: { id: patch.categoryId } });
      if (!exists)
        throw new AppError(
          'category_not_found',
          'Choose a category from the list.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
    }
    if (patch.coverMediaId) await this.media.requireReady(userId, patch.coverMediaId, 'shop_cover');
    const { location, openingHours, localDeliveryFeePaise, ...fields } = patch;
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id: shop.id },
        data: {
          ...fields,
          ...(localDeliveryFeePaise === undefined
            ? {}
            : { localDeliveryFeePaise: paiseToBigInt(localDeliveryFeePaise) }),
          ...(openingHours ? { openingHours: openingHours as Prisma.InputJsonValue } : {}),
        },
      });
      if (location) {
        // The rounded public point is written with the exact one, always, from the same helper
        // the shop page uses; discovery (feed, distance, map) reads only approx_location.
        const approx = approximateLocation(location);
        await tx.$executeRaw`
          UPDATE seller_profiles
          SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography,
              approx_location = ST_SetSRID(ST_MakePoint(${approx.lng}, ${approx.lat}), 4326)::geography
          WHERE id = ${shop.id}::uuid`;
      }
      await this.outbox(tx, 'profiles.shop_updated', shop.id, {
        sellerId: shop.id,
        fields: Object.keys(patch),
      });
    });
    return this.getOwnShop(userId, shop.id);
  }

  /** draft → kyc_pending, once everything buyers and the review team need is filled in. */
  async submitForReview(userId: string, sellerId: string): Promise<MyShop> {
    const shop = await this.loadOwned(userId, sellerId);
    const view = await this.toMyShop(shop);
    if (view.missingForSubmit.length > 0) {
      throw new AppError(
        'shop_incomplete',
        'Fill in the missing details first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          missing: view.missingForSubmit,
        },
      );
    }
    return this.transition(userId, shop, 'kyc_pending');
  }

  async pause(userId: string, sellerId: string): Promise<MyShop> {
    return this.transition(userId, await this.loadOwned(userId, sellerId), 'paused');
  }

  async resume(userId: string, sellerId: string): Promise<MyShop> {
    return this.transition(userId, await this.loadOwned(userId, sellerId), 'active');
  }

  async getPublicShop(handle: string): Promise<PublicShop> {
    const shop = await this.prisma.sellerProfile.findUnique({
      where: { handle },
      include: {
        category: { select: { slug: true, nameEn: true, nameTa: true } },
        coverMedia: true,
      },
    });
    if (!shop || !PUBLIC_SELLER_STATUSES.includes(shop.status)) {
      throw new AppError('shop_not_found', 'This shop is not available.', HttpStatus.NOT_FOUND);
    }
    const [point, liveProductCount, completedOrderCount, followerCount] = await Promise.all([
      this.readLocation(shop.id),
      this.prisma.product.count({
        where: { sellerId: shop.id, status: 'active', moderationStatus: 'live' },
      }),
      // Documented exception: orders imports profiles, so profiles can't call OrdersService.
      this.prisma.order.count({ where: { sellerId: shop.id, status: 'completed' } }),
      this.prisma.shopFollow.count({ where: { sellerId: shop.id } }),
    ]);
    return {
      handle: shop.handle,
      businessName: shop.businessName,
      category: shop.category,
      storyEn: shop.storyEn,
      storyTa: shop.storyTa,
      areaName: shop.areaName,
      city: shop.city,
      approximateLocation: point ? approximateLocation(point) : null,
      openingHours: parseHours(shop.openingHours),
      pickupAvailable: shop.pickupAvailable,
      localDelivery: shop.localDelivery,
      cover: this.media.toImage(shop.coverMedia),
      status: shop.status as 'active' | 'paused',
      verified: shop.verificationStatus === 'verified',
      liveProductCount,
      completedOrderCount,
      followerCount,
    };
  }

  // ── Used by other modules (catalog) instead of reading seller_profiles directly ──

  /** The caller's shop with what catalog needs: status and the delivery modes it offers. */
  async ownerShop(userId: string): Promise<OwnerShop | null> {
    const shop = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (!shop) return null;
    return {
      id: shop.id,
      status: shop.status,
      categoryId: shop.categoryId,
      offeredModes: offeredModes(shop),
    };
  }

  /** Buyer-safe maker summaries for shops buyers may see, keyed by seller id. */
  async publicSellers(sellerIds: string[]): Promise<Map<string, PublicSellerSummary>> {
    const shops = await this.prisma.sellerProfile.findMany({
      where: { id: { in: sellerIds }, status: { in: [...PUBLIC_SELLER_STATUSES] } },
    });
    return new Map(
      shops.map((shop) => [
        shop.id,
        {
          handle: shop.handle,
          businessName: shop.businessName,
          verified: shop.verificationStatus === 'verified',
          areaName: shop.areaName,
          city: shop.city,
          acceptingOrders: shop.status === 'active',
          offeredModes: offeredModes(shop),
        },
      ]),
    );
  }

  /** The seller id behind a public shop handle, or null when buyers can't see it. */
  async publicSellerId(handle: string): Promise<string | null> {
    const shop = await this.prisma.sellerProfile.findUnique({
      where: { handle },
      select: { id: true, status: true },
    });
    return shop && PUBLIC_SELLER_STATUSES.includes(shop.status) ? shop.id : null;
  }

  // ───────────────────────────── Used by orders ─────────────────────────────

  /** What checkout needs about a shop: who owns it, whether it takes orders, modes and fee. */
  async shopForOrder(sellerId: string): Promise<OrderingShop | null> {
    const shop = await this.prisma.sellerProfile.findUnique({ where: { id: sellerId } });
    if (!shop || !PUBLIC_SELLER_STATUSES.includes(shop.status)) return null;
    return {
      id: shop.id,
      ownerUserId: shop.userId,
      handle: shop.handle,
      businessName: shop.businessName,
      areaName: shop.areaName,
      city: shop.city,
      acceptingOrders: shop.status === 'active',
      offeredModes: offeredModes(shop),
      localDeliveryFeePaise: shop.localDeliveryFeePaise,
    };
  }

  /** For finance (payout CSV): names of any shops, whatever their status. */
  async payoutNames(
    sellerIds: string[],
  ): Promise<Map<string, { handle: string; businessName: string }>> {
    const rows = await this.prisma.sellerProfile.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, handle: true, businessName: true },
    });
    return new Map(rows.map((r) => [r.id, { handle: r.handle, businessName: r.businessName }]));
  }

  // ───────────────────────────── Following ─────────────────────────────

  /** Follows a public shop by handle. Safe to repeat. You can't follow your own shop. */
  async follow(userId: string, handle: string): Promise<void> {
    const shop = await this.prisma.sellerProfile.findUnique({
      where: { handle },
      select: { id: true, userId: true, status: true },
    });
    if (!shop || !PUBLIC_SELLER_STATUSES.includes(shop.status)) {
      throw new AppError('shop_not_found', 'This shop is not available.', HttpStatus.NOT_FOUND);
    }
    if (shop.userId === userId) {
      throw new AppError(
        'cannot_follow_own_shop',
        "You can't follow your own shop.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.prisma.shopFollow.findUnique({
      where: { userId_sellerId: { userId, sellerId: shop.id } },
    });
    if (existing) return;
    if ((await this.prisma.shopFollow.count({ where: { userId } })) >= MAX_FOLLOWED_SHOPS) {
      throw new AppError(
        'following_list_full',
        `You can follow up to ${MAX_FOLLOWED_SHOPS} shops. Unfollow some to follow more.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.shopFollow.createMany({
        data: { userId, sellerId: shop.id },
        skipDuplicates: true,
      });
      if (count === 1) {
        await this.outbox(tx, 'shop.followed', shop.id, { sellerId: shop.id, userId });
      }
    });
  }

  async unfollow(userId: string, handle: string): Promise<void> {
    await this.prisma.shopFollow.deleteMany({ where: { userId, seller: { handle } } });
  }

  /** Handles of public shops the buyer follows. */
  async followedHandles(userId: string): Promise<string[]> {
    const rows = await this.prisma.shopFollow.findMany({
      where: { userId, seller: { status: { in: [...PUBLIC_SELLER_STATUSES] } } },
      select: { seller: { select: { handle: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_FOLLOWED_SHOPS,
    });
    return rows.map((r) => r.seller.handle);
  }

  /** The buyer's Following list, newest first. Public fields only. */
  async listFollowing(
    userId: string,
    cursor: string | undefined,
  ): Promise<{ items: FollowedShop[]; nextCursor: string | null }> {
    const after = cursor === undefined ? null : decodeFollowCursor(cursor);
    const rows = await this.prisma.shopFollow.findMany({
      where: {
        userId,
        seller: { status: { in: [...PUBLIC_SELLER_STATUSES] } },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, sellerId: { lt: after.sellerId } },
              ],
            }
          : {}),
      },
      include: { seller: { include: { coverMedia: true } } },
      orderBy: [{ createdAt: 'desc' }, { sellerId: 'desc' }],
      take: FOLLOW_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, FOLLOW_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      items: page.map(({ seller }) => ({
        handle: seller.handle,
        businessName: seller.businessName,
        verified: seller.verificationStatus === 'verified',
        areaName: seller.areaName,
        city: seller.city,
        cover: this.media.toImage(seller.coverMedia),
        acceptingOrders: seller.status === 'active',
      })),
      nextCursor:
        rows.length > FOLLOW_PAGE_SIZE && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.sellerId}`).toString('base64url')
          : null,
    };
  }

  private async transition(userId: string, shop: SellerProfile, to: SellerStatus): Promise<MyShop> {
    if (!canTransitionSeller(shop.status, to, 'owner')) {
      throw new AppError(
        'invalid_shop_status',
        `A ${shop.status} shop cannot be moved to ${to}.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Conditional update: a concurrent change (e.g. an admin suspension) wins.
      const { count } = await tx.sellerProfile.updateMany({
        where: { id: shop.id, status: shop.status },
        data: { status: to, ...(to === 'kyc_pending' ? { submittedAt: new Date() } : {}) },
      });
      if (count === 0)
        throw new AppError(
          'shop_changed',
          'The shop changed. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      await this.outbox(tx, 'profiles.shop_status_changed', shop.id, {
        sellerId: shop.id,
        from: shop.status,
        to,
        actor: 'owner',
      });
    });
    return this.getOwnShop(userId, shop.id);
  }

  /** Loads a shop and enforces ownership. Unknown and foreign shops look the same to the caller. */
  private async loadOwned(userId: string, sellerId: string): Promise<SellerProfile> {
    const shop = await this.prisma.sellerProfile.findUnique({ where: { id: sellerId } });
    if (!shop) throw new AppError('shop_not_found', 'Shop not found.', HttpStatus.NOT_FOUND);
    if (shop.userId !== userId)
      throw new AppError('forbidden', 'You can only manage your own shop.', HttpStatus.FORBIDDEN);
    return shop;
  }

  private async toMyShop(shop: SellerProfile): Promise<MyShop> {
    const location = await this.readLocation(shop.id);
    const openingHours = parseHours(shop.openingHours);
    return {
      id: shop.id,
      handle: shop.handle,
      businessName: shop.businessName,
      categoryId: shop.categoryId,
      storyEn: shop.storyEn,
      storyTa: shop.storyTa,
      areaName: shop.areaName,
      city: shop.city,
      pincode: shop.pincode,
      location,
      pickupAddressLine: shop.pickupAddressLine,
      pickupLandmark: shop.pickupLandmark,
      openingHours,
      pickupAvailable: shop.pickupAvailable,
      localDelivery: shop.localDelivery,
      localDeliveryFeePaise: paiseToNumber(shop.localDeliveryFeePaise),
      cover: shop.coverMediaId
        ? this.media.toImage(
            await this.prisma.mediaAsset.findUnique({ where: { id: shop.coverMediaId } }),
          )
        : null,
      status: shop.status,
      verified: shop.verificationStatus === 'verified',
      missingForSubmit:
        shop.status === 'draft'
          ? missingForSubmit({ ...shop, hasLocation: location !== null, openingHours })
          : [],
    };
  }

  private async readLocation(sellerId: string): Promise<{ lat: number; lng: number } | null> {
    const rows = await this.prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM seller_profiles WHERE id = ${sellerId}::uuid`;
    const row = rows[0];
    return row && row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null;
  }

  private async outbox(
    tx: Tx,
    topic: string,
    aggregateId: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.outboxEvent.create({ data: { topic, aggregateId, payload } });
  }
}

export interface OwnerShop {
  id: string;
  status: SellerStatus;
  categoryId: string | null;
  offeredModes: FulfilmentMode[];
}

export interface OrderingShop {
  id: string;
  ownerUserId: string;
  handle: string;
  businessName: string;
  areaName: string | null;
  city: string;
  acceptingOrders: boolean;
  offeredModes: FulfilmentMode[];
  localDeliveryFeePaise: bigint;
}

export interface PublicSellerSummary {
  handle: string;
  businessName: string;
  verified: boolean;
  areaName: string | null;
  city: string;
  acceptingOrders: boolean;
  offeredModes: FulfilmentMode[];
}

const FOLLOW_PAGE_SIZE = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeFollowCursor(cursor: string): { createdAt: Date; sellerId: string } {
  const [iso, sellerId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (Number.isNaN(createdAt.getTime()) || !sellerId || !UUID.test(sellerId)) {
    throw new AppError('invalid_cursor', 'This page link is not valid.', HttpStatus.BAD_REQUEST);
  }
  return { createdAt, sellerId };
}

function offeredModes(shop: SellerProfile): FulfilmentMode[] {
  const modes: FulfilmentMode[] = [];
  if (shop.pickupAvailable) modes.push('pickup');
  if (shop.localDelivery) modes.push('local_delivery');
  if (shop.courierAvailable) modes.push('courier');
  return modes;
}

function parseHours(value: unknown): OpeningHours {
  const parsed = openingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
