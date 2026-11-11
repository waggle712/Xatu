import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Cart,
  type CartLine,
  MAX_CART_LINES,
  type OrderMode,
  orderTotals,
} from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import { paiseToNumber } from '../../common/money.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type CartVariant, CatalogService } from '../catalog/catalog.service.js';
import { type OrderingShop, ProfilesService } from '../profiles/profiles.service.js';

/**
 * The buyer's bag: one maker at a time, prices always from the server. The bag holds no stock;
 * stock is held only when an order is created.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly profiles: ProfilesService,
  ) {}

  async get(userId: string): Promise<Cart> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!cart || cart.items.length === 0) return emptyCart();
    const [shop, variants] = await Promise.all([
      this.profiles.shopForOrder(cart.sellerId),
      this.catalog.variantsForCart(cart.items.map((i) => i.variantId)),
    ]);
    const lines: CartLine[] = cart.items.map((item) =>
      toLine(item, variants.get(item.variantId), shop),
    );
    return { seller: shop ? sellerView(shop) : null, lines, ...this.quote(lines, variants, shop) };
  }

  async setItem(
    userId: string,
    variantId: string,
    quantity: number,
    replaceCart: boolean,
  ): Promise<Cart> {
    if (quantity === 0) {
      await this.prisma.cartItem.deleteMany({ where: { variantId, cart: { userId } } });
      await this.dropIfEmpty(userId);
      return this.get(userId);
    }
    const found = await this.catalog.publicVariantSeller(variantId);
    if (!found) {
      throw new AppError(
        'product_not_found',
        'This product is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    const shop = await this.profiles.shopForOrder(found.sellerId);
    if (!shop)
      throw new AppError('shop_not_found', 'This shop is not available.', HttpStatus.NOT_FOUND);
    if (shop.ownerUserId === userId) {
      throw new AppError(
        'cannot_buy_own',
        "You can't buy from your own shop.",
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      let cart = await tx.cart.findUnique({ where: { userId }, include: { items: true } });
      if (cart && cart.sellerId !== shop.id && cart.items.length > 0) {
        if (!replaceCart) {
          const current = await this.profiles.shopForOrder(cart.sellerId);
          throw new AppError(
            'cart_other_seller',
            'Your bag has items from another maker. Start a new bag?',
            HttpStatus.CONFLICT,
            { seller: current ? sellerView(current) : null },
          );
        }
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }
      cart = cart
        ? await tx.cart.update({
            where: { id: cart.id },
            data: { sellerId: shop.id },
            include: { items: true },
          })
        : await tx.cart.create({ data: { userId, sellerId: shop.id }, include: { items: true } });
      const lines = cart.items.filter((i) => i.variantId !== variantId).length;
      if (lines >= MAX_CART_LINES) {
        throw new AppError(
          'cart_full',
          `A bag can hold up to ${MAX_CART_LINES} different items.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        create: { cartId: cart.id, variantId, productId: found.productId, quantity },
        update: { quantity },
      });
    });
    return this.get(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cart.deleteMany({ where: { userId } });
  }

  /** The maker the bag is for, or null when it is empty. */
  async sellerOf(userId: string): Promise<string | null> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { sellerId: true, _count: { select: { items: true } } },
    });
    return cart && cart._count.items > 0 ? cart.sellerId : null;
  }

  /** For orders, inside its transaction: the bag's lines, then emptied. */
  async takeLines(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
  ): Promise<{ sellerId: string; lines: { variantId: string; quantity: number }[] } | null> {
    const cart = await tx.cart.findUnique({
      where: { userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!cart || cart.items.length === 0) return null;
    await tx.cart.delete({ where: { id: cart.id } });
    return {
      sellerId: cart.sellerId,
      lines: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    };
  }

  private async dropIfEmpty(userId: string): Promise<void> {
    await this.prisma.cart.deleteMany({ where: { userId, items: { none: {} } } });
  }

  /** Totals for each way the bag can be fulfilled (offered by the shop and by every item). */
  private quote(lines: CartLine[], variants: Map<string, CartVariant>, shop: OrderingShop | null) {
    const ok = lines.filter((l) => l.problem === null);
    if (!shop || ok.length === 0) return { subtotalPaise: 0, options: [] };
    const priced = ok.map((l) => ({
      unitPricePaise: BigInt(l.unitPricePaise),
      quantity: l.quantity,
      commissionBps: 0,
    }));
    const subtotal = orderTotals(priced, 0n).subtotalPaise;
    const modes: OrderMode[] = (['pickup', 'local_delivery'] as const).filter(
      (m) =>
        shop.offeredModes.includes(m) &&
        ok.every((l) => variants.get(l.variantId)?.fulfilmentModes.includes(m)),
    );
    return {
      subtotalPaise: paiseToNumber(subtotal),
      options: modes.map((mode) => {
        const fee = mode === 'local_delivery' ? shop.localDeliveryFeePaise : 0n;
        return {
          mode,
          deliveryFeePaise: paiseToNumber(fee),
          totalPaise: paiseToNumber(orderTotals(priced, fee).totalPaise),
        };
      }),
    };
  }
}

function emptyCart(): Cart {
  return { seller: null, lines: [], subtotalPaise: 0, options: [] };
}

export function sellerView(shop: OrderingShop) {
  return {
    handle: shop.handle,
    businessName: shop.businessName,
    areaName: shop.areaName,
    city: shop.city,
    acceptingOrders: shop.acceptingOrders,
  };
}

function toLine(
  item: { variantId: string; productId: string; quantity: number },
  v: CartVariant | undefined,
  shop: OrderingShop | null,
): CartLine {
  const visible = !!v && v.public && !!shop && v.sellerId === shop.id;
  return {
    variantId: item.variantId,
    productId: item.productId,
    title: v?.title ?? '',
    titleTa: v?.titleTa ?? null,
    variantLabel: v?.label ?? null,
    variantLabelTa: v?.labelTa ?? null,
    unitPricePaise: v?.pricePaise ?? 0,
    quantity: item.quantity,
    photo: v?.photo ?? null,
    available: visible ? v.available : null,
    problem: !visible ? 'unavailable' : v.available < item.quantity ? 'not_enough_stock' : null,
  };
}
