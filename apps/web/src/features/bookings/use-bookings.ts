import { useCallback, useEffect, useState } from 'react';
import type { Booking, PaginationMeta } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { bookingApi, type BookingQuery } from './booking-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

function normaliseError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error('Something went wrong');
}

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export function useMyBookings(query: BookingQuery): {
  status: AsyncStatus;
  bookings: Booking[];
  pagination: PaginationMeta;
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${query.status ?? ''}|${query.sort ?? ''}|${query.page ?? 1}|${nonce}`;

  useEffect(() => {
    let active = true;
    setStatus('loading');
    bookingApi
      .list(query)
      .then((response) => {
        if (!active) return;
        setBookings(Array.isArray(response.items) ? response.items : []);
        setPagination(response.pagination ?? EMPTY_PAGINATION);
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
  }, [key]);

  return {
    status,
    bookings,
    pagination,
    error,
    refetch: useCallback(() => setNonce((n) => n + 1), []),
  };
}
