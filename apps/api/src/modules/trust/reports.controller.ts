import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type CreateReport, createReportSchema, type ReportReceipt } from '@xatu/shared';
import { z } from 'zod';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthGuard, CurrentUser } from '../identity/auth.guard.js';
import { ReportsService } from './reports.service.js';

@ApiTags('trust')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit({ name: 'trust:report', limit: 60, windowSeconds: 3600 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a listing or shop (one open report per person and target)' })
  @ApiBody({
    schema: z.toJSONSchema(createReportSchema, { io: 'input' }) as Record<string, unknown>,
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReport,
  ): Promise<ReportReceipt> {
    return this.reports.create(user.id, body);
  }
}
