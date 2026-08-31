import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TechnicianJobStatusTarget } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { technicianApi } from './technician-api';
import { useTechnicianJob } from './use-technician';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const NEXT_ACTION: Partial<Record<string, { target: TechnicianJobStatusTarget; label: string }>> = {
  assigned: { target: 'in_progress', label: 'Start job' },
  in_progress: { target: 'completed', label: 'Mark complete' },
};

export function TechnicianJobDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { status, job, error, refetch, setJob } = useTechnicianJob(id);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const advance = async (target: TechnicianJobStatusTarget): Promise<void> => {
    if (target === 'completed' && !window.confirm('Mark this job as complete?')) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const { booking } = await technicianApi.updateJobStatus(id, target);
      setJob(booking);
      setNotice(target === 'completed' ? 'Job completed.' : 'Job started.');
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'Could not update the job. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" />
      </main>
    );
  }

  if (status === 'error' || !job) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6" role="alert">
        <h1 className="text-xl font-bold text-slate-900">
          {notFound ? 'Job not found' : 'Something went wrong'}
        </h1>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/technician/bookings"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to jobs
          </Link>
          {!notFound ? (
            <button
              type="button"
              onClick={refetch}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Try again
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const next = NEXT_ACTION[job.status];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link to="/technician/bookings" className="text-sm text-slate-500 hover:text-slate-700">
        ← Your jobs
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{job.service.name}</h1>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {job.status.replace('_', ' ')}
        </span>
      </div>

      <dl className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">Customer</dt>
          <dd className="font-medium text-slate-900">{job.customerName}</dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">Scheduled</dt>
          <dd className="font-medium text-slate-900">
            {formatWhen(job.scheduledStart)} – {formatWhen(job.scheduledEnd)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">Address</dt>
          <dd className="font-medium text-slate-900 sm:text-right">
            {job.address.line1}
            {job.address.line2 ? `, ${job.address.line2}` : ''}, {job.address.city},{' '}
            {job.address.state} {job.address.postalCode}
          </dd>
        </div>
        {job.customerNotes ? (
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-slate-500">Notes</dt>
            <dd className="font-medium text-slate-900 sm:text-right">{job.customerNotes}</dd>
          </div>
        ) : null}
      </dl>

      {next ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => advance(next.target)}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Working…' : next.label}
          </button>
          {notice ? (
            <p role="status" className="mt-2 text-sm font-medium text-emerald-700">
              {notice}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="mt-8" aria-label="Status timeline">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
        <ol className="mt-3 space-y-1.5 text-sm">
          {job.statusHistory.map((event, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span className="text-slate-700">
                {event.from ? `${event.from.replace('_', ' ')} → ` : ''}
                {event.to.replace('_', ' ')}
                {event.reason ? ` · ${event.reason}` : ''}
              </span>
              <span className="shrink-0 text-slate-400">{formatWhen(event.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
