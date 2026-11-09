import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthSession,
  type CreateSessionRequest,
  createSessionRequestSchema,
  type Me,
  type RefreshRequest,
  refreshRequestSchema,
} from '@xatu/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from './auth-user.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { IdentityService } from './identity.service.js';

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema) as Record<string, unknown>;

@ApiTags('auth')
@Controller()
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Post('auth/session')
  @HttpCode(200)
  @RateLimit({ name: 'auth:session', limit: 10, windowSeconds: 60 })
  @ApiOperation({ summary: 'Exchange a Firebase phone-auth ID token for Xatu tokens' })
  @ApiBody({ schema: jsonSchema(createSessionRequestSchema) })
  createSession(
    @Body(new ZodValidationPipe(createSessionRequestSchema)) body: CreateSessionRequest,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.identity.createSession(body, clientInfo(req));
  }

  @Post('auth/refresh')
  @HttpCode(200)
  @RateLimit({ name: 'auth:refresh', limit: 30, windowSeconds: 60 })
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  @ApiBody({ schema: jsonSchema(refreshRequestSchema) })
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.identity.refresh(body.refreshToken, clientInfo(req));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @RateLimit({ name: 'auth:logout', limit: 30, windowSeconds: 60 })
  @ApiOperation({ summary: 'Revoke this device session' })
  @ApiBody({ schema: jsonSchema(refreshRequestSchema) })
  async logout(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
  ): Promise<void> {
    await this.identity.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.identity.getMe(user.id);
  }
}

function clientInfo(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}
