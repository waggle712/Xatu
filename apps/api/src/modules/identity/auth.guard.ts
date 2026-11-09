import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { TokenService } from './token.service.js';

/** Requires a valid Xatu access token and an active, non-deleted user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw unauthorized();

    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) throw unauthorized();

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        phone: true,
        name: true,
        language: true,
        roles: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw unauthorized();
    if (user.status !== 'active') {
      throw new AppError('account_suspended', 'This account is suspended.', HttpStatus.FORBIDDEN);
    }
    req.user = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      language: user.language,
      roles: user.roles,
    };
    return true;
  }
}

function unauthorized(): AppError {
  return new AppError('unauthorized', 'Please sign in again.', HttpStatus.UNAUTHORIZED);
}

/** The user set by AuthGuard. Only use on routes guarded by AuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw unauthorized();
  return user;
});
