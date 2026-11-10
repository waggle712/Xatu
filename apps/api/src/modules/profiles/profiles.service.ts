import { HttpStatus, Injectable } from '@nestjs/common';
import {
  approximateLocation,
  canTransitionSeller,
  type Category,
  type CreateShopRequest,
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
    const { location, openingHours, ...fields } = patch;
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerProfile.update({
        where: { id: shop.id },
        data: {
          ...fields,
          ...(openingHours ? { openingHours: openingHours as Prisma.InputJsonValue } : {}),
        },
      });
      if (location) {
        await tx.$executeRaw`
          UPDATE seller_profiles
          SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography
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
      include: { category: { select: { slug: true, nameEn: true, nameTa: true } } },
    });
    if (!shop || !PUBLIC_SELLER_STATUSES.includes(shop.status)) {
      throw new AppError('shop_not_found', 'This shop is not available.', HttpStatus.NOT_FOUND);
    }
    const [point, liveProductCount, completedOrderCount] = await Promise.all([
      this.readLocation(shop.id),
      this.prisma.product.count({
        where: { sellerId: shop.id, status: 'active', moderationStatus: 'live' },
      }),
      this.prisma.order.count({ where: { sellerId: shop.id, status: 'delivered' } }),
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
      coverMediaKey: shop.coverMediaKey,
      status: shop.status as 'active' | 'paused',
      verified: shop.verificationStatus === 'verified',
      liveProductCount,
      completedOrderCount,
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
      coverMediaKey: shop.coverMediaKey,
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

function parseHours(value: unknown): OpeningHours {
  const parsed = openingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
