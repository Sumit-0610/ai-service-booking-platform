import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TechnicianSlot } from '@aisbp/shared';
import { TechnicianAvailabilityPage } from './TechnicianAvailabilityPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function futureIso(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function techSlot(overrides: Partial<TechnicianSlot> = {}): TechnicianSlot {
  return {
    id: 's1',
    service: { slug: 'wifi-mesh-setup', name: 'Wi-Fi Mesh Setup' },
    startsAt: futureIso(3, 9),
    endsAt: futureIso(3, 11),
    durationMinutes: 120,
    status: 'available',
    booked: false,
    ...overrides,
  };
}

const SERVICES = {
  items: [
    {
      id: 'c1',
      slug: 'wifi-mesh-setup',
      name: 'Wi-Fi Mesh Setup',
      description: 'x',
      priceCents: 1000,
      currency: 'USD',
      durationMinutes: 60,
      category: { id: 'x', slug: 'x', name: 'X' },
    },
  ],
  pagination: {
    page: 1,
    limit: 48,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

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

    if (url.pathname === '/api/v1/services') return Promise.resolve(json(SERVICES));
    if (url.pathname === '/api/v1/technician/availability' && method === 'GET') {
      return Promise.resolve(handlers.list?.() ?? json({ items: [techSlot()] }));
    }
    if (url.pathname === '/api/v1/technician/availability' && method === 'POST') {
      return Promise.resolve(
        handlers.create?.(body) ?? json({ slot: techSlot({ id: 'new' }) }, 201),
      );
    }
    if (url.pathname.startsWith('/api/v1/technician/availability/') && method === 'PATCH') {
      return Promise.resolve(handlers.update?.(body) ?? json({ slot: techSlot() }));
    }
    if (url.pathname.startsWith('/api/v1/technician/availability/') && method === 'DELETE') {
      return Promise.resolve(handlers.remove?.() ?? new Response(null, { status: 204 }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/technician/availability']}>
      <TechnicianAvailabilityPage />
    </MemoryRouter>,
  );
}

async function openAndFillForm() {
  await userEvent.click(screen.getByRole('button', { name: /add availability/i }));
  const form = await screen.findByRole('form', { name: /add availability/i });
  await waitFor(() =>
    expect(within(form).getByRole('option', { name: 'Wi-Fi Mesh Setup' })).toBeInTheDocument(),
  );
  const future = new Date();
  future.setDate(future.getDate() + 5);
  const dateValue = future.toISOString().slice(0, 10);
  fireEvent.change(within(form).getByLabelText(/date/i), { target: { value: dateValue } });
  fireEvent.change(within(form).getByLabelText(/start time/i), { target: { value: '09:00' } });
  fireEvent.change(within(form).getByLabelText(/end time/i), { target: { value: '11:00' } });
  return form;
}

describe('TechnicianAvailabilityPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists upcoming slots grouped by day', async () => {
    mockApi({
      list: () =>
        json({
          items: [
            techSlot({ id: 'a' }),
            techSlot({ id: 'b', startsAt: futureIso(4, 14), endsAt: futureIso(4, 16) }),
          ],
        }),
    });
    renderPage();
    expect(await screen.findAllByText('Wi-Fi Mesh Setup')).toHaveLength(2);
  });

  it('shows an empty state', async () => {
    mockApi({ list: () => json({ items: [] }) });
    renderPage();
    expect(await screen.findByText(/no upcoming availability/i)).toBeInTheDocument();
  });

  it('shows an error state', async () => {
    mockApi({ list: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderPage();
    expect(await screen.findByText(/couldn.t load your availability/i)).toBeInTheDocument();
  });

  it('creates a slot and sends UTC instants', async () => {
    let listCalls = 0;
    const created = techSlot({ id: 'new' });
    const fetchMock = mockApi({
      list: () => json({ items: listCalls++ === 0 ? [] : [created] }),
      create: () => json({ slot: created }, 201),
    });
    renderPage();
    await screen.findByText(/no upcoming availability/i);

    const form = await openAndFillForm();
    await userEvent.click(within(form).getByRole('button', { name: /add slot/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      const sent = JSON.parse(String(post?.[1]?.body));
      expect(sent.serviceSlug).toBe('wifi-mesh-setup');
      expect(sent.startsAt).toMatch(/Z$/);
      expect(new Date(sent.endsAt).getTime()).toBeGreaterThan(new Date(sent.startsAt).getTime());
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/availability added/i);
  });

  it('blocks submit and shows a message when end is not after start', async () => {
    const fetchMock = mockApi({ list: () => json({ items: [] }) });
    renderPage();
    await screen.findByText(/no upcoming availability/i);

    await userEvent.click(screen.getByRole('button', { name: /add availability/i }));
    const form = await screen.findByRole('form', { name: /add availability/i });
    const future = new Date();
    future.setDate(future.getDate() + 5);
    fireEvent.change(within(form).getByLabelText(/date/i), {
      target: { value: future.toISOString().slice(0, 10) },
    });
    fireEvent.change(within(form).getByLabelText(/start time/i), { target: { value: '11:00' } });
    fireEvent.change(within(form).getByLabelText(/end time/i), { target: { value: '10:00' } });
    await userEvent.click(within(form).getByRole('button', { name: /add slot/i }));

    expect(
      await within(form).findByText(/end time must be after the start time/i),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('surfaces an overlap conflict from the API', async () => {
    mockApi({
      list: () => json({ items: [] }),
      create: () =>
        json(
          {
            error: {
              code: 'CONFLICT',
              message: 'That time overlaps one of your existing availability slots',
            },
          },
          409,
        ),
    });
    renderPage();
    await screen.findByText(/no upcoming availability/i);

    const form = await openAndFillForm();
    await userEvent.click(within(form).getByRole('button', { name: /add slot/i }));

    expect(await within(form).findByText(/overlaps one of your existing/i)).toBeInTheDocument();
  });

  it('edits a slot', async () => {
    const fetchMock = mockApi({
      update: (body) => json({ slot: techSlot({ ...(body as object) }) }),
    });
    renderPage();
    await screen.findByText('Wi-Fi Mesh Setup');

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const form = await screen.findByRole('form', { name: /edit availability/i });
    fireEvent.change(within(form).getByLabelText(/end time/i), { target: { value: '10:00' } });
    await userEvent.click(within(form).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
    });
  });

  it('deletes a slot after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let listCalls = 0;
    const fetchMock = mockApi({
      list: () => json({ items: listCalls++ === 0 ? [techSlot()] : [] }),
    });
    renderPage();
    await screen.findByText('Wi-Fi Mesh Setup');

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    });
    expect(await screen.findByText(/no upcoming availability/i)).toBeInTheDocument();
  });
});
