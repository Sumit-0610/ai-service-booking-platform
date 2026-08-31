import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationsTechniciansPage } from './OperationsTechniciansPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tech(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: `Tech ${id}`,
    serviceArea: 'North',
    active: true,
    name: 'A Person',
    email: `${id}@example.com`,
    qualifiedServiceCount: 2,
    activeAssignmentCount: 1,
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

function mockApi(handler: (url: URL) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input), 'http://api.test');
    if (url.pathname === '/api/v1/operations/technicians') return Promise.resolve(handler(url));
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <OperationsTechniciansPage />
    </MemoryRouter>,
  );

describe('OperationsTechniciansPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists technicians with status and links to detail', async () => {
    mockApi(() => json(list([tech('a'), tech('b', { active: false })])));
    renderPage();

    expect(await screen.findByText('Tech a')).toBeInTheDocument();
    expect(screen.getByText('Tech b')).toBeInTheDocument();
    expect(screen.getAllByText(/active|inactive/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /manage/i })[0]).toHaveAttribute(
      'href',
      '/operations/technicians/a',
    );
  });

  it('sends the active filter to the API', async () => {
    const fetchMock = mockApi(() => json(list([tech('a')])));
    renderPage();
    await screen.findByText('Tech a');

    await userEvent.click(screen.getByRole('tab', { name: /inactive/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('active=false'))).toBe(true);
    });
  });

  it('shows an empty state', async () => {
    mockApi(() => json(list([])));
    renderPage();
    expect(await screen.findByText(/no technicians match/i)).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockApi(() => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load the technicians/i);
  });
});
