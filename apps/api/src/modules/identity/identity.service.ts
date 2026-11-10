import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { AuthSession, CreateSessionRequest, Me } from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FirebaseVerifier, InvalidFirebaseTokenError } from './firebase-verifier.js';
import { TokenService } from './token.service.js';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

type UserWithSeller = User & { sellerProfile: { id: string } | null };

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseVerifier,
    private readonly tokens: TokenService,
  ) {}

  /** Exchanges a Firebase phone-auth ID token for a Xatu session, creating the user if new. */
  async createSession(input: CreateSessionRequest, client: ClientInfo): Promise<AuthSession> {
    let identity;
    try {
      identity = await this.firebase.verify(input.firebaseIdToken);
    } catch (err) {
      if (err instanceof InvalidFirebaseTokenError) {
        throw new AppError(
          'invalid_firebase_token',
          'Could not verify your phone sign-in. Please try again.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw err;
    }

    const { user, isNewUser } = await this.prisma.$transaction(async (tx) => {
      const byUid = await tx.user.findUnique({ where: { firebaseUid: identity.firebaseUid } });
      if (byUid) return { user: byUid, isNewUser: false };

      // Firebase has just proven ownership of this phone number, so link an existing
      // account with the same phone (e.g. a maker onboarded by the team) to this Firebase user.
      const byPhone = await tx.user.findUnique({ where: { phone: identity.phone } });
      if (byPhone && env.AUTH_DEV_BYPASS && !/^(dev|seed)-/.test(byPhone.firebaseUid)) {
        // The development login proves nothing about the phone, so it may never take over
        // an account that belongs to a real Firebase user.
        throw new AppError(
          'invalid_firebase_token',
          'Development login cannot use this number.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (byPhone) {
        const linked = await tx.user.update({
          where: { id: byPhone.id },
          data: { firebaseUid: identity.firebaseUid },
        });
        return { user: linked, isNewUser: false };
      }

      const created = await tx.user.create({
        data: {
          firebaseUid: identity.firebaseUid,
          phone: identity.phone,
          language: input.language ?? 'ta',
        },
      });
      await tx.outboxEvent.create({
        data: {
          topic: 'identity.user_signed_up',
          aggregateId: created.id,
          payload: { userId: created.id },
        },
      });
      return { user: created, isNewUser: true };
    });

    this.assertCanSignIn(user);
    const full = await this.loadUser(user.id);
    return this.issueSession(full, { deviceName: input.deviceName, ...client }, isNewUser);
  }

  /** Rotates a refresh token. Reusing an already-rotated token revokes every session of that user. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthSession> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session) throw invalidRefresh();

    if (session.revokedAt) {
      await this.revokeAllSessions(session.userId);
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId}; all sessions revoked`,
      );
      throw invalidRefresh();
    }
    if (session.expiresAt.getTime() <= Date.now()) throw invalidRefresh();

    // Conditional update so two concurrent refreshes cannot both succeed.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      await this.revokeAllSessions(session.userId);
      throw invalidRefresh();
    }

    const user = await this.loadUser(session.userId);
    this.assertCanSignIn(user);
    const issued = await this.issueSession(
      user,
      { deviceName: session.deviceName ?? undefined, ...client },
      false,
    );
    const newSession = await this.prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: this.tokens.hashRefreshToken(issued.refreshToken) },
      select: { id: true },
    });
    await this.prisma.session.update({
      where: { id: session.id },
      data: { replacedById: newSession.id },
    });
    return issued;
  }

  /** Revokes one session. Unknown or already-revoked tokens are ignored (logout is idempotent). */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: this.tokens.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<Me> {
    return toMe(await this.loadUser(userId));
  }

  private async issueSession(
    user: UserWithSeller,
    meta: ClientInfo & { deviceName?: string },
    isNewUser: boolean,
  ): Promise<AuthSession> {
    const refreshToken = this.tokens.newRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const data: Prisma.SessionUncheckedCreateInput = {
      userId: user.id,
      refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
      deviceName: meta.deviceName ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: refreshExpiresAt,
    };
    await this.prisma.session.create({ data });
    const access = await this.tokens.signAccessToken({ sub: user.id, roles: user.roles });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: toMe(user),
      isNewUser,
    };
  }

  private async loadUser(id: string): Promise<UserWithSeller> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { sellerProfile: { select: { id: true } } },
    });
  }

  private assertCanSignIn(user: User): void {
    if (user.deletedAt) {
      throw new AppError('account_deleted', 'This account was deleted.', HttpStatus.FORBIDDEN);
    }
    if (user.status !== 'active') {
      throw new AppError('account_suspended', 'This account is suspended.', HttpStatus.FORBIDDEN);
    }
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function toMe(user: UserWithSeller): Me {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    language: user.language,
    roles: user.roles,
    isSeller: user.sellerProfile !== null,
  };
}

function invalidRefresh(): AppError {
  return new AppError('invalid_refresh_token', 'Please sign in again.', HttpStatus.UNAUTHORIZED);
}
