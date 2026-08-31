import type {
  CreateSlotInput,
  PublicAvailability,
  TechnicianSlot,
  TechnicianSlotList,
} from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

/** `startsAt` / `endsAt` go on the wire as ISO strings. */
export interface SlotBody {
  serviceSlug: string;
  startsAt: string;
  endsAt: string;
}

export type SlotPatchBody = Partial<SlotBody>;

export const availabilityApi = {
  forService: (slug: string) =>
    apiRequest<PublicAvailability>(`/api/v1/services/${encodeURIComponent(slug)}/availability`),

  listMine: () => apiRequest<TechnicianSlotList>('/api/v1/technician/availability'),

  create: (body: SlotBody) =>
    apiRequest<{ slot: TechnicianSlot }>('/api/v1/technician/availability', {
      method: 'POST',
      body,
    }),

  update: (id: string, body: SlotPatchBody) =>
    apiRequest<{ slot: TechnicianSlot }>(
      `/api/v1/technician/availability/${encodeURIComponent(id)}`,
      { method: 'PATCH', body },
    ),

  remove: (id: string) =>
    apiRequest<null>(`/api/v1/technician/availability/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

// Re-exported so form code has one place to import the request contract from.
export type { CreateSlotInput };
