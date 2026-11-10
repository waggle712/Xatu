import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MediaModule } from '../media/media.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * Catalog: products, variants, photos and stock. Owns its own tables; reaches shops and media
 * only through ProfilesService and MediaService. Other modules call CatalogService.
 */
@Module({
  imports: [IdentityModule, MediaModule, ProfilesModule],
  controllers: [CatalogController],
  providers: [CatalogService, RateLimitGuard],
  exports: [CatalogService],
})
export class CatalogModule {}
