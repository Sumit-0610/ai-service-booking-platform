import { useCallback, useEffect, useState } from 'react';
import type { Booking } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { bookingApi } from './booking-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

function normaliseError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error('Something went wrong');
}

export function useMyBookings(): {
  status: AsyncStatus;
  bookings: Booking[];
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    bookingApi
      .list()
      .then((response) => {
        if (!active) return;
        setBookings(Array.isArray(response.items) ? response.items : []);
        setError(null);
        setStatus('success');
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(normaliseError(caught));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { status, bookings, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}
