import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { BookingStatus } from '@aisbp/shared';
import { useTechnicianJobs } from './use-technician';

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-sky-100 text-sky-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  rejected: 'bg-rose-100 text-rose-800',
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TechnicianJobsPage(): ReactElement {
  const { status, profile, jobs, error, refetch } = useTechnicianJobs();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-slate-900">Your jobs</h1>

      {status === 'loading' ? (
        <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading jobs">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : status === 'error' ? (
        <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-medium text-rose-800">We couldn&apos;t load your jobs.</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
          <span className="sr-only">{error?.message}</span>
        </div>
      ) : (
        <>
          {profile ? (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold text-slate-900">
                {profile.displayName}
                {!profile.active ? (
                  <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    inactive
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-slate-500">Service area: {profile.serviceArea}</p>
              <p className="mt-1 text-slate-600">
                Qualified for:{' '}
                {profile.qualifications.length === 0
                  ? 'no services yet'
                  : profile.qualifications.map((q) => q.name).join(', ')}
              </p>
            </section>
          ) : null}

          {jobs.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">You have no jobs yet.</p>
          ) : (
            <ul className="mt-6 space-y-4">
              {jobs.map((job) => (
                <li key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-900">{job.service.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {formatWhen(job.scheduledStart)}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {job.customerName} · {job.address.line1}, {job.address.city}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[job.status]}`}
                    >
                      {job.status.replace('_', ' ')}
                    </span>
                  </div>
                  <Link
                    to={`/technician/bookings/${job.id}`}
                    className="mt-3 inline-block text-sm font-medium text-sky-700 hover:underline"
                  >
                    Open job →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
