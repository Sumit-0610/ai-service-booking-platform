import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@aisbp/shared';
import { BookingsPage } from './BookingsPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    status: 'pending',
    service: { slug: 'washing-machine-installation', name: 'Washing Machine Installation' },
    address: {
      label: 'Home',
      line1: '12 MG Road',
      line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      country: 'IN',
    },
    scheduledStart: '2026-09-15T09:00:00.000Z',
    scheduledEnd: '2026-09-15T10:00:00.000Z',
    customerNotes: null,
    price: {
      currency: 'USD',
      subtotalCents: 8900,
      feesTotalCents: 0,
      discountTotalCents: 0,
      taxTotalCents: 0,
      totalCents: 8900,
      breakdown: { lines: [{ label: 'Service', amountCents: 8900 }] },
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function list(items: unknown[], page = 1, total = items.length) {
  return {
    items,
    pagination: {
      page,
      limit: 10,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / 10),
      hasNextPage: page * 10 < total,
      hasPreviousPage: page > 1,
    },
  };
}

interface Handlers {
  list?: (url: URL) => Response;
  cancel?: () => Response;
  history?: () => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), 'http://api.test');
    const method = init?.method ?? 'GET';
    if (String(input).includes('/status-history')) {
      return Promise.resolve(
        h.history?.() ??
          json({
            items: [
              {
                from: null,
                to: 'pending',
                reason: 'Booking created',
                at: '2026-09-01T00:00:00.000Z',
              },
            ],
          }),
      );
    }
    if (url.pathname.includes('/cancel') && method === 'POST') {
      return Promise.resolve(h.cancel?.() ?? json({ booking: booking({ status: 'cancelled' }) }));
    }
    if (url.pathname === '/api/v1/bookings') {
      return Promise.resolve(h.list?.(url) ?? json(list([booking()])));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <BookingsPage />
    </MemoryRouter>,
  );

describe('BookingsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists bookings with status and total', async () => {
    mockApi({ list: () => json(list([booking()])) });
    renderPage();

    expect(await screen.findByText('Washing Machine Installation')).toBeInTheDocument();
    expect(screen.getByText('$89.00')).toBeInTheDocument();
    // status badge shows within a rounded pill
    expect(screen.getAllByText('pending').some((el) => el.className.includes('rounded-full'))).toBe(
      true,
    );
  });

  it('shows an empty state', async () => {
    mockApi({ list: () => json(list([])) });
    renderPage();
    expect(await screen.findByText(/you have no bookings yet/i)).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockApi({ list: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load your bookings/i);
  });

  it('sends the status filter and paginates', async () => {
    const fetchMock = mockApi({
      list: (url) => {
        const page = Number(url.searchParams.get('page') ?? '1');
        return json(list([booking({ id: `p${page}` })], page, 30));
      },
    });
    renderPage();
    await screen.findByText('Washing Machine Installation');

    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'completed');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('status=completed'))).toBe(true);
    });

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true);
    });
  });

  it('cancels a cancellable booking and refetches', async () => {
    const fetchMock = mockApi();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /cancel booking/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).includes('/cancel') && i?.method === 'POST',
        ),
      ).toBe(true);
    });
    // list was refetched (more than the initial GET)
    await waitFor(() => {
      const listGets = fetchMock.mock.calls.filter(([u, i]) => {
        const p = new URL(String(u), 'http://api.test').pathname;
        return p === '/api/v1/bookings' && (i?.method ?? 'GET') === 'GET';
      });
      expect(listGets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('hides cancel for a completed booking and shows its timeline', async () => {
    mockApi({ list: () => json(list([booking({ status: 'completed' })])) });
    renderPage();

    await screen.findByText('Washing Machine Installation');
    expect(screen.queryByRole('button', { name: /cancel booking/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show timeline/i }));
    expect(await screen.findByText(/booking created/i)).toBeInTheDocument();
  });
});
