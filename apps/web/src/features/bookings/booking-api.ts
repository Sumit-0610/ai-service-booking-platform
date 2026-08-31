import type { Booking, BookingList, BookingStatusHistory, CreateBookingInput } from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export const bookingApi = {
  list: () => apiRequest<BookingList>('/api/v1/bookings'),
  get: (id: string) =>
    apiRequest<{ booking: Booking }>(`/api/v1/bookings/${encodeURIComponent(id)}`),
  statusHistory: (id: string) =>
    apiRequest<BookingStatusHistory>(`/api/v1/bookings/${encodeURIComponent(id)}/status-history`),
  create: (input: CreateBookingInput) =>
    apiRequest<{ booking: Booking }>('/api/v1/bookings', { method: 'POST', body: input }),
  cancel: (id: string) =>
    apiRequest<{ booking: Booking }>(`/api/v1/bookings/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
};
