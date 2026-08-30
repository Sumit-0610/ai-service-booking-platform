import type { AuthMeResponse, LoginInput, RegisterInput, SessionUser } from '@aisbp/shared';
import { apiRequest } from '../../lib/api';

export const authApi = {
  me: () => apiRequest<AuthMeResponse>('/api/v1/auth/me'),
  login: (input: LoginInput) =>
    apiRequest<{ user: SessionUser }>('/api/v1/auth/login', { method: 'POST', body: input }),
  register: (input: RegisterInput) =>
    apiRequest<{ user: SessionUser }>('/api/v1/auth/register', { method: 'POST', body: input }),
  logout: () => apiRequest<null>('/api/v1/auth/logout', { method: 'POST' }),
};
