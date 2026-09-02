import type { AiAvailabilityResponse, AiBookingIntent, AiIntentResponse } from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

/**
 * Client for the Claude AI Booking Assistant (Milestone 14). Same `apiRequest`
 * wrapper as every other feature — cookie auth, CSRF header on POST. The
 * responses are draft intents / availability summaries; booking creation still
 * goes through the normal booking flow.
 */
export const aiApi = {
  intent: (message: string) =>
    apiRequest<AiIntentResponse>('/api/v1/ai/booking-assistant/intent', {
      method: 'POST',
      body: { message },
    }),
  clarify: (message: string, priorIntent: AiBookingIntent) =>
    apiRequest<AiIntentResponse>('/api/v1/ai/booking-assistant/clarify', {
      method: 'POST',
      body: { message, priorIntent },
    }),
  availability: (serviceSlug: string, message?: string) =>
    apiRequest<AiAvailabilityResponse>('/api/v1/ai/booking-assistant/availability', {
      method: 'POST',
      body: message ? { serviceSlug, message } : { serviceSlug },
    }),
};
