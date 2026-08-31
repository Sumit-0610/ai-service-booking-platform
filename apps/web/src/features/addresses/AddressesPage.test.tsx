import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@aisbp/shared';
import { AddressesPage } from './AddressesPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function address(overrides: Partial<Address> = {}): Address {
  return {
    id: 'a1',
    label: 'Home',
    line1: '12 MG Road',
    line2: null,
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
    country: 'IN',
    ...overrides,
  };
}

interface Handlers {
  list?: () => Response | Promise<Response>;
  create?: (body: unknown) => Response | Promise<Response>;
  update?: (body: unknown) => Response | Promise<Response>;
  remove?: () => Response | Promise<Response>;
}

function mockApi(handlers: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), 'http://api.test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.pathname === '/api/v1/addresses' && method === 'GET') {
      return Promise.resolve(handlers.list?.() ?? json({ items: [address()] }));
    }
    if (url.pathname === '/api/v1/addresses' && method === 'POST') {
      return Promise.resolve(
        handlers.create?.(body) ?? json({ address: address({ id: 'new' }) }, 201),
      );
    }
    if (url.pathname.startsWith('/api/v1/addresses/') && method === 'PATCH') {
      return Promise.resolve(handlers.update?.(body) ?? json({ address: address({ ...body }) }));
    }
    if (url.pathname.startsWith('/api/v1/addresses/') && method === 'DELETE') {
      return Promise.resolve(handlers.remove?.() ?? new Response(null, { status: 204 }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/account/addresses']}>
      <AddressesPage />
    </MemoryRouter>,
  );
}

async function fillCreateForm() {
  await userEvent.click(screen.getByRole('button', { name: /add address/i }));
  const form = await screen.findByRole('form', { name: /add address/i });
  await userEvent.type(within(form).getByLabelText(/label/i), 'Office');
  await userEvent.type(within(form).getByLabelText(/address line 1/i), '5 Residency Road');
  await userEvent.type(within(form).getByLabelText(/city/i), 'Bengaluru');
  await userEvent.type(within(form).getByLabelText(/state/i), 'Karnataka');
  await userEvent.type(within(form).getByLabelText(/postal code/i), '560025');
  return form;
}

describe('AddressesPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the customer's addresses", async () => {
    mockApi({
      list: () =>
        json({
          items: [
            address({ label: 'Home' }),
            address({ id: 'a2', label: 'Office', line1: '5 Residency Road', city: 'Bengaluru' }),
          ],
        }),
    });
    renderPage();
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText(/12 MG Road, Pune, Maharashtra, 411001, IN/)).toBeInTheDocument();
    expect(screen.getByText(/5 Residency Road, Bengaluru/)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockApi({ list: () => json({ items: [] }) });
    renderPage();
    expect(await screen.findByText(/no addresses yet/i)).toBeInTheDocument();
  });

  it('shows an error state when the list fails', async () => {
    mockApi({ list: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderPage();
    expect(await screen.findByText(/couldn.t load your addresses/i)).toBeInTheDocument();
  });

  it('creates an address and shows it in the list', async () => {
    const created = address({ id: 'new', label: 'Office', city: 'Bengaluru' });
    let listCalls = 0;
    const fetchMock = mockApi({
      list: () => json({ items: listCalls++ === 0 ? [address()] : [address(), created] }),
      create: () => json({ address: created }, 201),
    });
    renderPage();
    await screen.findByText('Home');

    await fillCreateForm();
    await userEvent.click(screen.getByRole('button', { name: /^add address$/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/address added/i);
    expect(await screen.findByText('Office')).toBeInTheDocument();
  });

  it('shows validation errors and does not call the API for an empty form', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByText('Home');

    await userEvent.click(screen.getByRole('button', { name: /add address/i }));
    const form = await screen.findByRole('form', { name: /add address/i });
    await userEvent.click(within(form).getByRole('button', { name: /^add address$/i }));

    expect(await within(form).findAllByRole('alert')).not.toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('edits an address', async () => {
    const fetchMock = mockApi({
      update: (body) => json({ address: address({ ...(body as object) }) }),
    });
    renderPage();
    await screen.findByText('Home');

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const form = await screen.findByRole('form', { name: /edit address/i });
    const label = within(form).getByLabelText(/label/i);
    await userEvent.clear(label);
    await userEvent.type(label, 'Primary home');
    await userEvent.click(within(form).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ label: 'Primary home' });
    });
  });

  it('deletes an address after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let listCalls = 0;
    const fetchMock = mockApi({
      list: () => json({ items: listCalls++ === 0 ? [address()] : [] }),
    });
    renderPage();
    await screen.findByText('Home');

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    });
    expect(await screen.findByText(/no addresses yet/i)).toBeInTheDocument();
  });

  it('surfaces a delete conflict from the API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      remove: () =>
        json({ error: { code: 'CONFLICT', message: 'This address is linked to a booking' } }, 409),
    });
    renderPage();
    await screen.findByText('Home');

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/linked to a booking/i);
  });
});
