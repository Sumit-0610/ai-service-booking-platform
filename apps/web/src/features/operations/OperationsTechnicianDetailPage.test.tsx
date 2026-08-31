import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationsTechnician } from '@aisbp/shared';
import { OperationsTechnicianDetailPage } from './OperationsTechnicianDetailPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function technician(overrides: Partial<OperationsTechnician> = {}): OperationsTechnician {
  return {
    id: 't1',
    displayName: 'Tomas Field',
    serviceArea: 'North',
    active: true,
    name: 'Tomas',
    email: 'tomas@example.com',
    qualifiedServiceCount: 1,
    activeAssignmentCount: 0,
    qualifications: [
      {
        serviceId: 'svc-1',
        slug: 'washing-machine-installation',
        name: 'Washing Machine',
        active: true,
      },
    ],
    ...overrides,
  };
}

const SERVICES = {
  items: [
    {
      id: 'svc-1',
      slug: 'washing-machine-installation',
      name: 'Washing Machine',
      description: 'x',
      priceCents: 8900,
      currency: 'USD',
      durationMinutes: 90,
      category: { id: 'c', slug: 'appliance', name: 'Appliance' },
    },
    {
      id: 'svc-2',
      slug: 'wifi-mesh-setup',
      name: 'Wi-Fi Mesh Setup',
      description: 'x',
      priceCents: 12000,
      currency: 'USD',
      durationMinutes: 120,
      category: { id: 'c', slug: 'appliance', name: 'Appliance' },
    },
  ],
  pagination: {
    page: 1,
    limit: 48,
    total: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

interface Handlers {
  get?: () => Response;
  patch?: () => Response;
  addService?: () => Response;
  removeService?: () => Response;
}

function mockApi(h: Handlers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/services')) return Promise.resolve(json(SERVICES));
    if (url.includes('/status') && method === 'PATCH') {
      return Promise.resolve(h.patch?.() ?? json({ technician: technician({ active: false }) }));
    }
    if (url.includes('/services/') && method === 'DELETE') {
      return Promise.resolve(
        h.removeService?.() ?? json({ technician: technician({ qualifications: [] }) }),
      );
    }
    if (url.includes('/services') && method === 'POST') {
      return Promise.resolve(
        h.addService?.() ??
          json({
            technician: technician({
              qualifications: [
                ...technician().qualifications,
                {
                  serviceId: 'svc-2',
                  slug: 'wifi-mesh-setup',
                  name: 'Wi-Fi Mesh Setup',
                  active: true,
                },
              ],
            }),
          }),
      );
    }
    if (url.includes('/api/v1/operations/technicians/')) {
      return Promise.resolve(h.get?.() ?? json({ technician: technician() }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/operations/technicians/t1']}>
      <Routes>
        <Route path="/operations/technicians/:id" element={<OperationsTechnicianDetailPage />} />
        <Route path="/operations/technicians" element={<p>List</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('OperationsTechnicianDetailPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the profile and qualifications', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByRole('heading', { name: /tomas field/i })).toBeInTheDocument();
    expect(screen.getByText(/tomas@example.com/)).toBeInTheDocument();
    expect(screen.getByText('Washing Machine')).toBeInTheDocument();
  });

  it('deactivates the technician after confirmation', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByRole('heading', { name: /tomas field/i });

    await userEvent.click(screen.getByRole('button', { name: /deactivate technician/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).includes('/status') && i?.method === 'PATCH',
        ),
      ).toBe(true);
    });
    expect(await screen.findByText('inactive')).toBeInTheDocument();
  });

  it('adds a qualification', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByRole('heading', { name: /tomas field/i });

    await userEvent.selectOptions(screen.getByLabelText(/service to add/i), 'svc-2');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/services') && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ serviceId: 'svc-2' });
    });
    expect(await screen.findByText('Wi-Fi Mesh Setup')).toBeInTheDocument();
  });

  it('surfaces a duplicate-qualification 409', async () => {
    mockApi({
      addService: () => json({ error: { code: 'CONFLICT', message: 'already has it' } }, 409),
    });
    renderPage();
    await screen.findByRole('heading', { name: /tomas field/i });

    await userEvent.selectOptions(screen.getByLabelText(/service to add/i), 'svc-2');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has it/i);
  });

  it('shows a not-found state', async () => {
    mockApi({ get: () => json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404) });
    renderPage();
    expect(await screen.findByText(/technician not found/i)).toBeInTheDocument();
  });
});
