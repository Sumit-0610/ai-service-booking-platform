import { prisma } from '@aisbp/database/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiBookingIntent } from '@aisbp/shared';
import {
  agent,
  closeConnections,
  freshIp,
  loginUser,
  registerUser,
  resetAuthState,
  uniqueEmail,
} from '../../test/helpers.js';
import type { ClaudeClient, StructuredResult, TextResult } from '../../lib/claude.js';
import { setClaudeClientForTesting } from '../../lib/claude.js';

/**
 * Integration tests for the Claude AI Booking Assistant (Milestone 14). Real
 * PostgreSQL + Redis; the Claude client is a scripted fake (`setClaudeClientForTesting`)
 * so no real API call is made. Tests cover grounding, safe fallback, the
 * no-mutation guarantee, auth/CSRF, and graceful degradation when the
 * assistant is unconfigured.
 */

type Role = 'customer' | 'operations' | 'technician';

interface TestUser {
  email: string;
  header: string;
  csrf: string;
}

async function makeUser(role: Role = 'customer'): Promise<TestUser> {
  const email = uniqueEmail(role);
  const registered = await registerUser(email);
  if (role !== 'customer') {
    await prisma.user.update({ where: { email }, data: { role } });
    const cookies = await loginUser(email);
    return { email, header: cookies.header, csrf: cookies.csrfToken };
  }
  return { email, header: registered.cookies.header, csrf: registered.cookies.csrfToken };
}

async function addAddress(user: TestUser, label = 'Home'): Promise<string> {
  const res = await agent()
    .post('/api/v1/addresses')
    .set('Cookie', user.header)
    .set('X-CSRF-Token', user.csrf)
    .set('X-Forwarded-For', freshIp())
    .send({
      label,
      line1: '12 MG Road',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      country: 'IN',
    });
  return res.body.address.id as string;
}

const usage = { inputTokens: 10, outputTokens: 5 };

function futureDate(days = 5): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fullIntent(overrides: Partial<AiBookingIntent> = {}): AiBookingIntent {
  return {
    serviceSlug: 'washing-machine-installation',
    serviceCandidateSlugs: [],
    requestedDate: futureDate(),
    requestedTimeOfDay: 'morning',
    addressId: null,
    notes: null,
    missingFields: [],
    clarificationQuestion: null,
    confidence: 'high',
    ...overrides,
  };
}

/** A fake whose structured output and text are set per test. */
function scriptedClient(script: {
  structured?: unknown;
  structuredError?: Error;
  text?: string;
  textError?: Error;
}): ClaudeClient {
  return {
    extractStructured: async (): Promise<StructuredResult> => {
      if (script.structuredError) throw script.structuredError;
      return { data: script.structured, model: 'fake-model', latencyMs: 1, usage };
    },
    generateText: async (): Promise<TextResult> => {
      if (script.textError) throw script.textError;
      return {
        text: script.text ?? 'Some times are available.',
        model: 'fake-model',
        latencyMs: 1,
        usage,
      };
    },
  };
}

function postIntent(user: TestUser, body: object, csrf = user.csrf) {
  const req = agent()
    .post('/api/v1/ai/booking-assistant/intent')
    .set('Cookie', user.header)
    .set('X-Forwarded-For', freshIp());
  if (csrf) req.set('X-CSRF-Token', csrf);
  return req.send(body);
}

beforeAll(resetAuthState);
afterAll(async () => {
  await prisma.address.deleteMany({ where: { user: { email: { startsWith: 'authtest-' } } } });
  await resetAuthState();
  await closeConnections();
});

beforeEach(() => {
  setClaudeClientForTesting(scriptedClient({ structured: fullIntent() }));
});
afterEach(() => {
  setClaudeClientForTesting(null);
});

