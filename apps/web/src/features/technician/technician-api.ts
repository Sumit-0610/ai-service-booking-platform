import type {
  TechnicianBookingList,
  TechnicianJobResponse,
  TechnicianJobStatusTarget,
  TechnicianProfileResponse,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export const technicianApi = {
  profile: () => apiRequest<TechnicianProfileResponse>('/api/v1/technician/profile'),
  listJobs: () => apiRequest<TechnicianBookingList>('/api/v1/technician/bookings'),
  getJob: (id: string) =>
    apiRequest<TechnicianJobResponse>(`/api/v1/technician/bookings/${encodeURIComponent(id)}`),
  updateJobStatus: (id: string, status: TechnicianJobStatusTarget) =>
    apiRequest<TechnicianJobResponse>(
      `/api/v1/technician/bookings/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: { status } },
    ),
};
