import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicSlot } from '@aisbp/shared';
import { ServiceAvailability } from './ServiceAvailability';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function slot(startsAt: string, endsAt: string, id = startsAt): PublicSlot {
  return {
    id,
    startsAt,
    endsAt,
    durationMinutes: Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000),
  };
}

function mockAvailability(handler: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    if (String(input).includes('/availability')) return Promise.resolve(handler());
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

const WINDOW = { from: '2026-09-14T00:00:00.000Z', to: '2026-09-28T00:00:00.000Z' };

describe('ServiceAvailability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders grouped slots with a timezone label', async () => {
    mockAvailability(() =>
      json({
        window: WINDOW,
        items: [
          slot('2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z'),
          slot('2026-09-15T11:00:00.000Z', '2026-09-15T12:00:00.000Z'),
          slot('2026-09-16T09:00:00.000Z', '2026-09-16T10:00:00.000Z'),
        ],
      }),
    );

    render(<ServiceAvailability slug="washing-machine-installation" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /availability/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/times shown in/i)).toBeInTheDocument();
    // two date tabs
    expect(screen.getAllByRole('tab').length).toBe(2);
    // the first day's slots render as time buttons
    const timeButtons = screen.getAllByRole('button').filter((b) => /–/.test(b.textContent ?? ''));
    expect(timeButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a loading state', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<ServiceAvailability slug="x" />);
    expect(screen.getByLabelText(/loading availability/i)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockAvailability(() => json({ window: WINDOW, items: [] }));
    render(<ServiceAvailability slug="x" />);
    expect(
      await screen.findByText(/no available times in the next two weeks/i),
    ).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockAvailability(() => json({ error: { code: 'INTERNAL', message: 'boom' } }, 500));
    render(<ServiceAvailability slug="x" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load available times/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('never performs a booking mutation when a time is selected', async () => {
    const fetchMock = mockAvailability(() =>
      json({
        window: WINDOW,
        items: [slot('2026-09-15T09:00:00.000Z', '2026-09-15T10:00:00.000Z')],
      }),
    );
    render(<ServiceAvailability slug="x" />);

    const timeButton = await screen.findByRole('button', { name: /–/ });
    await userEvent.click(timeButton);

    expect(screen.getByText(/booking opens in a later release/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});
