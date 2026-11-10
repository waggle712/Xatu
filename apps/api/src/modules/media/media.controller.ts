import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateUploadRequest,
  createUploadSchema,
  type MediaAsset,
  type UploadTicket,
} from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'media:upload', limit: 60, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Get a signed URL to upload one image (≤ 10 MB, jpeg/png/webp)' })
  @ApiBody({
    schema: z.toJSONSchema(createUploadSchema, { io: 'input' }) as Record<string, unknown>,
  })
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUploadSchema)) body: CreateUploadRequest,
  ): Promise<UploadTicket> {
    return this.media.createUpload(user.id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tell the server the upload finished; processing starts' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MediaAsset> {
    return this.media.complete(user.id, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Status and variant URLs of my upload' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MediaAsset> {
    return this.media.get(user.id, id);
  }
}
