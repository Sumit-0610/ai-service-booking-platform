import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  agent,
  closeConnections,
  freshIp,
  loginUser,
  readCookies,
  registerUser,
  resetAuthState,
  uniqueEmail,
  VALID_PASSWORD,
} from '../../test/helpers.js';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';

/**
 * Integration tests for the auth endpoints. Require a migrated PostgreSQL and a
 * reachable Redis (see docs/local-development.md and CI). No Redis-dependent
 * test is skipped: if Redis is down these fail.
 */

beforeAll(resetAuthState);
afterAll(closeConnections);
beforeEach(resetAuthState);

function expectNoPasswordHash(payload: unknown): void {
  const serialised = JSON.stringify(payload);
  expect(serialised).not.toMatch(/passwordHash/i);
  expect(serialised).not.toMatch(/\$argon2/);
}

describe('POST /api/v1/auth/register', () => {
  it('creates a customer, starts a session, and never returns the hash', async () => {
    const email = uniqueEmail();
    const res = await agent()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ email, name: 'Dana Customer', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, name: 'Dana Customer', role: 'customer' });
    expect(res.body.user.id).toEqual(expect.any(String));
    expectNoPasswordHash(res.body);

    const cookies = readCookies(res);
    expect(cookies.sessionId).not.toBe('');
    expect(cookies.csrfToken).not.toBe('');
    const sessionCookieLine =
      cookies.setCookieLines.find((line) => line.startsWith(`${env.SESSION_COOKIE_NAME}=`)) ?? '';
    expect(sessionCookieLine).toMatch(/HttpOnly/i);
    expect(sessionCookieLine).toMatch(/SameSite=Lax/i);
    const csrfCookieLine =
      cookies.setCookieLines.find((line) => line.startsWith(`${env.CSRF_COOKIE_NAME}=`)) ?? '';
    expect(csrfCookieLine).not.toMatch(/HttpOnly/i);
  });

  it('rejects invalid input with a 422 and field details', async () => {
    const res = await agent()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'not-an-email', name: '', password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(
      ['email', 'name', 'password'].sort(),
    );
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail();
    await registerUser(email);
    const res = await agent()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ email, name: 'Someone Else', password: VALID_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('authenticates with correct credentials and rotates the session', async () => {
    const { email, cookies: registered } = await registerUser();
    const loggedIn = await loginUser(email);

    expect(loggedIn.sessionId).not.toBe('');
    expect(loggedIn.sessionId).not.toBe(registered.sessionId); // session fixation defence
  });

  it('returns a generic 401 for a wrong password', async () => {
    const { email } = await registerUser();
    const res = await agent()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email, password: 'wrong-password-value' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same generic 401 for an unknown email (no user enumeration)', async () => {
    const res = await agent()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: uniqueEmail(), password: VALID_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('rate-limits repeated attempts from one client', async () => {
    const { email } = await registerUser();
    const ip = freshIp();
    const attempt = () =>
      agent()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'wrong-password-value' });

    for (let i = 0; i < env.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await agent().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user (no hash) when authenticated', async () => {
    const { email } = await registerUser();
    const cookies = await loginUser(email);
    const res = await agent().get('/api/v1/auth/me').set('Cookie', cookies.header);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expectNoPasswordHash(res.body);
  });

  it('rejects a forged / tampered session cookie', async () => {
    const res = await agent()
      .get('/api/v1/auth/me')
      .set('Cookie', `${env.SESSION_COOKIE_NAME}=totally-made-up-session-id`);
    expect(res.status).toBe(401);
  });

  // M16 hardening: the stored session is validated on read, so a poisoned Redis
  // blob cannot escalate a role. `req.user.role` flows straight into requireRole.
  it('rejects a session whose stored role is not a real role (no privilege escalation)', async () => {
    const { email } = await registerUser();
    const cookies = await loginUser(email);
    const sessionId = cookies.raw[env.SESSION_COOKIE_NAME];
    expect(sessionId).toBeTruthy();

    // Overwrite the stored blob with an invalid role.
    const raw = await redis.get(`sess:${sessionId}`);
    const poisoned = { ...JSON.parse(raw as string), role: 'superadmin' };
    await redis.set(`sess:${sessionId}`, JSON.stringify(poisoned));

    const res = await agent().get('/api/v1/auth/me').set('Cookie', cookies.header);
    expect(res.status).toBe(401);

    // And it cannot reach an operations route either.
    const ops = await agent()
      .get('/api/v1/operations/dashboard')
      .set('Cookie', cookies.header)
      .set('X-Forwarded-For', freshIp());
    expect(ops.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('invalidates the session and requires a CSRF token', async () => {
    const { email } = await registerUser();
    const cookies = await loginUser(email);

    // Missing CSRF header -> rejected.
    const noCsrf = await agent().post('/api/v1/auth/logout').set('Cookie', cookies.header);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_ERROR');

    // Wrong CSRF header -> rejected.
    const badCsrf = await agent()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.header)
      .set('X-CSRF-Token', 'not-the-real-token');
    expect(badCsrf.status).toBe(403);

    // A same-length but incorrect token is also rejected (constant-time compare,
    // M16 hardening — must not throw on the length check either).
    const sameLenWrong = 'A'.repeat(cookies.csrfToken.length);
    const badCsrf2 = await agent()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.header)
      .set('X-CSRF-Token', sameLenWrong);
    expect(badCsrf2.status).toBe(403);
    expect(badCsrf2.body.error.code).toBe('CSRF_ERROR');

    // Correct CSRF header -> succeeds.
    const ok = await agent()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies.header)
      .set('X-CSRF-Token', cookies.csrfToken);
    expect(ok.status).toBe(204);

    // Session is now dead.
    const after = await agent().get('/api/v1/auth/me').set('Cookie', cookies.header);
    expect(after.status).toBe(401);
  });
});
