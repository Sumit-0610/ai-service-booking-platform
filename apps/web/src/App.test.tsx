import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CUSTOMER = { id: 'u1', email: 'dana@example.com', name: 'Dana', role: 'customer' as const };
const EMPTY_LIST = {
  items: [],
  pagination: {
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

function mockApi(overrides: Record<string, () => Promise<Response>> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const key = `${method} ${new URL(url, 'http://x').pathname}`;
    if (overrides[key]) return overrides[key]();
    if (key === 'GET /api/v1/auth/me') {
      return Promise.resolve(json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, 401));
    }
    if (key === 'GET /api/v1/categories') return Promise.resolve(json({ items: [] }));
    if (key === 'GET /api/v1/services') return Promise.resolve(json(EMPTY_LIST));
    return Promise.resolve(json({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
  });
}

describe('App routing and auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('shows the public catalogue at / without authentication', async () => {
    mockApi();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /service catalogue/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /account to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/account');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /account/addresses to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/account/addresses');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /account/bookings to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/account/bookings');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /technician/availability to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/technician/availability');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /operations to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/operations');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('blocks a customer from the operations dashboard', async () => {
    mockApi({ 'GET /api/v1/auth/me': () => Promise.resolve(json({ user: CUSTOMER })) });
    window.history.pushState({}, '', '/operations');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
    });
  });

  it('redirects an unauthenticated visit to /operations/technicians to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/operations/technicians');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('redirects an unauthenticated visit to /technician/bookings to the login page', async () => {
    mockApi();
    window.history.pushState({}, '', '/technician/bookings');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('logs in and reflects the session in the header', async () => {
    const fetchMock = mockApi({
      'POST /api/v1/auth/login': () => Promise.resolve(json({ user: CUSTOMER }, 200)),
    });
    window.history.pushState({}, '', '/login');
    render(<App />);

    await screen.findByRole('heading', { name: /log in/i });
    await userEvent.type(screen.getByLabelText(/email/i), 'dana@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse-battery-staple');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Dana' })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
