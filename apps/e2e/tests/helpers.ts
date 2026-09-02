import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { e2eEnv } from '../playwright.config';

/**
 * On a service detail page: pick the first slot and confirm the booking. Waits
 * on the real `POST /bookings` response (the success banner is transient — the
 * availability refetch unmounts it — so the account page is the stable check).
 */
export async function bookFirstSlotViaUi(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();
  await page.getByRole('tab').first().click();
  await page.locator('button[aria-pressed]').first().click();
  await expect(page.getByText('Confirm your booking')).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/bookings') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Confirm booking' }).click(),
  ]);
  expect(response.status(), await response.text()).toBe(201);
}

/** The password every seeded account uses (development-only, see the seed script). */
export const SEED_PASSWORD = 'aisbp-dev-password';

export const SEED = {
  customerAlice: 'alice@example.com',
  operations: 'olivia@ops.example.com',
  technicianTomas: 'tomas@tech.example.com',
  washingMachineSlug: 'washing-machine-installation',
  washingMachineName: 'Washing Machine Installation',
  // Booked on Tara's slot, but Tomas is also qualified (E2E fixture) — so
  // operations can reassign it to Tomas.
  wifiMeshSlug: 'wifi-mesh-setup',
  wifiMeshName: 'Wi-Fi Mesh Setup',
} as const;

let counter = 0;
export function uniqueEmail(tag = 'e2e'): string {
  counter += 1;
  return `e2e-${tag}-${Date.now()}-${counter}@example.test`;
}

interface Session {
  cookie: string;
  csrf: string;
}

function sessionFromSetCookie(headers: Record<string, string>): Session {
  const raw = headers['set-cookie'] ?? '';
  const lines = raw.split('\n');
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > -1) jar[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1));
  }
  return {
    cookie: Object.entries(jar)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; '),
    csrf: jar['aisbp.csrf'] ?? '',
  };
}

async function api(
  request: APIRequestContext,
  method: 'get' | 'post' | 'patch',
  path: string,
  opts: { session?: Session; data?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.session) {
    headers['Cookie'] = opts.session.cookie;
    headers['X-CSRF-Token'] = opts.session.csrf;
  }
  const res = await request[method](`${e2eEnv.API_URL}${path}`, {
    headers,
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return res;
}

export async function apiLogin(request: APIRequestContext, email: string): Promise<Session> {
  const res = await api(request, 'post', '/api/v1/auth/login', {
    data: { email, password: SEED_PASSWORD },
  });
  expect(res.ok(), `login ${email}: ${res.status()}`).toBeTruthy();
  return sessionFromSetCookie(res.headers());
}

export async function apiRegisterCustomer(
  request: APIRequestContext,
  email: string,
): Promise<Session> {
  const res = await api(request, 'post', '/api/v1/auth/register', {
    data: { email, name: 'E2E Customer', password: SEED_PASSWORD },
  });
  expect(res.ok(), `register ${email}: ${res.status()}`).toBeTruthy();
  return sessionFromSetCookie(res.headers());
}

export async function addAddress(request: APIRequestContext, session: Session): Promise<string> {
  const res = await api(request, 'post', '/api/v1/addresses', {
    session,
    data: {
      label: 'Home',
      line1: '1 E2E Street',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      country: 'IN',
    },
  });
  expect(res.ok(), `add address: ${res.status()}`).toBeTruthy();
  return (await res.json()).address.id as string;
}

/** Book the first available slot of a service. Returns the booking id. */
export async function bookFirstSlot(
  request: APIRequestContext,
  session: Session,
  serviceSlug: string = SEED.washingMachineSlug,
): Promise<string> {
  const [avail, addresses] = await Promise.all([
    api(request, 'get', `/api/v1/services/${serviceSlug}/availability`),
    api(request, 'get', '/api/v1/addresses', { session }),
  ]);
  const slots = (await avail.json()).items as Array<{ id: string }>;
  expect(slots.length, 'seeded availability').toBeGreaterThan(0);
  let addressId = ((await addresses.json()).items as Array<{ id: string }>)[0]?.id;
  addressId ??= await addAddress(request, session);

  const res = await api(request, 'post', '/api/v1/bookings', {
    session,
    data: { slotId: slots[0]!.id, addressId },
  });
  expect(res.status(), `create booking: ${await res.text()}`).toBe(201);
  return (await res.json()).booking.id as string;
}

/**
 * Confirm a booking and assign the technician whose display name matches
 * `nameRe`, entirely through the real operations API. Used to set up state for
 * the technician journey.
 */
export async function confirmAndAssign(
  request: APIRequestContext,
  bookingId: string,
  nameRe = /tomas/i,
): Promise<void> {
  const ops = await apiLogin(request, SEED.operations);
  const confirm = await api(request, 'patch', `/api/v1/operations/bookings/${bookingId}/status`, {
    session: ops,
    data: { status: 'confirmed' },
  });
  expect(confirm.ok(), `confirm: ${await confirm.text()}`).toBeTruthy();

  const listRes = await api(
    request,
    'get',
    `/api/v1/operations/bookings/${bookingId}/assignable-technicians`,
    { session: ops },
  );
  const options = (await listRes.json()).items as Array<{ id: string; displayName: string }>;
  const target = options.find((t) => nameRe.test(t.displayName));
  expect(
    target,
    `assignable technician matching ${nameRe}: ${JSON.stringify(options)}`,
  ).toBeTruthy();

  const assign = await api(
    request,
    'post',
    `/api/v1/operations/bookings/${bookingId}/assign-technician`,
    { session: ops, data: { technicianId: target!.id } },
  );
  expect(assign.ok(), `assign: ${await assign.text()}`).toBeTruthy();
}

export async function uiLogin(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}
