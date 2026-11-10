import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { AppError } from './errors.js';

export interface RateLimitOptions {
  /** Bucket name, e.g. 'auth:session'. */
  name: string;
  /** Max requests per window, per client IP. */
  limit: number;
  windowSeconds: number;
  /** Also count separately per value of this route param (e.g. 'id' = per product). */
  perParam?: string;
}

const RATE_LIMIT = 'xatu:rate-limit';

/** Fixed-window rate limit per client IP, counted in Redis. Use with RateLimitGuard. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

export const RATE_LIMIT_KEY_PREFIX = 'rl:';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
    const scope = options.perParam ? `${String(req.params?.[options.perParam] ?? '')}:` : '';
    const key = `${RATE_LIMIT_KEY_PREFIX}${options.name}:${req.ip ?? 'unknown'}:${scope}${window}`;

    const [[, count]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, options.windowSeconds)
      .exec()) as [[Error | null, number], [Error | null, number]];

    res.setHeader('RateLimit-Limit', options.limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, options.limit - count));
    if (count > options.limit) {
      res.setHeader('Retry-After', options.windowSeconds);
      throw new AppError(
        'rate_limited',
        'Too many attempts. Please wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
