import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { BookingPanel } from './BookingPanel';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CUSTOMER = { id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'customer' as const };
const ADDRESS = {
  id: 'addr-1',
  label: 'Home',
  line1: '12 MG Road',
  line2: null,
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
  country: 'IN',
};

interface Handlers {
  me?: () => Response;
  addresses?: () => Response;
  createBooking?: (body: unknown) => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.includes('/api/v1/auth/me')) {
      return Promise.resolve(h.me?.() ?? json({ user: CUSTOMER }));
    }
    if (url.includes('/api/v1/addresses')) {
      return Promise.resolve(h.addresses?.() ?? json({ items: [ADDRESS] }));
    }
    if (url.includes('/api/v1/bookings') && method === 'POST') {
      return Promise.resolve(
        h.createBooking?.(body) ??
          json(
            {
              booking: {
                id: 'bk-1',
                status: 'pending',
                service: {
                  slug: 'washing-machine-installation',
                  name: 'Washing Machine Installation',
                },
                address: ADDRESS,
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
              },
            },
            201,
          ),
      );
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

function renderPanel(props: Partial<Parameters<typeof BookingPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <BookingPanel
          serviceName="Washing Machine Installation"
          priceCents={8900}
          currency="USD"
          slotId="slot-1"
          slotLabel="Tue Sep 15, 9:00 AM–10:00 AM"
          onBooked={props.onBooked ?? vi.fn()}
          {...props}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('BookingPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a booking with the chosen slot and address, sending no price', async () => {
    const fetchMock = mockApi();
    const onBooked = vi.fn();
    renderPanel({ onBooked });

    await userEvent.click(await screen.findByRole('button', { name: /confirm booking/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/api/v1/bookings') && i?.method === 'POST',
      );
      expect(call).toBeTruthy();
      const sent = JSON.parse(String(call?.[1]?.body));
      expect(sent).toEqual({ slotId: 'slot-1', addressId: 'addr-1' });
      expect(sent).not.toHaveProperty('priceTotalCents');
      expect(sent).not.toHaveProperty('status');
    });

    expect(await screen.findByRole('status')).toHaveTextContent(/booked/i);
    expect(screen.getByRole('link', { name: /view your bookings/i })).toBeInTheDocument();
    expect(onBooked).toHaveBeenCalled();
  });

  it('surfaces a 409 conflict as a friendly message', async () => {
    mockApi({
      createBooking: () => json({ error: { code: 'CONFLICT', message: 'taken' } }, 409),
    });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /confirm booking/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/i);
  });

  it('asks an unauthenticated visitor to sign in', async () => {
    mockApi({ me: () => json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401) });
    renderPanel();

    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
  });

  it('tells a customer with no addresses to add one', async () => {
    mockApi({ addresses: () => json({ items: [] }) });
    renderPanel();

    expect(await screen.findByRole('link', { name: /add an address/i })).toBeInTheDocument();
  });

  it('does not book until a slot is selected', async () => {
    mockApi();
    renderPanel({ slotId: null, slotLabel: null });

    expect(await screen.findByText(/select a time above to book/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
  });
});
