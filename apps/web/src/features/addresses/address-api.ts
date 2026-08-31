import type { Address, AddressList, CreateAddressInput, UpdateAddressInput } from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export const addressApi = {
  list: () => apiRequest<AddressList>('/api/v1/addresses'),
  create: (input: CreateAddressInput) =>
    apiRequest<{ address: Address }>('/api/v1/addresses', { method: 'POST', body: input }),
  update: (id: string, input: UpdateAddressInput) =>
    apiRequest<{ address: Address }>(`/api/v1/addresses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),
  remove: (id: string) =>
    apiRequest<null>(`/api/v1/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
