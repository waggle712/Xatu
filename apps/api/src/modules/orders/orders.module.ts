import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency.js';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { CartService } from './cart.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersExpiry } from './orders.expiry.js';
import { OrdersService } from './orders.service.js';

/**
 * Orders: the bag, order creation and the order state machine. Owns carts, orders, order items
 * and order events. Holds stock through CatalogService.reserve and reads shops through
 * ProfilesService; never their tables.
 */
@Module({
  imports: [IdentityModule, CatalogModule, ProfilesModule],
  controllers: [OrdersController],
  providers: [CartService, OrdersService, OrdersExpiry, RateLimitGuard, IdempotencyInterceptor],
  exports: [OrdersService],
})
export class OrdersModule {}
