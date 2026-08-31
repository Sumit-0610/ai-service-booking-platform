import type {
  Booking,
  BookingList,
  BookingListSort,
  BookingStatus,
  BookingStatusHistory,
  CreateBookingInput,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export interface BookingQuery {
  status?: BookingStatus | undefined;
  sort?: BookingListSort | undefined;
  page?: number | undefined;
}

function toSearchParams(query: BookingQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const bookingApi = {
  list: (query: BookingQuery = {}) =>
    apiRequest<BookingList>(`/api/v1/bookings${toSearchParams(query)}`),
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
