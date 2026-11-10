import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { env } from '../../config/env.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LocalMediaController } from './local-media.controller.js';
import { LocalImageVariants, LocalStorage } from './local-storage.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaWorker } from './media.worker.js';
import { CloudflareImageVariants, R2Storage } from './r2-storage.js';
import { IMAGE_VARIANTS, MEDIA_STORAGE } from './storage.js';

const local = env.MEDIA_STORAGE === 'local';

/** Media: signed uploads, processing worker, variant URLs. Other modules use MediaService. */
@Module({
  imports: [IdentityModule],
  controllers: local ? [MediaController, LocalMediaController] : [MediaController],
  providers: [
    MediaService,
    MediaWorker,
    RateLimitGuard,
    { provide: MEDIA_STORAGE, useFactory: () => (local ? new LocalStorage() : new R2Storage()) },
    {
      provide: IMAGE_VARIANTS,
      useFactory: () => (local ? new LocalImageVariants() : new CloudflareImageVariants()),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
