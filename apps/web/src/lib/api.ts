import { healthResponseSchema, type HealthResponse } from '@aisbp/shared';
import { clientEnv } from '../config/env';

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch(`${clientEnv.VITE_API_BASE_URL}/api/v1/health`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('API health check failed');
  }

  return healthResponseSchema.parse(await response.json());
}
