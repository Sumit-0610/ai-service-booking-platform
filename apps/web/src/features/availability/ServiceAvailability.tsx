import { useMemo, useState, type ReactElement } from 'react';
import type { PublicSlot } from '@aisbp/shared';
import {
  formatLocalDate,
  formatLocalTime,
  localDateKey,
  localTimeZone,
  useServiceAvailability,
} from './use-availability';

function groupByLocalDate(
  slots: PublicSlot[],
): { key: string; iso: string; slots: PublicSlot[] }[] {
  const groups = new Map<string, PublicSlot[]>();
  for (const slot of slots) {
    const key = localDateKey(slot.startsAt);
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, daySlots]) => ({ key, iso: daySlots[0]!.startsAt, slots: daySlots }));
}

export function ServiceAvailability({ slug }: { slug: string }): ReactElement {
  const { status, slots, error, refetch } = useServiceAvailability(slug);
  const days = useMemo(() => groupByLocalDate(slots), [slots]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const activeDay = days.find((d) => d.key === selectedDate) ?? days[0];

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Availability</h2>
        <span className="text-xs text-slate-400">Times shown in {localTimeZone}</span>
      </div>

      {status === 'loading' ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading availability">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : status === 'error' ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="font-medium text-rose-800">We couldn&apos;t load available times.</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-2 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
          <span className="sr-only">{error?.message}</span>
        </div>
      ) : days.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No available times in the next two weeks. Please check back later.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Dates">
            {days.map((day) => {
              const isActive = day.key === activeDay?.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setSelectedDate(day.key);
                    setSelectedSlot(null);
                  }}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-center text-sm transition ${
                    isActive
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <span className="block font-medium">{formatLocalDate(day.iso)}</span>
                  <span className={`text-xs ${isActive ? 'text-sky-100' : 'text-slate-400'}`}>
                    {day.slots.length} {day.slots.length === 1 ? 'slot' : 'slots'}
                  </span>
                </button>
              );
            })}
          </div>

          {activeDay ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeDay.slots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  aria-pressed={selectedSlot === slot.id}
                  onClick={() => setSelectedSlot(slot.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    selectedSlot === slot.id
                      ? 'border-sky-600 bg-sky-50 text-sky-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  {formatLocalTime(slot.startsAt)} &ndash; {formatLocalTime(slot.endsAt)}
                </button>
              ))}
            </div>
          ) : null}

          <p className="mt-4 text-sm text-slate-500">
            {selectedSlot
              ? 'Time selected — online booking opens in a later release.'
              : 'Select a time — booking coming next.'}
          </p>
        </>
      )}
    </section>
  );
}
