import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { formatDuration, formatPrice } from '@aisbp/shared';
import { ServiceAvailability } from '../availability/ServiceAvailability';
import { useService } from './use-catalogue';

export function ServiceDetailPage(): ReactElement {
  const { slug = '' } = useParams();
  const { status, data: service, error, refetch } = useService(slug);

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-8 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-11/12 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
        </div>
      </main>
    );
  }

  if (status === 'error') {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6" role="alert">
        <h1 className="text-2xl font-bold text-slate-900">
          {notFound ? 'Service not found' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-slate-600">
          {notFound
            ? 'This service is no longer available.'
            : (error?.message ?? 'Please try again in a moment.')}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to catalogue
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

  if (!service) return <main className="mx-auto max-w-3xl px-4 py-10" />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-slate-700">
          Catalogue
        </Link>
        <span className="px-2">/</span>
        <Link to={`/?category=${service.category.slug}`} className="hover:text-slate-700">
          {service.category.name}
        </Link>
      </nav>

      <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{service.name}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-2xl font-semibold text-slate-900">
          {formatPrice(service.priceCents, service.currency)}
        </span>
        <span className="text-slate-600">
          Estimated time: {formatDuration(service.durationMinutes)}
        </span>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          What&apos;s included
        </h2>
        <p className="mt-2 whitespace-pre-line text-slate-700">{service.description}</p>
      </div>

      <ServiceAvailability slug={service.slug} />
    </main>
  );
}
