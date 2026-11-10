import { HttpStatus, Injectable } from '@nestjs/common';
import {
  canTransitionProduct,
  type CreateProductRequest,
  fromPrice,
  isProductPublic,
  moderationOnPublish,
  type ProductCard,
  type ProductDraft,
  type ProductPage,
  type ProductStatus,
  type PublicProduct,
  publishProblems,
  type SellerProduct,
  type SellerProductCard,
  type VariantAttributes,
  variantAttributesSchema,
  type VariantInput,
} from '@xatu/shared';
import { AnalyticsService } from '../../analytics/analytics.service.js';
import { AppError } from '../../common/errors.js';
import { paiseToBigInt, paiseToNumber } from '../../common/money.js';
import {
  Prisma,
  type Product,
  type ProductMedia,
  type ProductVariant,
  type StockMovementReason,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { type OwnerShop, ProfilesService } from '../profiles/profiles.service.js';

type Tx = Prisma.TransactionClient;
type ProductRow = Product & { variants: ProductVariant[]; media: ProductMedia[] };

const PAGE_SIZE = 20;
const SELLER_LIST_LIMIT = 200;
const withChildren = {
  variants: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
  media: { orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude;

/**
 * Catalog: products, variants, photos and stock. Every seller action checks that the product
 * belongs to the caller's shop; every stock change happens under a row lock with an append-only
 * stock_movements row. Shops and media are reached only through their modules' services.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfilesService,
    private readonly media: MediaService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ───────────────────────────── Seller ─────────────────────────────

  /** Creates a draft. Idempotent on the app-made id, so a retried request returns the same draft. */
  async create(userId: string, input: CreateProductRequest): Promise<SellerProduct> {
    const shop = await this.requireShop(userId);
    const existing = await this.prisma.product.findUnique({ where: { id: input.id } });
    if (existing) return this.existingDraft(userId, shop, existing);

    const { id, ...draft } = input;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.create({
          data: {
            id,
            sellerId: shop.id,
            categoryId: shop.categoryId,
            fulfilmentModes: shop.offeredModes.length > 0 ? [shop.offeredModes[0]!] : ['pickup'],
          },
        });
        await this.applyDraft(tx, userId, shop, id, draft);
        await this.outbox(tx, 'catalog.product_created', id, { productId: id, sellerId: shop.id });
      });
    } catch (err) {
      // Two identical creates raced: the loser returns the winner's draft.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.product.findUnique({ where: { id } });
        if (winner) return this.existingDraft(userId, shop, winner);
      }
      throw err;
    }
    this.analytics.capture(userId, 'product_draft_started', { product_id: id, seller_id: shop.id });
    return this.getOwn(userId, id);
  }

  async listOwn(userId: string, archived: boolean): Promise<SellerProductCard[]> {
    const shop = await this.profiles.ownerShop(userId);
    if (!shop) return [];
    const rows = await this.prisma.product.findMany({
      where: { sellerId: shop.id, status: archived ? 'archived' : { not: 'archived' } },
      include: withChildren,
      orderBy: { updatedAt: 'desc' },
      take: SELLER_LIST_LIMIT,
    });
    const images = await this.media.imagesFor(rows.flatMap((r) => r.media.map((m) => m.mediaId)));
    return rows.map((row) => ({
      ...this.card(row, images),
      title: row.title,
      status: row.status,
      moderationStatus: row.moderationStatus,
      totalStock: row.variants.reduce((sum, v) => sum + v.stock, 0),
    }));
  }

  async getOwn(userId: string, productId: string): Promise<SellerProduct> {
    return this.toSellerProduct(await this.loadOwned(userId, productId));
  }

  /** Autosave. Live products stay complete: an edit that would break a listing is refused. */
  async update(userId: string, productId: string, patch: ProductDraft): Promise<SellerProduct> {
    const { shop, product } = await this.loadOwnedWithShop(userId, productId);
    if (product.status === 'archived') {
      throw new AppError(
        'product_archived',
        'Restore this product before editing it.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applyDraft(tx, userId, shop, product.id, patch);
      if (product.status === 'active' || product.status === 'paused') {
        const problems = publishProblems(await this.readinessOf(tx, product.id));
        if (problems.length > 0) {
          throw new AppError(
            'product_incomplete',
            'A live product needs a photo, a name, a category and a price.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            { missing: problems },
          );
        }
      }
      await this.outbox(tx, 'catalog.product_updated', product.id, {
        productId: product.id,
        fields: Object.keys(patch),
      });
    });
    return this.getOwn(userId, product.id);
  }

  /** Replaces the photo list (order = display order; the first is the cover). */
  async setPhotos(userId: string, productId: string, mediaIds: string[]): Promise<SellerProduct> {
    const product = await this.loadOwned(userId, productId);
    if (product.status === 'archived') {
      throw new AppError(
        'product_archived',
        'Restore this product before editing it.',
        HttpStatus.CONFLICT,
      );
    }
    if (mediaIds.length === 0 && (product.status === 'active' || product.status === 'paused')) {
      throw new AppError(
        'photo_required',
        'A live product needs at least one photo.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.media.requireReadyMany(userId, mediaIds, 'product_photo');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productMedia.deleteMany({ where: { productId: product.id } });
        if (mediaIds.length > 0) {
          await tx.productMedia.createMany({
            data: mediaIds.map((mediaId, position) => ({
              productId: product.id,
              mediaId,
              position,
            })),
          });
        }
        await tx.product.update({ where: { id: product.id }, data: { updatedAt: new Date() } });
        await this.outbox(tx, 'catalog.product_photos_changed', product.id, {
          productId: product.id,
          count: mediaIds.length,
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(
          'photo_in_use',
          'One of these photos is already on another product.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
    return this.getOwn(userId, product.id);
  }

  /** Sets one variant's stock (the − / + stepper and the stock list). */
  async setStock(
    userId: string,
    productId: string,
    variantId: string,
    stock: number,
    stockBefore: number,
  ): Promise<SellerProduct> {
    const product = await this.loadOwned(userId, productId);
    // The variant must belong to THIS product; another product's variant id is "not found".
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new AppError('variant_not_found', 'This option does not exist.', HttpStatus.NOT_FOUND);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.setStockLocked(tx, variant.id, stock, 'seller_set', userId, stockBefore);
    });
    return this.getOwn(userId, product.id);
  }

  async publish(userId: string, productId: string): Promise<SellerProduct> {
    return this.goLive(userId, productId, 'draft');
  }

  async resume(userId: string, productId: string): Promise<SellerProduct> {
    return this.goLive(userId, productId, 'paused');
  }

  async pause(userId: string, productId: string): Promise<SellerProduct> {
    const product = await this.loadOwned(userId, productId);
    await this.transition(product, 'paused');
    return this.getOwn(userId, product.id);
  }

  async archive(userId: string, productId: string): Promise<SellerProduct> {
    const product = await this.loadOwned(userId, productId);
    await this.transition(product, 'archived');
    return this.getOwn(userId, product.id);
  }

  async restore(userId: string, productId: string): Promise<SellerProduct> {
    const product = await this.loadOwned(userId, productId);
    await this.transition(product, 'draft');
    return this.getOwn(userId, product.id);
  }

  // ───────────────────────────── Buyers ─────────────────────────────

  async getPublic(productId: string): Promise<PublicProduct> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        ...withChildren,
        category: { select: { slug: true, nameEn: true, nameTa: true } },
      },
    });
    const maker = row
      ? (await this.profiles.publicSellers([row.sellerId])).get(row.sellerId)
      : null;
    if (!row || !maker || !isProductPublic(row) || !row.title || row.variants.length === 0) {
      throw new AppError(
        'product_not_found',
        'This product is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    const images = await this.media.imagesFor(row.media.map((m) => m.mediaId));
    return {
      id: row.id,
      title: row.title,
      titleTa: row.titleTa,
      description: row.description,
      descriptionTa: row.descriptionTa,
      category: row.category,
      madeToOrder: row.madeToOrder,
      leadTimeDays: row.leadTimeDays,
      // Never offer a mode the shop has since turned off.
      fulfilmentModes: row.fulfilmentModes.filter((m) => maker.offeredModes.includes(m)),
      variants: row.variants.map(toVariantView),
      photos: row.media.flatMap((m) => images.get(m.mediaId) ?? []),
      maker: {
        handle: maker.handle,
        businessName: maker.businessName,
        verified: maker.verified,
        areaName: maker.areaName,
        city: maker.city,
        acceptingOrders: maker.acceptingOrders,
      },
    };
  }

  /** Live products of a public shop, newest first. Keyset paging on (published_at, id). */
  async listShop(handle: string, cursor: string | undefined): Promise<ProductPage<ProductCard>> {
    const after = cursor === undefined ? null : decodeCursor(cursor);
    const sellerId = await this.profiles.publicSellerId(handle);
    if (!sellerId) {
      throw new AppError('shop_not_found', 'This shop is not available.', HttpStatus.NOT_FOUND);
    }
    const rows = await this.prisma.product.findMany({
      where: {
        sellerId,
        status: 'active',
        moderationStatus: 'live',
        title: { not: null },
        publishedAt: { not: null },
        variants: { some: { deletedAt: null } },
        ...(after
          ? {
              OR: [
                { publishedAt: { lt: after.publishedAt } },
                { publishedAt: after.publishedAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: withChildren,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    });
    const page = rows.slice(0, PAGE_SIZE);
    const images = await this.media.imagesFor(page.flatMap((r) => r.media.map((m) => m.mediaId)));
    return {
      items: page.map((row) => ({ ...this.card(row, images), title: row.title! })),
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  // ───────────────────────────── Internals ─────────────────────────────

  private async goLive(
    userId: string,
    productId: string,
    from: 'draft' | 'paused',
  ): Promise<SellerProduct> {
    const { shop, product } = await this.loadOwnedWithShop(userId, productId);
    if (shop.status !== 'active') {
      throw new AppError(
        'shop_not_active',
        'Your shop must be approved and open before products can go live.',
        HttpStatus.CONFLICT,
      );
    }
    if (product.status !== from) {
      throw new AppError(
        'invalid_product_status',
        `A ${product.status} product cannot be made live this way.`,
        HttpStatus.CONFLICT,
      );
    }
    const notOffered = product.fulfilmentModes.filter((m) => !shop.offeredModes.includes(m));
    if (notOffered.length > 0) {
      throw new AppError(
        'fulfilment_not_offered',
        'Turn this delivery option on for your shop first, or remove it from the product.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { notOffered },
      );
    }
    const problems = publishProblems(await this.readinessOf(this.prisma, product.id));
    if (problems.length > 0) {
      throw new AppError(
        'product_incomplete',
        'Fill in the missing details first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { missing: problems },
      );
    }
    const firstPublish = product.publishedAt === null;
    await this.transition(product, 'active', {
      moderationStatus: moderationOnPublish(product.moderationStatus),
      ...(firstPublish ? { publishedAt: new Date() } : {}),
    });
    if (firstPublish) {
      const fresh = await this.loadOwned(userId, product.id);
      const category = fresh.categoryId
        ? await this.prisma.category.findUnique({ where: { id: fresh.categoryId } })
        : null;
      this.analytics.capture(userId, 'product_listed', {
        product_id: fresh.id,
        seller_id: fresh.sellerId,
        ...(category ? { category_slug: category.slug } : {}),
        price_paise: fromPrice(fresh.variants.map(toVariantView)),
      });
    }
    return this.getOwn(userId, product.id);
  }

  /** Conditional status change: a concurrent change (another device, an admin) wins. */
  private async transition(
    product: Product,
    to: ProductStatus,
    extra: Prisma.ProductUpdateManyMutationInput = {},
  ): Promise<void> {
    if (!canTransitionProduct(product.status, to, 'owner')) {
      throw new AppError(
        'invalid_product_status',
        `A ${product.status} product cannot be moved to ${to}.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.product.updateMany({
        where: { id: product.id, status: product.status },
        data: { status: to, ...extra },
      });
      if (count === 0) {
        throw new AppError(
          'product_changed',
          'This product changed. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      await this.outbox(tx, 'catalog.product_status_changed', product.id, {
        productId: product.id,
        sellerId: product.sellerId,
        from: product.status,
        to,
        actor: 'owner',
      });
    });
  }

  private async applyDraft(
    tx: Tx,
    userId: string,
    shop: OwnerShop,
    productId: string,
    draft: ProductDraft,
  ): Promise<void> {
    const { variants, fulfilmentModes, categoryId, madeToOrder, leadTimeDays, ...text } = draft;
    if (fulfilmentModes) {
      const notOffered = fulfilmentModes.filter((m) => !shop.offeredModes.includes(m));
      if (notOffered.length > 0) {
        throw new AppError(
          'fulfilment_not_offered',
          'Turn this delivery option on for your shop first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { notOffered },
        );
      }
    }
    if (categoryId && (await tx.category.count({ where: { id: categoryId } })) === 0) {
      throw new AppError(
        'category_not_found',
        'Choose a category from the list.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const current = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const finalMadeToOrder = madeToOrder ?? current.madeToOrder;
    // Lead time only means something for made-to-order products; turning that off clears it.
    const finalLeadTime = finalMadeToOrder
      ? leadTimeDays !== undefined
        ? leadTimeDays
        : current.leadTimeDays
      : leadTimeDays
        ? -1
        : null;
    if (finalLeadTime === -1) {
      throw new AppError(
        'lead_time_invalid',
        'Lead time is only for made-to-order products.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const data: Prisma.ProductUpdateInput = { ...text };
    if (fulfilmentModes) data.fulfilmentModes = fulfilmentModes;
    if (categoryId !== undefined) {
      data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
    }
    if (finalMadeToOrder !== current.madeToOrder) data.madeToOrder = finalMadeToOrder;
    if (finalLeadTime !== current.leadTimeDays) data.leadTimeDays = finalLeadTime;
    if (Object.keys(data).length > 0) await tx.product.update({ where: { id: productId }, data });
    if (variants) await this.replaceVariants(tx, userId, productId, variants);
  }

  /** Full-list variant save: update kept ones, add new ones, hide removed ones. */
  private async replaceVariants(
    tx: Tx,
    userId: string,
    productId: string,
    inputs: VariantInput[],
  ): Promise<void> {
    // Lock this product's variants so a concurrent save or checkout can't interleave.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_variants
      WHERE product_id = ${productId}::uuid AND deleted_at IS NULL
      ORDER BY id FOR UPDATE`;
    const current = new Set(locked.map((r) => r.id));

    for (const input of inputs) {
      if (input.id && !current.has(input.id)) {
        throw new AppError(
          'variant_not_found',
          'One of these options no longer exists. Refresh and try again.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const kept = new Set(inputs.flatMap((v) => (v.id ? [v.id] : [])));
    for (const id of current) {
      if (kept.has(id)) continue;
      const reserved = await this.reservedUnits(tx, id);
      if (reserved > 0) {
        throw new AppError(
          'variant_reserved',
          'Someone is buying this option right now. Try again in a few minutes.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.productVariant.update({ where: { id }, data: { deletedAt: new Date() } });
    }

    for (const [position, input] of inputs.entries()) {
      const fields = {
        label: input.label ?? null,
        labelTa: input.labelTa ?? null,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
        pricePaise: paiseToBigInt(input.pricePaise),
        position,
      };
      if (input.id) {
        await tx.productVariant.update({ where: { id: input.id }, data: fields });
        // Only a stock the seller actually changed is written, and only from the value they saw.
        if (input.stockBefore !== undefined && input.stock !== input.stockBefore) {
          await this.setStockLocked(
            tx,
            input.id,
            input.stock,
            'seller_set',
            userId,
            input.stockBefore,
          );
        }
      } else {
        const created = await tx.productVariant.create({
          data: { ...fields, productId, stock: input.stock },
        });
        await tx.stockMovement.create({
          data: {
            variantId: created.id,
            delta: input.stock,
            stockAfter: input.stock,
            reason: 'listing_created',
            actorId: userId,
          },
        });
      }
    }
  }

  /**
   * The one place stock changes. Row lock on the variant; compare-and-set against the stock the
   * seller last saw (so an old screen never overwrites a sale or another device's change); never
   * below the units held by active reservations (buyers mid-checkout); and an append-only
   * movement row in the same transaction.
   */
  private async setStockLocked(
    tx: Tx,
    variantId: string,
    stock: number,
    reason: StockMovementReason,
    actorId: string,
    expected: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ stock: number }[]>`
      SELECT stock FROM product_variants WHERE id = ${variantId}::uuid FOR UPDATE`;
    const before = rows[0]?.stock;
    if (before === undefined) {
      throw new AppError('variant_not_found', 'This option does not exist.', HttpStatus.NOT_FOUND);
    }
    if (before !== expected) {
      throw new AppError(
        'stock_changed',
        'Stock changed since you opened this. Check the new number and try again.',
        HttpStatus.CONFLICT,
        { stock: before },
      );
    }
    if (stock === before) return;
    const reserved = await this.reservedUnits(tx, variantId);
    if (stock < reserved) {
      throw new AppError(
        'stock_below_reserved',
        `${reserved} of these are in buyers' carts right now. Stock can't go below that.`,
        HttpStatus.CONFLICT,
        { reserved },
      );
    }
    await tx.productVariant.update({ where: { id: variantId }, data: { stock } });
    await tx.stockMovement.create({
      data: { variantId, delta: stock - before, stockAfter: stock, reason, actorId },
    });
  }

  private async reservedUnits(tx: Tx, variantId: string): Promise<number> {
    const { _sum } = await tx.inventoryReservation.aggregate({
      where: { variantId, status: 'active', expiresAt: { gt: new Date() } },
      _sum: { quantity: true },
    });
    return _sum.quantity ?? 0;
  }

  private async readinessOf(db: Tx | PrismaService, productId: string) {
    const row = await db.product.findUniqueOrThrow({
      where: { id: productId },
      include: withChildren,
    });
    return readiness(row);
  }

  private async requireShop(userId: string): Promise<OwnerShop> {
    const shop = await this.profiles.ownerShop(userId);
    if (!shop) {
      throw new AppError('shop_required', 'Open your shop first.', HttpStatus.FORBIDDEN);
    }
    if (shop.status === 'suspended') {
      throw new AppError(
        'shop_suspended',
        'This shop is suspended. Contact Xatu support.',
        HttpStatus.CONFLICT,
      );
    }
    return shop;
  }

  private async existingDraft(
    userId: string,
    shop: OwnerShop,
    existing: Product,
  ): Promise<SellerProduct> {
    if (existing.sellerId !== shop.id) {
      throw new AppError('product_id_taken', 'Try again.', HttpStatus.CONFLICT);
    }
    return this.getOwn(userId, existing.id);
  }

  /** Loads a product and enforces ownership. Unknown ids are 404; another seller's are 403. */
  private async loadOwnedWithShop(
    userId: string,
    productId: string,
  ): Promise<{ shop: OwnerShop; product: ProductRow }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: withChildren,
    });
    if (!product) {
      throw new AppError('product_not_found', 'Product not found.', HttpStatus.NOT_FOUND);
    }
    const shop = await this.profiles.ownerShop(userId);
    if (!shop || product.sellerId !== shop.id) {
      throw new AppError(
        'forbidden',
        'You can only manage your own products.',
        HttpStatus.FORBIDDEN,
      );
    }
    return { shop, product };
  }

  private async loadOwned(userId: string, productId: string): Promise<ProductRow> {
    return (await this.loadOwnedWithShop(userId, productId)).product;
  }

  private async toSellerProduct(row: ProductRow): Promise<SellerProduct> {
    const images = await this.media.imagesFor(row.media.map((m) => m.mediaId));
    return {
      id: row.id,
      title: row.title,
      titleTa: row.titleTa,
      description: row.description,
      descriptionTa: row.descriptionTa,
      categoryId: row.categoryId,
      madeToOrder: row.madeToOrder,
      leadTimeDays: row.leadTimeDays,
      fulfilmentModes: row.fulfilmentModes,
      status: row.status,
      moderationStatus: row.moderationStatus,
      variants: row.variants.map(toVariantView),
      photos: row.media.flatMap((m) => images.get(m.mediaId) ?? []),
      publishProblems: publishProblems(readiness(row)),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private card(row: ProductRow, images: Map<string, ProductCard['photo'] & object>) {
    const variants = row.variants.map(toVariantView);
    const first = row.media[0];
    return {
      id: row.id,
      titleTa: row.titleTa,
      fromPricePaise: variants.length > 0 ? fromPrice(variants) : 0,
      hasOptions: variants.length > 1,
      inStock: variants.some((v) => v.stock > 0),
      madeToOrder: row.madeToOrder,
      photo: (first && images.get(first.mediaId)) ?? null,
    };
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

function toVariantView(v: ProductVariant) {
  const attributes = variantAttributesSchema.safeParse(v.attributes);
  return {
    id: v.id,
    label: v.label,
    labelTa: v.labelTa,
    attributes: (attributes.success ? attributes.data : {}) as VariantAttributes,
    pricePaise: paiseToNumber(v.pricePaise),
    stock: v.stock,
  };
}

function encodeCursor(row: Product): string {
  return Buffer.from(`${row.publishedAt!.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { publishedAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const publishedAt = new Date(iso ?? '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Number.isNaN(publishedAt.getTime()) || !id || !uuid.test(id)) {
    throw new AppError('invalid_cursor', 'This page link is not valid.', HttpStatus.BAD_REQUEST);
  }
  return { publishedAt, id };
}

function readiness(row: ProductRow) {
  return {
    photoCount: row.media.length,
    title: row.title,
    categoryId: row.categoryId,
    variants: row.variants.map(toVariantView),
    madeToOrder: row.madeToOrder,
    leadTimeDays: row.leadTimeDays,
    fulfilmentModes: row.fulfilmentModes,
  };
}
