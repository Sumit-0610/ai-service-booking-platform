import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CUSTOMER = { id: 'u1', email: 'dana@example.com', name: 'Dana', role: 'customer' as const };

describe('auth flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('redirects an unauthenticated visitor to the login page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('lets a user log in and then shows the authenticated home page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/v1/auth/me') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'nope' } }, 401),
        );
      }
      if (url.endsWith('/api/v1/auth/login') && method === 'POST') {
        return Promise.resolve(jsonResponse({ user: CUSTOMER }, 200));
      }
      return Promise.resolve(jsonResponse({ error: { code: 'UNKNOWN', message: 'x' } }, 500));
    });

    render(<App />);
    await screen.findByRole('heading', { name: /log in/i });

    await userEvent.type(screen.getByLabelText(/email/i), 'dana@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct-horse-battery-staple');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText(/signed in as/i)).toHaveTextContent('Dana');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
