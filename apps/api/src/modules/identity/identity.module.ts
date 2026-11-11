import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { env } from '../../config/env.js';
import {
  DevFirebaseVerifier,
  FirebaseAdminVerifier,
  FirebaseVerifier,
} from './firebase-verifier.js';
import { IdentityService } from './identity.service.js';
import { TokenService } from './token.service.js';

/**
 * Identity: users, sessions, devices, consent, delivery addresses. Other modules protect routes with the
 * exported AuthGuard; they never read the users or sessions tables directly.
 */
@Module({
  controllers: [AuthController, AddressesController],
  providers: [
    IdentityService,
    AddressesService,
    TokenService,
    AuthGuard,
    RateLimitGuard,
    {
      provide: FirebaseVerifier,
      useClass: env.AUTH_DEV_BYPASS ? DevFirebaseVerifier : FirebaseAdminVerifier,
    },
  ],
  exports: [AuthGuard, TokenService, IdentityService, AddressesService],
})
export class IdentityModule {}
