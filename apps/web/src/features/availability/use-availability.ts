import { useCallback, useEffect, useState } from 'react';
import type { PublicSlot, TechnicianSlot } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { availabilityApi } from './availability-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

function normaliseError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error('Something went wrong');
}

export function useServiceAvailability(slug: string): {
  status: AsyncStatus;
  slots: PublicSlot[];
  window: { from: string; to: string } | null;
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [window, setWindow] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    availabilityApi
      .forService(slug)
      .then((response) => {
        if (!active) return;
        setSlots(Array.isArray(response.items) ? response.items : []);
        setWindow(response.window ?? null);
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
  }, [slug, nonce]);

  return { status, slots, window, error, refetch: () => setNonce((n) => n + 1) };
}

export function useTechnicianAvailability(): {
  status: AsyncStatus;
  slots: TechnicianSlot[];
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [slots, setSlots] = useState<TechnicianSlot[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    availabilityApi
      .listMine()
      .then((response) => {
        if (!active) return;
        setSlots(response.items);
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

  return { status, slots, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

// ---------------------------------------------------------------------------
// Local-time display helpers. The API is UTC; the browser renders local.
// ---------------------------------------------------------------------------

export const localTimeZone =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function formatLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
