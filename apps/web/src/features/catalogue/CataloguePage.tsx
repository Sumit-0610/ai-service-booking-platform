import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalogueSortValues, type CatalogueSort } from '@aisbp/shared';
import { CategoryFilter, Pagination, SearchBar, SortSelect } from './CatalogueControls';
import { ServiceCard, ServiceCardSkeleton } from './ServiceCard';
import { useCategories, useDebouncedValue, useServices } from './use-catalogue';

function readSort(raw: string | null): CatalogueSort {
  return (catalogueSortValues as readonly string[]).includes(raw ?? '')
    ? (raw as CatalogueSort)
    : 'name_asc';
}

export function CataloguePage(): ReactElement {
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const category = params.get('category');
  const sort = readSort(params.get('sort'));
  const page = Math.max(1, Math.trunc(Number(params.get('page') ?? '1')) || 1);

  const [searchInput, setSearchInput] = useState(q);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);

  const mutateParams = (mutate: (next: URLSearchParams) => void) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace: true },
    );
  };

  // One-way: the debounced search box drives the URL (and resets the page).
  useEffect(() => {
    if (debouncedSearch === q) return;
    mutateParams((next) => {
      if (debouncedSearch) next.set('q', debouncedSearch);
      else next.delete('q');
      next.delete('page');
    });
  }, [debouncedSearch, q]);

  const categories = useCategories();
  const services = useServices({
    q: q || undefined,
    category: category ?? undefined,
    sort,
    page,
  });

  const onSelectCategory = (slug: string | null) =>
    mutateParams((next) => {
      if (slug) next.set('category', slug);
      else next.delete('category');
      next.delete('page');
    });

  const onChangeSort = (value: CatalogueSort) =>
    mutateParams((next) => {
      if (value === 'name_asc') next.delete('sort');
      else next.set('sort', value);
      next.delete('page');
    });

  const onChangePage = (nextPage: number) => {
    mutateParams((next) => {
      if (nextPage <= 1) next.delete('page');
      else next.set('page', String(nextPage));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearAll = () => {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const hasFilters = Boolean(q || category);
  const list = services.data;
  const isInitialLoad = services.status === 'loading' && !list;
  const isRefetching = services.status === 'loading' && Boolean(list);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Service catalogue</h1>
        <p className="mt-2 text-slate-600">
          Browse the home services we install and set up. Pick one to see the details.
        </p>
      </header>

      <div className="mt-8 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-sm sm:flex-1">
            <SearchBar value={searchInput} onChange={setSearchInput} />
          </div>
          <div className="sm:ml-auto">
            <SortSelect value={sort} onChange={onChangeSort} />
          </div>
        </div>

        {categories.status === 'success' && categories.data ? (
          <CategoryFilter
            categories={categories.data}
            selected={category}
            onSelect={onSelectCategory}
          />
        ) : null}
      </div>

      <div className="mt-8">
        {isInitialLoad ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-label="Loading services"
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <ServiceCardSkeleton key={index} />
            ))}
          </div>
        ) : services.status === 'error' ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center"
          >
            <p className="font-semibold text-rose-800">We couldn&apos;t load the catalogue.</p>
            <p className="mt-1 text-sm text-rose-700">
              {services.error?.message ?? 'Please try again in a moment.'}
            </p>
            <button
              type="button"
              onClick={services.refetch}
              className="mt-4 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : list && list.items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <p className="text-lg font-semibold text-slate-900">No services match your search.</p>
            <p className="mt-1 text-sm text-slate-600">Try a different keyword or category.</p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearAll}
                className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : list ? (
          <>
            <p className="text-sm text-slate-500" aria-live="polite">
              {list.pagination.total} {list.pagination.total === 1 ? 'service' : 'services'}
            </p>
            <div
              className={`mt-3 grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${
                isRefetching ? 'opacity-60' : 'opacity-100'
              }`}
            >
              {list.items.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
            <Pagination
              page={list.pagination.page}
              totalPages={list.pagination.totalPages}
              hasNextPage={list.pagination.hasNextPage}
              hasPreviousPage={list.pagination.hasPreviousPage}
              onPageChange={onChangePage}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
