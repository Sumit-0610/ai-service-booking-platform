import { prisma } from '@aisbp/database/testing';
import request from 'supertest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';

export const app = createApp();
export const agent = () => request(app);

const TEST_EMAIL_PREFIX = 'authtest-';
let sequence = 0;

export function uniqueEmail(tag = 'user'): string {
  sequence += 1;
  return `${TEST_EMAIL_PREFIX}${tag}-${Date.now()}-${sequence}@example.test`;
}

export const VALID_PASSWORD = 'correct-horse-battery-staple';

/** A distinct client IP per call so tests do not share rate-limit buckets. */
export function freshIp(): string {
  sequence += 1;
  return `2001:db8::${sequence.toString(16)}`;
}

export interface AuthCookies {
  raw: Record<string, string>;
  header: string;
  setCookieLines: string[];
  sessionId: string;
  csrfToken: string;
}

export function readCookies(res: request.Response): AuthCookies {
  const setCookie = (res.headers['set-cookie'] ?? []) as string | string[];
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const raw: Record<string, string> = {};
  for (const cookie of list) {
    const [pair] = cookie.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (pair && eq > -1) {
      raw[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return {
    raw,
    header: Object.entries(raw)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('; '),
    setCookieLines: list,
    sessionId: raw[env.SESSION_COOKIE_NAME] ?? '',
    csrfToken: raw[env.CSRF_COOKIE_NAME] ?? '',
  };
}

export async function registerUser(
  email = uniqueEmail(),
  password = VALID_PASSWORD,
): Promise<{ email: string; password: string; cookies: AuthCookies; body: unknown }> {
  const res = await agent()
    .post('/api/v1/auth/register')
    .set('X-Forwarded-For', freshIp())
    .send({ email, name: 'Test User', password });
  return { email, password, cookies: readCookies(res), body: res.body };
}

export async function loginUser(email: string, password = VALID_PASSWORD): Promise<AuthCookies> {
  const res = await agent()
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', freshIp())
    .send({ email, password });
  return readCookies(res);
}

export async function resetAuthState(): Promise<void> {
  await redis.flushdb();
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
}

export async function closeConnections(): Promise<void> {
  // `disconnect()` is safe on any connection state, including "never connected".
  redis.disconnect();
  await prisma.$disconnect();
}
