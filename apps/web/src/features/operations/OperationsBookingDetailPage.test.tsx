import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationsBooking } from '@aisbp/shared';
import { OperationsBookingDetailPage } from './OperationsBookingDetailPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function booking(overrides: Partial<OperationsBooking> = {}): OperationsBooking {
  return {
    id: 'bk-1',
    status: 'pending',
    service: { slug: 'wifi', name: 'Wi-Fi Mesh Setup' },
    customerName: 'Alice',
    customerEmail: 'alice@example.com',
    technicianName: 'Tomas',
    address: {
      label: 'Home',
      line1: '1 Test St',
      line2: null,
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'IN',
    },
    scheduledStart: '2026-09-15T09:00:00.000Z',
    scheduledEnd: '2026-09-15T10:00:00.000Z',
    customerNotes: null,
    price: {
      currency: 'USD',
      subtotalCents: 12000,
      feesTotalCents: 0,
      discountTotalCents: 0,
      taxTotalCents: 0,
      totalCents: 12000,
      breakdown: { lines: [{ label: 'Service', amountCents: 12000 }] },
    },
    statusHistory: [
      {
        from: null,
        to: 'pending',
        reason: 'Booking created',
        by: 'Alice',
        byRole: 'customer',
        at: '2026-09-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

interface Handlers {
  get?: () => Response;
  patch?: (body: unknown) => Response;
  assignable?: () => Response;
  assign?: (body: unknown) => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.includes('/assignable-technicians')) {
      return Promise.resolve(h.assignable?.() ?? json({ items: [] }));
    }
    if (url.includes('/assign-technician') && method === 'POST') {
      return Promise.resolve(
        h.assign?.(body) ?? json({ booking: booking({ status: 'assigned' }) }),
      );
    }
    if (
      url.includes('/api/v1/operations/bookings/') &&
      url.includes('/status') &&
      method === 'PATCH'
    ) {
      return Promise.resolve(
        h.patch?.(body) ?? json({ booking: booking({ status: 'confirmed' }) }),
      );
    }
    if (url.includes('/api/v1/operations/bookings/')) {
      return Promise.resolve(h.get?.() ?? json({ booking: booking() }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/operations/bookings/bk-1']}>
      <Routes>
        <Route path="/operations/bookings/:id" element={<OperationsBookingDetailPage />} />
        <Route path="/operations" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('OperationsBookingDetailPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the booking detail and its timeline', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByRole('heading', { name: /wi-fi mesh setup/i })).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText(/booking created/i)).toBeInTheDocument();
  });

  it('offers Confirm and Reject for a pending booking and applies the change', async () => {
    const fetchMock = mockApi();
    renderPage();

    await screen.findByRole('heading', { name: /wi-fi mesh setup/i });
    expect(screen.queryByRole('button', { name: /^cancel booking$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/status') && i?.method === 'PATCH',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: 'confirmed' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/confirmed/i);
  });

  it('offers only Cancel booking for a confirmed booking', async () => {
    mockApi({ get: () => json({ booking: booking({ status: 'confirmed' }) }) });
    renderPage();
    await screen.findByRole('heading', { name: /wi-fi mesh setup/i });
    expect(screen.getByRole('button', { name: /cancel booking/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it('surfaces a 409 conflict from the API', async () => {
    mockApi({
      patch: () => json({ error: { code: 'CONFLICT', message: 'already confirmed' } }, 409),
    });
    renderPage();
    await screen.findByRole('heading', { name: /wi-fi mesh setup/i });

    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already confirmed/i);
  });

  it('shows a not-found state for a 404', async () => {
    mockApi({ get: () => json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404) });
    renderPage();
    expect(await screen.findByText(/booking not found/i)).toBeInTheDocument();
  });

  it('assigns a technician to a confirmed booking', async () => {
    const fetchMock = mockApi({
      get: () => json({ booking: booking({ status: 'confirmed', technicianName: null }) }),
      assignable: () =>
        json({
          items: [
            {
              id: 'tech-x',
              displayName: 'Tara Bolt',
              serviceArea: 'South',
              hasScheduleConflict: false,
            },
          ],
        }),
    });
    renderPage();
    await screen.findByRole('heading', { name: /wi-fi mesh setup/i });

    await userEvent.selectOptions(await screen.findByLabelText(/^technician$/i), 'tech-x');
    await userEvent.click(screen.getByRole('button', { name: /^assign$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/assign-technician') && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ technicianId: 'tech-x' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/assigned/i);
  });

  it('surfaces an assignment conflict', async () => {
    mockApi({
      get: () => json({ booking: booking({ status: 'confirmed', technicianName: null }) }),
      assignable: () =>
        json({
          items: [
            {
              id: 'tech-x',
              displayName: 'Tara Bolt',
              serviceArea: 'South',
              hasScheduleConflict: false,
            },
          ],
        }),
      assign: () => json({ error: { code: 'CONFLICT', message: 'another job at this time' } }, 409),
    });
    renderPage();
    await screen.findByRole('heading', { name: /wi-fi mesh setup/i });

    await userEvent.selectOptions(await screen.findByLabelText(/^technician$/i), 'tech-x');
    await userEvent.click(screen.getByRole('button', { name: /^assign$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/another job at this time/i);
  });
});
