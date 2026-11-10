import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Category,
  type CreateShopRequest,
  createShopSchema,
  handleSchema,
  type MyShop,
  type PublicShop,
  type UpdateShopRequest,
  updateShopSchema,
} from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { ProfilesService } from './profiles.service.js';

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

@ApiTags('shops')
@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Top-level product categories (en + ta)' })
  categories(): Promise<Category[]> {
    return this.profiles.listCategories();
  }

  @Get('shops/:handle')
  @ApiOperation({ summary: 'Public shop page. Never includes the exact pickup point or address.' })
  publicShop(@Param('handle') handle: string): Promise<PublicShop> {
    return this.profiles.getPublicShop(handle.toLowerCase());
  }

  @Get('sellers/handle-available')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'sellers:handle', limit: 60, windowSeconds: 60 })
  @ApiBearerAuth()
  async handleAvailable(
    @Query('handle', new ZodValidationPipe(handleSchema)) handle: string,
  ): Promise<{ available: boolean }> {
    return { available: await this.profiles.isHandleAvailable(handle) };
  }

  @Post('sellers')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'sellers:create', limit: 5, windowSeconds: 3600 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open a shop (starts as draft)' })
  @ApiBody({ schema: jsonSchema(createShopSchema) })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createShopSchema)) body: CreateShopRequest,
  ): Promise<MyShop> {
    return this.profiles.createShop(user.id, body);
  }

  @Get('sellers/me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My shop, or null' })
  async mine(@CurrentUser() user: AuthUser): Promise<{ shop: MyShop | null }> {
    return { shop: await this.profiles.getMyShop(user.id) };
  }

  @Patch('sellers/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiBody({ schema: jsonSchema(updateShopSchema) })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateShopSchema)) body: UpdateShopRequest,
  ): Promise<MyShop> {
    return this.profiles.updateShop(user.id, id, body);
  }

  @Post('sellers/:id/submit')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a draft shop for review' })
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MyShop> {
    return this.profiles.submitForReview(user.id, id);
  }

  @Post('sellers/:id/pause')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  pause(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MyShop> {
    return this.profiles.pause(user.id, id);
  }

  @Post('sellers/:id/resume')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  resume(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MyShop> {
    return this.profiles.resume(user.id, id);
  }
}
