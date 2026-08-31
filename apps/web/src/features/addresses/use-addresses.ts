import { useCallback, useEffect, useState } from 'react';
import type { Address } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { addressApi } from './address-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

export function useAddresses(): {
  status: AsyncStatus;
  addresses: Address[];
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    addressApi
      .list()
      .then((response) => {
        if (!active) return;
        setAddresses(response.items);
        setError(null);
        setStatus('success');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught : new Error('Failed to load addresses'));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { status, addresses, error, refetch };
}
