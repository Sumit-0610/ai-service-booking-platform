import { useEffect, useRef, useState } from 'react';
import type { CatalogueCategory, CatalogueService, CatalogueServiceList } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { catalogueApi, type ServiceQuery } from './catalogue-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: ApiError | Error | null;
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useCategories(): AsyncState<CatalogueCategory[]> {
  const [state, setState] = useState<AsyncState<CatalogueCategory[]>>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    catalogueApi
      .listCategories()
      .then((response) => {
        if (active) setState({ status: 'success', data: response.items, error: null });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: 'error', data: null, error: normaliseError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

/** Keeps the previous page visible while the next one loads. */
export function useServices(query: ServiceQuery): AsyncState<CatalogueServiceList> & {
  refetch: () => void;
} {
  const [state, setState] = useState<AsyncState<CatalogueServiceList>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const key = `${query.q ?? ''}|${query.category ?? ''}|${query.sort ?? ''}|${query.page ?? 1}|${nonce}`;
  const previous = useRef<CatalogueServiceList | null>(null);

  useEffect(() => {
    let active = true;
    setState((current) => ({
      status: 'loading',
      data: current.data ?? previous.current,
      error: null,
    }));

    catalogueApi
      .listServices(query)
      .then((data) => {
        if (!active) return;
        previous.current = data;
        setState({ status: 'success', data, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', data: null, error: normaliseError(error) });
      });

    return () => {
      active = false;
    };
  }, [key]);

  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

export function useService(slug: string): AsyncState<CatalogueService> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<CatalogueService>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, error: null });
    catalogueApi
      .getService(slug)
      .then((response) => {
        if (active) setState({ status: 'success', data: response.service, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', data: null, error: normaliseError(error) });
      });
    return () => {
      active = false;
    };
  }, [slug, nonce]);

  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

function normaliseError(error: unknown): ApiError | Error {
  if (error instanceof ApiError || error instanceof Error) return error;
  return new Error('Something went wrong');
}
