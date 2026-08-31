import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useOpsTechnicians } from './use-operations';

type ActiveFilter = 'all' | 'active' | 'inactive';

export function OperationsTechniciansPage(): ReactElement {
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const { status, data, error, refetch } = useOpsTechnicians({
    active: filter === 'all' ? undefined : filter === 'active',
    page,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Technicians</h1>
        <Link to="/operations" className="text-sm text-slate-500 hover:text-slate-700">
          ← Dashboard
        </Link>
      </div>

      <div className="mt-4 flex gap-2 text-sm" role="tablist" aria-label="Filter technicians">
        {(['all', 'active', 'inactive'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => {
              setFilter(value);
              setPage(1);
            }}
            className={`rounded-lg border px-3 py-1.5 font-medium capitalize ${
              filter === value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {status === 'error' ? (
        <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-medium text-rose-800">We couldn&apos;t load the technicians.</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
          <span className="sr-only">{error?.message}</span>
        </div>
      ) : status === 'loading' && !data ? (
        <div className="mt-6 space-y-2" aria-busy="true" aria-label="Loading technicians">
          <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No technicians match this filter.</p>
      ) : data ? (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Area</th>
                  <th className="py-2 pr-4">Services</th>
                  <th className="py-2 pr-4">Active jobs</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 font-medium text-slate-900">{t.displayName}</td>
                    <td className="py-2 pr-4 text-slate-600">{t.serviceArea}</td>
                    <td className="py-2 pr-4 tabular-nums text-slate-600">
                      {t.qualifiedServiceCount}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-slate-600">
                      {t.activeAssignmentCount}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {t.active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        to={`/operations/technicians/${t.id}`}
                        className="text-sm font-medium text-sky-700 hover:underline"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)} ·{' '}
              {data.pagination.total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data.pagination.hasPreviousPage}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data.pagination.hasNextPage}
                className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
