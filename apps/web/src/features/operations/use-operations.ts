import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OperationsBooking,
  OperationsBookingList,
  OperationsDashboard,
  OperationsTechnician,
  OperationsTechnicianList,
  OperationsTechnicianSort,
} from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { operationsApi, type OpsBookingQuery } from './operations-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

function normaliseError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error('Something went wrong');
}

export function useOpsDashboard(): {
  status: AsyncStatus;
  dashboard: OperationsDashboard | null;
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    operationsApi
      .dashboard()
      .then((response) => {
        if (!active) return;
        setDashboard(response.dashboard);
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

  return { status, dashboard, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useOpsBookings(query: OpsBookingQuery): {
  status: AsyncStatus;
  data: OperationsBookingList | null;
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [data, setData] = useState<OperationsBookingList | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const previous = useRef<OperationsBookingList | null>(null);
  const key = `${query.status ?? ''}|${query.q ?? ''}|${query.sort ?? ''}|${query.page ?? 1}|${nonce}`;

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setData((current) => current ?? previous.current);
    operationsApi
      .listBookings(query)
      .then((response) => {
        if (!active) return;
        previous.current = response;
        setData(response);
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

  return { status, data, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useOpsBooking(id: string): {
  status: AsyncStatus;
  booking: OperationsBooking | null;
  error: ApiError | Error | null;
  refetch: () => void;
  setBooking: (booking: OperationsBooking) => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [booking, setBooking] = useState<OperationsBooking | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    operationsApi
      .getBooking(id)
      .then((response) => {
        if (!active) return;
        setBooking(response.booking);
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
  }, [id, nonce]);

  return {
    status,
    booking,
    error,
    refetch: useCallback(() => setNonce((n) => n + 1), []),
    setBooking,
  };
}

export function useOpsTechnicians(query: {
  active?: boolean | undefined;
  sort?: OperationsTechnicianSort | undefined;
  page: number;
}): {
  status: AsyncStatus;
  data: OperationsTechnicianList | null;
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [data, setData] = useState<OperationsTechnicianList | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${query.active ?? ''}|${query.sort ?? ''}|${query.page}|${nonce}`;

  useEffect(() => {
    let active = true;
    setStatus('loading');
    operationsApi
      .listTechnicians({ active: query.active, sort: query.sort, page: query.page })
      .then((response) => {
        if (!active) return;
        setData(response);
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

  return { status, data, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useOpsTechnician(id: string): {
  status: AsyncStatus;
  technician: OperationsTechnician | null;
  error: ApiError | Error | null;
  refetch: () => void;
  setTechnician: (t: OperationsTechnician) => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [technician, setTechnician] = useState<OperationsTechnician | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    operationsApi
      .getTechnician(id)
      .then((response) => {
        if (!active) return;
        setTechnician(response.technician);
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
  }, [id, nonce]);

  return {
    status,
    technician,
    error,
    refetch: useCallback(() => setNonce((n) => n + 1), []),
    setTechnician,
  };
}
