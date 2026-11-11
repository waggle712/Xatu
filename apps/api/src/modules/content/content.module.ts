import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialController } from './social.controller.js';
import { WebController } from './web.controller.js';

/**
 * Content: what buyers keep and share. The Saved and Following routes (rows owned by catalog and
 * profiles, reached through their services), and the web side of share links (link files and
 * preview pages). Owns no tables yet; posts and reels come here later.
 */
@Module({
  imports: [IdentityModule, CatalogModule, ProfilesModule],
  controllers: [SocialController, WebController],
  providers: [RateLimitGuard],
})
export class ContentModule {}
