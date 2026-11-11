import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type FollowedShop,
  handleSchema,
  type ProductPage,
  type SavedProductCard,
  type SavedState,
} from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CatalogService } from '../catalog/catalog.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { ProfilesService } from '../profiles/profiles.service.js';

const cursorSchema = z.string().max(120).optional();
const handleParam = z.string().trim().toLowerCase().pipe(handleSchema);

/**
 * What a signed-in buyer keeps: saved products (catalog) and followed shops (profiles). Every
 * route acts only on the caller's own rows; PUT and DELETE are safe to repeat.
 */
@ApiTags('saved')
@ApiBearerAuth()
@Controller('me')
@UseGuards(AuthGuard, RateLimitGuard)
export class SocialController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get('saved')
  @ApiOperation({ summary: 'Ids of saved products and handles of followed shops (for hearts)' })
  async saved(@CurrentUser() user: AuthUser): Promise<SavedState> {
    const [productIds, shopHandles] = await Promise.all([
      this.catalog.savedProductIds(user.id),
      this.profiles.followedHandles(user.id),
    ]);
    return { productIds, shopHandles };
  }

  @Get('saved-products')
  @ApiOperation({ summary: 'Saved list, newest first (only products buyers can still see)' })
  savedProducts(
    @CurrentUser() user: AuthUser,
    @Query('cursor', new ZodValidationPipe(cursorSchema)) cursor?: string,
  ): Promise<ProductPage<SavedProductCard>> {
    return this.catalog.listSaved(user.id, cursor);
  }

  @Put('saved-products/:productId')
  @HttpCode(204)
  @RateLimit({ name: 'saved:toggle', limit: 300, windowSeconds: 60 })
  save(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    return this.catalog.save(user.id, productId);
  }

  @Delete('saved-products/:productId')
  @HttpCode(204)
  @RateLimit({ name: 'saved:toggle', limit: 300, windowSeconds: 60 })
  unsave(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    return this.catalog.unsave(user.id, productId);
  }

  @Get('following')
  @ApiOperation({ summary: 'Followed shops, newest first (public shops only)' })
  following(
    @CurrentUser() user: AuthUser,
    @Query('cursor', new ZodValidationPipe(cursorSchema)) cursor?: string,
  ): Promise<{ items: FollowedShop[]; nextCursor: string | null }> {
    return this.profiles.listFollowing(user.id, cursor);
  }

  @Put('following/:handle')
  @HttpCode(204)
  @RateLimit({ name: 'follow:toggle', limit: 300, windowSeconds: 60 })
  follow(
    @CurrentUser() user: AuthUser,
    @Param('handle', new ZodValidationPipe(handleParam)) handle: string,
  ): Promise<void> {
    return this.profiles.follow(user.id, handle);
  }

  @Delete('following/:handle')
  @HttpCode(204)
  @RateLimit({ name: 'follow:toggle', limit: 300, windowSeconds: 60 })
  unfollow(
    @CurrentUser() user: AuthUser,
    @Param('handle', new ZodValidationPipe(handleParam)) handle: string,
  ): Promise<void> {
    return this.profiles.unfollow(user.id, handle);
  }
}
