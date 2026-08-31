import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CatalogueService, OperationsTechnician } from '@aisbp/shared';
import { ApiError } from '../../lib/api';
import { catalogueApi } from '../catalogue/catalogue-api';
import { operationsApi } from './operations-api';
import { useOpsTechnician } from './use-operations';

export function OperationsTechnicianDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { status, technician, error, refetch, setTechnician } = useOpsTechnician(id);
  const [services, setServices] = useState<CatalogueService[]>([]);
  const [addServiceId, setAddServiceId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    catalogueApi
      .listServices({ limit: 48, sort: 'name_asc' })
      .then((r) => {
        if (active) setServices(r.items);
      })
      .catch(() => {
        /* the dropdown just stays empty */
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (label: string, fn: () => Promise<{ technician: OperationsTechnician }>) => {
    setBusy(label);
    setActionError(null);
    setNotice(null);
    try {
      const { technician: next } = await fn();
      setTechnician(next);
      setNotice('Saved.');
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(null);
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

  if (status === 'error' || !technician) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6" role="alert">
        <h1 className="text-xl font-bold text-slate-900">
          {notFound ? 'Technician not found' : 'Something went wrong'}
        </h1>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/operations/technicians"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to technicians
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

  const qualifiedSlugs = new Set(technician.qualifications.map((q) => q.slug));
  const addableServices = services.filter((s) => !qualifiedSlugs.has(s.slug));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link to="/operations/technicians" className="text-sm text-slate-500 hover:text-slate-700">
        ← Technicians
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{technician.displayName}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {technician.name} · {technician.email} · {technician.serviceArea}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            technician.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {technician.active ? 'active' : 'inactive'}
        </span>
      </div>

      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-700">
          {actionError}
        </p>
      ) : null}

      <section
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"
        aria-label="Status"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Availability
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {technician.activeAssignmentCount} active assignment
          {technician.activeAssignmentCount === 1 ? '' : 's'}.{' '}
          {technician.active
            ? 'Deactivating stops new assignments; existing jobs are unaffected.'
            : 'Inactive technicians cannot be newly assigned.'}
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            if (
              technician.active &&
              !window.confirm('Deactivate this technician? They will not receive new assignments.')
            ) {
              return;
            }
            void run('status', () =>
              operationsApi.setTechnicianActive(technician.id, !technician.active),
            );
          }}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {busy === 'status'
            ? 'Saving…'
            : technician.active
              ? 'Deactivate technician'
              : 'Reactivate technician'}
        </button>
      </section>

      <section
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"
        aria-label="Qualifications"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Service qualifications
        </h2>
        {technician.qualifications.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No services yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {technician.qualifications.map((q) => (
              <li key={q.serviceId} className="flex items-center justify-between gap-4">
                <span className="text-slate-700">
                  {q.name}
                  {!q.active ? ' (inactive service)' : ''}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`rm-${q.serviceId}`, () =>
                      operationsApi.removeQualification(technician.id, q.serviceId),
                    )
                  }
                  className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                >
                  {busy === `rm-${q.serviceId}` ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Service to add</span>
            <select
              value={addServiceId}
              onChange={(e) => setAddServiceId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              aria-label="Service to add"
            >
              <option value="">Add a service…</option>
              {addableServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy !== null || addServiceId === ''}
            onClick={() =>
              void run('add', async () => {
                const result = await operationsApi.addQualification(technician.id, addServiceId);
                setAddServiceId('');
                return result;
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
          >
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </section>
    </main>
  );
}