describe('POST /api/v1/ai/booking-assistant/intent — auth & CSRF', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await agent()
      .post('/api/v1/ai/booking-assistant/intent')
      .send({ message: 'install my washing machine' });
    expect(res.status).toBe(401);
  });

  it('forbids operations and technician roles', async () => {
    for (const role of ['operations', 'technician'] as const) {
      const user = await makeUser(role);
      const res = await postIntent(user, { message: 'hello' });
      expect(res.status, role).toBe(403);
    }
  });

  it('requires a CSRF token', async () => {
    const user = await makeUser();
    const res = await postIntent(user, { message: 'hello' }, '');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ERROR');
  });

  it('rejects a malformed or oversized body with 422', async () => {
    const user = await makeUser();
    for (const body of [
      {},
      { message: '' },
      { message: 'x'.repeat(2001) },
      { message: 'ok', extra: 1 },
    ]) {
      const res = await postIntent(user, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe('POST /api/v1/ai/booking-assistant/intent — grounding', () => {
  it('returns a grounded intent and matched service for a clear request', async () => {
    const user = await makeUser();
    const addressId = await addAddress(user);
    setClaudeClientForTesting(
      scriptedClient({ structured: fullIntent({ addressId, requestedDate: futureDate(3) }) }),
    );

    const res = await postIntent(user, { message: 'install my washing machine next week at home' });
    expect(res.status).toBe(200);
    expect(res.body.intent.serviceSlug).toBe('washing-machine-installation');
    expect(res.body.intent.addressId).toBe(addressId);
    expect(res.body.intent.missingFields).toEqual([]);
    expect(res.body.matchedService).toMatchObject({
      slug: 'washing-machine-installation',
      currency: expect.any(String),
      priceCents: expect.any(Number),
    });
  });

  it('drops a service slug the model invented', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(
      scriptedClient({
        structured: fullIntent({ serviceSlug: 'teleportation-setup', serviceCandidateSlugs: [] }),
      }),
    );
    const res = await postIntent(user, { message: 'teleport me' });
    expect(res.body.intent.serviceSlug).toBeNull();
    expect(res.body.intent.missingFields).toContain('service');
    expect(res.body.matchedService).toBeNull();
    expect(res.body.intent.clarificationQuestion).toBeTruthy();
  });

  it('drops an address id the caller does not own', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(
      scriptedClient({ structured: fullIntent({ addressId: 'clsomeoneelses000000000000' }) }),
    );
    const res = await postIntent(user, { message: 'book it' });
    expect(res.body.intent.addressId).toBeNull();
    expect(res.body.intent.missingFields).toContain('address');
  });

  it('drops a past date', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(
      scriptedClient({ structured: fullIntent({ requestedDate: '2020-01-01' }) }),
    );
    const res = await postIntent(user, { message: 'yesterday please' });
    expect(res.body.intent.requestedDate).toBeNull();
    expect(res.body.intent.missingFields).toContain('date');
  });

  it('falls back safely when the model returns malformed output', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(scriptedClient({ structured: { nonsense: true } }));
    const res = await postIntent(user, { message: 'garbled' });
    expect(res.status).toBe(200);
    expect(res.body.intent.confidence).toBe('low');
    expect(res.body.intent.clarificationQuestion).toBeTruthy();
  });

  it('falls back safely (not 5xx) when the Claude call throws', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(scriptedClient({ structuredError: new Error('upstream 529') }));
    const res = await postIntent(user, { message: 'anything' });
    expect(res.status).toBe(200);
    expect(res.body.intent.confidence).toBe('low');
  });

  it('returns 503 when the assistant is not configured', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(null);
    const res = await postIntent(user, { message: 'hello' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('never creates a booking or address', async () => {
    const user = await makeUser();
    const addressId = await addAddress(user);
    const [bookingsBefore, addressesBefore] = await Promise.all([
      prisma.booking.count(),
      prisma.address.count(),
    ]);
    setClaudeClientForTesting(scriptedClient({ structured: fullIntent({ addressId }) }));
    await postIntent(user, { message: 'book washing machine' });
    await postIntent(user, { message: 'and dishwasher too' });
    const [bookingsAfter, addressesAfter] = await Promise.all([
      prisma.booking.count(),
      prisma.address.count(),
    ]);
    expect(bookingsAfter).toBe(bookingsBefore);
    expect(addressesAfter).toBe(addressesBefore);
  });

  it('rate-limits repeated calls per user', async () => {
    const user = await makeUser();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await postIntent(user, { message: `try ${i}` })).status);
    }
    expect(statuses.filter((s) => s === 200).length).toBe(4);
    expect(statuses).toContain(429);
  });
});

describe('POST /api/v1/ai/booking-assistant/clarify', () => {
  it('re-grounds the prior intent instead of trusting the client-supplied copy', async () => {
    const user = await makeUser();
    const addressId = await addAddress(user);
    // The client sends a priorIntent carrying a foreign address + bogus service;
    // the fake model echoes them back; the server must null both.
    const priorIntent = fullIntent({
      serviceSlug: 'not-a-real-service',
      addressId: 'clforeignaddr0000000000000',
    });
    setClaudeClientForTesting(scriptedClient({ structured: priorIntent }));

    const res = await agent()
      .post('/api/v1/ai/booking-assistant/clarify')
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf)
      .set('X-Forwarded-For', freshIp())
      .send({ message: 'actually the fridge', priorIntent });

    expect(res.status).toBe(200);
    expect(res.body.intent.serviceSlug).toBeNull();
    expect(res.body.intent.addressId).toBeNull();
    expect(addressId).toBeTruthy(); // (the real one exists but the model didn't return it)
  });

  it('422s when priorIntent is missing or malformed', async () => {
    const user = await makeUser();
    const res = await agent()
      .post('/api/v1/ai/booking-assistant/clarify')
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf)
      .set('X-Forwarded-For', freshIp())
      .send({ message: 'hi', priorIntent: { confidence: 'banana' } });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/ai/booking-assistant/availability', () => {
  const postAvailability = (user: TestUser, body: object) =>
    agent()
      .post('/api/v1/ai/booking-assistant/availability')
      .set('Cookie', user.header)
      .set('X-CSRF-Token', user.csrf)
      .set('X-Forwarded-For', freshIp())
      .send(body);

  it('returns real slots plus a natural-language answer', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(scriptedClient({ text: 'There are morning slots this week.' }));
    const res = await postAvailability(user, { serviceSlug: 'washing-machine-installation' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('There are morning slots this week.');
    expect(Array.isArray(res.body.slots)).toBe(true);
    if (res.body.slots.length > 0) {
      expect(Object.keys(res.body.slots[0]).sort()).toEqual([
        'durationMinutes',
        'endsAt',
        'id',
        'startsAt',
      ]);
    }
  });

  it('404s for an unknown or inactive service', async () => {
    const user = await makeUser();
    expect((await postAvailability(user, { serviceSlug: 'legacy-tv-wall-mount' })).status).toBe(
      404,
    );
    expect((await postAvailability(user, { serviceSlug: 'nope-not-real' })).status).toBe(404);
  });

  it('still answers (from a template) when the assistant is unconfigured', async () => {
    const user = await makeUser();
    setClaudeClientForTesting(null);
    const res = await postAvailability(user, { serviceSlug: 'washing-machine-installation' });
    expect(res.status).toBe(200);
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.slots)).toBe(true);
  });
});
