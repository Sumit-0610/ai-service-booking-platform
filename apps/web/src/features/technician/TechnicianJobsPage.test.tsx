import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TechnicianJobsPage } from './TechnicianJobsPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PROFILE = {
  profile: {
    displayName: 'Tomas Field',
    serviceArea: 'North',
    active: true,
    qualifications: [{ slug: 'washing-machine-installation', name: 'Washing Machine' }],
  },
};

function job(id: string, status = 'assigned') {
  return {
    id,
    status,
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
    customerNotes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function jobList(items: unknown[], page = 1, total = items.length) {
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
  profile?: () => Response;
  jobs?: (url: URL) => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input), 'http://api.test');
    if (url.pathname === '/api/v1/technician/profile')
      return Promise.resolve(h.profile?.() ?? json(PROFILE));
    if (url.pathname === '/api/v1/technician/bookings') {
      return Promise.resolve(h.jobs?.(url) ?? json(jobList([job('bk-1')])));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <TechnicianJobsPage />
    </MemoryRouter>,
  );

describe('TechnicianJobsPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the profile card and the job list', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText('Tomas Field')).toBeInTheDocument();
    expect(screen.getByText(/qualified for:/i)).toHaveTextContent('Washing Machine');
    expect(
      screen.getAllByText('assigned').some((el) => el.className.includes('rounded-full')),
    ).toBe(true);
    expect(screen.getByRole('link', { name: /open job/i })).toHaveAttribute(
      'href',
      '/technician/bookings/bk-1',
    );
  });

  it('shows an empty state', async () => {
    mockApi({ jobs: () => json(jobList([])) });
    renderPage();
    expect(await screen.findByText(/you have no jobs yet/i)).toBeInTheDocument();
  });

  it('sends the status filter and paginates', async () => {
    const fetchMock = mockApi({
      jobs: (url) => {
        const page = Number(url.searchParams.get('page') ?? '1');
        return json(jobList([job(`p${page}`)], page, 30));
      },
    });
    renderPage();
    await screen.findByText('Tomas Field');

    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'completed');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('status=completed'))).toBe(true);
    });
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true);
    });
  });

  it('shows an error state with retry', async () => {
    mockApi({ jobs: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load your jobs/i);
  });
});
