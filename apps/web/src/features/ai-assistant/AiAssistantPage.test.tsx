import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiBookingIntent, AiIntentResponse } from '@aisbp/shared';
import { AiAssistantPage } from './AiAssistantPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function intent(overrides: Partial<AiBookingIntent> = {}): AiBookingIntent {
  return {
    serviceSlug: null,
    serviceCandidateSlugs: [],
    requestedDate: null,
    requestedTimeOfDay: null,
    addressId: null,
    notes: null,
    missingFields: ['service', 'date', 'address'],
    clarificationQuestion: 'Which service do you need?',
    confidence: 'low',
    ...overrides,
  };
}

function response(overrides: Partial<AiIntentResponse> = {}): AiIntentResponse {
  return {
    intent: intent(),
    matchedService: null,
    assistantMessage: 'Which service do you need?',
    ...overrides,
  };
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/assistant']}>
      <Routes>
        <Route path="/assistant" element={<AiAssistantPage />} />
        <Route path="/services/:slug" element={<p>Service detail</p>} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('AiAssistantPage', () => {
  it('sends a message and shows the assistant reply and clarification', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(response()));
    renderPage();

    await userEvent.type(
      screen.getByLabelText(/message the booking assistant/i),
      'help me book something',
    );
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain('/api/v1/ai/booking-assistant/intent');
      expect(init?.method).toBe('POST');
    });
    expect(await screen.findAllByText(/which service do you need/i)).not.toHaveLength(0);
    expect(screen.getByText(/still need: service, date, address/i)).toBeInTheDocument();
  });

  it('uses /clarify for the second message', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(response()));
    renderPage();
    const box = screen.getByLabelText(/message the booking assistant/i);

    await userEvent.type(box, 'first');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await userEvent.type(box, 'second');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/clarify');
  });

  it('offers a Review & book link once the intent is complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(
        response({
          intent: intent({
            serviceSlug: 'washing-machine-installation',
            requestedDate: '2099-01-01',
            addressId: 'addr-1',
            missingFields: [],
            clarificationQuestion: null,
            confidence: 'high',
          }),
          matchedService: {
            slug: 'washing-machine-installation',
            name: 'Washing Machine Installation',
            priceCents: 8900,
            currency: 'USD',
            durationMinutes: 90,
          },
          assistantMessage: 'Got it — ready to book.',
        }),
      ),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText(/message the booking assistant/i), 'do it');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    const link = await screen.findByRole('link', { name: /review & book/i });
    expect(link).toHaveAttribute('href', '/services/washing-machine-installation');
  });

  it('shows a friendly message when the assistant is unavailable (503)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The booking assistant is not available right now.',
          },
        },
        503,
      ),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText(/message the booking assistant/i), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/not available right now/i)).toBeInTheDocument();
  });
});
