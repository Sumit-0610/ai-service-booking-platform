import type {
  BookingStatus,
  OperationsBooking,
  OperationsBookingList,
  OperationsBookingSort,
  OperationsDashboardResponse,
  OperationsStatusTarget,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export interface OpsBookingQuery {
  status?: BookingStatus | undefined;
  q?: string | undefined;
  sort?: OperationsBookingSort | undefined;
  page?: number | undefined;
}

function toSearchParams(query: OpsBookingQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const operationsApi = {
  dashboard: () => apiRequest<OperationsDashboardResponse>('/api/v1/operations/dashboard'),
  listBookings: (query: OpsBookingQuery) =>
    apiRequest<OperationsBookingList>(`/api/v1/operations/bookings${toSearchParams(query)}`),
  getBooking: (id: string) =>
    apiRequest<{ booking: OperationsBooking }>(
      `/api/v1/operations/bookings/${encodeURIComponent(id)}`,
    ),
  updateStatus: (id: string, body: { status: OperationsStatusTarget; reason?: string }) =>
    apiRequest<{ booking: OperationsBooking }>(
      `/api/v1/operations/bookings/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body },
    ),
};
