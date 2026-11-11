import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateReport, ReportReceipt } from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

const OPEN = ['open', 'reviewing'] as const;

/**
 * Reports of listings and shops. Targets are checked through CatalogService and ProfilesService
 * (never their tables). One open report per reporter and target, enforced by the partial unique
 * index reports_one_open_per_target, so a repeat or a double tap returns the same report.
 * The details text is the reporter's own words: stored for the trust team, treated as data,
 * never sent to analytics or the outbox.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly profiles: ProfilesService,
  ) {}

  async create(userId: string, input: CreateReport): Promise<ReportReceipt> {
    const target = await this.resolveTarget(userId, input.target);
    const existing = await this.openReport(userId, target);
    if (existing) return { id: existing, alreadyReported: true };
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const report = await tx.report.create({
          data: {
            reporterId: userId,
            targetType: target.targetType,
            targetId: target.targetId,
            reason: input.reason,
            details: 'details' in input ? input.details : null,
          },
        });
        await tx.outboxEvent.create({
          data: {
            topic: 'report.created',
            aggregateId: target.targetId,
            payload: {
              reportId: report.id,
              targetType: target.targetType,
              targetId: target.targetId,
              sellerId: target.sellerId,
              reason: input.reason,
            },
          },
        });
        return report.id;
      });
      return { id, alreadyReported: false };
    } catch (err) {
      // Lost a race with a parallel report from the same person: return theirs.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const id = await this.openReport(userId, target);
        if (id) return { id, alreadyReported: true };
      }
      throw err;
    }
  }

  private async openReport(
    userId: string,
    target: { targetType: 'product' | 'seller'; targetId: string },
  ): Promise<string | null> {
    const row = await this.prisma.report.findFirst({
      where: {
        reporterId: userId,
        targetType: target.targetType,
        targetId: target.targetId,
        status: { in: [...OPEN] },
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async resolveTarget(
    userId: string,
    target: CreateReport['target'],
  ): Promise<{ targetType: 'product' | 'seller'; targetId: string; sellerId: string }> {
    const sellerId =
      target.type === 'product'
        ? await this.catalog.publicProductSellerId(target.id)
        : await this.profiles.publicSellerId(target.handle);
    if (!sellerId) {
      throw new AppError(
        target.type === 'product' ? 'product_not_found' : 'shop_not_found',
        target.type === 'product'
          ? 'This product is not available.'
          : 'This shop is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    if ((await this.profiles.ownerShop(userId))?.id === sellerId) {
      throw new AppError(
        'cannot_report_own',
        "You can't report your own shop or listing.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return target.type === 'product'
      ? { targetType: 'product', targetId: target.id, sellerId }
      : { targetType: 'seller', targetId: sellerId, sellerId };
  }
}
