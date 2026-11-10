import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { MediaModule } from '../media/media.module.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';

/** Search and discovery: home feed, search, makers near you. Read-only; see DiscoveryService. */
@Module({
  imports: [MediaModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, RateLimitGuard],
  exports: [DiscoveryService],
})
export class SearchModule {}
