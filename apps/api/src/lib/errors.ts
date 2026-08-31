export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_ERROR'
  | 'EMAIL_TAKEN'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_ERROR: 403,
  EMAIL_TAKEN: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

/**
 * The only error type route handlers and services should throw. The error
 * handler turns it into the standard `{ error: { code, message, details? } }`
 * envelope. Messages must be safe to show a client.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details: unknown[] | undefined;

  constructor(code: ApiErrorCode, message: string, details?: unknown[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}
