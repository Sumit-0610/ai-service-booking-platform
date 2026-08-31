import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueService, PublicSlot } from '@aisbp/shared';
import { AuthProvider } from '../auth/AuthProvider';
import { ServiceAvailability } from './ServiceAvailability';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SERVICE: CatalogueService = {
  id: 'svc-1',
  slug: 'washing-machine-installation',
  name: 'Washing Machine Installation',
  description: 'Connect and level a washing machine.',
  priceCents: 8900,
  currency: 'USD',
  durationMinutes: 90,
  category: { id: 'c1', slug: 'appliance-installation', name: 'Appliance Installation' },
};

function slot(startsAt: string, endsAt: string, id = startsAt): PublicSlot {
  return {
    id,
    startsAt,
    endsAt,
    durationMinutes: Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000),
  };
}

/** Availability handler + an always-401 /auth/me so the panel is unauthenticated. */
function mockApi(availability: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/v1/auth/me')) {
      return Promise.resolve(json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401));
    }
    if (url.includes('/availability')) return Promise.resolve(availability());
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ServiceAvailability service={SERVICE} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const WINDOW = { from: '2026-09-14T00:00:00.000Z', to: '2026-09-28T00:00:00.000Z' };

describe('ServiceAvailability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders grouped slots with a timezone label', async () => {
    mockApi(() =>
      json({
        window: WINDOW,
        items: [
          slot('2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z'),
          slot('2026-09-15T11:00:00.000Z', '2026-09-15T12:00:00.000Z'),
          slot('2026-09-16T09:00:00.000Z', '2026-09-16T10:00:00.000Z'),
        ],
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /availability/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/times shown in/i)).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBe(2);
    const timeButtons = screen.getAllByRole('button').filter((b) => /–/.test(b.textContent ?? ''));
    expect(timeButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByLabelText(/loading availability/i)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockApi(() => json({ window: WINDOW, items: [] }));
    renderPanel();
    expect(
      await screen.findByText(/no available times in the next two weeks/i),
    ).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockApi(() => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500));
    renderPanel();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load available times/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('prompts an unauthenticated visitor to sign in, and books nothing', async () => {
    const fetchMock = mockApi(() =>
      json({
        window: WINDOW,
        items: [slot('2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z')],
      }),
    );
    renderPanel();

    const timeButton = await screen.findByRole('button', { name: /–/ });
    await userEvent.click(timeButton);

    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});
