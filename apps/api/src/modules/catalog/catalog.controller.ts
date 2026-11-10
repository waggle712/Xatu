import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateProductRequest,
  createProductSchema,
  type ProductCard,
  type ProductDraft,
  productDraftSchema,
  type ProductPage,
  type PublicProduct,
  type SellerProduct,
  type SellerProductCard,
  type SetProductPhotosRequest,
  setProductPhotosSchema,
  type SetStockRequest,
  setStockSchema,
} from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { CatalogService } from './catalog.service.js';

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
const cursorSchema = z.string().max(120).optional();

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ── Buyers ──

  @Get('products/:id')
  @ApiOperation({ summary: 'Public product page (active, live, public shop only)' })
  product(@Param('id', ParseUUIDPipe) id: string): Promise<PublicProduct> {
    return this.catalog.getPublic(id);
  }

  @Get('shops/:handle/products')
  @ApiOperation({ summary: "A shop's live products, newest first" })
  shopProducts(
    @Param('handle') handle: string,
    @Query('cursor', new ZodValidationPipe(cursorSchema)) cursor?: string,
  ): Promise<ProductPage<ProductCard>> {
    return this.catalog.listShop(handle.toLowerCase(), cursor);
  }

  // ── Sellers ──

  @Post('seller/products')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'catalog:create', limit: 60, windowSeconds: 3600 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a draft (idempotent on the app-made id)' })
  @ApiBody({ schema: jsonSchema(createProductSchema) })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductRequest,
  ): Promise<SellerProduct> {
    return this.catalog.create(user.id, body);
  }

  @Get('seller/products')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('archived') archived?: string,
  ): Promise<{ items: SellerProductCard[] }> {
    return { items: await this.catalog.listOwn(user.id, archived === 'true') };
  }

  @Get('seller/products/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.getOwn(user.id, id);
  }

  @Patch('seller/products/:id')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'catalog:autosave', limit: 600, windowSeconds: 3600 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Autosave draft fields and the full variant list' })
  @ApiBody({ schema: jsonSchema(productDraftSchema) })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(productDraftSchema)) body: ProductDraft,
  ): Promise<SellerProduct> {
    return this.catalog.update(user.id, id, body);
  }

  @Put('seller/products/:id/photos')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace the ordered photo list (max 8, first is the cover)' })
  @ApiBody({ schema: jsonSchema(setProductPhotosSchema) })
  photos(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setProductPhotosSchema)) body: SetProductPhotosRequest,
  ): Promise<SellerProduct> {
    return this.catalog.setPhotos(user.id, id, body.mediaIds);
  }

  @Post('seller/products/:id/variants/:variantId/stock')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiBody({ schema: jsonSchema(setStockSchema) })
  stock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body(new ZodValidationPipe(setStockSchema)) body: SetStockRequest,
  ): Promise<SellerProduct> {
    return this.catalog.setStock(user.id, id, variantId, body.stock);
  }

  @Post('seller/products/:id/publish')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.publish(user.id, id);
  }

  @Post('seller/products/:id/pause')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.pause(user.id, id);
  }

  @Post('seller/products/:id/resume')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.resume(user.id, id);
  }

  @Post('seller/products/:id/archive')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.archive(user.id, id);
  }

  @Post('seller/products/:id/restore')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProduct> {
    return this.catalog.restore(user.id, id);
  }
}
