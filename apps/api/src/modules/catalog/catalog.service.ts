import { HttpStatus, Injectable } from '@nestjs/common';
import {
  canTransitionProduct,
  type CreateProductRequest,
  type FulfilmentMode,
  fromPrice,
  type Image,
  isProductPublic,
  moderationOnPublish,
  type ProductCard,
  type ProductDraft,
  type ProductPage,
  type ProductStatus,
  MAX_SAVED_PRODUCTS,
  type PublicProduct,
  publishProblems,
  type SavedProductCard,
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

  // ───────────────────────────── Saved products (heart) ─────────────────────────────

  /**
   * Saves a product for a buyer. Safe to repeat. Only products buyers can see can be newly
   * saved; a product already saved stays a quiet no-op even if it has since been hidden.
   */
  async save(userId: string, productId: string): Promise<void> {
    const existing = await this.prisma.savedProduct.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) return;
    if (!(await this.publicProductSellerId(productId))) {
      throw new AppError(
        'product_not_found',
        'This product is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    if ((await this.prisma.savedProduct.count({ where: { userId } })) >= MAX_SAVED_PRODUCTS) {
      throw new AppError(
        'saved_list_full',
        `You can save up to ${MAX_SAVED_PRODUCTS} products. Remove some to save more.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: a parallel save of the same product writes one row and one event.
      const { count } = await tx.savedProduct.createMany({
        data: { userId, productId },
        skipDuplicates: true,
      });
      if (count === 1) await this.outbox(tx, 'product.saved', productId, { productId, userId });
    });
  }

  async unsave(userId: string, productId: string): Promise<void> {
    await this.prisma.savedProduct.deleteMany({ where: { userId, productId } });
  }

  /** Ids of every product the buyer saved (hidden ones too, so hearts stay right). */
  async savedProductIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.savedProduct.findMany({
      where: { userId },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_SAVED_PRODUCTS,
    });
    return rows.map((r) => r.productId);
  }

  /** The buyer's Saved list, newest first: only products buyers can still see. */
  async listSaved(
    userId: string,
    cursor: string | undefined,
  ): Promise<ProductPage<SavedProductCard>> {
    const after = cursor === undefined ? null : decodeSavedCursor(cursor);
    const saved = await this.prisma.savedProduct.findMany({
      where: {
        userId,
        product: {
          status: 'active',
          moderationStatus: 'live',
          title: { not: null },
          variants: { some: { deletedAt: null } },
        },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, productId: { lt: after.productId } },
              ],
            }
          : {}),
      },
      include: { product: { include: withChildren } },
      orderBy: [{ createdAt: 'desc' }, { productId: 'desc' }],
      take: PAGE_SIZE + 1,
    });
    const page = saved.slice(0, PAGE_SIZE);
    const [makers, images] = await Promise.all([
      this.profiles.publicSellers([...new Set(page.map((s) => s.product.sellerId))]),
      this.media.imagesFor(page.flatMap((s) => s.product.media.map((m) => m.mediaId))),
    ]);
    const items: SavedProductCard[] = [];
    for (const { product } of page) {
      const maker = makers.get(product.sellerId);
      if (!maker) continue; // the shop is no longer public
      items.push({
        ...this.card(product, images),
        title: product.title!,
        maker: { handle: maker.handle, businessName: maker.businessName, verified: maker.verified },
      });
    }
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: saved.length > PAGE_SIZE && last ? encodeSavedCursor(last) : null,
    };
  }

  /**
   * The seller id of a product buyers can see right now, or null. Used by trust (reports) so it
   * never reads the products table itself.
   */
  async publicProductSellerId(productId: string): Promise<string | null> {
    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        sellerId: true,
        status: true,
        moderationStatus: true,
        title: true,
        _count: { select: { variants: { where: { deletedAt: null } } } },
      },
    });
    if (!row || !isProductPublic(row) || !row.title || row._count.variants === 0) return null;
    const maker = (await this.profiles.publicSellers([row.sellerId])).get(row.sellerId);
    return maker ? row.sellerId : null;
  }

  // ───────────────────────────── Stock holds (used by orders) ─────────────────────────────

  /**
   * What the bag needs to show each line: buyer-safe product details, price and how many can be
   * bought right now (stock minus active holds). Lines whose product buyers can't see come back
   * with `public: false`.
   */
  async variantsForCart(variantIds: string[]): Promise<Map<string, CartVariant>> {
    if (variantIds.length === 0) return new Map();
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, deletedAt: null },
      include: { product: { include: { media: { orderBy: { position: 'asc' }, take: 1 } } } },
    });
    const sellers = await this.profiles.publicSellers([
      ...new Set(variants.map((v) => v.product.sellerId)),
    ]);
    const [held, images] = await Promise.all([
      heldUnits(
        this.prisma,
        variants.map((v) => v.id),
      ),
      this.media.imagesFor(variants.flatMap((v) => v.product.media.map((m) => m.mediaId))),
    ]);
    return new Map(
      variants.map((v) => {
        const p = v.product;
        const first = p.media[0];
        return [
          v.id,
          {
            variantId: v.id,
            productId: p.id,
            sellerId: p.sellerId,
            title: p.title ?? '',
            titleTa: p.titleTa,
            label: v.label,
            labelTa: v.labelTa,
            pricePaise: paiseToNumber(v.pricePaise),
            available: Math.max(0, v.stock - (held.get(v.id) ?? 0)),
            fulfilmentModes: p.fulfilmentModes,
            photo: (first && images.get(first.mediaId)) ?? null,
            public: isProductPublic(p) && !!p.title && sellers.has(p.sellerId),
          },
        ];
      }),
    );
  }

  /** The seller of a variant buyers can see right now, or null (for adding to the bag). */
  async publicVariantSeller(
    variantId: string,
  ): Promise<{ sellerId: string; productId: string } | null> {
    const v = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: { productId: true, product: { select: { sellerId: true } } },
    });
    if (!v) return null;
    const sellerId = await this.publicProductSellerId(v.productId);
    return sellerId ? { sellerId, productId: v.productId } : null;
  }

  /**
   * Checks stock for an order inside the caller's transaction (then call holdForOrder). Locks the variant rows FOR UPDATE
   * in id order (so two orders can never deadlock), counts active holds with the database clock,
   * and refuses with out_of_stock if any line can't be covered. Returns the locked rows'
   * purchase-time details (price read under the lock is the price charged).
   */
  async reserve(
    tx: Tx,
    input: { lines: { variantId: string; quantity: number }[] },
  ): Promise<ReservedLine[]> {
    const ids = [...new Set(input.lines.map((l) => l.variantId))].sort();
    const locked = await tx.$queryRaw<
      {
        id: string;
        product_id: string;
        stock: number;
        price_paise: bigint;
        label: string | null;
        label_ta: string | null;
        deleted_at: Date | null;
      }[]
    >`
      SELECT id, product_id, stock, price_paise, label, label_ta, deleted_at
      FROM product_variants WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const byId = new Map(locked.map((r) => [r.id, r]));
    const products = await tx.product.findMany({
      where: { id: { in: [...new Set(locked.map((r) => r.product_id))] } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const held = await heldUnits(tx, ids);

    const short: { variantId: string; available: number }[] = [];
    const out: ReservedLine[] = [];
    for (const line of input.lines) {
      const row = byId.get(line.variantId);
      const product = row ? productById.get(row.product_id) : undefined;
      if (!row || !product || row.deleted_at || !isProductPublic(product) || !product.title) {
        throw new AppError(
          'cart_has_problems',
          'Something in your bag is no longer available.',
          HttpStatus.CONFLICT,
          {
            variantId: line.variantId,
          },
        );
      }
      const available = row.stock - (held.get(row.id) ?? 0);
      if (available < line.quantity)
        short.push({ variantId: row.id, available: Math.max(0, available) });
      out.push({
        variantId: row.id,
        productId: product.id,
        sellerId: product.sellerId,
        categoryId: product.categoryId,
        title: product.title,
        titleTa: product.titleTa,
        label: row.label,
        labelTa: row.label_ta,
        unitPricePaise: row.price_paise,
        quantity: line.quantity,
        fulfilmentModes: product.fulfilmentModes,
      });
    }
    if (short.length > 0) {
      throw new AppError(
        'out_of_stock',
        'Sorry, not enough left. Someone else got there first.',
        HttpStatus.CONFLICT,
        {
          lines: short,
        },
      );
    }
    return out;
  }

  /**
   * Writes the holds for lines checked by `reserve`, in the same transaction (the variant rows
   * are still locked, so nothing can change in between). Call after the order row exists.
   */
  async holdForOrder(
    tx: Tx,
    input: { buyerId: string; orderId: string; expiresAt: Date; lines: ReservedLine[] },
  ): Promise<void> {
    await tx.inventoryReservation.createMany({
      data: input.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        buyerId: input.buyerId,
        orderId: input.orderId,
        quantity: l.quantity,
        expiresAt: input.expiresAt,
      })),
    });
  }

  /**
   * On a verified payment: lowers stock for the order's lines inside the caller's transaction.
   * Locks the variant rows in id order. If the order's holds are still active they are used;
   * if they lapsed (late payment) the lines must be covered by stock not held by anyone else.
   * Returns false, changing nothing, when there isn't enough. Stock never goes negative.
   */
  async commitForOrder(
    tx: Tx,
    input: { orderId: string; lines: { variantId: string; quantity: number }[] },
  ): Promise<boolean> {
    const ids = [...new Set(input.lines.map((l) => l.variantId))].sort();
    const locked = await tx.$queryRaw<{ id: string; stock: number }[]>`
      SELECT id, stock FROM product_variants WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const stockOf = new Map(locked.map((r) => [r.id, r.stock]));
    const own = await tx.$queryRaw<{ variant_id: string; held: bigint }[]>`
      SELECT variant_id, SUM(quantity)::bigint AS held FROM inventory_reservations
      WHERE order_id = ${input.orderId}::uuid AND status = 'active' AND expires_at > now()
      GROUP BY variant_id`;
    const ownHeld = new Map(own.map((r) => [r.variant_id, Number(r.held)]));
    const heldByAll = await heldUnits(tx, ids);
    const need = new Map<string, number>();
    for (const l of input.lines) need.set(l.variantId, (need.get(l.variantId) ?? 0) + l.quantity);

    for (const [variantId, qty] of need) {
      const stock = stockOf.get(variantId);
      if (stock === undefined) return false;
      // Units held by OTHER orders can't be sold to this one.
      const heldByOthers = (heldByAll.get(variantId) ?? 0) - (ownHeld.get(variantId) ?? 0);
      if (stock - heldByOthers < qty) return false;
    }
    for (const [variantId, qty] of need) {
      const stockAfter = stockOf.get(variantId)! - qty;
      await tx.productVariant.update({ where: { id: variantId }, data: { stock: stockAfter } });
      await tx.stockMovement.create({
        data: { variantId, delta: -qty, stockAfter, reason: 'order_sold', actorId: null },
      });
    }
    await tx.inventoryReservation.updateMany({
      where: { orderId: input.orderId, status: { in: ['active', 'expired'] } },
      data: { status: 'committed' },
    });
    return true;
  }

  /** Ends an order's active holds (cancelled → released, timed out → expired). */
  async releaseForOrder(tx: Tx, orderId: string, to: 'released' | 'expired'): Promise<void> {
    await tx.inventoryReservation.updateMany({
      where: { orderId, status: 'active' },
      data: { status: to },
    });
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
    return (await heldUnits(tx, [variantId])).get(variantId) ?? 0;
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

/**
 * Units held right now by unpaid orders, per variant: active holds that haven't expired by the
 * DATABASE clock. The one count used by checkout and by seller stock edits.
 */
async function heldUnits(
  db: Tx | PrismaService,
  variantIds: string[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ variant_id: string; held: bigint }[]>`
    SELECT variant_id, SUM(quantity)::bigint AS held FROM inventory_reservations
    WHERE variant_id = ANY(${variantIds}::uuid[]) AND status = 'active' AND expires_at > now()
    GROUP BY variant_id`;
  return new Map(rows.map((r) => [r.variant_id, Number(r.held)]));
}

export interface CartVariant {
  variantId: string;
  productId: string;
  sellerId: string;
  title: string;
  titleTa: string | null;
  label: string | null;
  labelTa: string | null;
  pricePaise: number;
  available: number;
  fulfilmentModes: FulfilmentMode[];
  photo: Image | null;
  public: boolean;
}

export interface ReservedLine {
  variantId: string;
  productId: string;
  sellerId: string;
  categoryId: string | null;
  title: string;
  titleTa: string | null;
  label: string | null;
  labelTa: string | null;
  unitPricePaise: bigint;
  quantity: number;
  fulfilmentModes: FulfilmentMode[];
}

function encodeSavedCursor(row: { createdAt: Date; productId: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.productId}`).toString('base64url');
}

function decodeSavedCursor(cursor: string): { createdAt: Date; productId: string } {
  const { publishedAt, id } = decodeCursor(cursor);
  return { createdAt: publishedAt, productId: id };
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
