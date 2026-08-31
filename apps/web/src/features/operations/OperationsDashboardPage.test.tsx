import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationsDashboardPage } from './OperationsDashboardPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DASHBOARD = {
  dashboard: {
    bookings: {
      total: 12,
      byStatus: {
        pending: 5,
        confirmed: 3,
        assigned: 0,
        in_progress: 0,
        completed: 2,
        cancelled: 1,
        rejected: 1,
      },
      active: 8,
      upcoming: 6,
    },
    revenue: { byCurrency: [{ currency: 'USD', committedTotalCents: 120000 }] },
    technicians: { total: 2, active: 2 },
  },
};

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'pending',
    service: { slug: 's', name: 'Wi-Fi Mesh Setup' },
    customerName: 'Alice',
    technicianName: null,
    scheduledStart: '2026-09-15T09:00:00.000Z',
    scheduledEnd: '2026-09-15T10:00:00.000Z',
    totalCents: 12000,
    currency: 'USD',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function list(items: unknown[], page = 1, total = items.length) {
  return {
    items,
    pagination: {
      page,
      limit: 20,
      total,
      totalPages: Math.max(1, Math.ceil(total / 20)),
      hasNextPage: page * 20 < total,
      hasPreviousPage: page > 1,
    },
  };
}

interface Handlers {
  dashboard?: () => Response;
  bookings?: (url: URL) => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input), 'http://api.test');
    if (url.pathname === '/api/v1/operations/dashboard') {
      return Promise.resolve(h.dashboard?.() ?? json(DASHBOARD));
    }
    if (url.pathname === '/api/v1/operations/bookings') {
      return Promise.resolve(h.bookings?.(url) ?? json(list([summary('bk-1')])));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <OperationsDashboardPage />
    </MemoryRouter>,
  );

describe('OperationsDashboardPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders metrics and the booking queue', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText('12')).toBeInTheDocument(); // total bookings
    expect(screen.getByText(/committed revenue/i)).toHaveTextContent('$1,200.00');
    expect(await screen.findByText('Wi-Fi Mesh Setup')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view/i })).toHaveAttribute(
      'href',
      '/operations/bookings/bk-1',
    );
  });

  it('shows a loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText(/loading metrics/i)).toBeInTheDocument();
  });

  it('shows an empty queue state', async () => {
    mockApi({ bookings: () => json(list([])) });
    renderPage();
    expect(await screen.findByText(/no bookings match this filter/i)).toBeInTheDocument();
  });

  it('shows an error state with retry for the metrics', async () => {
    mockApi({ dashboard: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load the dashboard metrics/i);
    expect(screen.getAllByRole('button', { name: /try again/i }).length).toBeGreaterThan(0);
  });

  it('sends the status filter to the API', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByText('Wi-Fi Mesh Setup');

    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'confirmed');

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('status=confirmed'))).toBe(true);
    });
  });

  it('paginates the queue', async () => {
    const fetchMock = mockApi({
      bookings: (url) => {
        const page = Number(url.searchParams.get('page') ?? '1');
        return json(list([summary(`p${page}`, { customerName: `Cust ${page}` })], page, 40));
      },
    });
    renderPage();
    await screen.findByText('Cust 1');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true);
    });
    expect(await screen.findByText('Cust 2')).toBeInTheDocument();
  });
});
