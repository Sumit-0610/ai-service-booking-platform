import type {
  BookingListSort,
  BookingStatus,
  TechnicianBookingList,
  TechnicianJobResponse,
  TechnicianJobStatusTarget,
  TechnicianProfileResponse,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export interface TechnicianJobsQuery {
  status?: BookingStatus | undefined;
  sort?: BookingListSort | undefined;
  page?: number | undefined;
}

function toSearchParams(query: TechnicianJobsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const technicianApi = {
  profile: () => apiRequest<TechnicianProfileResponse>('/api/v1/technician/profile'),
  listJobs: (query: TechnicianJobsQuery = {}) =>
    apiRequest<TechnicianBookingList>(`/api/v1/technician/bookings${toSearchParams(query)}`),
  getJob: (id: string) =>
    apiRequest<TechnicianJobResponse>(`/api/v1/technician/bookings/${encodeURIComponent(id)}`),
  updateJobStatus: (id: string, status: TechnicianJobStatusTarget) =>
    apiRequest<TechnicianJobResponse>(
      `/api/v1/technician/bookings/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: { status } },
    ),
};
