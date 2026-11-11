import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type Address, addressInputSchema } from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AddressesService } from './addresses.service.js';
import type { AuthUser } from './auth-user.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';

const patchSchema = addressInputSchema.partial();

@ApiTags('addresses')
@ApiBearerAuth()
@Controller('me/addresses')
@UseGuards(AuthGuard, RateLimitGuard)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<{ items: Address[] }> {
    return { items: await this.addresses.list(user.id) };
  }

  @Post()
  @RateLimit({ name: 'addresses:write', limit: 60, windowSeconds: 3600 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addressInputSchema)) body: z.output<typeof addressInputSchema>,
  ): Promise<Address> {
    return this.addresses.create(user.id, body);
  }

  @Patch(':id')
  @RateLimit({ name: 'addresses:write', limit: 60, windowSeconds: 3600 })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: z.output<typeof patchSchema>,
  ): Promise<Address> {
    return this.addresses.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
