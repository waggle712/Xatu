import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Trust and safety. Owns reports (and later reviews, disputes, KYC). Reaches listings and shops
 * only through CatalogService and ProfilesService.
 */
@Module({
  imports: [IdentityModule, CatalogModule, ProfilesModule],
  controllers: [ReportsController],
  providers: [ReportsService, RateLimitGuard],
  exports: [ReportsService],
})
export class TrustModule {}
