/**
 * The only error type the tool services throw. Mirrors `AppError` in
 * `apps/api/src/lib/errors.ts` (a small code enum + a client-safe message); the
 * server wrapper turns it into an MCP `isError` result with the same
 * `{ error: { code, message, details? } }` envelope the REST API uses.
 *
 * `INTERNAL` is never constructed here — an unexpected throw is caught by the
 * wrapper, logged, and reported generically so nothing internal leaks to the
 * model.
 */
export type ToolErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: unknown[] | undefined;

  constructor(code: ToolErrorCode, message: string, details?: unknown[]) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}

export function validationDetail(field: string, message: string): unknown[] {
  return [{ path: field, message }];
}
