import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TechnicianJob } from '@aisbp/shared';
import { TechnicianJobDetailPage } from './TechnicianJobDetailPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function job(overrides: Partial<TechnicianJob> = {}): TechnicianJob {
  return {
    id: 'bk-1',
    status: 'assigned',
    service: { slug: 'washing-machine-installation', name: 'Washing Machine' },
    customerName: 'Alice',
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
    customerNotes: 'Gate code 4321',
    createdAt: '2026-09-01T00:00:00.000Z',
    statusHistory: [
      {
        from: 'confirmed',
        to: 'assigned',
        reason: 'Assigned by operations',
        at: '2026-09-02T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

interface Handlers {
  get?: () => Response;
  patch?: (body: unknown) => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.includes('/status') && method === 'PATCH') {
      return Promise.resolve(h.patch?.(body) ?? json({ booking: job({ status: 'in_progress' }) }));
    }
    if (url.includes('/api/v1/technician/bookings/')) {
      return Promise.resolve(h.get?.() ?? json({ booking: job() }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/technician/bookings/bk-1']}>
      <Routes>
        <Route path="/technician/bookings/:id" element={<TechnicianJobDetailPage />} />
        <Route path="/technician/bookings" element={<p>Jobs</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('TechnicianJobDetailPage', () => {
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('renders the job detail and timeline', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByRole('heading', { name: /washing machine/i })).toBeInTheDocument();
    expect(screen.getByText(/gate code 4321/i)).toBeInTheDocument();
    expect(screen.getByText(/assigned by operations/i)).toBeInTheDocument();
  });

  it('starts an assigned job', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByRole('heading', { name: /washing machine/i });

    await userEvent.click(screen.getByRole('button', { name: /start job/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/status') && i?.method === 'PATCH',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: 'in_progress' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/started/i);
  });

  it('shows Mark complete for an in_progress job and surfaces a 409', async () => {
    mockApi({
      get: () => json({ booking: job({ status: 'in_progress' }) }),
      patch: () => json({ error: { code: 'CONFLICT', message: 'stale' } }, 409),
    });
    renderPage();
    await screen.findByRole('heading', { name: /washing machine/i });

    expect(screen.queryByRole('button', { name: /start job/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/stale/i);
  });

  it('offers no action for a completed job', async () => {
    mockApi({ get: () => json({ booking: job({ status: 'completed' }) }) });
    renderPage();
    await screen.findByRole('heading', { name: /washing machine/i });
    expect(
      screen.queryByRole('button', { name: /start job|mark complete/i }),
    ).not.toBeInTheDocument();
  });

  it('shows a not-found state', async () => {
    mockApi({ get: () => json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404) });
    renderPage();
    expect(await screen.findByText(/job not found/i)).toBeInTheDocument();
  });
});
