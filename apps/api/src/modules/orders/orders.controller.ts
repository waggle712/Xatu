import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Cart,
  type CreateOrderRequest,
  createOrderSchema,
  type OrderView,
  setCartItemSchema,
} from '@xatu/shared';
import { z } from 'zod';
import { Idempotent, IdempotencyInterceptor } from '../../common/idempotency.js';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { CartService } from './cart.service.js';
import { OrdersService } from './orders.service.js';

const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  description: '8-128 chars; reuse it for retries',
};

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
@UseInterceptors(IdempotencyInterceptor)
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
  ) {}

  // ── Bag ──

  @Get('cart')
  @ApiOperation({
    summary: 'The bag with server prices, availability and a total per way to get it',
  })
  getCart(@CurrentUser() user: AuthUser): Promise<Cart> {
    return this.cart.get(user.id);
  }

  @Put('cart/items/:variantId')
  @RateLimit({ name: 'cart:write', limit: 300, windowSeconds: 60 })
  @ApiOperation({ summary: 'Set a line quantity (0 removes it). One maker per bag.' })
  setItem(
    @CurrentUser() user: AuthUser,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body(new ZodValidationPipe(setCartItemSchema)) body: z.output<typeof setCartItemSchema>,
  ): Promise<Cart> {
    return this.cart.setItem(user.id, variantId, body.quantity, body.replaceCart);
  }

  @Delete('cart')
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser): Promise<void> {
    return this.cart.clear(user.id);
  }

  // ── Orders ──

  @Post('orders')
  @Idempotent('orders:create')
  // Per IP; generous because mobile carriers put many buyers behind one IP (CGNAT).
  @RateLimit({ name: 'orders:create', limit: 120, windowSeconds: 60 })
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Order the bag: holds stock for 15 minutes; awaiting payment' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderRequest,
  ): Promise<OrderView> {
    return this.orders.create(user.id, body);
  }

  @Get('orders')
  list(@CurrentUser() user: AuthUser): Promise<{ items: OrderView[] }> {
    return this.orders.list(user.id);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrderView> {
    return this.orders.get(user.id, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Idempotent('orders:cancel')
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Cancel an unpaid order; its stock hold ends at once' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderView> {
    return this.orders.cancel(user.id, id);
  }
}
