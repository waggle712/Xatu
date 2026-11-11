import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  type RawBodyRequest,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { PaymentView, StartPayment } from '@xatu/shared';
import type { Request } from 'express';
import { AppError } from '../../common/errors.js';
import { Idempotent, IdempotencyInterceptor } from '../../common/idempotency.js';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { env } from '../../config/env.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { PaymentsService } from './payments.service.js';
import { WebhookProcessor } from './webhook.processor.js';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly webhooks: WebhookProcessor,
  ) {}

  @Post('orders/:id/pay')
  @UseGuards(AuthGuard, RateLimitGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent('payments:start')
  @RateLimit({ name: 'payments:start', limit: 120, windowSeconds: 60 })
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Open Razorpay Checkout for an unpaid order (one payment per order)' })
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StartPayment> {
    return this.payments.start(user.id, id);
  }

  @Get('payments/:id')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'payments:view', limit: 600, windowSeconds: 60 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Payment status (the app polls this; it never marks anything paid)' })
  view(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentView> {
    return this.payments.view(user.id, id);
  }

  /** Razorpay → us. No auth guard or Idempotency-Key: the signature and event id do that job. */
  @Post('webhooks/razorpay')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'webhooks:razorpay', limit: 1200, windowSeconds: 60 })
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ ok: true }> {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new AppError(
        'payments_unavailable',
        'Webhooks are not set up.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!req.rawBody || req.rawBody.length === 0) {
      throw new AppError('bad_webhook', 'Empty body.', HttpStatus.BAD_REQUEST);
    }
    const result = await this.webhooks.receive(req.rawBody, signature, eventId);
    if (result === 'invalid')
      throw new AppError('bad_signature', 'Invalid signature.', HttpStatus.BAD_REQUEST);
    return { ok: true };
  }
}
