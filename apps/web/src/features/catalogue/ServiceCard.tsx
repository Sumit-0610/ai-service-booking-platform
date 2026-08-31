import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatDuration, formatPrice, type CatalogueService } from '@aisbp/shared';

export function ServiceCard({ service }: { service: CatalogueService }): ReactElement {
  return (
    <Link
      to={`/services/${service.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
    >
      <span className="inline-flex w-fit rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
        {service.category.name}
      </span>
      <h3 className="mt-3 text-lg font-semibold text-slate-900 group-hover:text-sky-700">
        {service.name}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-sm text-slate-600">{service.description}</p>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-base font-semibold text-slate-900">
          {formatPrice(service.priceCents, service.currency)}
        </span>
        <span className="text-sm text-slate-500">{formatDuration(service.durationMinutes)}</span>
      </div>
    </Link>
  );
}

export function ServiceCardSkeleton(): ReactElement {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5">
      <div className="h-4 w-20 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="mt-6 flex justify-between border-t border-slate-100 pt-3">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-12 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}
