import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MediaModule } from '../media/media.module.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';

/** Profiles: shops (seller profiles), categories for onboarding, public shop pages. */
@Module({
  imports: [IdentityModule, MediaModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, RateLimitGuard],
  exports: [ProfilesService],
})
export class ProfilesModule {}
