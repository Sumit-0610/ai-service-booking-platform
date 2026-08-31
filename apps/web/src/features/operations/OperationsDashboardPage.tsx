import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  bookingStatusValues,
  formatPrice,
  type BookingStatus,
  type OperationsBookingSort,
} from '@aisbp/shared';
import { useOpsBookings, useOpsDashboard } from './use-operations';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_LABEL = (s: BookingStatus): string => s.replace('_', ' ');

export function OperationsDashboardPage(): ReactElement {
  const dashboard = useOpsDashboard();
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [sort, setSort] = useState<OperationsBookingSort>('created_desc');
  const [page, setPage] = useState(1);

  const bookings = useOpsBookings({
    status: status || undefined,
    sort,
    page,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Operations dashboard</h1>
        <Link
          to="/operations/technicians"
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          Technicians →
        </Link>
      </div>

      {/* Metrics */}
      {dashboard.status === 'loading' ? (
        <div
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
          aria-busy="true"
          aria-label="Loading metrics"
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : dashboard.status === 'error' ? (
        <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-medium text-rose-800">We couldn&apos;t load the dashboard metrics.</p>
          <button
            type="button"
            onClick={dashboard.refetch}
            className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
        </div>
      ) : dashboard.dashboard ? (
        <section className="mt-6" aria-label="Metrics">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total bookings" value={dashboard.dashboard.bookings.total} />
            <Metric label="Active" value={dashboard.dashboard.bookings.active} />
            <Metric label="Upcoming" value={dashboard.dashboard.bookings.upcoming} />
            <Metric label="Active technicians" value={dashboard.dashboard.technicians.active} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {bookingStatusValues.map((s) => (
              <span
                key={s}
                className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600"
              >
                {STATUS_LABEL(s)}: {dashboard.dashboard?.bookings.byStatus[s] ?? 0}
              </span>
            ))}
          </div>

          {dashboard.dashboard.revenue.byCurrency.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              Committed revenue:{' '}
              {dashboard.dashboard.revenue.byCurrency
                .map((r) => formatPrice(r.committedTotalCents, r.currency))
                .join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Booking queue */}
      <section className="mt-10" aria-label="Booking queue">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Booking queue</h2>
          <div className="flex gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="sr-only">Filter by status</span>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as BookingStatus | '');
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {bookingStatusValues.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="sr-only">Sort</span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as OperationsBookingSort);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5"
                aria-label="Sort bookings"
              >
                <option value="created_desc">Newest first</option>
                <option value="created_asc">Oldest first</option>
                <option value="scheduled_asc">Soonest scheduled</option>
                <option value="scheduled_desc">Latest scheduled</option>
              </select>
            </label>
          </div>
        </div>

        {bookings.status === 'error' ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm"
          >
            <p className="font-medium text-rose-800">We couldn&apos;t load the booking queue.</p>
            <button
              type="button"
              onClick={bookings.refetch}
              className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : bookings.status === 'loading' && !bookings.data ? (
          <div className="mt-4 space-y-2" aria-busy="true">
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : bookings.data && bookings.data.items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No bookings match this filter.</p>
        ) : bookings.data ? (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Service</th>
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Scheduled</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bookings.data.items.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-4 font-medium text-slate-900">{b.service.name}</td>
                      <td className="py-2 pr-4 text-slate-600">{b.customerName}</td>
                      <td className="py-2 pr-4 text-slate-600">{formatWhen(b.scheduledStart)}</td>
                      <td className="py-2 pr-4 tabular-nums text-slate-600">
                        {formatPrice(b.totalCents, b.currency)}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {STATUS_LABEL(b.status)}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          to={`/operations/bookings/${b.id}`}
                          className="text-sm font-medium text-sky-700 hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>
                Page {bookings.data.pagination.page} of{' '}
                {Math.max(1, bookings.data.pagination.totalPages)} ·{' '}
                {bookings.data.pagination.total} total
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!bookings.data.pagination.hasPreviousPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!bookings.data.pagination.hasNextPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
