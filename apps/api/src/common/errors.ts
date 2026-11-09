import { HttpException, HttpStatus } from '@nestjs/common';

/** The one error shape every endpoint returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Throw this for expected, user-facing errors with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
