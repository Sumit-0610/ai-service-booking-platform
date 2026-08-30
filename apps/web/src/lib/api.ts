import { healthResponseSchema, type HealthResponse } from '@aisbp/shared';
import { clientEnv } from '../config/env';

const CSRF_COOKIE_NAME = 'aisbp.csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[] | undefined;

  constructor(status: number, code: string, message: string, details?: unknown[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCookie(name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Single fetch wrapper for the API. Always sends the session cookie
 * (`credentials: 'include'`), attaches the CSRF token on state-changing
 * requests, and turns the `{ error: { code, message } }` envelope into an
 * `ApiError`. The session lives in an HttpOnly cookie — never in JS or storage.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (UNSAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  const response = await fetch(`${clientEnv.VITE_API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    const envelope = (
      payload as { error?: { code?: string; message?: string; details?: unknown[] } }
    )?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'UNKNOWN',
      envelope?.message ?? 'Request failed',
      envelope?.details,
    );
  }

  return payload as T;
}

export async function getApiHealth(): Promise<HealthResponse> {
  return healthResponseSchema.parse(await apiRequest('/api/v1/health'));
}
