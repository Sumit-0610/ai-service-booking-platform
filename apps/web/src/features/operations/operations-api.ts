import type {
  AssignableTechniciansResponse,
  BookingStatus,
  OperationsBooking,
  OperationsBookingList,
  OperationsBookingSort,
  OperationsDashboardResponse,
  OperationsStatusTarget,
  OperationsTechnicianList,
  OperationsTechnicianResponse,
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

  // --- technician management (Milestone 11) ---
  listTechnicians: (query: {
    active?: boolean | undefined;
    q?: string | undefined;
    page?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.active !== undefined) params.set('active', String(query.active));
    if (query.q) params.set('q', query.q);
    if (query.page && query.page > 1) params.set('page', String(query.page));
    const qs = params.toString();
    return apiRequest<OperationsTechnicianList>(
      `/api/v1/operations/technicians${qs ? `?${qs}` : ''}`,
    );
  },
  getTechnician: (id: string) =>
    apiRequest<OperationsTechnicianResponse>(
      `/api/v1/operations/technicians/${encodeURIComponent(id)}`,
    ),
  setTechnicianActive: (id: string, active: boolean) =>
    apiRequest<OperationsTechnicianResponse>(
      `/api/v1/operations/technicians/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: { active } },
    ),
  addQualification: (id: string, serviceId: string) =>
    apiRequest<OperationsTechnicianResponse>(
      `/api/v1/operations/technicians/${encodeURIComponent(id)}/services`,
      { method: 'POST', body: { serviceId } },
    ),
  removeQualification: (id: string, serviceId: string) =>
    apiRequest<OperationsTechnicianResponse>(
      `/api/v1/operations/technicians/${encodeURIComponent(id)}/services/${encodeURIComponent(serviceId)}`,
      { method: 'DELETE' },
    ),

  // --- booking assignment (Milestone 11) ---
  assignableTechnicians: (bookingId: string) =>
    apiRequest<AssignableTechniciansResponse>(
      `/api/v1/operations/bookings/${encodeURIComponent(bookingId)}/assignable-technicians`,
    ),
  assignTechnician: (bookingId: string, body: { technicianId: string; reason?: string }) =>
    apiRequest<{ booking: OperationsBooking }>(
      `/api/v1/operations/bookings/${encodeURIComponent(bookingId)}/assign-technician`,
      { method: 'POST', body },
    ),
};
