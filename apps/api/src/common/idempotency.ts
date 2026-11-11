import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable } from 'rxjs';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { AppError } from './errors.js';

const IDEMPOTENT = 'xatu:idempotent';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RECORD_TTL_MS = 24 * 60 * 60_000;
/** An in-progress record older than this was abandoned (crash, timeout) and may be taken over. */
const LEASE_MS = 60_000;

/**
 * Marks a mutating order or money endpoint: it then requires an `Idempotency-Key` header
 * (stored in idempotency_records). A retry with the same key and body gets the first response;
 * the same key with a different body is refused. Final 4xx answers are stored and replayed, so
 * after one the app must use a new key; 5xx answers are not stored, so a retry can go through.
 * Use after AuthGuard (the record is scoped to the user).
 */
export const Idempotent = (endpoint: string) => SetMetadata(IDEMPOTENT, endpoint);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly errors = new ApiExceptionFilter();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const endpoint = this.reflector.get<string | undefined>(IDEMPOTENT, context.getHandler());
    if (!endpoint) return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthorized', 'Please sign in.', HttpStatus.UNAUTHORIZED);

    const key = req.header('Idempotency-Key');
    if (!key || !KEY_PATTERN.test(key)) {
      throw new AppError(
        'idempotency_key_required',
        'This request needs an Idempotency-Key header (8-128 letters, digits, - or _).',
        HttpStatus.BAD_REQUEST,
      );
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify([endpoint, req.params ?? {}, req.body ?? null]))
      .digest('hex');
    const successCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);

    return from(this.claim(userId, endpoint, key, requestHash)).pipe(
      mergeMap((claim) => {
        if (claim.replay) return from(this.replay(claim.replay));
        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(this.finish(claim.id, successCode, body).then(() => body)),
          ),
          catchError((err: unknown) => from(this.fail(claim.id, err))),
        );
      }),
    );
  }

  /** Commits an in-progress record before any work, or returns the stored answer to replay. */
  private async claim(
    userId: string,
    endpoint: string,
    key: string,
    requestHash: string,
  ): Promise<{ id: string; replay?: undefined } | { id?: undefined; replay: StoredAnswer }> {
    try {
      const row = await this.prisma.idempotencyRecord.create({
        data: {
          userId,
          endpoint,
          key,
          requestHash,
          expiresAt: new Date(Date.now() + RECORD_TTL_MS),
        },
      });
      return { id: row.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({
      where: { userId_endpoint_key: { userId, endpoint, key } },
    });
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'idempotency_key_reused',
        'This Idempotency-Key was already used for a different request.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (existing.status === 'completed' && existing.responseCode !== null) {
      return { replay: { code: existing.responseCode, body: existing.responseBody } };
    }
    // Still running, unless the lease ran out: then take it over (compare-and-set on updatedAt).
    if (Date.now() - existing.updatedAt.getTime() > LEASE_MS) {
      const { count } = await this.prisma.idempotencyRecord.updateMany({
        where: { id: existing.id, status: 'in_progress', updatedAt: existing.updatedAt },
        data: { updatedAt: new Date() },
      });
      if (count === 1) return { id: existing.id };
    }
    throw new AppError(
      'idempotency_in_progress',
      'This request is still being processed. Try again in a moment.',
      HttpStatus.CONFLICT,
    );
  }

  private async replay(answer: StoredAnswer): Promise<unknown> {
    if (answer.code < 400) return answer.body;
    const e = (answer.body as { error?: { code: string; message: string; details?: unknown } })
      ?.error;
    throw new AppError(
      e?.code ?? 'unknown',
      e?.message ?? 'Request failed',
      answer.code,
      e?.details,
    );
  }

  private async finish(id: string, code: number, body: unknown): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id },
      data: {
        status: 'completed',
        responseCode: code,
        responseBody: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }

  /** Final 4xx: store it (replayed for the same key). 5xx or unexpected: forget the key. */
  private async fail(id: string, err: unknown): Promise<never> {
    const { status, body } = this.errors.toBody(err);
    const transient = status >= 500 || status === 429 || (status === 409 && isTransient(body));
    if (transient) {
      await this.prisma.idempotencyRecord.delete({ where: { id } }).catch(() => undefined);
    } else {
      await this.prisma.idempotencyRecord
        .update({
          where: { id },
          data: {
            status: 'completed',
            responseCode: status,
            responseBody: body as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
    }
    throw err;
  }
}

interface StoredAnswer {
  code: number;
  body: unknown;
}

/** Conflicts that may pass on a plain retry are not stored. */
function isTransient(body: { error: { code: string } }): boolean {
  return ['idempotency_in_progress', 'busy'].includes(body.error.code);
}
