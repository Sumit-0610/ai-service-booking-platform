import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { closeConnections, loginUser, registerUser, resetAuthState } from '../test/helpers.js';
import { requireAuth } from './authenticate.js';
import { requireResourceOwner, requireRole } from './authorize.js';
import { errorHandler } from './error-handler.js';
import { prisma } from '@aisbp/database/testing';

/**
 * The authorization middleware is meant to be reused by every future route, so
 * we test it directly against a throwaway app rather than inventing business
 * endpoints just to demonstrate it.
 */
function harnessApp() {
  const app = express();
  app.use(cookieParser());

  app.get('/ops-only', requireAuth, requireRole('operations'), (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/staff-only', requireAuth, requireRole('operations', 'technician'), (_req, res) => {
    res.json({ ok: true });
  });

  // A resource "owned" by the user whose id is in the path.
  app.get(
    '/things/:ownerId',
    requireAuth,
    requireResourceOwner((req) =>
      typeof req.params.ownerId === 'string' ? req.params.ownerId : null,
    ),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  app.use(errorHandler);
  return app;
}

const app = harnessApp();

beforeAll(resetAuthState);
afterAll(closeConnections);
beforeEach(resetAuthState);

async function makeUser(role: 'customer' | 'operations' | 'technician') {
  const { email } = await registerUser();
  if (role !== 'customer') {
    await prisma.user.update({ where: { email }, data: { role } });
  }
  const cookies = await loginUser(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, cookies };
}

describe('requireRole', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).get('/ops-only');
    expect(res.status).toBe(401);
  });

  it('rejects a customer from an operations route', async () => {
    const customer = await makeUser('customer');
    const res = await request(app).get('/ops-only').set('Cookie', customer.cookies.header);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an operations user on an operations route', async () => {
    const ops = await makeUser('operations');
    const res = await request(app).get('/ops-only').set('Cookie', ops.cookies.header);
    expect(res.status).toBe(200);
  });

  it('enforces multi-role gates (technician allowed, customer not)', async () => {
    const technician = await makeUser('technician');
    const customer = await makeUser('customer');

    expect(
      (await request(app).get('/staff-only').set('Cookie', technician.cookies.header)).status,
    ).toBe(200);
    expect(
      (await request(app).get('/staff-only').set('Cookie', customer.cookies.header)).status,
    ).toBe(403);
  });
});

describe('requireResourceOwner', () => {
  it('lets a customer reach their own resource', async () => {
    const customer = await makeUser('customer');
    const res = await request(app)
      .get(`/things/${customer.id}`)
      .set('Cookie', customer.cookies.header);
    expect(res.status).toBe(200);
  });

  it("hides another customer's resource as 404 (IDOR protection)", async () => {
    const alice = await makeUser('customer');
    const bob = await makeUser('customer');
    const res = await request(app).get(`/things/${bob.id}`).set('Cookie', alice.cookies.header);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lets operations reach any resource', async () => {
    const ops = await makeUser('operations');
    const customer = await makeUser('customer');
    const res = await request(app).get(`/things/${customer.id}`).set('Cookie', ops.cookies.header);
    expect(res.status).toBe(200);
  });

  it('rejects a forged session on a protected resource', async () => {
    const res = await request(app)
      .get('/things/anything')
      .set('Cookie', `${env.SESSION_COOKIE_NAME}=forged`);
    expect(res.status).toBe(401);
  });
});
