import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { FirebaseAdminVerifier, FirebaseVerifier } from './firebase-verifier.js';
import { IdentityService } from './identity.service.js';
import { TokenService } from './token.service.js';

/**
 * Identity: users, sessions, devices, consent. Other modules protect routes with the
 * exported AuthGuard; they never read the users or sessions tables directly.
 */
@Module({
  controllers: [AuthController],
  providers: [
    IdentityService,
    TokenService,
    AuthGuard,
    RateLimitGuard,
    { provide: FirebaseVerifier, useClass: FirebaseAdminVerifier },
  ],
  exports: [AuthGuard, TokenService, IdentityService],
})
export class IdentityModule {}
