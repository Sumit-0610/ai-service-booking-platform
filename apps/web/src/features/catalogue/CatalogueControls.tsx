import type { ReactElement } from 'react';
import { catalogueSortValues, type CatalogueCategory, type CatalogueSort } from '@aisbp/shared';

const SORT_LABELS: Record<CatalogueSort, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  price_asc: 'Price (low to high)',
  price_desc: 'Price (high to low)',
  newest: 'Newest',
};

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.63 3.64a1 1 0 0 0 1.42-1.42l-3.64-3.63A5.5 5.5 0 0 0 9 3.5ZM5.5 9a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
          clipRule="evenodd"
        />
      </svg>
      <input
        type="search"
        aria-label="Search services"
        placeholder="Search services…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
      />
    </div>
  );
}

export function SortSelect({
  value,
  onChange,
}: {
  value: CatalogueSort;
  onChange: (value: CatalogueSort) => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="hidden sm:inline">Sort</span>
      <select
        aria-label="Sort services"
        value={value}
        onChange={(event) => onChange(event.target.value as CatalogueSort)}
        className="rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
      >
        {catalogueSortValues.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: CatalogueCategory[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}): ReactElement {
  const pill = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? 'border-sky-600 bg-sky-600 text-white'
        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
    }`;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      <button type="button" className={pill(selected === null)} onClick={() => onSelect(null)}>
        All services
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          type="button"
          className={pill(selected === category.slug)}
          aria-pressed={selected === category.slug}
          onClick={() => onSelect(category.slug)}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPageChange: (page: number) => void;
}): ReactElement | null {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
      <button
        type="button"
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!hasPreviousPage}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span className="px-2 text-sm text-slate-600" aria-current="page">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!hasNextPage}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
