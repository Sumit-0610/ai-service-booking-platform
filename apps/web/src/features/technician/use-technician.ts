import { useCallback, useEffect, useState } from 'react';
import type { TechnicianBooking, TechnicianJob, TechnicianProfile } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { technicianApi } from './technician-api';

export type AsyncStatus = 'loading' | 'success' | 'error';

function normaliseError(error: unknown): ApiError | Error {
  return error instanceof Error ? error : new Error('Something went wrong');
}

export function useTechnicianJobs(): {
  status: AsyncStatus;
  profile: TechnicianProfile | null;
  jobs: TechnicianBooking[];
  error: ApiError | Error | null;
  refetch: () => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [profile, setProfile] = useState<TechnicianProfile | null>(null);
  const [jobs, setJobs] = useState<TechnicianBooking[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    Promise.all([technicianApi.profile(), technicianApi.listJobs()])
      .then(([p, j]) => {
        if (!active) return;
        setProfile(p.profile);
        setJobs(Array.isArray(j.items) ? j.items : []);
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

  return { status, profile, jobs, error, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useTechnicianJob(id: string): {
  status: AsyncStatus;
  job: TechnicianJob | null;
  error: ApiError | Error | null;
  refetch: () => void;
  setJob: (job: TechnicianJob) => void;
} {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [job, setJob] = useState<TechnicianJob | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    technicianApi
      .getJob(id)
      .then((response) => {
        if (!active) return;
        setJob(response.booking);
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
    job,
    error,
    refetch: useCallback(() => setNonce((n) => n + 1), []),
    setJob,
  };
}
