import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueService } from '@aisbp/shared';
import { CataloguePage } from './CataloguePage';
import { ServiceDetailPage } from './ServiceDetailPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CATEGORIES = {
  items: [
    { id: 'c1', slug: 'appliance-installation', name: 'Appliance Installation', description: 'x' },
    { id: 'c2', slug: 'home-networking', name: 'Home Networking', description: 'y' },
  ],
};

function service(overrides: Partial<CatalogueService> = {}): CatalogueService {
  return {
    id: 'svc-1',
    slug: 'washing-machine-installation',
    name: 'Washing Machine Installation',
    description: 'Connect and level a washing machine.',
    priceCents: 8900,
    currency: 'USD',
    durationMinutes: 90,
    category: { id: 'c1', slug: 'appliance-installation', name: 'Appliance Installation' },
    ...overrides,
  };
}

function serviceList(items: CatalogueService[], page = 1, total = items.length) {
  const limit = 12;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

interface MockOptions {
  services?: (url: URL) => Response | Promise<Response>;
  service?: () => Response | Promise<Response>;
}

function mockApi(options: MockOptions = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input), 'http://api.test');
    if (url.pathname === '/api/v1/categories') return Promise.resolve(json(CATEGORIES));
    if (url.pathname === '/api/v1/services') {
      return Promise.resolve(options.services?.(url) ?? json(serviceList([service()])));
    }
    if (url.pathname.startsWith('/api/v1/services/')) {
      return Promise.resolve(options.service?.() ?? json({ service: service() }));
    }
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

function renderCatalogue(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<CataloguePage />} />
        <Route path="/services/:slug" element={<ServiceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CataloguePage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders service cards from the API', async () => {
    mockApi({
      services: () =>
        json(
          serviceList([
            service(),
            service({
              id: 'svc-2',
              slug: 'dishwasher',
              name: 'Dishwasher Installation',
              priceCents: 9900,
              durationMinutes: 45,
            }),
          ]),
        ),
    });
    renderCatalogue();

    expect(
      await screen.findByRole('heading', { name: /washing machine installation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /dishwasher installation/i })).toBeInTheDocument();
    expect(screen.getByText('$89.00')).toBeInTheDocument();
    expect(screen.getByText('$99.00')).toBeInTheDocument();
    expect(screen.getByText('1 hr 30 min')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
  });

  it('shows a loading state first', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    renderCatalogue();
    expect(screen.getByLabelText(/loading services/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    mockApi({ services: () => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500) });
    renderCatalogue();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/couldn.t load the catalogue/i)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockApi({ services: () => json(serviceList([], 1, 0)) });
    renderCatalogue();
    expect(await screen.findByText(/no services match your search/i)).toBeInTheDocument();
  });

  it('sends the search term to the API after debounce', async () => {
    const fetchMock = mockApi();
    renderCatalogue();
    await screen.findByRole('heading', { name: /washing machine installation/i });

    await userEvent.type(screen.getByRole('searchbox', { name: /search services/i }), 'dryer');

    await waitFor(
      () => {
        const called = fetchMock.mock.calls.some(([u]) => String(u).includes('q=dryer'));
        expect(called).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('filters by category when a pill is clicked', async () => {
    const fetchMock = mockApi();
    renderCatalogue();
    await screen.findByRole('button', { name: 'Home Networking' });

    await userEvent.click(screen.getByRole('button', { name: 'Home Networking' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('category=home-networking')),
      ).toBe(true);
    });
  });

  it('paginates to the next page', async () => {
    const fetchMock = mockApi({
      services: (url) => {
        const page = Number(url.searchParams.get('page') ?? '1');
        return json(
          serviceList([service({ id: `p${page}`, name: `Service page ${page}` })], page, 30),
        );
      },
    });
    renderCatalogue();
    await screen.findByRole('heading', { name: /service page 1/i });

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true);
    });
    expect(await screen.findByRole('heading', { name: /service page 2/i })).toBeInTheDocument();
  });

  it('navigates to the service detail page', async () => {
    mockApi();
    renderCatalogue();
    const card = await screen.findByRole('link', { name: /washing machine installation/i });

    await userEvent.click(card);

    expect(await screen.findByText(/what.s included/i)).toBeInTheDocument();
    expect(screen.getByText(/online booking for this service opens/i)).toBeInTheDocument();
  });
});
